'use strict'

import {run} from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import {projectRoot} from './paths.mjs'

process.once('message', message => {
  if (message?.type !== 'run') return
  void main(message.options).catch(error => {
    process.exitCode = 1
    process.send?.({type: 'error', error: serializeError(error)}, () => process.disconnect?.())
  })
})

async function main(options) {
  const {file, editor, coverage, testNamePattern, shardTimeoutMs, testTimeout} = options
  const records = await requestCompiledRecords([file])
  const {initializeTestHooks} = await import('./bundle-hooks.mjs')
  initializeTestHooks(records, editor)
  const abort = new AbortController()
  const timeoutTimer = setTimeout(() => abort.abort(), shardTimeoutMs)
  timeoutTimer.unref?.()
  const stream = run({
    isolation: 'none',
    concurrency: false,
    cwd: projectRoot,
    files: [file],
    timeout: testTimeout,
    coverage,
    testNamePatterns: testNamePattern ? [new RegExp(testNamePattern)] : undefined,
    signal: abort.signal,
    coverageIncludeGlobs: coverage ? ['src/**/*.ts', '.cache/coc-test/bundle.js'] : undefined,
    coverageExcludeGlobs: coverage ? ['src/__tests__/**', '**/*.test.ts', '**/*.d.ts', '**/*.json'] : undefined,
  })
  const stats = {passed: 0, failed: 0, skipped: 0, todo: 0, failures: [], diagnostics: []}
  const leafStats = {[file]: {passed: 0, failed: 0}}
  const captured = []
  let coverageSummary
  let suiteFailures = 0
  let durationMs = 0
  process.send?.({type: 'progress', file, state: {status: 'running', durationMs: 0}})
  for await (const event of stream) {
    const data = event.data
    const isLeaf = data.details?.type === 'test'
    switch (event.type) {
      case 'test:pass':
        if (isLeaf) {
          stats.passed++
          leafStats[file].passed++
          durationMs += data.details?.duration_ms ?? 0
        }
        break
      case 'test:fail':
        if (isLeaf) {
          const serialized = serializeData(data)
          stats.failed++
          leafStats[file].failed++
          durationMs += data.details?.duration_ms ?? 0
          stats.failures.push(serialized)
          process.send?.({type: 'failure', data: serialized})
        } else {
          suiteFailures++
        }
        break
      case 'test:skip':
        stats.skipped++
        break
      case 'test:todo':
        stats.todo++
        break
      case 'test:coverage':
        coverageSummary = data?.summary
        break
      case 'test:diagnostic':
        if (!/^(tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) /.test(data.message)) {
          stats.diagnostics.push(data.message)
        }
        break
      case 'test:stderr':
      case 'test:stdout':
        if (typeof data.message === 'string') {
          captured.push(data.message)
          process.send?.({
            type: 'output',
            stream: event.type === 'test:stderr' ? 'stderr' : 'stdout',
            message: data.message,
          })
        }
        break
    }
  }
  clearTimeout(timeoutTimer)
  if (stats.failed === 0 && suiteFailures > 0) {
    stats.failed = suiteFailures
    stats.failures.push({
      name: 'suite failure',
      file,
      details: {error: {message: captured.join('').trim() || 'a test suite failed to load or threw before any test ran'}},
    })
  }
  const roundedDuration = Math.round(durationMs)
  process.send?.({
    type: 'progress',
    file,
    state: {status: stats.failed > 0 ? 'failed' : 'passed', durationMs: roundedDuration},
  })
  process.send?.({
    type: 'result',
    result: {
      stats,
      timings: {[file]: roundedDuration},
      leafStats,
      coverage: coverageSummary,
      timedOut: abort.signal.aborted,
    },
  }, () => process.disconnect?.())
}

function requestCompiledRecords(files) {
  return new Promise(resolve => {
    const onMessage = message => {
      if (message.type !== 'compiled') return
      process.off('message', onMessage)
      resolve(message.records)
    }
    process.on('message', onMessage)
    process.send?.({type: 'request-compiled', files})
  })
}

function serializeData(data) {
  return {
    name: data.name,
    file: data.file,
    details: data.details ? {...data.details, error: serializeError(data.details.error)} : undefined,
  }
}

function serializeError(error) {
  if (!error) return undefined
  return {
    message: error.message,
    stack: error.stack,
    cause: serializeError(error.cause),
  }
}
