'use strict'

/**
 * Builds the coverage summary from the raw V8 coverage files written by every
 * child process/worker via NODE_V8_COVERAGE.
 *
 * node:test's own per-worker coverage summary is unreliable for worker threads
 * (a large esbuild enum IIFE collapses to a single V8 block and loses most of
 * its lines), so the runner reports coverage from these raw files instead.
 * Truncated files — a test process killed on timeout can leave a partial JSON
 * (upstream nodejs/node#29865) — are skipped. Only the bundle script is
 * source-mapped (that is where all src/*.ts coverage lives); everything else
 * is dropped because the report only keeps src/**\/*.ts anyway.
 */

import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {projectRoot} from './paths.mjs'
import ts from 'typescript'

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

const executableLinesBySource = new Map()
const collectedSourceMaps = new WeakSet()

function collectExecutableLines(sourceMap) {
  if (collectedSourceMaps.has(sourceMap)) return
  collectedSourceMaps.add(sourceMap)
  for (const mapping of sourceMap.mappings) {
    if (mapping.length < 6) continue
    const source = mapping[2]
    if (!source) continue
    let lines = executableLinesBySource.get(source)
    if (!lines) {
      lines = new Set()
      executableLinesBySource.set(source, lines)
    }
    lines.add(mapping[3] + 1)
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
  const executableLines = executableLinesBySource.get(fileUrl)
  const lines = source.split(kLineSplitRegex).map((text, i) => {
    const coverageLine = new CoverageLine(i + 1, offset, text)
    if (executableLines) coverageLine.ignore = !executableLines.has(i + 1)
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
  const sourceMap = sourceMapFor(data)
  collectExecutableLines(sourceMap)
  if (data.sourcesContent != null) {
    for (let j = 0; j < data.sources.length; j++) getLines(data.sources[j], data.sourcesContent[j])
  }
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
        // esbuild maps an enum IIFE's opening and closing brackets back to
        // the declaration line, so a single V8 block spanning the whole body
        // would collapse to that one source line if we only trusted the first
        // and last offsets. Derive the covered source range from each executed
        // generated line instead so every inlined member line is counted.
        let sourceUrl
        let minLine = Infinity
        let maxLine = -1
        for (const line of lines) {
          const entry = sourceMap.findEntry(line.line - 1, 0)
          if (!entry.originalSource) continue
          if (!sourceUrl) sourceUrl = entry.originalSource
          else if (sourceUrl !== entry.originalSource) continue
          if (entry.originalLine < minLine) minLine = entry.originalLine
          if (entry.originalLine > maxLine) maxLine = entry.originalLine
        }
        if (!sourceUrl || minLine === Infinity || maxLine < 0) continue
        newUrl ??= sourceUrl
        const mappedLines = getLines(sourceUrl)
        if (!mappedLines) continue
        const mappedStartOffset = mappedLines[minLine]?.startOffset
        const mappedEndOffset = mappedLines[maxLine]?.endOffset
        if (mappedStartOffset == null || mappedEndOffset == null) continue
        for (let l = minLine; l <= maxLine; l++) mappedLines[l].count = count
        newRanges.push({startOffset: mappedStartOffset, endOffset: mappedEndOffset + 1, count})
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

function isStringLiteralExpression(statement) {
  return ts.isExpressionStatement(statement) &&
    (ts.isStringLiteral(statement.expression) || ts.isNoSubstitutionTemplateLiteral(statement.expression))
}

function hasModifier(node, kind) {
  return node.modifiers?.some(modifier => modifier.kind === kind) ?? false
}

function isEmittedStatement(statement) {
  if (isStringLiteralExpression(statement)) return false
  if (ts.isImportDeclaration(statement)) {
    const clause = statement.importClause
    if (!clause || clause.isTypeOnly) return false
    if (clause.name && !clause.isTypeOnly) return true
    if (clause.namedBindings) {
      if (ts.isNamespaceImport(clause.namedBindings)) return false
      if (ts.isNamedImports(clause.namedBindings)) {
        return clause.namedBindings.elements.some(element => !element.isTypeOnly)
      }
    }
    return false
  }
  if (ts.isImportEqualsDeclaration(statement)) return !statement.isTypeOnly
  if (ts.isExportDeclaration(statement)) {
    if (statement.isTypeOnly) return false
    if (statement.exportClause) {
      if (ts.isNamedExports(statement.exportClause)) {
        return statement.exportClause.elements.some(element => !element.isTypeOnly)
      }
      return true
    }
    return true
  }
  if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) return false
  if (ts.isModuleDeclaration(statement)) {
    if (hasModifier(statement, ts.SyntaxKind.DeclareKeyword)) return false
    if (statement.body && ts.isModuleBlock(statement.body)) return true
    if (statement.body && ts.isModuleDeclaration(statement.body)) return isEmittedStatement(statement.body)
    return false
  }
  if (ts.isEmptyStatement(statement)) return false
  return true
}

/**
 * Returns true for source files whose top-level statements are all erased at
 * compile time (interfaces, type aliases, type-only imports/exports, declare
 * namespaces). Those files have no runtime code and must not contribute
 * uncovered lines to the coverage report.
 */
function isTypeOnlySource(absPath) {
  const text = fs.readFileSync(absPath, 'utf8')
  const sourceFile = ts.createSourceFile(absPath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  for (const statement of sourceFile.statements) {
    if (isEmittedStatement(statement)) return false
  }
  return true
}

const typeOnlySourceCache = new Map()

function isTypeOnlySourceCached(absPath) {
  if (!typeOnlySourceCache.has(absPath)) {
    typeOnlySourceCache.set(absPath, isTypeOnlySource(absPath))
  }
  return typeOnlySourceCache.get(absPath)
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
      if (!fn.url.startsWith('file:')) continue
      const absPath = fileURLToPath(fn.url)
      if (!isSrcFile(absPath)) continue
      if (isTypeOnlySourceCached(absPath)) continue
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
