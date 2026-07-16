#!/usr/bin/env bash
set -e

node bin/queuectl.js config set max-retries 2
node bin/queuectl.js config set backoff-base 1
node bin/queuectl.js enqueue '{"id":"demo-success","command":"node -e \"process.exit(0)\""}'
node bin/queuectl.js enqueue '{"id":"demo-fail","command":"node -e \"process.exit(1)\""}'
node bin/queuectl.js worker start --count 1
sleep 4
node bin/queuectl.js status
node bin/queuectl.js dlq list
