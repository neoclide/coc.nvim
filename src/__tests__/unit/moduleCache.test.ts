import { createRequire } from 'node:module'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { ExtensionModuleCache } from '../../extension/moduleCache'
import { createModuleDescription } from '../../extension/pathIndex'

let folders: string[] = []

function createFolder(): string {
  let folder = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-module-cache-'))
  folders.push(folder)
  return folder
}

after(() => {
  for (let folder of folders) {
    for (let key of Object.keys(require.cache)) {
      if (key.startsWith(folder)) delete require.cache[key]
    }
    fs.rmSync(folder, { recursive: true, force: true })
  }
})

const require = createRequire(import.meta.url)
const cache = new ExtensionModuleCache()

describe('ExtensionModuleCache', () => {
  it('should clear extension-owned modules', () => {
    let folder = createFolder()
    let extDir = path.join(folder, 'ext')
    fs.mkdirSync(extDir, { recursive: true })
    let state = path.join(extDir, 'state.js')
    let entry = path.join(extDir, 'index.js')
    fs.writeFileSync(state, "let count = 0\nmodule.exports = { inc: () => ++count }")
    fs.writeFileSync(entry, "let state = require('./state')\nexports.activate = () => state.inc()")
    let desc = createModuleDescription('ext', extDir, entry)
    let mod = require(entry) as any
    assert.strictEqual(mod.activate(), 1)
    cache.clear(desc, folder)
    delete require.cache[entry]
    mod = require(entry) as any
    assert.strictEqual(mod.activate(), 1)
  })

  it('should keep modules outside extension root cached', () => {
    let folder = createFolder()
    let shared = path.join(folder, 'shared.js')
    let extDir = path.join(folder, 'ext')
    fs.mkdirSync(extDir, { recursive: true })
    let entry = path.join(extDir, 'index.js')
    fs.writeFileSync(shared, "let count = 0\nmodule.exports = { inc: () => ++count }")
    fs.writeFileSync(entry, "let shared = require('../shared')\nexports.activate = () => shared.inc()")
    let desc = createModuleDescription('ext', extDir, entry)
    let mod = require(entry) as any
    assert.strictEqual(mod.activate(), 1)
    cache.clear(desc, folder)
    delete require.cache[entry]
    mod = require(entry) as any
    // shared.js outside extension root stays cached, counter is not reset.
    assert.strictEqual(mod.activate(), 2)
  })

  it('should not touch unrelated extension cache', () => {
    let folder = createFolder()
    let extA = path.join(folder, 'ext-a')
    let extB = path.join(folder, 'ext-b')
    fs.mkdirSync(extA, { recursive: true })
    fs.mkdirSync(extB, { recursive: true })
    let entryA = path.join(extA, 'index.js')
    let entryB = path.join(extB, 'index.js')
    fs.writeFileSync(entryA, "let count = 0\nexports.activate = () => ++count")
    fs.writeFileSync(entryB, "let count = 0\nexports.activate = () => ++count")
    let descA = createModuleDescription('a', extA, entryA)
    require(entryA)
    require(entryB)
    cache.clear(descA, folder)
    // entryA must re-execute, entryB must stay cached.
    delete require.cache[entryA]
    let modA = require(entryA) as any
    let modB = require(entryB) as any
    assert.strictEqual(modA.activate(), 1)
    assert.strictEqual(modB.activate(), 1)
  })

  it('should refuse to clear coc.nvim root', () => {
    let folder = createFolder()
    let desc = createModuleDescription('bad', folder, path.join(folder, 'index.js'))
    assert.throws(() => cache.clear(desc, folder), /Refusing to clear/)
  })

  it('should refuse to clear an ancestor of coc.nvim root', () => {
    let folder = createFolder()
    let parent = path.dirname(folder)
    let desc = createModuleDescription('bad', parent, path.join(parent, 'index.js'))
    assert.throws(() => cache.clear(desc, folder), /Refusing to clear/)
  })

  it('should refuse to clear filesystem root', () => {
    let folder = createFolder()
    let root = path.parse(folder).root
    let desc = createModuleDescription('bad', root, path.join(root, 'index.js'))
    assert.throws(() => cache.clear(desc, folder), /Refusing to clear/)
  })

  it('should refuse relative roots', () => {
    let folder = createFolder()
    let desc = {
      id: 'bad',
      root: 'relative/path',
      realRoot: 'relative/path',
      entry: 'relative/path/index.js',
      moduleType: 'commonjs' as const
    }
    assert.throws(() => cache.clear(desc, folder), /Invalid extension root/)
  })
})
