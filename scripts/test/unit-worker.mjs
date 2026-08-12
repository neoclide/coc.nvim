'use strict'
import {run} from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import {parentPort, workerData} from 'node:worker_threads'
import {projectRoot} from './paths.mjs'
import {initializeTestHooks} from './bundle-hooks.mjs'

const {files, testNamePattern, shardTimeoutMs, testTimeout} = workerData
const requestedFiles = new Set(files)
const startedFiles = new Set()
const finishedFiles = new Set()

function relPath(file) {
  const rel = path.relative(projectRoot, file)
  if (!rel.endsWith('.ts') && fs.existsSync(path.join(projectRoot, rel + '.ts'))) {
    return rel + '.ts'
  }
  return rel
}

function serializeError(error) {
  if (!error) return undefined
  return {
    message: error.message,
    stack: error.stack,
    cause: serializeError(error.cause),
  }
}

function serializeData(data) {
  return {
    name: data.name,
    file: data.file,
    details: data.details ? {...data.details, error: serializeError(data.details.error)} : undefined,
  }
}

async function main() {
  const records = await requestCompiledRecords(files)
  initializeTestHooks(records, undefined, undefined, testNamePattern)
  const abort = new AbortController()
  const timeoutTimer = setTimeout(() => abort.abort(), shardTimeoutMs)
  timeoutTimer.unref?.()
  const runOptions = {
    isolation: 'none',
    concurrency: false,
    cwd: projectRoot,
    // Keep files relative to projectRoot (the run cwd); node:test resolves
    // them against cwd before spawning.
    files: files.map(file => (path.isAbsolute(file) ? path.relative(projectRoot, file) : file)),
    timeout: testTimeout,
    testNamePatterns: testNamePattern ? [new RegExp(testNamePattern)] : undefined,
    signal: abort.signal,
  }
  const stream = run(runOptions)
  const stats = {passed: 0, failed: 0, skipped: 0, todo: 0, failures: [], diagnostics: []}
  const fileDurations = new Map()
  const fileLeafStats = new Map()
  const failedFiles = new Set()
  let suiteFailures = 0
  let currentFile
  const captured = []

  for await (const event of stream) {
    const data = event.data
    const file = data.file ? relPath(data.file) : undefined
    if (event.type === 'test:start' && file && requestedFiles.has(file) && !startedFiles.has(file)) {
      if (currentFile) finishFile(currentFile)
      currentFile = file
      startedFiles.add(file)
      parentPort.postMessage({type: 'progress', file, state: {status: 'running', durationMs: 0}})
    }
    const isLeaf = data.details?.type === 'test'
    switch (event.type) {
      case 'test:pass':
        if (isLeaf) {
          stats.passed++
          addDuration(data)
          bumpLeaf(data, true)
        }
        break
      case 'test:fail': {
        if (file) failedFiles.add(file)
        if (isLeaf) {
          const serialized = serializeData(data)
          stats.failed++
          stats.failures.push(serialized)
          addDuration(data)
          bumpLeaf(data, false)
          parentPort.postMessage({type: 'failure', data: serialized})
        } else {
          suiteFailures++
        }
        break
      }
      case 'test:skip':
        stats.skipped++
        break
      case 'test:todo':
        stats.todo++
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
          parentPort.postMessage({
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
      file: failedFiles.values().next().value ?? currentFile ?? files[0],
      details: {error: {message: captured.join('').trim() || 'a test suite failed to load or threw before any test ran'}},
    })
  }

  const timings = {}
  const leafStats = {}
  if (currentFile) finishFile(currentFile)
  for (const file of files) {
    const durationMs = Math.round(fileDurations.get(file) ?? 0)
    timings[file] = durationMs
    leafStats[file] = fileLeafStats.get(file) ?? {passed: 0, failed: 0}
    if (!finishedFiles.has(file)) {
      parentPort.postMessage({type: 'progress', file, state: {status: 'running', durationMs: 0}})
      finishFile(file)
    }
  }
  parentPort.postMessage({
    type: 'result',
    result: {stats, timings, leafStats, timedOut: abort.signal.aborted},
  })

  function addDuration(data) {
    if (!data.file || typeof data.details?.duration_ms !== 'number') return
    const file = relPath(data.file)
    fileDurations.set(file, (fileDurations.get(file) ?? 0) + data.details.duration_ms)
  }

  function bumpLeaf(data, passed) {
    if (!data.file) return
    const file = relPath(data.file)
    const counts = fileLeafStats.get(file) ?? {passed: 0, failed: 0}
    if (passed) counts.passed++
    else counts.failed++
    fileLeafStats.set(file, counts)
  }

  function finishFile(file) {
    if (finishedFiles.has(file)) return
    finishedFiles.add(file)
    parentPort.postMessage({
      type: 'progress',
      file,
      state: {
        status: failedFiles.has(file) ? 'failed' : 'passed',
        durationMs: Math.round(fileDurations.get(file) ?? 0),
      },
    })
  }
}

function requestCompiledRecords(files) {
  return new Promise(resolve => {
    const onMessage = message => {
      if (message.type !== 'compiled') return
      parentPort.off('message', onMessage)
      resolve(message.records)
    }
    parentPort.on('message', onMessage)
    parentPort.postMessage({type: 'request-compiled', files})
  })
}

main().catch(error => {
  parentPort.postMessage({type: 'error', error: serializeError(error)})
})
