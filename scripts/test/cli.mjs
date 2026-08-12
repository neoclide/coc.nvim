'use strict'

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {spawn} from 'node:child_process'
import {parseArgs} from 'node:util'
import {discoverTests} from './discover.mjs'
import {runUnit} from './run.mjs'
import {createLiveReporter} from './reporter.mjs'
import {cacheDir, projectRoot} from './paths.mjs'
import {
  filterSrcCoverage,
  mergeCoverageSummaries,
  coverageTotals,
  printCoverageSummary,
  toLcov,
  writeLcov,
} from './coverage.mjs'
import {buildSummaryFromRawDir} from './raw-coverage.mjs'

const RED = process.stderr.isTTY ? '\x1b[1;31m' : ''
const RESET = process.stderr.isTTY ? '\x1b[0m' : ''

function red(text) {
  return `${RED}${text}${RESET}`
}

function failureText(data) {
  const error = data.details?.error
  const stack = error?.cause?.stack || error?.stack
  const message = error?.cause?.message || error?.message
  return stack || message || String(error)
}

function failureFile(data) {
  if (!data.file) return '<unknown test file>'
  const relative = path.relative(process.cwd(), data.file)
  return relative && !relative.startsWith('..') ? relative : data.file
}

function formatFailure(data) {
  return `${red('FAIL')} ${failureFile(data)}: ${data.name}\n${failureText(data)}\n`
}

const {values, positionals} = parseArgs({
  options: {
    unit: {type: 'boolean', default: false},
    jobs: {type: 'string', short: 'j'},
    'test-name-pattern': {type: 'string', short: 't'},
    list: {type: 'boolean'},
    coverage: {type: 'boolean'},
    'keep-temp': {type: 'boolean'},
    'force-exit': {type: 'boolean'},
  },
  allowPositionals: true,
})

/**
 * Node's test coverage needs --enable-source-maps from process start: the
 * parent's run() reads it via parseCommandLine() to decide whether to map
 * the bundle's V8 coverage back to src/*.ts (nvim/vim lanes are aggregated
 * here), and unit worker threads inherit the parent's execArgv. It cannot
 * be enabled after startup, so when --coverage is requested without it we
 * re-exec ourselves with the flag. --experimental-test-coverage is not
 * required here — run({coverage: true}) enables the profiler directly.
 * Returns the child's exit info when re-executing, null otherwise.
 */
async function reexecWithCoverageFlags() {
  if (process.execArgv.includes('--enable-source-maps')) return null
  const child = spawn(process.execPath, [...process.execArgv, '--enable-source-maps', process.argv[1], ...process.argv.slice(2)], {
    stdio: 'inherit',
  })
  const {status, signal} = await new Promise(resolve => {
    child.once('exit', (code, sig) => resolve({status: code, signal: sig}))
  })
  return signal ? {signal} : {code: status ?? 1}
}

if (values.coverage && !values.list) {
  const reexec = await reexecWithCoverageFlags()
  if (reexec) {
    if (reexec.signal) process.kill(process.pid, reexec.signal)
    else process.exit(reexec.code)
  }
}

// V8 coverage must be on before any unit worker thread starts, otherwise the
// worker's profiler connection never initializes and its coverage is empty.
// Raw coverage files copied here by node:test are gitignored; the merged
// report is what coverage/lcov.info is built from, and the raw directory is
// removed once that report has been written.
if (values.coverage) {
  process.env.NODE_V8_COVERAGE = path.join(projectRoot, '.cache', 'coc-test', 'coverage')
  await fs.mkdir(process.env.NODE_V8_COVERAGE, {recursive: true})
}

// No --nvim/--vim flags: lane is decided by path (discover.mjs) — the unit
// directory is unit, VIM_TESTS is vim, everything else is nvim. The default
// run executes all three lanes; --unit restricts to the unit lane.
const lanes = values.unit ? ['unit'] : ['unit', 'nvim', 'vim']
const testNamePattern = values['test-name-pattern']

// Unit tests get all CPU cores in phase 1; editor lanes are capped at 8
// (measured sweet spot) in phase 2. -j overrides both.
const unitJobs = os.cpus().length
const editorJobs = Math.max(1, Number(values.jobs) || Math.min(8, os.cpus().length - 1))
const LANE_TEST_TIMEOUT = {unit: 3000, nvim: 5000, vim: 5000}
// Editor files normally finish in seconds; 20s bounds a hung file (stuck
// session start or teardown) instead of holding a pool slot for 15 minutes.
const LANE_SHARD_TIMEOUT = {unit: 5 * 60 * 1000, nvim: 20 * 1000, vim: 20 * 1000}

async function loadTimings() {
  try {
    return JSON.parse(await fs.readFile(path.join(cacheDir, 'timings.json'), 'utf8'))
  } catch {
    return {}
  }
}

async function existsSourceFile(key) {
  try {
    await fs.access(path.join(process.cwd(), key))
    return true
  } catch {
    return false
  }
}

async function persistTimings(timings, result) {
  const validOld = {}
  for (const [key, ms] of Object.entries(timings)) {
    if (/^src\/__tests__\/.*\.test\.ts$/.test(key) && await existsSourceFile(key)) validOld[key] = ms
  }
  const merged = {...validOld, ...result.timings}
  await fs.mkdir(cacheDir, {recursive: true})
  await fs.writeFile(path.join(cacheDir, 'timings.json'), JSON.stringify(merged, null, 2) + '\n')
  return merged
}

async function runLane(lane, {files, jobs, reporter}) {
  // Files are passed by their real source paths; the runner passes each child
  // its editor kind and initializes hooks before loading the test entry.
  return await runUnit(files, {
    lane,
    concurrency: jobs,
    coverage: values.coverage,
    testNamePattern,
    keepTemp: values['keep-temp'],
    forceExit: values['force-exit'],
    testTimeout: LANE_TEST_TIMEOUT[lane],
    shardTimeoutMs: LANE_SHARD_TIMEOUT[lane],
    onProgress: (file, state) => {
      reporter.update(file, state)
    },
    onFailure: data => {
      reporter.error(`\n${formatFailure(data)}`)
    },
    onOutput: (type, message) => {
      reporter.output(message, type)
    },
  })
}

const startedAt = performance.now()
const discovered = await discoverTests(positionals)

if (values.list) {
  for (const lane of lanes) {
    for (const file of discovered[lane]) {
      if (file.runnable) console.log(file.file)
    }
  }
  process.exit(0)
}

let timings = await loadTimings()
let failed = 0
const laneResults = []
const finalFailures = []
const coverageSummaries = []
let coverageFailed = false

async function collect(lane, result, files) {
  laneResults.push({lane, durationMs: result.durationMs, result: result.stats, files})
  if (result.stats.failed > 0) failed += result.stats.failed
  if (values.coverage && result.stats.diagnostics.some(message => /code coverage/i.test(message))) coverageFailed = true
  finalFailures.push(...result.stats.failures)
  if (Array.isArray(result.coverage)) coverageSummaries.push(...result.coverage)
  else if (result.coverage) coverageSummaries.push(result.coverage)
  timings = await persistTimings(timings, result)
  for (const message of result.stats.diagnostics) {
    reporter.error(`[test] ${message}`)
  }
}

const runnableByLane = Object.fromEntries(lanes.map(lane => [lane, discovered[lane].filter(file => file.runnable)]))
const allFiles = lanes.flatMap(lane => runnableByLane[lane])
const reporter = createLiveReporter(allFiles.map(file => file.file))

// Lanes run concurrently: the unit worker pool uses a few CPU cores while the
// editor pool mostly waits on nvim/vim RPC, so they overlap without stealing
// cycles from each other. Both pools assign longest-running files first so
// slots drain evenly.
const unitFiles = runnableByLane.unit
  .slice()
  .sort((a, b) => (timings[b.file] ?? 0) - (timings[a.file] ?? 0))
  .map(file => file.file)
const unitPromise = lanes.includes('unit') && unitFiles.length > 0
  ? runLane('unit', {
      files: unitFiles,
      jobs: unitJobs,
      reporter,
    })
  : Promise.resolve(null)

const editorLanes = lanes.filter(lane => lane !== 'unit')
const editorFiles = editorLanes
  .flatMap(lane => runnableByLane[lane])
  .slice()
  .sort((a, b) => (timings[b.file] ?? 0) - (timings[a.file] ?? 0))
  .map(file => file.file)
const editorPromise = editorLanes.length > 0 && editorFiles.length > 0
  ? runLane(editorLanes[0], {
      files: editorFiles,
      jobs: editorJobs,
      reporter,
    })
  : Promise.resolve(null)

// Wait for both phases so a failing pool never orphans the other lane's
// processes; rethrow the first infrastructure error afterwards.
const [unitResult, editorResult] = await Promise.allSettled([unitPromise, editorPromise])
const laneError = [unitResult, editorResult].find(result => result.status === 'rejected')
if (laneError) throw laneError.reason

if (unitResult.value) await collect('unit', unitResult.value, unitFiles.length)
if (editorResult.value) {
  const result = editorResult.value
    // Split the aggregate result back into per-lane summaries from the
    // per-file completion statuses.
    timings = await persistTimings(timings, result)
    for (const lane of editorLanes) {
      let passed = 0
      let laneFailed = 0
      for (const file of runnableByLane[lane]) {
        const counts = result.leafStats[file.file]
        if (counts) {
          passed += counts.passed
          laneFailed += counts.failed
        }
      }
      laneResults.push({
        lane,
        durationMs: result.durationMs,
        result: {passed, failed: laneFailed, skipped: 0},
        files: runnableByLane[lane].length,
      })
      failed += laneFailed
    }
    for (const message of result.stats.diagnostics) {
      reporter.error(`[test] ${message}`)
    }
    finalFailures.push(...result.stats.failures)
    if (values.coverage && result.stats.diagnostics.some(message => /code coverage/i.test(message))) coverageFailed = true
    if (Array.isArray(result.coverage)) coverageSummaries.push(...result.coverage)
    else if (result.coverage) coverageSummaries.push(result.coverage)
}
reporter.finish()

const totalDuration = Math.round(performance.now() - startedAt)
const totalFiles = laneResults.reduce((sum, lane) => sum + lane.files, 0)
const totalTests = laneResults.reduce((sum, lane) => {
  const result = lane.result
  return sum + result.passed + result.failed + result.skipped + (result.todo ?? 0)
}, 0)
console.log(`total: ${formatCount(totalFiles, 'file')}, ${formatCount(totalTests, 'test')}, ${formatDuration(totalDuration)}`)
if (values.coverage) {
  let merged
  if (coverageFailed) {
    // node:test's summary() can be knocked out by a truncated raw coverage
    // file (a process killed on timeout); rebuild from the raw files it
    // copied back into NODE_V8_COVERAGE, skipping unparseable ones.
    const rawFiles = buildSummaryFromRawDir(process.env.NODE_V8_COVERAGE)
    merged = filterSrcCoverage(mergeCoverageSummaries([{files: rawFiles}]))
    if (merged.size > 0) {
      console.error('[test] Warning: coverage summary was rebuilt from raw V8 files and may be partial')
    } else {
      failed += 1
    }
  } else {
    merged = filterSrcCoverage(mergeCoverageSummaries(coverageSummaries))
  }
  const totals = coverageTotals(Array.from(merged.values()))
  writeLcov(toLcov(Array.from(merged.values())))
  printCoverageSummary(Array.from(merged.values()), totals)
  console.log(`coverage report written to ${path.join('coverage', 'lcov.info')}`)
  // The raw V8 coverage JSONs are only needed while building the summary
  // above, so remove them instead of leaving them to accumulate in .cache.
  await fs.rm(process.env.NODE_V8_COVERAGE, {recursive: true, force: true})
}
if (finalFailures.length > 0) {
  console.error(`\n${red('Failures')} (${finalFailures.length}):`)
  for (const failure of finalFailures) {
    process.stderr.write(`\n${formatFailure(failure)}`)
  }
}
process.exitCode = failed > 0 ? 1 : 0

function formatDuration(ms) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}

function formatCount(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}
