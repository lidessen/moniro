#!/usr/bin/env bun
/**
 * Debug script to test cursor-agent behavior in different spawn configurations
 *
 * Run: bun test/debug-cursor.ts
 */

import { spawn, spawnSync } from 'node:child_process'

const MESSAGE = '2+2=?'

console.log('=== Testing cursor-agent spawn configurations ===\n')

// Test 1: Default spawn (no stdio specified)
async function test1() {
  console.log('Test 1: Default spawn (no stdio)')
  return new Promise<void>((resolve) => {
    const start = Date.now()
    const proc = spawn('cursor-agent', ['-p', MESSAGE])

    let stdout = ''
    let stderr = ''

    proc.stdout?.on('data', (data) => {
      stdout += data.toString()
      console.log('  stdout:', data.toString().trim())
    })

    proc.stderr?.on('data', (data) => {
      stderr += data.toString()
      console.log('  stderr:', data.toString().trim())
    })

    const timeout = setTimeout(() => {
      console.log('  TIMEOUT after 10s')
      proc.kill()
      resolve()
    }, 10000)

    proc.on('close', (code) => {
      clearTimeout(timeout)
      console.log(`  exit code: ${code}, duration: ${Date.now() - start}ms`)
      console.log(`  stdout length: ${stdout.length}`)
      resolve()
    })
  })
}

// Test 2: With explicit stdio: ['pipe', 'pipe', 'pipe']
async function test2() {
  console.log('\nTest 2: With stdio: pipe')
  return new Promise<void>((resolve) => {
    const start = Date.now()
    const proc = spawn('cursor-agent', ['-p', MESSAGE], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''

    proc.stdout?.on('data', (data) => {
      stdout += data.toString()
      console.log('  stdout:', data.toString().trim())
    })

    proc.stderr?.on('data', (data) => {
      console.log('  stderr:', data.toString().trim())
    })

    const timeout = setTimeout(() => {
      console.log('  TIMEOUT after 10s')
      proc.kill()
      resolve()
    }, 10000)

    proc.on('close', (code) => {
      clearTimeout(timeout)
      console.log(`  exit code: ${code}, duration: ${Date.now() - start}ms`)
      resolve()
    })
  })
}

// Test 3: With stdin closed immediately
async function test3() {
  console.log('\nTest 3: With stdin.end() immediately')
  return new Promise<void>((resolve) => {
    const start = Date.now()
    const proc = spawn('cursor-agent', ['-p', MESSAGE], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    // Close stdin immediately
    proc.stdin?.end()

    let stdout = ''

    proc.stdout?.on('data', (data) => {
      stdout += data.toString()
      console.log('  stdout:', data.toString().trim())
    })

    proc.stderr?.on('data', (data) => {
      console.log('  stderr:', data.toString().trim())
    })

    const timeout = setTimeout(() => {
      console.log('  TIMEOUT after 10s')
      proc.kill()
      resolve()
    }, 10000)

    proc.on('close', (code) => {
      clearTimeout(timeout)
      console.log(`  exit code: ${code}, duration: ${Date.now() - start}ms`)
      resolve()
    })
  })
}

// Test 4: With stdio: 'ignore' for stdin
async function test4() {
  console.log('\nTest 4: With stdin ignored')
  return new Promise<void>((resolve) => {
    const start = Date.now()
    const proc = spawn('cursor-agent', ['-p', MESSAGE], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''

    proc.stdout?.on('data', (data) => {
      stdout += data.toString()
      console.log('  stdout:', data.toString().trim())
    })

    proc.stderr?.on('data', (data) => {
      console.log('  stderr:', data.toString().trim())
    })

    const timeout = setTimeout(() => {
      console.log('  TIMEOUT after 10s')
      proc.kill()
      resolve()
    }, 10000)

    proc.on('close', (code) => {
      clearTimeout(timeout)
      console.log(`  exit code: ${code}, duration: ${Date.now() - start}ms`)
      resolve()
    })
  })
}

// Test 5: With inherit (uses TTY)
async function test5() {
  console.log('\nTest 5: With stdio: inherit (TTY)')
  return new Promise<void>((resolve) => {
    const start = Date.now()
    const proc = spawn('cursor-agent', ['-p', MESSAGE], {
      stdio: 'inherit',
    })

    const timeout = setTimeout(() => {
      console.log('  TIMEOUT after 10s')
      proc.kill()
      resolve()
    }, 10000)

    proc.on('close', (code) => {
      clearTimeout(timeout)
      console.log(`  exit code: ${code}, duration: ${Date.now() - start}ms`)
      resolve()
    })
  })
}

// Test 6: spawnSync
function test6() {
  console.log('\nTest 6: spawnSync')
  const start = Date.now()
  try {
    const result = spawnSync('cursor-agent', ['-p', MESSAGE], {
      timeout: 10000,
      encoding: 'utf-8',
    })
    console.log(`  exit code: ${result.status}, duration: ${Date.now() - start}ms`)
    console.log(`  stdout: ${result.stdout?.trim() || '(empty)'}`)
    console.log(`  stderr: ${result.stderr?.trim() || '(empty)'}`)
  } catch (e) {
    console.log(`  error: ${e}`)
  }
}

// Run all tests
async function main() {
  console.log('cursor-agent location:', await getCommandPath('cursor-agent'))
  console.log('')

  await test1()
  await test2()
  await test3()
  await test4()
  await test5()
  test6()

  console.log('\n=== Done ===')
}

async function getCommandPath(cmd: string): Promise<string> {
  return new Promise((resolve) => {
    const proc = spawn('which', [cmd])
    let path = ''
    proc.stdout?.on('data', (d) => { path += d.toString() })
    proc.on('close', () => resolve(path.trim() || 'not found'))
  })
}

main()
