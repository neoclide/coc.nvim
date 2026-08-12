'use strict'

import {fork} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {Worker} from 'node:worker_threads'
import {ISOLATED_UNIT_TESTS} from './discover.mjs'
import {projectRoot} from './paths.mjs'
import {writeBundleFiles} from './bundle.mjs'
import {TestCompiler} from './compiler.mjs'
import {runProcessPool} from './process-pool.mjs'

// Read once in the main process; every worker/editor child receives the
// source with its compiled records instead of re-reading editor-session.mjs
// from disk.
const editorSessionSource = fs.readFileSync(
  path.join(projectRoot, 'scripts', 'test', 'editor-session.mjs'),
  'utf8'
)

function relPath(absPath) {
  // Relative inputs are relative to projectRoot (the run cwd); resolve them
  // against it explicitly so the mapping also works when the parent process
  // was started from a different directory.
  const p = path.isAbsolute(absPath) ? absPath : path.resolve(projectRoot, absPath)
  const relRoot = path.relative(projectRoot, p)
  if (relRoot.startsWith('..')) return absPath
  // node:test's data.file can drop the .ts extension (sourcemapped source
  // path); restore it so timings keys match the repository layout.
  if (!relRoot.endsWith('.ts') && fs.existsSync(path.join(projectRoot, relRoot + '.ts'))) {
    return relRoot + '.ts'
  }
  return relRoot
}

/**
 * Maps node:test's file-level lifecycle events to reporter states. The
 * TestsStream uses test:dequeue/test:complete for child test files; the
 * test:start/test:pass events belong to suites and leaf tests instead.
 */
export function getFileProgress(event, files) {
  const data = event.data
  // File-level lifecycle events carry the test file path in `name`
  // (absolute when the runner passes absolute files, relative when it passes
  // relative ones); suite and leaf events carry a test name instead. Match
  // on the name so both forms keep file progress working.
  if (typeof data?.name !== 'string') return undefined
  const file = relPath(data.name)
  if (!files.has(file)) return undefined
  if (event.type === 'test:dequeue') {
    return {file, state: {status: 'running', durationMs: 0}}
  }
  if (event.type === 'test:complete') {
    return {
      file,
      state: {
        status: data.details?.passed ? 'passed' : 'failed',
        durationMs: data.details?.duration_ms ?? 0,
      },
    }
  }
  return undefined
}

/**
 * Executes the given test files with node:test and consumes the structured
 * TestsStream directly (document section 12.2). Unit files use an
 * isolation:none worker pool; editor files run in their own child processes.
 * The parent passes each editor kind to its child; bundle-hooks.mjs only loads
 * the compiled records supplied explicitly by that execution endpoint.
 * On Node 24 leaf tests carry details.type === 'test' while suites carry
 * details.type === 'suite'.
 */
export async function runUnit(
  files,
  {
    lane = 'unit',
    concurrency = 6,
    coverage = false,
    testNamePattern,
    forceExit = false,
    shardTimeoutMs = 5 * 60 * 1000,
    testTimeout = 3000,
    onProgress,
    onFailure,
    onOutput,
  } = {}
) {
  // COC_TEST_ROOT is now the repository root: src/util/constants uses it as
  // pluginRoot so bin/data resolve from the source tree. All compilation is
  // in memory (only the editor-runtime bundle is written to .cache).
  process.env.COC_TEST_ROOT = projectRoot
  // Compile every requested entry and its src/__tests__ dependency closure in
  // the main process before any child process or worker starts executing it.
  await testCompiler.compileTests(files)
  // The editor-runtime bundle is built exactly once by the parent and
  // written to `.cache/coc-test/bundle.js`; children just require() it
  // through bundle-hooks.mjs and never rebuild. The package list
  // lets hooks route test imports of bundled packages to `pkg:<spec>`.
  await ensureBundleFiles()
  if (lane === 'unit') {
    return await runUnitThreads(files, {
      concurrency,
      coverage,
      testNamePattern,
      forceExit,
      shardTimeoutMs,
      testTimeout,
      onProgress,
      onFailure,
      onOutput,
    })
  }
  return await runEditorProcesses(files, {
    concurrency,
    coverage,
    testNamePattern,
    forceExit,
    shardTimeoutMs,
    testTimeout,
    onProgress,
    onFailure,
    onOutput,
  })
}

async function runEditorProcesses(
  files,
  {concurrency, coverage, testNamePattern, forceExit, shardTimeoutMs, testTimeout, onProgress, onFailure, onOutput}
) {
  const started = performance.now()
  const results = await runProcessPool(files, concurrency, (file, index, signal) => {
    return runEditorProcess(file, index, signal, {
      coverage,
      testNamePattern,
      forceExit,
      shardTimeoutMs,
      testTimeout,
      onProgress,
      onFailure,
      onOutput,
    })
  })

  const stats = {passed: 0, failed: 0, skipped: 0, todo: 0, failures: [], diagnostics: []}
  const timings = {}
  const leafStats = {}
  const coverageSummaries = []
  let timedOut = false
  for (const result of results) {
    stats.passed += result.stats.passed
    stats.failed += result.stats.failed
    stats.skipped += result.stats.skipped
    stats.todo += result.stats.todo
    stats.failures.push(...result.stats.failures)
    stats.diagnostics.push(...result.stats.diagnostics)
    Object.assign(timings, result.timings)
    Object.assign(leafStats, result.leafStats)
    if (result.coverage) coverageSummaries.push(result.coverage)
    timedOut ||= result.timedOut
  }
  return {
    stats,
    timings,
    leafStats,
    coverage: coverageSummaries.length > 0 ? coverageSummaries : undefined,
    timedOut,
    durationMs: Math.round(performance.now() - started),
  }
}

function runEditorProcess(
  file,
  id,
  signal,
  {coverage, testNamePattern, forceExit, shardTimeoutMs, testTimeout, onProgress, onFailure, onOutput}
) {
  return new Promise((resolve, reject) => {
    const child = fork(new URL('./editor-worker.mjs', import.meta.url), [], {
      cwd: projectRoot,
      env: {...process.env},
      execArgv: ['--enable-source-maps'],
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })
    child.stdout.on('data', chunk => onOutput?.('stdout', chunk.toString()))
    child.stderr.on('data', chunk => onOutput?.('stderr', chunk.toString()))
    let result
    let processError
    let settled = false
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      fn(value)
    }
    const onAbort = () => {
      child.kill()
    }
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, {once: true})
    const send = message => {
      if (!child.connected) return
      child.send(message, error => {
        if (!error) return
        processError ??= error
        child.kill()
      })
    }
    child.on('message', message => {
      switch (message.type) {
        case 'request-compiled':
          try {
            send({
              type: 'compiled',
              records: testCompiler.recordsFor(message.files),
              editorSessionSource,
            })
          } catch (error) {
            processError = error
            child.kill()
          }
          break
        case 'progress':
          onProgress?.(message.file, message.state)
          break
        case 'failure':
          onFailure?.(message.data)
          break
        case 'output':
          onOutput?.(message.stream, message.message)
          break
        case 'result':
          result = message.result
          if (forceExit) child.kill()
          break
        case 'error':
          processError = Object.assign(new Error(message.error.message), {stack: message.error.stack})
          child.kill()
          break
      }
    })
    child.on('error', error => {
      processError ??= error
    })
    // A pool slot is released only after the child and its stdio streams are
    // fully closed, including error/abort paths.
    child.on('close', code => {
      if (result) finish(resolve, result)
      else finish(reject,
        processError ?? (signal.aborted && signal.reason instanceof Error
          ? signal.reason
          : new Error(`editor worker ${id} exited with code ${code}`)))
    })
    const editor = testCompiler.recordFor(file).editor
    if (!editor) throw new Error(`coc-test: editor kind not found for ${file}`)
    send({
      type: 'run',
      options: {file, editor, coverage, testNamePattern, shardTimeoutMs, testTimeout},
    })
  })
}

async function runUnitThreads(
  files,
  {
    concurrency,
    coverage,
    testNamePattern,
    forceExit,
    shardTimeoutMs,
    testTimeout,
    onProgress,
    onFailure,
    onOutput,
  }
) {
  const started = performance.now()
  const maxWorkers = Math.max(1, Math.min(
    files.length,
    Number.isInteger(concurrency) ? concurrency : os.availableParallelism()
  ))
  const isolated = new Set(ISOLATED_UNIT_TESTS)
  const isolatedBatches = files.filter(file => isolated.has(file)).map(file => [file])
  const sharedFiles = files.filter(file => !isolated.has(file))
  const reserved = Math.min(isolatedBatches.length, Math.max(0, maxWorkers - 1))
  const sharedWorkerCount = Math.min(sharedFiles.length, Math.max(1, maxWorkers - reserved))
  const sharedBatches = Array.from({length: sharedWorkerCount}, () => [])
  for (let i = 0; i < sharedFiles.length; i++) {
    sharedBatches[i % sharedWorkerCount].push(sharedFiles[i])
  }
  const batches = [...isolatedBatches, ...sharedBatches.filter(batch => batch.length > 0)]
  const results = new Array(batches.length)
  let next = 0
  const runners = Array.from({length: Math.min(maxWorkers, batches.length)}, async () => {
    while (next < batches.length) {
      const index = next++
      results[index] = await runUnitWorker(batches[index], index, {
        coverage,
        testNamePattern,
        forceExit,
        shardTimeoutMs,
        testTimeout,
        onProgress,
        onFailure,
        onOutput,
      })
    }
  })
  await Promise.all(runners)

  const stats = {passed: 0, failed: 0, skipped: 0, todo: 0, failures: [], diagnostics: []}
  const timings = {}
  const leafStats = {}
  const coverageSummaries = []
  let timedOut = false
  for (const result of results) {
    stats.passed += result.stats.passed
    stats.failed += result.stats.failed
    stats.skipped += result.stats.skipped
    stats.todo += result.stats.todo
    stats.failures.push(...result.stats.failures)
    stats.diagnostics.push(...result.stats.diagnostics)
    Object.assign(timings, result.timings)
    Object.assign(leafStats, result.leafStats)
    if (result.coverage) coverageSummaries.push(result.coverage)
    timedOut ||= result.timedOut
  }
  return {
    stats,
    timings,
    leafStats,
    coverage: coverageSummaries.length > 0 ? coverageSummaries : undefined,
    timedOut,
    durationMs: Math.round(performance.now() - started),
  }
}

function runUnitWorker(
  files,
  id,
  {
    coverage,
    testNamePattern,
    forceExit,
    shardTimeoutMs,
    testTimeout,
    onProgress,
    onFailure,
    onOutput,
  }
) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./unit-worker.mjs', import.meta.url), {
      workerData: {files, coverage, testNamePattern, shardTimeoutMs, testTimeout},
      env: {...process.env},
    })
    let result
    worker.on('message', message => {
      switch (message.type) {
        case 'request-compiled':
          // Send this worker only the entries assigned to it and their
          // transitive src/__tests__ dependencies; unit tests never import
          // coc-test/edit_session, so the session source is not sent here.
          worker.postMessage({type: 'compiled', records: testCompiler.recordsFor(message.files)})
          break
        case 'progress':
          onProgress?.(message.file, message.state)
          break
        case 'failure':
          onFailure?.(message.data)
          break
        case 'output':
          onOutput?.(message.stream, message.message)
          break
        case 'result':
          result = message.result
          if (forceExit) void worker.terminate()
          break
        case 'error':
          reject(Object.assign(new Error(message.error.message), {stack: message.error.stack}))
          break
      }
    })
    worker.on('error', reject)
    worker.on('exit', code => {
      if (result) resolve(result)
      else reject(new Error(`unit worker ${id} exited with code ${code}`))
    })
  })
}

let bundleFilesPromise
const testCompiler = new TestCompiler()

/** Builds + writes bundle.js/bundle.js.map once per runner process. */
function ensureBundleFiles() {
  if (!bundleFilesPromise) bundleFilesPromise = writeBundleFiles()
  return bundleFilesPromise
}
