'use strict'

/**
 * Fallback coverage builder used when node:test's own summary() throws.
 *
 * node:test aggregates the raw V8 coverage files written by every child
 * process/worker into one summary. If any of those files is truncated — a
 * test process killed on timeout can leave a partial JSON (upstream
 * nodejs/node#29865) — the whole summary() call fails and run() returns no
 * coverage at all. The raw files still exist (node:test copies them back to
 * NODE_V8_COVERAGE before deleting its temp dir), so this module rebuilds
 * the summary from them, skipping unparseable files. Only the bundle script
 * is source-mapped (that is where all src/*.ts coverage lives); everything
 * else is dropped because the report only keeps src/**\/*.ts anyway.
 */

import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {projectRoot} from './paths.mjs'

const kCoverageFileRegex = /^coverage-\d+-\d{13}-\d+\.json$/
const kLineEndingRegex = /\r?\n$/u
const kLineSplitRegex = /(?<=\r?\n)/u

const VLQ_BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const VLQ_BASE64_MAP = new Map([...VLQ_BASE64].map((char, index) => [char, index]))

function decodeVLQAt(chars, i) {
  let result = 0
  let shift = 0
  while (i < chars.length) {
    const digit = VLQ_BASE64_MAP.get(chars[i])
    if (digit === undefined) break
    const continuation = digit & 32
    result += (digit & 31) << shift
    i++
    if (!continuation) break
    shift += 5
  }
  const negative = result & 1
  result >>>= 1
  return {value: negative ? -result : result, next: i}
}

class SourceMap {
  constructor(data) {
    this.mappings = []
    this.parseMap(data)
    this.mappings.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  }

  parseMap(map) {
    let sourceIndex = 0
    let sourceLineNumber = 0
    let sourceColumnNumber = 0
    let nameIndex = 0
    const sources = map.sources
    let sourceURL = sources[sourceIndex]
    const chars = map.mappings
    let lineNumber = 0
    let columnNumber = 0
    let i = 0
    while (true) {
      if (chars[i] === ',') {
        i++
      } else {
        while (chars[i] === ';') {
          lineNumber += 1
          columnNumber = 0
          i++
        }
        if (i >= chars.length) break
      }
      const genCol = decodeVLQAt(chars, i)
      columnNumber += genCol.value
      i = genCol.next
      if (chars[i] === ',' || chars[i] === ';') {
        this.mappings.push([lineNumber, columnNumber])
        continue
      }
      const srcIdx = decodeVLQAt(chars, i)
      i = srcIdx.next
      if (srcIdx.value) sourceIndex += srcIdx.value
      sourceURL = sources[sourceIndex]
      const srcLine = decodeVLQAt(chars, i)
      sourceLineNumber += srcLine.value
      i = srcLine.next
      const srcCol = decodeVLQAt(chars, i)
      sourceColumnNumber += srcCol.value
      i = srcCol.next
      let name
      if (chars[i] !== ',' && chars[i] !== ';') {
        const nameDelta = decodeVLQAt(chars, i)
        nameIndex += nameDelta.value
        i = nameDelta.next
        name = map.names?.[nameIndex]
      }
      this.mappings.push([lineNumber, columnNumber, sourceURL, sourceLineNumber, sourceColumnNumber, name])
    }
  }

  findEntry(lineOffset, columnOffset) {
    let first = 0
    let count = this.mappings.length
    while (count > 1) {
      const step = count >> 1
      const middle = first + step
      const mapping = this.mappings[middle]
      if (lineOffset < mapping[0] || (lineOffset === mapping[0] && columnOffset < mapping[1])) {
        count = step
      } else {
        first = middle
        count -= step
      }
    }
    const entry = this.mappings[first]
    if (!first && entry && (lineOffset < entry[0] || (lineOffset === entry[0] && columnOffset < entry[1]))) {
      return {}
    }
    if (!entry) return {}
    return {
      generatedLine: entry[0],
      generatedColumn: entry[1],
      originalSource: entry[2],
      originalLine: entry[3],
      originalColumn: entry[4],
      name: entry[5],
    }
  }
}

class CoverageLine {
  constructor(line, startOffset, src, length = src?.length) {
    const newlineLength = src == null ? 0 : (kLineEndingRegex.exec(src)?.[0].length ?? 0)
    this.line = line
    this.src = src
    this.startOffset = startOffset
    this.endOffset = startOffset + length - newlineLength
    this.ignore = false
    this.count = this.startOffset === this.endOffset ? 1 : 0
  }
}

function mapRangeToLines(range, lines) {
  const {startOffset, endOffset, count} = range
  const mappedLines = []
  let ignoredLines = 0
  let start = 0
  let end = lines.length
  let mid
  while (start <= end) {
    mid = Math.floor((start + end) / 2)
    let line = lines[mid]
    if (startOffset >= line?.startOffset && startOffset <= line?.endOffset) {
      while (endOffset > line?.startOffset) {
        if (startOffset <= line.startOffset && endOffset >= line.endOffset) line.count = count
        mappedLines.push(line)
        if (line.ignore) ignoredLines++
        mid++
        line = lines[mid]
      }
      break
    } else if (startOffset >= line?.endOffset) {
      start = mid + 1
    } else {
      end = mid - 1
    }
  }
  return {lines: mappedLines, ignoredLines}
}

function entryToOffset(entry, lines) {
  const line = Math.max(entry.originalLine, 0)
  const mappedLine = lines[line]
  if (!mappedLine) return -1
  return Math.min(mappedLine.startOffset + entry.originalColumn, mappedLine.endOffset)
}

const sourceLines = new Map()

function getLines(fileUrl, source) {
  if (sourceLines.has(fileUrl)) return sourceLines.get(fileUrl)
  try {
    source ??= fs.readFileSync(fileURLToPath(fileUrl), 'utf8')
  } catch {
    sourceLines.set(fileUrl, null)
    return
  }
  let offset = 0
  const lines = source.split(kLineSplitRegex).map((text, i) => {
    const coverageLine = new CoverageLine(i + 1, offset, text)
    offset += text.length
    return coverageLine
  })
  sourceLines.set(fileUrl, lines)
  return lines
}

// The bundle source map is identical in every raw file; parse it once.
const sourceMapInstances = new Map()

function sourceMapFor(data) {
  const key = data.sources[0] ?? data.mappings.length
  if (!sourceMapInstances.has(key)) sourceMapInstances.set(key, new SourceMap(data))
  return sourceMapInstances.get(key)
}

/**
 * Maps the bundle script of one raw coverage file to src files. All other
 * scripts are dropped — node:test's own include/exclude filtering (and the
 * final src-only filter) keeps them out of the report anyway.
 */
function mapBundleScript(coverage, bundleUrl) {
  const sourceMapCache = coverage['source-map-cache']
  if (!sourceMapCache) return []
  const entry = sourceMapCache[bundleUrl]
  if (!entry?.data || !entry.lineLengths) return []
  const {data, lineLengths} = entry
  let offset = 0
  const executedLines = lineLengths.map((length, i) => {
    const coverageLine = new CoverageLine(i + 1, offset, null, length + 1)
    offset += length + 1
    return coverageLine
  })
  if (data.sourcesContent != null) {
    for (let j = 0; j < data.sources.length; j++) getLines(data.sources[j], data.sourcesContent[j])
  }
  const sourceMap = sourceMapFor(data)
  const result = []
  for (const script of coverage.result) {
    if (script.url !== bundleUrl) continue
    for (const {ranges, functionName, isBlockCoverage} of script.functions ?? []) {
      if (!ranges) continue
      let newUrl
      const newRanges = []
      for (const range of ranges) {
        const {startOffset, endOffset, count} = range
        const {lines} = mapRangeToLines(range, executedLines)
        if (lines.length === 0) continue
        let startEntry = sourceMap.findEntry(lines[0].line - 1, Math.max(0, startOffset - lines[0].startOffset))
        const endEntry = sourceMap.findEntry(lines[lines.length - 1].line - 1, (endOffset - lines[lines.length - 1].startOffset) - 1)
        if (!startEntry.originalSource && endEntry.originalSource &&
          lines[0].line === 1 && startOffset === 0 && lines[0].startOffset === 0) {
          const first = sourceMap.mappings[0]
          startEntry = {originalSource: first[2], originalLine: first[3], originalColumn: first[4]}
        }
        if (!startEntry.originalSource || startEntry.originalSource !== endEntry.originalSource) continue
        newUrl ??= startEntry.originalSource
        const mappedLines = getLines(newUrl)
        if (!mappedLines) continue
        const mappedStartOffset = entryToOffset(startEntry, mappedLines)
        const mappedEndOffset = entryToOffset(endEntry, mappedLines) + 1
        if (mappedStartOffset < 0 || mappedEndOffset < 1) continue
        for (let l = startEntry.originalLine; l <= endEntry.originalLine; l++) mappedLines[l].count = count
        newRanges.push({startOffset: mappedStartOffset, endOffset: mappedEndOffset, count})
      }
      if (!newUrl || newRanges.length === 0) continue
      result.push({url: newUrl, functionName, ranges: newRanges, isBlockCoverage})
    }
  }
  return result
}

function mergeFunctions(target, functions) {
  for (const newFn of functions) {
    let found = false
    for (const oldFn of target) {
      if (oldFn.functionName === newFn.functionName &&
        oldFn.ranges?.[0]?.startOffset === newFn.ranges?.[0]?.startOffset &&
        oldFn.ranges?.[0]?.endOffset === newFn.ranges?.[0]?.endOffset) {
        found = true
        if (newFn.isBlockCoverage) {
          if (oldFn.isBlockCoverage) {
            const set = new Set()
            for (const r of oldFn.ranges) if (r.count > 0) set.add(r)
            for (const nr of newFn.ranges) {
              let exact = false
              for (const or of oldFn.ranges) {
                if (nr.startOffset === or.startOffset && nr.endOffset === or.endOffset && nr.count === or.count) {
                  or.count += nr.count
                  set.add(or)
                  exact = true
                  break
                }
                if (or.count === 0 && nr.count === 0) {
                  if (or.startOffset <= nr.startOffset && nr.endOffset <= or.endOffset) set.add(nr)
                  else if (nr.startOffset <= or.startOffset && or.endOffset <= nr.endOffset) set.add(or)
                }
              }
              if (nr.count > 0 && !exact) set.add(nr)
            }
            oldFn.ranges = [...set]
          } else {
            oldFn.isBlockCoverage = true
            oldFn.ranges = newFn.ranges
          }
        }
        break
      }
    }
    if (!found) target.push(newFn)
  }
}

function isSrcFile(absPath) {
  const rel = path.relative(projectRoot, absPath)
  if (!rel.startsWith('src' + path.sep)) return false
  if (!rel.endsWith('.ts') || rel.endsWith('.d.ts')) return false
  if (rel.startsWith('src' + path.sep + '__tests__')) return false
  if (rel.endsWith('.test.ts')) return false
  return true
}

/**
 * Rebuilds the per-file coverage summary from the raw V8 coverage files
 * node:test copied into `rawDir`. Returns an array shaped like
 * node:test's `summary.files` so the existing merge/report pipeline can
 * consume it. Unparseable (truncated) files are skipped.
 */
export function buildSummaryFromRawDir(rawDir) {
  const merged = new Map()
  const bundleUrl = 'file://' + path.join(projectRoot, '.cache', 'coc-test', 'bundle.js')
  const entries = fs.readdirSync(rawDir)
  for (const name of entries) {
    if (!kCoverageFileRegex.test(name)) continue
    let coverage
    try {
      coverage = JSON.parse(fs.readFileSync(path.join(rawDir, name), 'utf8'))
    } catch {
      continue
    }
    for (const fn of mapBundleScript(coverage, bundleUrl)) {
      if (!fn.url.startsWith('file:') || !isSrcFile(fileURLToPath(fn.url))) continue
      let entry = merged.get(fn.url)
      if (!entry) {
        entry = {url: fn.url, functions: []}
        merged.set(fn.url, entry)
      }
      mergeFunctions(entry.functions, [fn])
    }
  }

  const files = []
  for (const {url, functions} of merged.values()) {
    if (!url.startsWith('file:')) continue
    const lines = getLines(url)
    if (!lines) continue
    const functionReports = []
    const branchReports = []
    for (let j = 0; j < functions.length; j++) {
      const {isBlockCoverage, ranges} = functions[j]
      let maxCountPerFunction = 0
      for (const range of ranges) {
        maxCountPerFunction = Math.max(maxCountPerFunction, range.count)
        Object.assign(range, mapRangeToLines(range, lines))
        if (isBlockCoverage) {
          branchReports.push({line: range.lines[0]?.line, count: range.count})
        }
      }
      if (j > 0 && ranges.length > 0) {
        functionReports.push({
          name: functions[j].functionName,
          count: maxCountPerFunction,
          line: ranges[0].lines[0]?.line,
        })
      }
    }
    const lineReports = []
    for (const line of lines) {
      if (!line.ignore) lineReports.push({line: line.line, count: line.count})
    }
    files.push({path: fileURLToPath(url), lines: lineReports, branches: branchReports, functions: functionReports})
  }
  return files
}
