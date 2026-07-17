const { createQueueEngine } = require("../src/queue");

const args = process.argv.slice(2);
const engine = createQueueEngine({ dataDir: process.cwd() + "/data" });

function formatJobAddedMessage(job) {
  return `✅ Job added successfully\nJob ID: ${job.id}\nCommand: ${job.command}`;
}

function formatWorkerStartMessages(workers) {
  if (!Array.isArray(workers) || workers.length === 0) {
    return "No workers were started.";
  }

  const lines = workers.map((worker, index) => `worker ${index + 1} started`);
  return ["✅ Workers started successfully", ...lines].join("\n");
}

function parsePayload(value) {
  if (typeof value !== "string") {
    throw new Error("A JSON payload is required");
  }

  let normalized = value.trim();
  if (
    (normalized.startsWith('"') && normalized.endsWith('"')) ||
    (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    normalized = normalized.slice(1, -1).trim();
  }

  normalized = normalized
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");

  try {
    return JSON.parse(normalized);
  } catch (error) {
    try {
      return parseObjectLikePayload(normalized);
    } catch (innerError) {
      throw new Error(`Invalid JSON payload: ${innerError.message}`);
    }
  }
}

function parseObjectLikePayload(input) {
  if (!input.startsWith("{") || !input.endsWith("}")) {
    throw new Error("Payload must be JSON or object-like syntax");
  }

  const body = input.slice(1, -1).trim();
  if (!body) {
    return {};
  }

  const entries = [];
  let current = "";
  let quote = null;
  let escaped = false;

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      current += char;
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      }
      current += char;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }

    if (char === ",") {
      entries.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    entries.push(current.trim());
  }

  const result = {};
  for (const entry of entries) {
    const separatorIndex = entry.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }

    const rawKey = entry
      .slice(0, separatorIndex)
      .trim()
      .replace(/^['"]|['"]$/g, "");
    const rawValue = entry.slice(separatorIndex + 1).trim();
    let parsedValue = rawValue.replace(/^['"]|['"]$/g, "");
    if (parsedValue === "true") {
      parsedValue = true;
    } else if (parsedValue === "false") {
      parsedValue = false;
    } else if (parsedValue === "null") {
      parsedValue = null;
    } else if (/^-?\d+$/.test(parsedValue)) {
      parsedValue = Number(parsedValue);
    }

    result[rawKey] = parsedValue;
  }

  return result;
}

function printHelp() {
  console.log(
    `QueueCTL CLI\n\nCommands:\n  enqueue <json>              Add a job to the queue\n  list [--state <state>]      List jobs by state\n  status                      Show queue summary\n  worker start --count <n>    Start worker processes\n  worker stop                 Stop workers gracefully\n  dlq list                    List dead-letter queue entries\n  dlq retry <id>              Retry a DLQ job\n  config set <key> <value>    Update configuration\n  help                        Show this help\n\nExamples:\n  node .\\bin\\queuectl.js enqueue '{"id":"job1","command":"echo hello"}'`,
  );
}

async function main() {
  if (args.length === 0 || args[0] === "help") {
    printHelp();
    return;
  }

  try {
    switch (args[0]) {
      case "enqueue": {
        const payload = parsePayload(args[1]);
        const job = await engine.enqueue(payload);
        console.log(formatJobAddedMessage(job));
        break;
      }
      case "list": {
        const state = args.includes("--state")
          ? args[args.indexOf("--state") + 1]
          : undefined;
        const jobs = await engine.listJobs(state);
        console.log(JSON.stringify(jobs, null, 2));
        break;
      }
      case "status": {
        const status = await engine.getStatus();
        console.log(JSON.stringify(status, null, 2));
        break;
      }
      case "worker": {
        if (args[1] === "start") {
          const count = Number(args[3] || 1);
          const workers = await engine.startWorkers(count);
          console.log(formatWorkerStartMessages(workers));
          console.log("Press Ctrl+C to stop.");

          process.on("SIGINT", async () => {
            console.log("\nGracefully stopping workers...");
            await engine.stopWorkers();
            process.exit(0);
          });
          await new Promise(() => {});
        } else if (args[1] === "stop") {
          const workers = await engine.stopWorkers();
          console.log(JSON.stringify(workers, null, 2));
        } else {
          throw new Error("Unknown worker command");
        }
        break;
      }
      case "dlq": {
        if (args[1] === "list") {
          const items = await engine.listDLQ();
          console.log(JSON.stringify(items, null, 2));
        }
        else if (args[1] === "retry") {
          const item = await engine.retryDLQ(args[2]);
          console.log(JSON.stringify(item, null, 2));
        }
        else {
          throw new Error("Unknown DLQ command");
        }
        break;
      }
      case "config": {
        if (args[1] === "set") {
          const config = await engine.setConfig(args[2], args[3]);
          console.log(JSON.stringify(config, null, 2));
        }
        else {
          throw new Error("Unknown config command");
        }
        break;
      }
      default:
        throw new Error(`Unknown command: ${args[0]}`);
    }
  }
  catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  formatJobAddedMessage,
  formatWorkerStartMessages
};
