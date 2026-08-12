'use strict'

import fs from 'node:fs'
import path from 'node:path'
import {projectRoot} from './paths.mjs'

function isSrcFile(absPath) {
  const rel = path.relative(projectRoot, absPath)
  if (!rel.startsWith('src' + path.sep)) return false
  if (!rel.endsWith('.ts') || rel.endsWith('.d.ts')) return false
  if (rel.startsWith('src' + path.sep + '__tests__')) return false
  if (rel.endsWith('.test.ts')) return false
  return true
}

/**
 * Merges the per-process/per-worker `test:coverage` summaries collected by
 * the runner. Line/branch/function hit counts are summed across lanes; a
 * line stays covered as long as any process executed it.
 */
export function mergeCoverageSummaries(summaries) {
  const files = new Map()
  for (const summary of summaries) {
    if (!summary?.files) continue
    for (const file of summary.files) {
      if (!file?.path) continue
      let entry = files.get(file.path)
      if (!entry) {
        entry = {path: file.path, lines: new Map(), branches: [], functions: []}
        files.set(file.path, entry)
      }
      for (const line of file.lines ?? []) {
        entry.lines.set(line.line, (entry.lines.get(line.line) ?? 0) + line.count)
      }
      for (const branch of file.branches ?? []) {
        entry.branches.push({line: branch.line, count: branch.count})
      }
      for (const fn of file.functions ?? []) {
        entry.functions.push({name: fn.name, line: fn.line, count: fn.count})
      }
    }
  }
  return files
}

/**
 * Keeps only project src/**\/*.ts files that were actually executed during
 * the run. Files no process imported have no V8 coverage data and are left
 * out — matching node:test's own summary, which only counts loaded modules.
 */
export function filterSrcCoverage(merged) {
  const result = new Map()
  for (const [absPath, entry] of merged) {
    if (isSrcFile(absPath)) result.set(absPath, entry)
  }
  return result
}

function entryCounts(entry) {
  const totalLines = entry.lines.size
  const coveredLines = Array.from(entry.lines.values()).filter(count => count > 0).length
  const totalBranches = entry.branches.length
  const coveredBranches = entry.branches.filter(branch => branch.count > 0).length
  const totalFunctions = entry.functions.length
  const coveredFunctions = entry.functions.filter(fn => fn.count > 0).length
  return {totalLines, coveredLines, totalBranches, coveredBranches, totalFunctions, coveredFunctions}
}

function percent(covered, total) {
  return total === 0 ? 100 : (covered / total) * 100
}

export function coverageTotals(entries) {
  const totals = {totalLines: 0, coveredLines: 0, totalBranches: 0, coveredBranches: 0, totalFunctions: 0, coveredFunctions: 0}
  for (const entry of entries) {
    const counts = entryCounts(entry)
    totals.totalLines += counts.totalLines
    totals.coveredLines += counts.coveredLines
    totals.totalBranches += counts.totalBranches
    totals.coveredBranches += counts.coveredBranches
    totals.totalFunctions += counts.totalFunctions
    totals.coveredFunctions += counts.coveredFunctions
  }
  return totals
}

function toLcovEntry(entry) {
  const lines = Array.from(entry.lines.entries()).sort((a, b) => a[0] - b[0])
  const branches = entry.branches
  const functions = entry.functions
  const counts = entryCounts(entry)
  const output = [`TN:`, `SF:${entry.path}`]
  for (const fn of functions) output.push(`FN:${fn.line},${fn.name}`)
  for (const fn of functions) output.push(`FNDA:${fn.count},${fn.name}`)
  output.push(`FNF:${counts.totalFunctions}`)
  output.push(`FNH:${counts.coveredFunctions}`)
  for (let i = 0; i < branches.length; i++) {
    const branch = branches[i]
    output.push(`BRDA:${branch.line},${i},0,${branch.count > 0 ? branch.count : '-'}`)
  }
  output.push(`BRF:${counts.totalBranches}`)
  output.push(`BRH:${counts.coveredBranches}`)
  for (const [line, count] of lines) output.push(`DA:${line},${count}`)
  output.push(`LF:${counts.totalLines}`)
  output.push(`LH:${counts.coveredLines}`)
  output.push('end_of_record')
  return output.join('\n')
}

/**
 * Builds the LCOV report (same layout as the previous Vitest output) for
 * codecov and local coverage tooling.
 */
export function toLcov(entries) {
  return entries.map(toLcovEntry).join('\n') + '\n'
}

function pad(value, width) {
  const text = String(value)
  return text.length >= width ? text : text + ' '.repeat(width - text.length)
}

function relPath(absPath) {
  const rel = path.relative(projectRoot, absPath)
  return rel && !rel.startsWith('..') ? rel : absPath
}

function shortList(lines, max = 20) {
  const text = lines.slice(0, max).join(',')
  return lines.length > max ? text + ',…' : text
}

/**
 * Prints the same shape as Vitest's coverage table: totals row first, then
 * files sorted by ascending line coverage so the worst offenders stand out.
 */
export function printCoverageSummary(entries, totals) {
  const rows = entries
    .map(entry => ({entry, counts: entryCounts(entry)}))
    .sort((a, b) => {
      const diff = percent(a.counts.coveredLines, a.counts.totalLines) - percent(b.counts.coveredLines, b.counts.totalLines)
      return diff !== 0 ? diff : a.entry.path.localeCompare(b.entry.path)
    })
  const header = `${pad('File', 46)}| ${pad('% Lines', 10)}| ${pad('% Funcs', 10)}| ${pad('% Branch', 10)}| ${pad('Uncovered Lines', 18)}`
  const sep = '-'.repeat(header.length)
  console.log(sep)
  console.log(header)
  console.log(sep)
  const totalRow = [
    pad('All files', 46),
    `${pad(percent(totals.coveredLines, totals.totalLines).toFixed(2), 10)}|`,
    `${pad(percent(totals.coveredFunctions, totals.totalFunctions).toFixed(2), 10)}|`,
    `${pad(percent(totals.coveredBranches, totals.totalBranches).toFixed(2), 10)}|`,
    '',
  ].join(' ')
  console.log(totalRow)
  for (const {entry, counts} of rows) {
    const uncovered = Array.from(entry.lines.entries())
      .filter(([, count]) => count === 0)
      .map(([line]) => line)
      .join(',')
    const row = [
      pad(relPath(entry.path), 46),
      `${pad(percent(counts.coveredLines, counts.totalLines).toFixed(2), 10)}|`,
      `${pad(percent(counts.coveredFunctions, counts.totalFunctions).toFixed(2), 10)}|`,
      `${pad(percent(counts.coveredBranches, counts.totalBranches).toFixed(2), 10)}|`,
      pad(shortList(uncovered.split(',').filter(Boolean).map(Number)), 18),
    ].join(' ')
    console.log(row)
  }
  console.log(sep)
}

/**
 * Writes coverage/lcov.info (gitignored, same path as the Vitest report).
 */
export function writeLcov(lcov) {
  const reportDir = path.join(projectRoot, 'coverage')
  fs.mkdirSync(reportDir, {recursive: true})
  fs.writeFileSync(path.join(reportDir, 'lcov.info'), lcov)
}
