import {build} from 'esbuild'
import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {VIM_TESTS} from './discover.mjs'
import {projectRoot as defaultProjectRoot} from './paths.mjs'

const REQUIRES_DIRECT = new Set([
  'src/__tests__/unit/factory.test.ts',
  'src/__tests__/unit/modules-util.test.ts',
  'src/__tests__/handler/workspace.test.ts',
])

function toPosix(value) {
  return value.split(path.sep).join('/')
}

function laneForFile(root, file) {
  const rel = toPosix(path.relative(root, file))
  if (rel.startsWith('src/__tests__/unit/')) return 'unit'
  if (VIM_TESTS.includes(rel)) return 'vim'
  return 'nvim'
}

function editorLifecycleSource(editor) {
  const banner = `import { after as __cocAfter } from 'node:test'
import { start as __cocStart, reset as __cocReset, stop as __cocStop } from 'coc-test/edit_session'
globalThis.editorReset = __cocReset
await __cocStart(${JSON.stringify(editor)})
`
  const footer = `
__cocAfter(async () => { await __cocStop() }, { timeout: 10000 })
`
  return {banner, footer}
}

function testGlobalsSource() {
  return `import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, describe, it } from 'node:test'
`
}

function rewriteInlineSourceMap(output, root) {
  const match = output.match(/sourceMappingURL=data:application\/json;base64,([A-Za-z0-9+/=]+)/)
  if (!match) return output
  const map = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'))
  map.sources = map.sources.map(source => pathToFileURL(path.resolve(root, source)).href)
  return output.replace(
    match[0],
    'sourceMappingURL=data:application/json;base64,' + Buffer.from(JSON.stringify(map)).toString('base64')
  )
}

async function firstFile(candidates) {
  for (const candidate of candidates) {
    try {
      if ((await fs.stat(candidate)).isFile()) return candidate
    } catch {
      // Try the next TypeScript resolution candidate.
    }
  }
  return undefined
}

/**
 * Main-process compiler for test entries and their TypeScript dependencies
 * inside src/__tests__. Compilation records are retained for the whole run;
 * workers and test children only receive immutable serialized records.
 */
export class TestCompiler {
  constructor(root = defaultProjectRoot) {
    this.projectRoot = root
    this.testsRoot = path.join(root, 'src', '__tests__')
    /** @type {Map<string, Promise<object>>} */
    this.pending = new Map()
    /** @type {Map<string, any>} */
    this.records = new Map()
    /** @type {Map<string, Set<string>>} */
    this.dependencies = new Map()
    /** @type {Map<string, Set<string>>} */
    this.dependents = new Map()
  }

  normalizeFile(file) {
    if (file instanceof URL) return fileURLToPath(file)
    if (file.startsWith('file:')) return fileURLToPath(file)
    return path.isAbsolute(file) ? path.normalize(file) : path.resolve(this.projectRoot, file)
  }

  async compileTests(files) {
    const entries = files.map(file => this.normalizeFile(file))
    await Promise.all(entries.map(file => this.compileFile(file, true)))
    // Expand the dependency graph one level at a time. Keeping graph traversal
    // outside compileSource avoids deadlocking if two test helpers import each
    // other: each file's own record is completed before the next frontier is
    // compiled.
    const visited = new Set(entries)
    let frontier = entries
    while (frontier.length > 0) {
      const next = []
      for (const file of frontier) {
        for (const dependency of this.recordFor(file).dependencies) {
          if (visited.has(dependency)) continue
          visited.add(dependency)
          next.push(dependency)
        }
      }
      await Promise.all(next.map(file => this.compileFile(file, false)))
      frontier = next
    }
    return entries.map(file => this.recordFor(file))
  }

  async compileFile(file, isEntry = false) {
    const absolute = this.normalizeFile(file)
    const existing = this.pending.get(absolute)
    if (existing) return await existing
    const pending = this.compileSource(absolute, isEntry)
    this.pending.set(absolute, pending)
    try {
      return await pending
    } catch (error) {
      this.pending.delete(absolute)
      throw error
    }
  }

  async compileSource(file, isEntry) {
    const started = performance.now()
    const lane = isEntry ? laneForFile(this.projectRoot, file) : undefined
    const editor = lane === 'vim' ? 'vim' : lane === 'nvim' ? 'nvim' : undefined
    const lifecycle = editor ? editorLifecycleSource(editor) : undefined
    const result = await build({
      entryPoints: [file],
      bundle: false,
      packages: 'external',
      format: 'esm',
      platform: 'node',
      target: 'node24',
      write: false,
      metafile: true,
      sourcemap: 'inline',
      sourcesContent: true,
      tsconfig: path.join(this.projectRoot, 'tsconfig.test.json'),
      banner: {js: `${testGlobalsSource()}${lifecycle?.banner ?? ''}`},
      footer: lifecycle ? {js: lifecycle.footer} : undefined,
      logLevel: 'silent',
    })
    const outputFile = result.outputFiles.find(output => output.path.endsWith('.js')) ?? result.outputFiles[0]
    let source = rewriteInlineSourceMap(outputFile.text, this.projectRoot)
    const rel = toPosix(path.relative(this.projectRoot, file))
    if (REQUIRES_DIRECT.has(rel)) {
      source = "import { createRequire } from 'node:module';const require = createRequire(import.meta.url);" + source
    }

    const output = Object.values(result.metafile.outputs)[0]
    const directDependencies = []
    for (const item of output?.imports ?? []) {
      if (!item.path.startsWith('./') && !item.path.startsWith('../')) continue
      const dependency = await this.resolveTestDependency(file, item.path)
      if (dependency && !directDependencies.includes(dependency)) directDependencies.push(dependency)
    }
    directDependencies.sort()
    this.dependencies.set(file, new Set(directDependencies))
    for (const dependency of directDependencies) {
      let owners = this.dependents.get(dependency)
      if (!owners) this.dependents.set(dependency, owners = new Set())
      owners.add(file)
    }

    const record = {
      file,
      url: pathToFileURL(file).href,
      source,
      dependencies: directDependencies,
      isTestEntry: isEntry,
      lane,
      editor,
      bytes: Buffer.byteLength(source),
      durationMs: Math.round(performance.now() - started),
    }
    this.records.set(file, record)
    return record
  }

  async resolveTestDependency(parent, specifier) {
    const base = path.resolve(path.dirname(parent), specifier)
    const dependency = await firstFile([
      base,
      base + '.ts',
      path.join(base, 'index.ts'),
    ])
    if (!dependency || path.extname(dependency) !== '.ts') return undefined
    const rel = path.relative(this.testsRoot, dependency)
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return undefined
    return dependency
  }

  recordFor(file) {
    const absolute = this.normalizeFile(file)
    const record = this.records.get(absolute)
    if (!record) throw new Error(`coc-test: no main-process compilation record for ${absolute}`)
    return record
  }

  recordsFor(files) {
    const result = []
    const visited = new Set()
    const visit = file => {
      const absolute = this.normalizeFile(file)
      if (visited.has(absolute)) return
      visited.add(absolute)
      const record = this.recordFor(absolute)
      result.push(record)
      for (const dependency of record.dependencies) visit(dependency)
    }
    for (const file of files) visit(file)
    return result
  }
}
