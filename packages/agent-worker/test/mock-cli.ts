#!/usr/bin/env bun
/**
 * Mock CLI for testing cursor-agent, claude, and codex backends
 *
 * Usage:
 *   bun test/mock-cli.ts cursor-agent -p "hello"
 *   bun test/mock-cli.ts claude -p "hello"
 *   bun test/mock-cli.ts codex "hello"
 *
 * Environment variables:
 *   MOCK_DELAY_MS - Delay before responding (default: 100)
 *   MOCK_FAIL - If set, simulate a failure
 *   MOCK_TIMEOUT - If set, hang forever (for timeout testing)
 *   MOCK_EXIT_CODE - Exit with this code (default: 0)
 *   MOCK_RESPONSE - Custom response text
 */

const args = process.argv.slice(2)

// Parse command name (cursor-agent, claude, codex)
const command = args[0]

// Environment configuration
const delay = parseInt(process.env.MOCK_DELAY_MS || '100', 10)
const shouldFail = process.env.MOCK_FAIL === '1'
const shouldTimeout = process.env.MOCK_TIMEOUT === '1'
const slowOutputChunks = parseInt(process.env.MOCK_SLOW_OUTPUT_CHUNKS || '0', 10)
const slowOutputIntervalMs = parseInt(process.env.MOCK_SLOW_OUTPUT_INTERVAL_MS || '50', 10)
const exitCode = parseInt(process.env.MOCK_EXIT_CODE || '0', 10)
const customResponse = process.env.MOCK_RESPONSE

// Handle --version for availability check
if (args.includes('--version')) {
  console.log('mock-cli 1.0.0')
  process.exit(0)
}

// Handle --help
if (args.includes('--help')) {
  console.log(`Mock CLI - simulates ${command || 'agent'} behavior for testing`)
  console.log('\nOptions:')
  console.log('  -p <message>     Print mode (cursor-agent)')
  console.log('  --version        Show version')
  console.log('  --help           Show help')
  process.exit(0)
}

// Simulate timeout (hang forever)
if (shouldTimeout) {
  // Do nothing, just hang
  await new Promise(() => {})
}

// Simulate slow output (chunks of text with delays between them)
// Used to test idle timeout reset behavior
if (slowOutputChunks > 0) {
  for (let i = 0; i < slowOutputChunks; i++) {
    process.stdout.write(`chunk ${i + 1}\n`)
    await new Promise(resolve => setTimeout(resolve, slowOutputIntervalMs))
  }
  process.stdout.write('done\n')
  process.exit(0)
}

// Extract message from args
let message = ''

if (command === 'cursor-agent') {
  // cursor-agent -p "message" or cursor-agent "message" -p
  const pIndex = args.indexOf('-p')
  if (pIndex !== -1 && args[pIndex + 1]) {
    message = args[pIndex + 1]!
  } else {
    // Try finding message before -p
    for (let i = 1; i < args.length; i++) {
      if (args[i] !== '-p' && !args[i]?.startsWith('-')) {
        message = args[i] ?? ''
        break
      }
    }
  }
} else if (command === 'claude') {
  // claude -p "message"
  const pIndex = args.indexOf('-p')
  if (pIndex !== -1 && args[pIndex + 1]) {
    message = args[pIndex + 1]!
  }
} else if (command === 'codex') {
  // codex "message"
  message = args[1] || ''
}

// Simulate delay
await new Promise(resolve => setTimeout(resolve, delay))

// Simulate failure
if (shouldFail) {
  console.error('Mock CLI error: simulated failure')
  process.exit(1)
}

// Generate response
let response: string

if (customResponse) {
  response = customResponse
} else if (message.includes('2+2')) {
  response = '4'
} else if (message.toLowerCase().includes('hello')) {
  response = 'Hello! How can I help you today?'
} else if (message.toLowerCase().includes('error')) {
  // Simulate an error response
  console.error('Error processing request')
  process.exit(1)
} else {
  response = `Mock response to: ${message}`
}

// Check output format
const outputFormat = args.find(a => a.startsWith('--output-format='))?.split('=')[1]

if (outputFormat === 'stream-json') {
  // Output JSON format like cursor-agent does
  const sessionId = crypto.randomUUID()
  console.log(JSON.stringify({ type: 'system', subtype: 'init', model: 'Mock Model', session_id: sessionId }))
  console.log(JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: message }] }, session_id: sessionId }))
  console.log(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: response }] }, session_id: sessionId }))
  console.log(JSON.stringify({ type: 'result', subtype: 'success', result: response, duration_ms: delay, session_id: sessionId }))
} else {
  // Plain text output
  console.log(response)
}

process.exit(exitCode)
