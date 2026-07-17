# QueueCTL

QueueCTL is a lightweight CLI-based background job queue system built with Node.js. It supports:

- Enqueuing jobs
- Running multiple workers
- Retrying failed jobs with exponential backoff
- Moving permanently failed jobs to a Dead Letter Queue (DLQ)
- Persisting jobs to disk across restarts
- Managing configuration through the CLI

## Features

- Persistent JSON-backed storage in the `data/` folder
- CLI commands for enqueueing, listing, status, DLQ handling, and config
- Automatic retry handling with exponential backoff
- Basic worker management and graceful stop support

## Setup

1. Install Node.js 18+
2. Clone the repository and enter the project folder
3. Install dependencies (none are required beyond Node.js standard libraries)
4. Make the CLI executable:

```bash
chmod +x bin/queuectl.js
```

## Usage

### Enqueue a job

```bash
node bin/queuectl.js enqueue '{"id":"job1","command":"node -e \"process.exit(0)\""}'
```

For PowerShell, use single quotes around the JSON payload and escape the inner quotes carefully:

```powershell
node .\bin\queuectl.js enqueue '{"id":"job1","command":"echo hello"}'
```

### List pending jobs

```bash
node bin/queuectl.js list --state pending
```

### Start workers

```bash
node bin/queuectl.js worker start --count 2
```

### Check status

```bash
node bin/queuectl.js status
```

### View and retry DLQ items

```bash
node bin/queuectl.js dlq list
node bin/queuectl.js dlq retry job1
```

### Configure retries and backoff

```bash
node bin/queuectl.js config set max-retries 3
node bin/queuectl.js config set backoff-base 2
```

## Architecture Overview

- The queue engine is implemented in `src/queue.js`
- Job state is persisted in JSON files in `data/`
- Workers pick pending jobs, execute the shell command, and update the job state
- When a job fails and has exhausted its retry budget, it is moved to the DLQ

## Testing

Run the test suite:

```bash
npm test
```

## Assumptions and Trade-offs

- Storage uses JSON files instead of a database for simplicity and ease of local use
- Worker management is intentionally lightweight and process-safe for a minimal assignment prototype
- Shell execution is done via `spawn(..., { shell: true })` to allow simple commands like `echo` or `sleep`

## Demo

A short demo script is available in `scripts/demo.sh`.

### Demo video

Record a short screen demo showing:

- enqueueing a successful job
- enqueueing a failing job
- starting workers
- job processing and retry behavior
- DLQ list and retry flow
- status output

For the failing-job example, use a simple command such as:

```powershell
node .\bin\queuectl.js enqueue '{"id":"job-fail","command":"node -e process.exit(1)"}'
```

Upload the recording to Google Drive, YouTube (unlisted), or a similar service, then add the public link below.

Demo video link: https://your-demo-link-here
