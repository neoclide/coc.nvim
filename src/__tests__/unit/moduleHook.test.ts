import { createRequire } from 'node:module'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { pathToFileURL } from 'url'
import { ExtensionApiFactory } from '../../extension/apiFactory'
import { installCocModuleHooks, invalidateExtensionCocModule } from '../../extension/moduleHook'
import { ExtensionPathIndex, createModuleDescription } from '../../extension/pathIndex'

let folders: string[] = []
let counter = 0
const require = createRequire(import.meta.url)

function createFolder(): string {
  let folder = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-module-hook-'))
  // Resolve symlinked temp roots (e.g. /var -> /private/var on macOS) so
  // module filenames and roots are compared in one consistent domain.
  folder = fs.realpathSync(folder)
  folders.push(folder)
  return folder
}

function writeModule(dir: string, name: string, content: string): string {
  let file = path.join(dir, name)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
  return file
}

after(() => {
  for (let folder of folders) {
    for (let key of Object.keys(require.cache)) {
      if (key.startsWith(folder) || key.startsWith('coc-virtual:coc.nvim?')) {
        delete require.cache[key]
      }
    }
    fs.rmSync(folder, { recursive: true, force: true })
  }
})

function setup(
  folder: string,
  core: object = { workspace: { name: 'core-workspace' }, commands: {} },
  cocRoot: string = folder
) {
  let index = new ExtensionPathIndex()
  let factory = new ExtensionApiFactory<object, object>()
  factory.initialize(core)
  installCocModuleHooks(index, factory, cocRoot)
  return { index, factory, core }
}

describe('coc.nvim CommonJS hooks', () => {
  it('should resolve api by importing extension with stable identity', () => {
    let folder = createFolder()
    let extDir = path.join(folder, 'ext')
    let id = `cjs-ext-${++counter}`
    let entry = writeModule(extDir, 'index.js', "exports.api = require('coc.nvim')\nexports.libApi = require('./lib')")
    writeModule(extDir, 'lib.js', "module.exports = require('coc.nvim')")
    let core = { workspace: { name: 'core-workspace' } }
    let { index } = setup(folder, core)
    index.update([createModuleDescription(id, extDir, entry)])
    let mod = require(entry) as any
    assert.strictEqual(mod.api.workspace.name, 'core-workspace')
    assert.notStrictEqual(mod.api, core)
    assert.strictEqual(mod.libApi, mod.api)
  })

  it('should give different extensions different api objects', () => {
    let folder = createFolder()
    let extA = path.join(folder, 'ext-a')
    let extB = path.join(folder, 'ext-b')
    let idA = `cjs-a-${++counter}`
    let idB = `cjs-b-${counter}`
    let entryA = writeModule(extA, 'index.js', "module.exports = require('coc.nvim')")
    let entryB = writeModule(extB, 'index.js', "module.exports = require('coc.nvim')")
    let { index } = setup(folder, { workspace: {} })
    index.update([
      createModuleDescription(idA, extA, entryA),
      createModuleDescription(idB, extB, entryB)
    ])
    assert.notStrictEqual(require(entryA), require(entryB))
  })

  it('should resolve dependency under extension node_modules', () => {
    let folder = createFolder()
    let extDir = path.join(folder, 'ext')
    let id = `cjs-dep-${++counter}`
    let entry = writeModule(extDir, 'index.js', "module.exports = require('dep')")
    writeModule(path.join(extDir, 'node_modules', 'dep'), 'index.js', "module.exports = require('coc.nvim')")
    let { index } = setup(folder, { workspace: {} })
    index.update([createModuleDescription(id, extDir, entry)])
    let api = require(entry) as any
    assert.strictEqual(typeof api.workspace, 'object')
  })

  it('should resolve hoisted extension dependencies with the shared api', () => {
    let folder = createFolder()
    let extDir = path.join(folder, 'packages', 'ext')
    let depDir = path.join(folder, 'node_modules', 'dep')
    let id = `cjs-hoisted-${++counter}`
    let entry = writeModule(extDir, 'index.js', "module.exports = require('dep')")
    writeModule(depDir, 'index.js', "module.exports = require('coc.nvim')")
    fs.mkdirSync(path.join(extDir, 'node_modules'), { recursive: true })
    try {
      fs.symlinkSync(depDir, path.join(extDir, 'node_modules', 'dep'), process.platform === 'win32' ? 'junction' : 'dir')
    } catch (e) {
      return
    }
    let core = { workspace: { name: 'core-workspace' } }
    let { index } = setup(folder, core, path.join(folder, 'core'))
    index.update([createModuleDescription(id, extDir, entry)])
    assert.strictEqual(require(entry), core)
  })

  it('should return core api for coc.nvim-owned modules', () => {
    let folder = createFolder()
    let coreDir = path.join(folder, 'core')
    let coreFile = writeModule(coreDir, 'core.js', "module.exports = require('coc.nvim')")
    let core = { workspace: { name: 'core' } }
    let { factory } = setup(folder, core, coreDir)
    assert.strictEqual(require(coreFile), factory.getCoreApi())
  })

  it('should fail clearly for unknown callers', () => {
    let folder = createFolder()
    let outside = path.join(folder, 'outside')
    let file = writeModule(outside, 'unknown.js', "module.exports = require('coc.nvim')")
    let index = new ExtensionPathIndex()
    let factory = new ExtensionApiFactory<object, object>()
    factory.initialize({ workspace: {} })
    installCocModuleHooks(index, factory, path.join(folder, 'core'))
    assert.throws(() => require(file), /Cannot resolve "coc\.nvim" API owner/)
  })

  it('should delegate non-coc requests unchanged', () => {
    let folder = createFolder()
    let dep = writeModule(folder, 'dep.js', "module.exports = { ok: true }")
    let entry = writeModule(folder, 'entry.js', "module.exports = require('./dep')")
    setup(folder)
    assert.deepStrictEqual(require(entry), { ok: true })
  })

  it('should recreate the api after invalidation', () => {
    let folder = createFolder()
    let extDir = path.join(folder, 'ext')
    let id = `cjs-invalidate-${++counter}`
    let entry = writeModule(extDir, 'index.js', "module.exports = require('coc.nvim')")
    let { index, factory } = setup(folder, { workspace: {} })
    index.update([createModuleDescription(id, extDir, entry)])
    let api1 = require(entry)
    delete require.cache[entry]
    factory.delete(id)
    invalidateExtensionCocModule(id)
    let api2 = require(entry)
    assert.notStrictEqual(api1, api2)
  })

  it('should keep loading normal modules after a failed resolve', () => {
    let folder = createFolder()
    let outside = path.join(folder, 'outside')
    let file = writeModule(outside, 'unknown.js', "module.exports = require('coc.nvim')")
    let dep = writeModule(folder, 'dep.js', "module.exports = 1")
    setup(folder, { workspace: {} }, path.join(folder, 'core'))
    assert.throws(() => require(file), /Cannot resolve/)
    assert.strictEqual(require(dep), 1)
  })
})

describe('coc.nvim ESM hooks', () => {
  it('should resolve api by importing extension with stable identity', async () => {
    let folder = createFolder()
    let extDir = path.join(folder, 'ext')
    let id = `esm-ext-${++counter}`
    let entry = writeModule(extDir, 'index.mjs', [
      "import api, { workspace } from 'coc.nvim'",
      "import { depApi } from './dep.mjs'",
      "export const result = { same: api === depApi, hasWorkspace: workspace && workspace.name === 'core-workspace' }"
    ].join('\n'))
    writeModule(extDir, 'dep.mjs', "import api from 'coc.nvim'\nexport const depApi = api")
    let { index, factory } = setup(folder)
    index.update([createModuleDescription(id, extDir, entry, 'module')])
    let mod = await import(pathToFileURL(entry).href) as any
    assert.deepStrictEqual(mod.result, { same: true, hasWorkspace: true })
    assert.strictEqual(typeof factory.getApi(index.findByFile(entry)!), 'object')
  })

  it('should give different extensions different api objects', async () => {
    let folder = createFolder()
    let extA = path.join(folder, 'ext-a')
    let extB = path.join(folder, 'ext-b')
    let idA = `esm-a-${++counter}`
    let idB = `esm-b-${counter}`
    let entryA = writeModule(extA, 'index.mjs', "import api from 'coc.nvim'\nexport { api }")
    let entryB = writeModule(extB, 'index.mjs', "import api from 'coc.nvim'\nexport { api }")
    let { index } = setup(folder)
    index.update([
      createModuleDescription(idA, extA, entryA, 'module'),
      createModuleDescription(idB, extB, entryB, 'module')
    ])
    let apiA = (await import(pathToFileURL(entryA).href) as any).api
    let apiB = (await import(pathToFileURL(entryB).href) as any).api
    assert.notStrictEqual(apiA, apiB)
  })

  it('should return core api for coc.nvim-owned modules', async () => {
    let folder = createFolder()
    let coreFile = writeModule(folder, 'core.mjs', "import api from 'coc.nvim'\nexport default api")
    let { factory } = setup(folder)
    let mod = await import(pathToFileURL(coreFile).href) as any
    assert.strictEqual(mod.default, factory.getCoreApi())
  })

  it('should fail clearly for unknown callers', async () => {
    let folder = createFolder()
    let coreDir = path.join(folder, 'core')
    let outside = createFolder()
    let file = writeModule(outside, 'unknown.mjs', "import api from 'coc.nvim'\nexport { api }")
    setup(coreDir)
    await assert.rejects(() => import(pathToFileURL(file).href), /Cannot resolve "coc\.nvim" API owner/)
  })

  it('should delegate non-coc imports unchanged', async () => {
    let folder = createFolder()
    let extDir = path.join(folder, 'ext')
    let id = `esm-delegate-${++counter}`
    let dep = writeModule(extDir, 'dep.mjs', "export const ok = true")
    let entry = writeModule(extDir, 'index.mjs', "import { ok } from './dep.mjs'\nexport const result = ok")
    let { index } = setup(folder)
    index.update([createModuleDescription(id, extDir, entry, 'module')])
    let mod = await import(pathToFileURL(entry).href) as any
    assert.strictEqual(mod.result, true)
    assert.strictEqual(dep, path.join(extDir, 'dep.mjs'))
  })
})
