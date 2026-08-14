import fs from 'fs'
import os from 'os'
import path from 'path'
import { pathToFileURL } from 'url'
import { ExtensionApiFactory } from '../../extension/apiFactory'
import { installEsmHooks } from '../../extension/esmHook'
import { ExtensionPathIndex, createModuleDescription } from '../../extension/pathIndex'

let folders: string[] = []
let counter = 0

function createFolder(): string {
  let folder = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-esm-hook-'))
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
    fs.rmSync(folder, { recursive: true, force: true })
  }
})

function setup(folder: string) {
  let index = new ExtensionPathIndex()
  let core = { workspace: { name: 'core-workspace' }, commands: {} }
  let factory = new ExtensionApiFactory<object, object>()
  factory.initialize(core)
  installEsmHooks(index, factory, folder)
  return { index, factory, core }
}

describe('coc.nvim ESM hooks', () => {
  it('should resolve api by importing extension with stable identity', async () => {
    let folder = createFolder()
    let extDir = path.join(folder, 'ext')
    let id = `ext-${++counter}`
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
    let api1 = factory.getApi(index.findByFile(entry)!)
    assert.strictEqual(typeof api1, 'object')
  })

  it('should give different extensions different api objects', async () => {
    let folder = createFolder()
    let extA = path.join(folder, 'ext-a')
    let extB = path.join(folder, 'ext-b')
    let idA = `a-${++counter}`
    let idB = `b-${counter}`
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
    let id = `delegate-${++counter}`
    let dep = writeModule(extDir, 'dep.mjs', "export const ok = true")
    let entry = writeModule(extDir, 'index.mjs', "import { ok } from './dep.mjs'\nexport const result = ok")
    let { index } = setup(folder)
    index.update([createModuleDescription(id, extDir, entry, 'module')])
    let mod = await import(pathToFileURL(entry).href) as any
    assert.strictEqual(mod.result, true)
    assert.strictEqual(dep, path.join(extDir, 'dep.mjs'))
  })
})
