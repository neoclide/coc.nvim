import * as shared from '../sharedUtil'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { Disposable } from 'vscode-languageserver-protocol'
import events from '../../events'
import { logger } from '../../logger/index'
import { API, checkCommand, checkFileSystem, checkLanguageId, Extension, ExtensionManager, ExtensionType, getActivationEvents, getEvents, getOnCommandList, toWorkspaceContainsPatterns } from '../../extension/manager'
import { ExtensionJson, ExtensionStat } from '../../extension/stat'
import { Neovim } from '@chemzqm/neovim'
import { disposeAll } from '../../util'
import { Extensions as ExtensionsInfo, getExtensionDefinitions, IExtensionRegistry } from '../../util/extensionRegistry'
import { writeJson } from '../../util/fs'
import { deepIterate } from '../../util/object'
import { Registry } from '../../util/registry'
import workspace from '../../workspace'
import { afterEach, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'

let disposables: Disposable[] = []
let nvim: Neovim
let tmpfolder: string
before(async () => {
  nvim = workspace.nvim
})

afterEach(() => {
  disposeAll(disposables)
  if (tmpfolder && fs.existsSync(tmpfolder)) {
    fs.rmSync(tmpfolder, { force: true, recursive: true })
  }
})

function createFolder(): string {
  let folder = path.join(os.tmpdir(), crypto.randomUUID())
  fs.mkdirSync(folder, { recursive: true })
  return folder
}

describe('utils', () => {
  it('should get events', t => {
    assert.deepStrictEqual(getEvents(undefined), [])
    assert.deepStrictEqual(getEvents(['a', 'b']), ['a', 'b'])
    assert.deepStrictEqual(getEvents(['x:y', 'x:z']), ['x'])
  })

  it('should get onCommand list', async t => {
    let res = getOnCommandList(['onCommand:a', 'onCommand', 'onCommand:b'])
    assert.deepStrictEqual(res, ['a', 'b'])
    assert.deepStrictEqual(getOnCommandList(undefined), [])
  })

  it('should getActivationEvents', async t => {
    assert.deepStrictEqual(getActivationEvents({} as any), [])
    assert.deepStrictEqual(getActivationEvents({ activationEvents: 1 } as any), [])
    assert.deepStrictEqual(getActivationEvents({ activationEvents: ['a', ''] } as any), ['a'])
    assert.deepStrictEqual(getActivationEvents({ activationEvents: ['a', 1] } as any), ['a'])
  })

  it('should checkLanguageId', t => {
    assert.strictEqual(checkLanguageId({ languageId: 'vim', filetype: 'vim' }, []), false)
    assert.strictEqual(checkLanguageId({ languageId: 'vim', filetype: 'vim' }, ['onLanguage:java', 'onLanguage:vim']), true)
  })

  it('should checkCommand', async t => {
    assert.strictEqual(checkCommand('cmd', []), false)
    assert.strictEqual(checkCommand('cmd', ['onCommand:abc']), false)
    assert.strictEqual(checkCommand('cmd', ['onCommand:def', 'onCommand:cmd']), true)
  })

  it('should checkFilesystem', async t => {
    assert.strictEqual(checkFileSystem('file:///1', []), false)
    assert.strictEqual(checkFileSystem('file:///1', ['onFileSystem:x', 'onFileSystem:file']), true)
  })

  it('should toWorkspaceContainsPatterns', async t => {
    let res = toWorkspaceContainsPatterns(['workspaceContains:', 'workspaceContains:a.js', 'workspaceContains:b.js'])
    assert.deepStrictEqual(res, ['a.js', 'b.js'])
    res = toWorkspaceContainsPatterns(['workspaceContains:', 'workspaceContains:**/b.js'])
    assert.deepStrictEqual(res, ['**/b.js'])
  })
})

describe('ExtensionManager', () => {
  function create(folder = createFolder(), activate = false): ExtensionManager {
    let stats = new ExtensionStat(folder)
    let manager = new ExtensionManager(stats, tmpfolder)
    disposables.push(manager)
    if (activate) void manager.activateExtensions()
    return manager
  }

  function createExtension(folder: string, packageJSON: ExtensionJson, code?: string): void {
    fs.mkdirSync(folder, { recursive: true })
    code = code ?? `exports.activate = () => {return {folder: "${folder}"}}`
    let jsonfile = path.join(folder, 'package.json')
    fs.writeFileSync(jsonfile, JSON.stringify(packageJSON), 'utf8')
    let file = packageJSON.main ?? 'index.js'
    fs.writeFileSync(path.join(folder, file), code, 'utf8')
  }

  function createGlobalExtension(name: string, contributes?: any): string {
    tmpfolder = createFolder()
    let extFolder = path.join(tmpfolder, 'node_modules', name)
    createExtension(extFolder, { name, main: 'entry.js', engines: { coc: '>=0.0.1' }, contributes })
    return extFolder
  }

  describe('activateExtensions()', () => {
    it('should registExtensions', async t => {
      let res = await shared.doAction('registerExtensions')
      assert.strictEqual(res, true)
    })

    it('should throw on error', async t => {
      tmpfolder = createFolder()
      createExtension(tmpfolder, {
        name: 'name',
        engines: { coc: '>= 0.0.80' },
        activationEvents: ['onLanguage:vim'],
        contributes: {}
      })
      let manager = create(tmpfolder)
      await manager.loadExtension(tmpfolder)
      await manager.activateExtensions()
      let fn = () => {
        manager.tryActivateExtensions('onLanguage', () => {
          throw new Error('test error')
        })
      }
      assert.throws(fn, Error)
    })

    it('should not throw when autoActivated throws', async t => {
      tmpfolder = createFolder()
      createExtension(tmpfolder, {
        name: 'name',
        engines: { coc: '>= 0.0.80' },
        activationEvents: ['*']
      })
      let manager = create(tmpfolder)
      await manager.loadExtension(tmpfolder)
      let extension = manager.getExtension('name').extension
      t.mock.method(manager, 'checkAutoActivate' as any, () => {
        throw new Error('test error')
      })
      await manager.autoActivate('name', extension)
    })

    it('should automatically activated', async t => {
      let folder = createFolder()
      fs.writeFileSync(path.join(folder, 'base.js'), 'foo', 'utf8')
      workspace.workspaceFolderControl.addWorkspaceFolder(folder, false)
      tmpfolder = createFolder()
      let code = `exports.activate = (ctx) => {return {abs: ctx.asAbsolutePath('./foo')}}`
      createExtension(tmpfolder, {
        name: 'auto',
        engines: { coc: '>= 0.0.80' },
        activationEvents: ['workspaceContains:base.js'],
        contributes: {
          rootPatterns: [
            {
              filetype: "javascript",
              patterns: [
                "package.json",
                "jsconfig.json"
              ]
            }
          ]
        }
      }, code)
      let manager = create(tmpfolder)
      t.mock.method(workspace, 'checkPatterns', () => {
        return Promise.resolve(true)
      })
      await manager.activateExtensions()
      await manager.loadExtension(tmpfolder)
      let item = manager.getExtension('auto')
      await shared.waitValue(() => {
        return item.extension.isActive
      }, true)
      assert.strictEqual(manager.all.length, 1)
      assert.strictEqual(manager.getExtensionState('auto'), 'activated')
      assert.notStrictEqual(item.extension.exports['abs'], undefined)
      fs.rmSync(folder, { recursive: true, force: true })
    })
  })

  describe('activationEvents', () => {
    async function createExtension(manager: ExtensionManager, ...events: string[]): Promise<Extension<API>> {
      let id = crypto.randomUUID()
      let isActive = false
      let packageJSON = {
        name: id,
        activationEvents: events
      }
      let ext = {
        id,
        packageJSON,
        exports: void 0,
        extensionPath: '',
        activate: async () => {
          isActive = true
        }
      } as any
      Object.defineProperty(ext, 'isActive', {
        get: () => isActive
      })
      await manager.registerInternalExtension(ext, () => {
        isActive = false
      })
      return ext
    }

    it('should load local extension on runtimepath change', async t => {
      tmpfolder = createFolder()
      let manager = create(tmpfolder, true)
      writeJson(path.join(tmpfolder, 'package.json'), {
        name: 'local',
        engines: { coc: '>=0.0.1' },
        contributes: {
          configuration: {
            properties: {
              'local.enable': {
                type: 'boolean',
                default: true,
                description: "Enable local"
              }
            }
          }
        }
      })
      fs.writeFileSync(path.join(tmpfolder, 'index.js'), '')
      let called = false
      workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('local.enable')) {
          called = true
        }
      })
      await nvim.command(`set runtimepath^=${tmpfolder}`)
      await shared.waitValue(() => {
        return manager.has('local')
      }, true)
      assert.strictEqual(called, true)
      let ext = manager.getExtension('local')
      assert.strictEqual(ext.extension.isActive, true)
      let c = workspace.getConfiguration('local')
      assert.strictEqual(c.get('enable'), true)
      fs.rmSync(tmpfolder, { force: true, recursive: true })
    })

    it('should activate on language', async t => {
      tmpfolder = createFolder()
      let manager = create(tmpfolder, true)
      let ext = await createExtension(manager, 'workspaceContains:foobar', 'onLanguage:javascript')
      assert.strictEqual(ext.isActive, false)
      assert.strictEqual(ext._exports, undefined)
      await nvim.command('edit /tmp/a.js')
      await nvim.command('setf javascript')
      await shared.waitValue(() => ext.isActive, true)
      assert.strictEqual(ext.isActive, true)
      ext = await createExtension(manager, 'onLanguage:javascript')
      assert.strictEqual(ext.isActive, true)
    })

    it('should activate on command', async t => {
      tmpfolder = createFolder()
      let manager = create(tmpfolder, true)
      let ext = await createExtension(manager, 'onCommand:test.echo')
      await events.fire('Command', ['test.bac'])
      await events.fire('Command', ['test.echo'])
      await shared.waitValue(() => ext.isActive, true)
      assert.strictEqual(ext.isActive, true)
    })

    it('should activate on workspace contains', async t => {
      tmpfolder = createFolder()
      let manager = create(tmpfolder, true)
      let ext = await createExtension(manager, 'workspaceContains:package.json')
      await createExtension(manager, 'workspaceContains:file_not_exists')
      let root = path.resolve(import.meta.dirname, '../../..')
      await nvim.command(`edit ${path.join(root, 'file.js')}`)
      await shared.waitValue(() => {
        return ext.isActive
      }, true)
    })

    it('should activate on file system', async t => {
      tmpfolder = createFolder()
      let manager = create(tmpfolder, true)
      let ext = await createExtension(manager, 'onFileSystem:zip')
      // `:edit zip:///a` needs a zip plugin and is unreliable in CI, so
      // mock a zip document open instead.
      let bufnr = 100000
      let doc = {
        bufnr,
        uri: 'zip:///a',
        attached: true,
        languageId: 'zip',
        filetype: 'zip',
        winids: [],
        // The file-level editor reset wipes all documents; the fake buffer
        // must survive documentsManager.reset()'s detach path.
        detach: () => {},
        textDocument: { lines: [] }
      } as any
      let documents = workspace.documentsManager
      documents.buffers.set(bufnr, doc)
      disposables.push(Disposable.create(() => {
        documents.buffers.delete(bufnr)
      }))
        ; (documents as any)._onDidOpenTextDocument.fire(doc)
      await shared.waitValue(() => ext.isActive, true)
      assert.strictEqual(ext.isActive, true)
      ext = await createExtension(manager, 'onFileSystem:zip')
      await shared.waitValue(() => ext.isActive, true)
    })
  })

  describe('has()', () => {
    it('should check current extensions', async t => {
      let manager = create()
      assert.strictEqual(manager.has('id'), false)
      assert.strictEqual(manager.getExtension('id'), undefined)
      assert.deepStrictEqual(manager.loadedExtensions, [])
      assert.deepStrictEqual(manager.all, [])
    })
  })

  describe('activate()', () => {
    it('should throw when extension not registered', async t => {
      tmpfolder = createFolder()
      let manager = create(tmpfolder)
      let fn = async () => {
        await manager.activate('name')
      }
      await assert.rejects(fn(), Error)
      fn = async () => {
        await manager.call('name', 'fn', [])
      }
      await assert.rejects(fn(), Error)
    })

    it('should activate extension with dependencies', async t => {
      tmpfolder = createFolder()
      let manager = create(tmpfolder)

      let depFolder = path.join(tmpfolder, 'coc-ext-dep')
      createExtension(depFolder, {
        name: 'coc-ext-dep',
        engines: { coc: '>=0.0.1' }
      }, `exports.activate = () => { return { name: 'coc-ext-dep' } }`)

      let mainFolder = path.join(tmpfolder, 'coc-ext-main')
      createExtension(mainFolder, {
        name: 'coc-ext-main',
        engines: { coc: '>=0.0.1' },
        extensionDependencies: ['coc-ext-dep']
      }, `exports.activate = () => { return { name: 'coc-ext-main' } }`)

      await manager.loadExtension(depFolder)
      await manager.loadExtension(mainFolder)

      await manager.activate('coc-ext-main')

      assert.strictEqual(manager.getExtension('coc-ext-dep').extension.isActive, true)
      assert.strictEqual(manager.getExtension('coc-ext-main').extension.isActive, true)
    })

    it('should fail when dependency activation fails', async t => {
      tmpfolder = createFolder()
      let manager = create(tmpfolder)

      let depFolder = path.join(tmpfolder, 'coc-ext-dep')
      createExtension(depFolder, {
        name: 'coc-ext-dep',
        engines: { coc: '>=0.0.1' }
      }, `exports.activate = () => { throw new Error('Dependency failed') }`)

      let mainFolder = path.join(tmpfolder, 'coc-ext-main')
      createExtension(mainFolder, {
        name: 'coc-ext-main',
        engines: { coc: '>=0.0.1' },
        extensionDependencies: ['coc-ext-dep']
      }, `exports.activate = () => { return { name: 'coc-ext-main' } }`)

      await manager.loadExtension(depFolder)
      await manager.loadExtension(mainFolder)

      let result = await manager.activate('coc-ext-main')

      assert.strictEqual(result, false)
      assert.strictEqual(manager.getExtension('coc-ext-main').extension.isActive, false)
    })

    it('should log failed dependency name', async t => {
      tmpfolder = createFolder()
      let manager = create(tmpfolder)

      let depFolder = path.join(tmpfolder, 'coc-ext-dep')
      createExtension(depFolder, {
        name: 'coc-ext-dep',
        engines: { coc: '>=0.0.1' }
      }, `exports.activate = () => { throw new Error('Dependency failed') }`)

      let mainFolder = path.join(tmpfolder, 'coc-ext-main')
      createExtension(mainFolder, {
        name: 'coc-ext-main',
        engines: { coc: '>=0.0.1' },
        extensionDependencies: ['coc-ext-dep']
      }, `exports.activate = () => { return { name: 'coc-ext-main' } }`)

      await manager.loadExtension(depFolder)
      await manager.loadExtension(mainFolder)

      let scopeLogger = (logger as any).loggers.get('extensions-manager')
      let spy = t.mock.method(scopeLogger, 'error')
      let result = await manager.activate('coc-ext-main')
      assert.strictEqual(result, false)
      assert.ok(spy.mock.calls.length > 0)
      assert.ok(String(spy.mock.calls[0].arguments[0]).includes('coc-ext-dep'))
      assert.strictEqual(spy.mock.calls[0].arguments.length, 2)
    })

    it('should fail on circular dependencies', async t => {
      tmpfolder = createFolder()
      let manager = create(tmpfolder)

      let ext1Folder = path.join(tmpfolder, 'coc-ext1')
      createExtension(ext1Folder, {
        name: 'coc-ext1',
        engines: { coc: '>=0.0.1' },
        extensionDependencies: ['coc-ext2']
      }, `exports.activate = () => { return { name: 'coc-ext1' } }`)

      let ext2Folder = path.join(tmpfolder, 'coc-ext2')
      createExtension(ext2Folder, {
        name: 'coc-ext2',
        engines: { coc: '>=0.0.1' },
        extensionDependencies: ['coc-ext1']
      }, `exports.activate = () => { return { name: 'coc-ext2' } }`)

      await manager.loadExtension(ext1Folder)
      await manager.loadExtension(ext2Folder)

      let result = await manager.activate('coc-ext1')
      assert.strictEqual(result, false)
    })
  })

  describe('call()', () => {
    it('should activate extension that not activated', async t => {
      tmpfolder = createFolder()
      let code = `exports.activate = () => {return {getId: () => {return 'foo'}}}`
      createExtension(tmpfolder, { name: 'name', engines: { coc: '>=0.0.1' } }, code)
      let manager = create(tmpfolder)
      await manager.loadExtension(tmpfolder)
      let item = manager.getExtension('name')
      assert.strictEqual(item.extension.isActive, false)
      let res = await manager.call('name', 'getId', [])
      assert.strictEqual(res, 'foo')
      let fn = async () => {
        await manager.call('name', 'fn', [])
      }
      await assert.rejects(fn(), Error)
    })
  })

  describe('loadExtensionFile()', () => {
    it('should load single file extension', async t => {
      tmpfolder = createFolder()
      let filepath = path.join(tmpfolder, 'abc.js')
      fs.writeFileSync(filepath, `exports.activate = (ctx) => {return {storagePath: ctx.storagePath}}`, 'utf8')
      let manager = create(tmpfolder, true)
      await manager.loadExtensionFile(filepath)
      let item = manager.getExtension('single-abc')
      assert.strictEqual(item.extension.isActive, true)
      let file = path.join(tmpfolder, 'single-abc-data')
      assert.strictEqual(item.extension.exports['storagePath'], file)
    })

    it('should not load extension when filepath not exists', async t => {
      tmpfolder = createFolder()
      let manager = create(tmpfolder, true)
      let filepath = path.join(tmpfolder, 'abc.js')
      await manager.loadExtensionFile(filepath)
      let item = manager.getExtension('single-abc')
      assert.strictEqual(item, undefined)
    })
  })

  describe('uninstallExtensions()', () => {
    it('should show message for extensions not found', async t => {
      let manager = create(tmpfolder)
      await manager.uninstallExtensions(['foo'])
      let line = await shared.getCmdline()
      assert.match(line, new RegExp('not found'))
    })
  })

  describe('cleanExtensions()', () => {
    it('should return extension ids that not disabled', async t => {
      tmpfolder = createFolder()
      let foo = path.join(tmpfolder, 'foo')
      createExtension(foo, { name: 'foo', engines: { coc: '>=0.0.1' } })
      let bar = path.join(tmpfolder, 'bar')
      createExtension(bar, { name: 'bar', engines: { coc: '>=0.0.1' } })
      let obj = { dependencies: { foo: '1.0.0', bar: '1.0.0' } }
      writeJson(path.join(tmpfolder, 'package.json'), obj)
      let manager = create(tmpfolder)
      await manager.loadExtension(foo)
      await manager.loadExtension(bar)
      manager.states.setDisable('foo', true)
      let res = await manager.cleanExtensions()
      assert.deepStrictEqual(res, ['bar'])
    })
  })

  describe('loadedExtension()', () => {
    it('should throw on bad extension', async t => {
      tmpfolder = createFolder()
      createExtension(tmpfolder, { name: 'name', engines: {} })
      let manager = create(tmpfolder)
      let fn = async () => {
        await manager.loadExtension(tmpfolder)
      }
      await assert.rejects(fn(), Error)
      fn = async () => {
        await manager.loadExtension([tmpfolder])
      }
      await assert.rejects(fn(), Error)
    })

    it('should return false when disabled', async t => {
      tmpfolder = createFolder()
      createExtension(tmpfolder, { name: 'name', engines: { coc: '>=0.0.1' } })
      let manager = create(tmpfolder)
      manager.states.setDisable('name', true)
      let res = await manager.loadExtension(tmpfolder)
      assert.strictEqual(res, false)
    })

    it('should load local extension', async t => {
      tmpfolder = createFolder()
      createExtension(tmpfolder, { name: 'name', engines: { vscode: '1.0' } })
      let manager = create(tmpfolder)
      await manager.loadExtension(tmpfolder)
      await manager.loadExtension([tmpfolder])
      let item = manager.getExtension('name')
      assert.strictEqual(item.isLocal, true)
      assert.strictEqual(item.extension.isActive, false)
      await item.extension.activate()
      assert.strictEqual(item.extension.isActive, true)
    })

    it('should load and activate global extension', async t => {
      let contributes = {
        configuration: {
          properties: {
            'name.enable': {
              type: 'boolean',
              description: "Enable name"
            }
          }
        }
      }
      let extFolder = createGlobalExtension('name', contributes)
      let manager = create(tmpfolder)
      manager.states.addExtension('name', '>=0.0.1')
      let res = await manager.loadExtension(extFolder)
      await manager.activateExtensions()
      assert.strictEqual(res, true)
      let item = manager.getExtension('name')
      assert.strictEqual(item.isLocal, false)
      assert.strictEqual(item.extension.extensionPath.endsWith('name'), true)
      let result = await item.extension.activate()
      assert.notStrictEqual(result, undefined)
      assert.deepStrictEqual(result, item.extension.exports)
      await manager.deactivate('name')
      let stat = manager.getExtensionState('name')
      assert.strictEqual(stat, 'loaded')
      let c = workspace.getConfiguration('name')
      assert.strictEqual(c.get('enable'), false)
      manager.unregistContribution('name')
      c = workspace.getConfiguration('name')
      assert.strictEqual(c.get('enable', undefined), undefined)
    })
  })

  describe('unloadExtension()', () => {
    it('should unload extension', async t => {
      let extFolder = createGlobalExtension('name')
      let manager = create(tmpfolder)
      manager.states.addExtension('name', '>=0.0.1')
      await manager.loadExtension(extFolder)
      let res = manager.getExtension('name')
      assert.notStrictEqual(res, undefined)
      let fn = t.mock.fn()
      manager.onDidUnloadExtension(() => {
        fn()
      })
      await manager.unloadExtension('name')
      res = manager.getExtension('name')
      assert.strictEqual(res, undefined)
      await manager.unloadExtension('name')
      assert.strictEqual(fn.mock.calls.length, 1)
    })
  })

  describe('reloadExtension()', () => {
    it('should throw when extension not registered', async t => {
      tmpfolder = createFolder()
      let manager = create(tmpfolder)
      let fn = async () => {
        await manager.reloadExtension('id')
      }
      await assert.rejects(fn(), Error)
    })

    it('should reload single file extension', async t => {
      tmpfolder = createFolder()
      let filepath = path.join(tmpfolder, 'test.js')
      fs.writeFileSync(filepath, `exports.activate = () => {return {file: "${filepath}"}};exports.deactivate = () => {}`, 'utf8')
      let manager = create(tmpfolder)
      await manager.activateExtensions()
      await manager.loadExtensionFile(filepath)
      let item = manager.getExtension('single-test')
      assert.strictEqual(item.extension.isActive, true)
      await manager.activate('single-test')
      await manager.reloadExtension('single-test')
      item = manager.getExtension('single-test')
      assert.strictEqual(item.extension.isActive, true)
      await item.deactivate()
      assert.strictEqual(item.extension.isActive, false)
      process.env.COC_NO_PLUGINS = '1'
      await manager.activateExtensions()
    })

    it('should reload extension from directory', async t => {
      tmpfolder = createFolder()
      let extFolder = path.join(tmpfolder, 'node_modules', 'name')
      createExtension(extFolder, { name: 'name', main: 'entry.js', engines: { coc: '>=0.0.1' } })
      let manager = create(tmpfolder)
      let res = await manager.loadExtension(extFolder)
      assert.strictEqual(res, true)
      await manager.reloadExtension('name')
      let item = manager.getExtension('name')
      assert.strictEqual(item.extension.isActive, false)
    })
  })

  describe('registerExtension()', () => {
    it('should not register disabled extension', async t => {
      tmpfolder = createFolder()
      let manager = create(tmpfolder)
      manager.states.setDisable('name', true)
      await manager.registerExtension(tmpfolder, {
        name: 'name',
        engines: { coc: '>=0.0.1' },
      }, ExtensionType.Internal)
      let item = manager.getExtension('name')
      assert.strictEqual(item, undefined)
    })

    it('should throw error on activate', async t => {
      tmpfolder = createFolder()
      let code = `exports.activate = () => {throw new Error('my error')}`
      createExtension(tmpfolder, { name: 'name', engines: { coc: '>=0.0.1' } }, code)
      let manager = create(tmpfolder)
      await manager.loadExtension(tmpfolder)
      let item = manager.getExtension('name')
      let fn = async () => {
        await item.extension.activate()
      }
      await assert.rejects(fn(),)
      fn = async () => {
        item.extension.exports
      }
      await assert.rejects(fn(),)
    })

    it('should catch error on deactivate', async t => {
      tmpfolder = createFolder()
      let code = `exports.activate = () => { return {}};exports.deactivate = () => {throw new Error('my error')}`
      createExtension(tmpfolder, { name: 'name', engines: { coc: '>=0.0.1' } }, code)
      let manager = create(tmpfolder)
      await manager.loadExtension(tmpfolder)
      let item = manager.getExtension('name')
      await item.deactivate()
      await item.extension.activate()
      await item.deactivate()
    })

    it('should not throw on register error', async t => {
      let manager = create()
      t.mock.method(manager, 'registerExtension', () => {
        throw new Error('my error')
      })
      manager.registerExtensions([{
        root: import.meta.filename,
        isLocal: false,
        packageJSON: {} as any
      }])
    })
  })

  describe('toggleExtension()', () => {
    it('should not toggle disabled extension', async t => {
      tmpfolder = createFolder()
      let manager = create(tmpfolder)
      manager.states.setDisable('foo', true)
      await manager.toggleExtension('foo')
    })

    it('should toggle single file extension', async t => {
      tmpfolder = createFolder()
      let filepath = path.join(tmpfolder, 'test.js')
      fs.writeFileSync(filepath, `exports.activate = () => {return {file: "${filepath}"}};exports.deactivate = () => {}`, 'utf8')
      let manager = create(tmpfolder, true)
      await manager.loadExtensionFile(filepath)
      await manager.toggleExtension('single-test')
      let item = manager.getExtension('single-test')
      assert.strictEqual(item, undefined)
      await manager.toggleExtension('single-test')
    })

    it('should toggle global extension', async t => {
      tmpfolder = createFolder()
      let folder = createGlobalExtension('global')
      let manager = create(tmpfolder, true)
      manager.states.addExtension('global', '>=0.0.1')
      await manager.loadExtension(folder)
      let item = manager.getExtension('global')
      assert.strictEqual(item.extension.isActive, true)
      await manager.toggleExtension('global')
      item = manager.getExtension('global')
      assert.strictEqual(item, undefined)
      await manager.toggleExtension('global')
      item = manager.getExtension('global')
      assert.strictEqual(item.extension.isActive, true)
    })

    it('should toggle local extension', async t => {
      tmpfolder = createFolder()
      let folder = path.join(tmpfolder, 'local')
      createExtension(folder, { name: 'local', main: 'entry.js', engines: { coc: '>=0.0.1' } })
      let manager = create(tmpfolder, true)
      await manager.loadExtension(folder)
      let item = manager.getExtension('local')
      assert.strictEqual(item.extension.isActive, true)
      assert.strictEqual(item.isLocal, true)
      await manager.toggleExtension('local')
      item = manager.getExtension('local')
      assert.strictEqual(item, undefined)
      await manager.toggleExtension('local')
      let state = manager.getExtensionState('local')
      assert.strictEqual(state, 'activated')
    })
  })

  it('builds extensionUri from a filesystem path with the file scheme', async t => {
    tmpfolder = createFolder()
    let manager = create()
    await manager.registerExtension('C:\\tmp\\win-ext', {
      name: 'win-ext',
      main: 'index.js',
      engines: { coc: '>=0.0.1' }
    }, ExtensionType.Global)
    let extension = manager.getExtension('win-ext')!.extension
    assert.strictEqual(extension.extensionUri.scheme, 'file')
    // URI.parse('C:\\...') would treat C as the scheme; URI.file must keep
    // the drive-letter path.
    assert.match(extension.extensionUri.fsPath, /^[a-z]:/i)
    assert.ok(extension.extensionUri.fsPath.includes('win-ext'))
  })

  describe('watchExtension()', () => {
    it('should throw when watchman not found', async t => {
      tmpfolder = createFolder()
      let extFolder = path.join(tmpfolder, 'node_modules', 'name')
      createExtension(extFolder, { name: 'name', main: 'entry.js', engines: { coc: '>=0.0.1' } })
      let manager = create(tmpfolder)
      let res = await manager.loadExtension(extFolder)
      assert.strictEqual(res, true)
      t.mock.method(workspace.fileSystemWatchers, 'getWatchmanPath', () => {
        return Promise.reject(new Error('not found'))
      })
      let fn = async () => {
        await manager.watchExtension('name')
      }
      await assert.rejects(fn(), Error)
      await assert.rejects(shared.doAction('watchExtension', 'not_exists_extension'), /not found/)
    })

    it('should reload extension on file change', async t => {
      tmpfolder = createFolder()
      workspace.fileSystemWatchers.disabled = false
      let extFolder = path.join(tmpfolder, 'node_modules', 'name')
      createExtension(extFolder, { name: 'name', main: 'entry.js', engines: { coc: '>=0.0.1' } })
      let manager = create(tmpfolder)
      let res = await manager.loadExtension(extFolder)
      assert.strictEqual(res, true)
      let called = false
      let fn = t.mock.fn()
      t.mock.method(workspace, 'getWatchmanPath', () => {
        return 'watchman'
      })
      t.mock.method(manager, 'reloadExtension', () => {
        fn()
        return Promise.resolve()
      })
      t.mock.method(workspace.fileSystemWatchers, 'createClient', () => {
        return {
          dispose: () => {},
          subscribe: (_key: string, cb: Function) => {
            setTimeout(() => {
              called = true
              cb()
            }, 20)
          }
        } as any
      })
      await manager.watchExtension('name')
      await shared.waitValue(() => {
        return called
      }, true)
      assert.ok(fn.mock.calls.length > 0)
    })

    it('should watch single file extension', async t => {
      let dir = createFolder()
      let id = crypto.randomUUID()
      let filepath = path.join(dir, `${id}.js`)
      fs.writeFileSync(filepath, `exports.activate = () => {return {file: "${filepath}"}};exports.deactivate = () => {}`, 'utf8')
      let manager = create(dir)
      await manager.loadExtensionFile(filepath)
      await manager.watchExtension(`single-${id}`)
      let fn = async () => {
        await manager.watchExtension('single-unknown')
      }
      await assert.rejects(fn(), Error)
      let called = false
      t.mock.method(manager, 'loadExtensionFile', () => {
        called = true
        return Promise.resolve('')
      })
      await shared.waitValue(() => {
        return called
      }, true)
      fs.unlinkSync(filepath)
    })
  })

  describe('loadFileExtensions', () => {
    it('should load extension files', async t => {
      tmpfolder = createFolder()
      let filepath = path.join(tmpfolder, 'abc.js')
      fs.writeFileSync(filepath, `exports.activate = (ctx) => {return {storagePath: ctx.storagePath}}`, 'utf8')
      let manager = create(tmpfolder, true)
      Object.assign(manager, { singleExtensionsRoot: tmpfolder })
      await manager.loadFileExtensions()
      let item = manager.getExtension('single-abc')
      assert.strictEqual(item.extension.isActive, true)
    })
  })

  describe('registContribution', () => {
    it('should register definitions', async t => {
      let json = `{
"configuration": {
    "definitions": {
      "flexible": {
        "type": "object",
        "$ref": 3,
        "properties": {
          "grow": {
            "$ref": "#/definitions/flexible.position"
          },
          "omit": {
            "$ref": "#/definitions/flexible.position"
          }
        }
      }
    },
    "properties": {
      "explorer.presets": {
        "toggle": {
          "$ref": "#/properties/explorer.toggle"
        },
        "mykey": {
          "$ref": "#/definitions/mapping.keyMappings"
        }
      }
    }
  }
}`
      let obj = JSON.parse(json)
      tmpfolder = createFolder()
      let manager = create(tmpfolder, false)
      let packageJSON = { contributes: obj }
      manager.registContribution('@explorer', packageJSON, import.meta.dirname)
      const extensionRegistry = Registry.as<IExtensionRegistry>(ExtensionsInfo.ExtensionContribution)
      let info = extensionRegistry.getExtension('@explorer')
      let definitions = info.definitions
      assert.notStrictEqual(definitions['explorer.flexible'], undefined)
      let refs: string[] = []
      deepIterate(definitions, (node, key) => {
        if (key == '$ref' && typeof node[key] === 'string') {
          refs.push(node[key])
        }
      })
      assert.deepStrictEqual(refs, [
        '#/definitions/explorer.flexible.position',
        '#/definitions/explorer.flexible.position'
      ])
      refs = []
      let properties = manager.configurationNodes[0].properties
      deepIterate(properties, (node, key) => {
        if (key == '$ref' && typeof node[key] === 'string') {
          refs.push(node[key])
        }
      })
      assert.deepStrictEqual(refs, [
        '#/properties/explorer.toggle',
        '#/definitions/explorer.mapping.keyMappings'
      ])
      let defs = getExtensionDefinitions()
      assert.notStrictEqual(defs['explorer.flexible'], undefined)
    })
  })

  describe('loadFileOrFolder()', () => {

    it('should throw for invalid extension', async t => {
      tmpfolder = createFolder()
      let manager = create(tmpfolder, false)
      await assert.rejects(manager.load('file_not_exists', false), Error)
      let id = crypto.randomUUID()
      let filpath = path.join(os.tmpdir(), id)
      fs.writeFileSync(filpath, '', 'utf8')
      await manager.toggleExtension(`single-${id}`)
      await assert.rejects(manager.load(filpath, false), /disabled/)
      fs.rmSync(filpath, { force: true })
    })

    it('should load extension without active', async t => {
      tmpfolder = createFolder()
      let manager = create(tmpfolder, false)
      createExtension(tmpfolder, {
        name: 'name',
        engines: { coc: '>= 0.0.80' },
        activationEvents: ['*'],
        contributes: {}
      })
      let res = await manager.load(tmpfolder, false)
      assert.strictEqual(res.isActive, false)
      assert.strictEqual(res.name, 'name')
      assert.deepStrictEqual(res.exports, {})
      await manager.activateExtensions()
      await res.unload()
      fs.rmSync(tmpfolder, { recursive: true })
    })

    it('should load and active extension', async t => {
      tmpfolder = createFolder()
      let manager = create(tmpfolder, false)
      createExtension(tmpfolder, {
        name: 'active',
        engines: { coc: '>= 0.0.80' },
        activationEvents: ['*'],
        contributes: {}
      }, `exports.activate = () => 'api';exports.foo = 'bar';`)
      let res = await manager.load(tmpfolder, true)
      assert.strictEqual(res.isActive, true)
      assert.strictEqual(res.name, 'active')
      assert.strictEqual(res.api, 'api')
      assert.deepStrictEqual(res.exports, { foo: 'bar' })
      await res.unload()
      fs.rmSync(tmpfolder, { recursive: true })
    })
  })
})
