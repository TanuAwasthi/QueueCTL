const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createQueueEngine, defaultConfig } = require('../src/queue');

test('enqueue and list jobs', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queuectl-test-'));
  const engine = createQueueEngine({ dataDir: tempDir });

  const job = await engine.enqueue({
    id: 'job-1',
    command: 'node -e "process.exit(0)"'
  });

  assert.equal(job.state, 'pending');
  const jobs = await engine.listJobs('pending');
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].id, 'job-1');
});

test('successful job completes and failed job reaches DLQ after retries', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queuectl-test-'));
  const engine = createQueueEngine({ dataDir: tempDir, config: { ...defaultConfig, maxRetries: 2, backoffBase: 1 } });

  await engine.enqueue({ id: 'job-2', command: 'node -e "process.exit(1)"', maxRetries: 2 });
  const result = await engine.processNextJob();
  assert.equal(result.state, 'failed');
  assert.equal(result.attempts, 1);

  await new Promise(resolve => setTimeout(resolve, 1200));
  const second = await engine.processNextJob();
  assert.equal(second.state, 'dead');
  const deadJobs = await engine.listDLQ();
  assert.equal(deadJobs.length, 1);
});
