const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const defaultConfig = {
  maxRetries: 3,
  backoffBase: 2,
  workerCount: 1,
  dataDir: path.join(process.cwd(), 'data')
};

function createQueueEngine(options = {}) {
  const config = { ...defaultConfig, ...options.config, dataDir: options.dataDir || options.config?.dataDir || defaultConfig.dataDir };
  const jobsPath = path.join(config.dataDir, 'jobs.json');
  const dlqPath = path.join(config.dataDir, 'dlq.json');
  const statePath = path.join(config.dataDir, 'state.json');

  ensureDir(config.dataDir);

  function readJson(filePath, fallback) {
    if (!fs.existsSync(filePath)) return fallback;
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return fallback;
    }
  }

  function writeJson(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  }

  function loadState() {
    return readJson(statePath, { workers: [] });
  }

  function saveState(state) {
    writeJson(statePath, state);
  }

  function acquireProcessingLock() {
    const lockPath = path.join(config.dataDir, '.queue.lock');
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.closeSync(fd);
      return { lockPath };
    } catch (error) {
      if (error.code === 'EEXIST') {
        return null;
      }
      throw error;
    }
  }

  function releaseProcessingLock(lock) {
    if (!lock) return;
    try {
      fs.rmSync(lock.lockPath, { force: true });
    } catch {
      console.error(`Failed to release processing lock at ${lock.lockPath}`);
    }
  }

  function loadJobs() {
    return readJson(jobsPath, []);
  }

  function saveJobs(jobs) {
    writeJson(jobsPath, jobs);
  }

  function loadDLQ() {
    return readJson(dlqPath, []);
  }

  function saveDLQ(items) {
    writeJson(dlqPath, items);
  }

  async function enqueue(input) {
    const effectiveConfig = await getConfig();
    const jobs = loadJobs();
    const now = new Date().toISOString();
    const job = {
      id: input.id || `job-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      command: input.command,
      state: 'pending',
      attempts: 0,
      max_retries: input.maxRetries || effectiveConfig.maxRetries || config.maxRetries,
      created_at: now,
      updated_at: now,
      output: ''
    };
    jobs.push(job);
    saveJobs(jobs);
    return job;
  }

  async function listJobs(state) {
    const jobs = loadJobs();
    if (!state) return jobs;
    return jobs.filter(job => job.state === state);
  }

  async function listDLQ() {
    return loadDLQ();
  }

  async function retryDLQ(id) {
    const dlq = loadDLQ();
    const item = dlq.find(entry => entry.id === id);
    if (!item) throw new Error(`DLQ item not found: ${id}`);
    const jobs = loadJobs();
    const restored = { ...item, state: 'pending', attempts: 0, updated_at: new Date().toISOString() };
    jobs.push(restored);
    saveJobs(jobs);
    const updatedDLQ = dlq.filter(entry => entry.id !== id);
    saveDLQ(updatedDLQ);
    return restored;
  }

  async function getJob(id) {
    const jobs = loadJobs();
    return jobs.find(job => job.id === id);
  }

  async function updateJob(jobId, updates) {
    const jobs = loadJobs();
    const index = jobs.findIndex(job => job.id === jobId);
    if (index === -1) return null;
    jobs[index] = { ...jobs[index], ...updates, updated_at: new Date().toISOString() };
    saveJobs(jobs);
    return jobs[index];
  }

  async function processNextJob() {
    const lock = acquireProcessingLock();
    if (!lock) return null;

    try {
      const jobs = loadJobs();
      const now = Date.now();
      const availableJob = jobs.find(job => job.state === 'pending') || jobs.find(job => job.state === 'failed' && (!job.next_retry_at || job.next_retry_at <= now) && job.attempts < job.max_retries);
      if (!availableJob) return null;

      const processingJob = { ...availableJob, state: 'processing', attempts: availableJob.attempts + 1, updated_at: new Date().toISOString() };
      jobs[jobs.findIndex(job => job.id === availableJob.id)] = processingJob;
      saveJobs(jobs);

      const result = await runCommand(processingJob.command);
      if (result.success) {
        await updateJob(processingJob.id, { state: 'completed', output: result.output, next_retry_at: null });
        return { ...processingJob, state: 'completed', output: result.output };
      }

      if (processingJob.attempts < processingJob.max_retries) {
        const backoffDelay = Math.pow(config.backoffBase, processingJob.attempts - 1);
        await updateJob(processingJob.id, {
          state: 'failed',
          attempts: processingJob.attempts,
          output: result.output,
          next_retry_at: Date.now() + backoffDelay * 1000
        });
        return { ...processingJob, state: 'failed', attempts: processingJob.attempts, output: result.output };
      }

      const dlq = loadDLQ();
      dlq.push({ ...processingJob, state: 'dead', output: result.output });
      saveDLQ(dlq);
      await updateJob(processingJob.id, { state: 'dead', output: result.output, next_retry_at: null });
      return { ...processingJob, state: 'dead', output: result.output };
    } finally {
      releaseProcessingLock(lock);
    }
  }

  async function runCommand(command) {
    return new Promise((resolve) => {
      const child = spawn(command, { shell: true, cwd: process.cwd() });
      let output = '';
      child.stdout.on('data', chunk => { output += chunk.toString(); });
      child.stderr.on('data', chunk => { output += chunk.toString(); });
      child.on('error', () => resolve({ success: false, output: `${output}Command failed` }));
      child.on('close', code => resolve({ success: code === 0, output: output.trim() || `Exit code ${code}` }));
    });
  }

  async function getStatus() {
    const jobs = loadJobs();
    const dlq = loadDLQ();
    const state = loadState();
    return {
      jobs: jobs.length,
      pending: jobs.filter(job => job.state === 'pending').length,
      processing: jobs.filter(job => job.state === 'processing').length,
      completed: jobs.filter(job => job.state === 'completed').length,
      failed: jobs.filter(job => job.state === 'failed').length,
      dead: jobs.filter(job => job.state === 'dead').length,
      dlq: dlq.length,
      workers: state.workers.length
    };
  }

  async function startWorkers(count) {
    const state = loadState();
    const workers = Array.from({ length: count }, (_, index) => ({ id: `worker-${Date.now()}-${index}`, running: true }));
    state.workers = [...state.workers, ...workers];
    saveState(state);

    workers.forEach(worker => {
      const timer = setInterval(async () => {
        const currentState = loadState();
        if (!currentState.workers.some(entry => entry.id === worker.id && entry.running)) {
          clearInterval(timer);
          return;
        }
        await processNextJob();
      }, 1000);
    });

    return workers;
  }

  async function stopWorkers() {
    const state = loadState();
    state.workers = state.workers.map(worker => ({ ...worker, running: false }));
    saveState(state);
    return state.workers;
  }

  async function setConfig(key, value) {
    const state = loadState();
    state.config = state.config || {};
    const normalizedKey = key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const normalizedValue = ['maxRetries', 'backoffBase', 'workerCount'].includes(normalizedKey) ? Number(value) : value;
    state.config[normalizedKey] = normalizedValue;
    saveState(state);
    return state.config;
  }

  async function getConfig() {
    const state = loadState();
    const merged = { ...defaultConfig, ...state.config };
    return {
      ...merged,
      maxRetries: Number(merged.maxRetries ?? defaultConfig.maxRetries),
      backoffBase: Number(merged.backoffBase ?? defaultConfig.backoffBase),
      workerCount: Number(merged.workerCount ?? defaultConfig.workerCount)
    };
  }

  return {
    enqueue,
    listJobs,
    listDLQ,
    retryDLQ,
    getJob,
    updateJob,
    processNextJob,
    getStatus,
    startWorkers,
    stopWorkers,
    setConfig,
    getConfig
  };
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

module.exports = {
  createQueueEngine,
  defaultConfig
};
