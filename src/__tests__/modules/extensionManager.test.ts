import { Neovim } from '@chemzqm/neovim'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { v4 as uuid } from 'uuid'
import { Disposable } from 'vscode-languageserver-protocol'
import Watchman from '../../core/watchman'
import { Extensions as ExtensionsInfo, getExtensionDefinitions, IExtensionRegistry } from '../../util/extensionRegistry'
import events from '../../events'
import { API, checkCommand, checkFileSystem, checkLanguageId, Extension, ExtensionManager, ExtensionType, getActivationEvents, getEvents, getOnCommandList, toWorkspaceContinsPatterns } from '../../extension/manager'
import { ExtensionJson, ExtensionStat } from '../../extension/stat'
import { Registry } from '../../util/registry'
import { disposeAll } from '../../util'
import { writeJson } from '../../util/fs'
import workspace from '../../workspace'
import helper from '../helper'
import { deepIterate } from '../../util/object'

let disposables: Disposable[] = []
let nvim: Neovim
let tmpfolder: string
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
})

afterEach(() => {
  disposeAll(disposables)
  if (fs.existsSync(tmpfolder)) {
    fs.rmSync(tmpfolder, { force: true, recursive: true })
  }
})

afterAll(async () => {
  await helper.shutdown()
})

function createFolder(): string {
  let folder = path.join(os.tmpdir(), uuid())
  fs.mkdirSync(folder)
  return folder
}

describe('utils', () => {
  it('should get events', () => {
    expect(getEvents(undefined)).toEqual([])
    expect(getEvents(['a', 'b'])).toEqual(['a', 'b'])
    expect(getEvents(['x:y', 'x:z'])).toEqual(['x'])
  })

  it('should get onCommand list', async () => {
    let res = getOnCommandList(['onCommand:a', 'onCommand', 'onCommand:b'])
    expect(res).toEqual(['a', 'b'])
    expect(getOnCommandList(undefined)).toEqual([])
  })

  it('should getActivationEvents', async () => {
    expect(getActivationEvents({} as any)).toEqual([])
    expect(getActivationEvents({ activationEvents: 1 } as any)).toEqual([])
    expect(getActivationEvents({ activationEvents: ['a', ''] } as any)).toEqual(['a'])
    expect(getActivationEvents({ activationEvents: ['a', 1] } as any)).toEqual(['a'])
  })

  it('should checkLanguageId', () => {
    expect(checkLanguageId({ languageId: 'vim', filetype: 'vim' }, [])).toBe(false)
    expect(checkLanguageId({ languageId: 'vim', filetype: 'vim' }, ['onLanguage:java', 'onLanguage:vim'])).toBe(true)
  })

  it('should checkCommand', async () => {
    expect(checkCommand('cmd', [])).toBe(false)
    expect(checkCommand('cmd', ['onCommand:abc'])).toBe(false)
    expect(checkCommand('cmd', ['onCommand:def', 'onCommand:cmd'])).toBe(true)
  })

  it('should checkFilesystem', async () => {
    expect(checkFileSystem('file:///1', [])).toBe(false)
    expect(checkFileSystem('file:///1', ['onFileSystem:x', 'onFileSystem:file'])).toBe(true)
  })

  it('should toWorkspaceContinsPatterns', async () => {
    let res = toWorkspaceContinsPatterns(['workspaceContains:', 'workspaceContains:a.js', 'workspaceContains:b.js'])
    expect(res).toEqual(['a.js', 'b.js'])
    res = toWorkspaceContinsPatterns(['workspaceContains:', 'workspaceContains:**/b.js'])
    expect(res).toEqual(['**/b.js'])
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
    it('should registExtensions', async () => {
      let res = await helper.doAction('registerExtensions')
      expect(res).toBe(true)
    })

    it('should throw on error', async () => {
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
      expect(fn).toThrow(Error)
    })

    it('should not throw when autoActiavte throws', async () => {
      tmpfolder = createFolder()
      createExtension(tmpfolder, {
        name: 'name',
        engines: { coc: '>= 0.0.80' },
        activationEvents: ['*']
      })
      let manager = create(tmpfolder)
      await manager.loadExtension(tmpfolder)
      let extension = manager.getExtension('name').extension
      let spy = jest.spyOn(manager, 'checkAutoActivate' as any).mockImplementation(() => {
        throw new Error('test error')
      })
      await manager.autoActiavte('name', extension)
      spy.mockRestore()
    })

    it('should automatically activated', async () => {
      workspace.workspaceFolderControl.addWorkspaceFolder(__dirname, false)
      tmpfolder = createFolder()
      let code = `exports.activate = (ctx) => {return {abs: ctx.asAbsolutePath('./foo')}}`
      createExtension(tmpfolder, {
        name: 'name',
        engines: { coc: '>= 0.0.80' },
        activationEvents: ['workspaceContains:extensionManager.test.ts'],
        contributes: {
          rootPatterns: [
            {
              filetype: "javascript",
              patterns: [
                "package.json",
                "jsconfig.json"
              ]
            }
          ],
          commands: [
            {
              title: "Test",
              command: "test.run"
            }
          ]
        }
      }, code)
      let manager = create(tmpfolder)
      await manager.activateExtensions()
      await manager.loadExtension(tmpfolder)
      let item = manager.getExtension('name')
      expect(item.extension.isActive).toBe(true)
      expect(manager.all.length).toBe(1)
      expect(manager.getExtensionState('name')).toBe('activated')
      expect(item.extension.exports['abs']).toBeDefined()
    })
  })

  describe('activationEvents', () => {
    async function createExtension(manager: ExtensionManager, ...events: string[]): Promise<Extension<API>> {
      let id = uuid()
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

    it('should load local extension on runtimepath change', async () => {
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
      await helper.waitValue(() => {
        return manager.has('local')
      }, true)
      expect(called).toBe(true)
      let ext = manager.getExtension('local')
      expect(ext.extension.isActive).toBe(true)
      let c = workspace.getConfiguration('local')
      expect(c.get('enable')).toBe(true)
      fs.rmSync(tmpfolder, { force: true, recursive: true })
    })

    it('should activate on language', async () => {
      tmpfolder = createFolder()
      let manager = create(tmpfolder, true)
      let ext = await createExtension(manager, 'workspaceContains:foobar', 'onLanguage:javascript')
      expect(ext.isActive).toBe(false)
      await nvim.command('edit /tmp/a.js')
      await nvim.command('setf javascript')
      await helper.wait(50)
      expect(ext.isActive).toBe(true)
      ext = await createExtension(manager, 'onLanguage:javascript')
      expect(ext.isActive).toBe(true)
    })

    it('should activate on command', async () => {
      tmpfolder = createFolder()
      let manager = create(tmpfolder, true)
      let ext = await createExtension(manager, 'onCommand:test.echo')
      await events.fire('Command', ['test.bac'])
      await events.fire('Command', ['test.echo'])
      await helper.wait(30)
      expect(ext.isActive).toBe(true)
    })

    it('should activate on workspace contains', async () => {
      tmpfolder = createFolder()
      let manager = create(tmpfolder, true)
      let ext = await createExtension(manager, 'workspaceContains:package.json')
      await createExtension(manager, 'workspaceContains:file_not_exists')
      let root = path.resolve(__dirname, '../../..')
      await nvim.command(`edit ${path.join(root, 'file.js')}`)
      await helper.waitValue(() => {
        return ext.isActive
      }, true)
    })

    it('should activate on file system', async () => {
      tmpfolder = createFolder()
      let manager = create(tmpfolder, true)
      let ext = await createExtension(manager, 'onFileSystem:zip')
      await nvim.command('edit zip:///a')
      await helper.wait(30)
      expect(ext.isActive).toBe(true)
      ext = await createExtension(manager, 'onFileSystem:zip')
      expect(ext.isActive).toBe(true)
    })
  })

  describe('has()', () => {
    it('should check current extensions', async () => {
      let manager = create()
      expect(manager.has('id')).toBe(false)
      expect(manager.getExtension('id')).toBeUndefined()
      expect(manager.loadedExtensions).toEqual([])
      expect(manager.all).toEqual([])
    })
  })

  describe('activate()', () => {
    it('should throw when extension not registered', async () => {
      tmpfolder = createFolder()
      let manager = create(tmpfolder)
      let fn = async () => {
        await manager.activate('name')
      }
      await expect(fn()).rejects.toThrow(Error)
      fn = async () => {
        await manager.call('name', 'fn', [])
      }
      await expect(fn()).rejects.toThrow(Error)
    })
  })

  describe('call()', () => {
    it('should activate extension that not activated', async () => {
      tmpfolder = createFolder()
      let code = `exports.activate = () => {return {getId: () => {return 'foo'}}}`
      createExtension(tmpfolder, { name: 'name', engines: { coc: '>=0.0.1' } }, code)
      let manager = create(tmpfolder)
      await manager.loadExtension(tmpfolder)
      let item = manager.getExtension('name')
      expect(item.extension.isActive).toBe(false)
      let res = await manager.call('name', 'getId', [])
      expect(res).toBe('foo')
      let fn = async () => {
        await manager.call('name', 'fn', [])
      }
      await expect(fn()).rejects.toThrow(Error)
    })
  })

  describe('loadExtensionFile()', () => {
    it('should load single file extension', async () => {
      tmpfolder = createFolder()
      let filepath = path.join(tmpfolder, 'abc.js')
      fs.writeFileSync(filepath, `exports.activate = (ctx) => {return {storagePath: ctx.storagePath}}`, 'utf8')
      let manager = create(tmpfolder, true)
      await manager.loadExtensionFile(filepath)
      let item = manager.getExtension('single-abc')
      expect(item.extension.isActive).toBe(true)
      let file = path.join(tmpfolder, 'single-abc-data')
      expect(item.extension.exports['storagePath']).toBe(file)
    })

    it('should not load extension when filepath not exists', async () => {
      tmpfolder = createFolder()
      let manager = create(tmpfolder, true)
      let filepath = path.join(tmpfolder, 'abc.js')
      await manager.loadExtensionFile(filepath)
      let item = manager.getExtension('single-abc')
      expect(item).toBeUndefined()
    })
  })

  describe('uninstallExtensions()', () => {
    it('should show message for extensions not found', async () => {
      let manager = create(tmpfolder)
      await manager.uninstallExtensions(['foo'])
      let line = await helper.getCmdline()
      expect(line).toMatch('not found')
    })
  })

  describe('cleanExtensions()', () => {
    it('should return extension ids that not disabled', async () => {
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
      expect(res).toEqual(['bar'])
    })
  })

  describe('loadedExtension()', () => {
    it('should throw on bad extension', async () => {
      tmpfolder = createFolder()
      createExtension(tmpfolder, { name: 'name', engines: {} })
      let manager = create(tmpfolder)
      let fn = async () => {
        await manager.loadExtension(tmpfolder)
      }
      await expect(fn()).rejects.toThrow(Error)
      fn = async () => {
        await manager.loadExtension([tmpfolder])
      }
      await expect(fn()).rejects.toThrow(Error)
    })

    it('should return false when disabled', async () => {
      tmpfolder = createFolder()
      createExtension(tmpfolder, { name: 'name', engines: { coc: '>=0.0.1' } })
      let manager = create(tmpfolder)
      manager.states.setDisable('name', true)
      let res = await manager.loadExtension(tmpfolder)
      expect(res).toBe(false)
    })

    it('should load local extension', async () => {
      tmpfolder = createFolder()
      createExtension(tmpfolder, { name: 'name', engines: { vscode: '1.0' } })
      let manager = create(tmpfolder)
      await manager.loadExtension(tmpfolder)
      await manager.loadExtension([tmpfolder])
      let item = manager.getExtension('name')
      expect(item.isLocal).toBe(true)
      expect(item.extension.isActive).toBe(false)
      await item.extension.activate()
      expect(item.extension.isActive).toBe(true)
    })

    it('should load and activate global extension', async () => {
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
      expect(res).toBe(true)
      let item = manager.getExtension('name')
      expect(item.isLocal).toBe(false)
      expect(item.extension.extensionPath.endsWith('name')).toBe(true)
      let result = await item.extension.activate()
      expect(result).toBeDefined()
      expect(result).toEqual(item.extension.exports)
      await manager.deactivate('name')
      let stat = manager.getExtensionState('name')
      expect(stat).toBe('loaded')
      let c = workspace.getConfiguration('name')
      expect(c.get('enable')).toBe(false)
      manager.unregistContribution('name')
      c = workspace.getConfiguration('name')
      expect(c.get('enable', undefined)).toBe(undefined)
    })
  })

  describe('unloadExtension()', () => {
    it('should unload extension', async () => {
      let extFolder = createGlobalExtension('name')
      let manager = create(tmpfolder)
      manager.states.addExtension('name', '>=0.0.1')
      await manager.loadExtension(extFolder)
      let res = manager.getExtension('name')
      expect(res).toBeDefined()
      let fn = jest.fn()
      manager.onDidUnloadExtension(() => {
        fn()
      })
      await manager.unloadExtension('name')
      res = manager.getExtension('name')
      expect(res).toBeUndefined()
      await manager.unloadExtension('name')
      expect(fn).toBeCalledTimes(1)
    })
  })

  describe('reloadExtension()', () => {
    it('should throw when extension not registered', async () => {
      tmpfolder = createFolder()
      let manager = create(tmpfolder)
      let fn = async () => {
        await manager.reloadExtension('id')
      }
      await expect(fn()).rejects.toThrow(Error)
    })

    it('should reload single file extension', async () => {
      tmpfolder = createFolder()
      let filepath = path.join(tmpfolder, 'test.js')
      fs.writeFileSync(filepath, `exports.activate = () => {return {file: "${filepath}"}};exports.deactivate = () => {}`, 'utf8')
      let manager = create(tmpfolder)
      await manager.activateExtensions()
      await manager.loadExtensionFile(filepath)
      let item = manager.getExtension('single-test')
      expect(item.extension.isActive).toBe(true)
      await manager.activate('single-test')
      await manager.reloadExtension('single-test')
      item = manager.getExtension('single-test')
      expect(item.extension.isActive).toBe(true)
      await item.deactivate()
      expect(item.extension.isActive).toBe(false)
      process.env.COC_NO_PLUGINS = '1'
      await manager.activateExtensions()
    })

    it('should reload extension from directory', async () => {
      tmpfolder = createFolder()
      let extFolder = path.join(tmpfolder, 'node_modules', 'name')
      createExtension(extFolder, { name: 'name', main: 'entry.js', engines: { coc: '>=0.0.1' } })
      let manager = create(tmpfolder)
      let res = await manager.loadExtension(extFolder)
      expect(res).toBe(true)
      await manager.reloadExtension('name')
      let item = manager.getExtension('name')
      expect(item.extension.isActive).toBe(false)
    })
  })

  describe('registerExtension()', () => {
    it('should not register disabled extension', async () => {
      tmpfolder = createFolder()
      let manager = create(tmpfolder)
      manager.states.setDisable('name', true)
      await manager.registerExtension(tmpfolder, {
        name: 'name',
        engines: { coc: '>=0.0.1' },
      }, ExtensionType.Internal)
      let item = manager.getExtension('name')
      expect(item).toBeUndefined()
    })

    it('should throw error on activate', async () => {
      tmpfolder = createFolder()
      let code = `exports.activate = () => {throw new Error('my error')}`
      createExtension(tmpfolder, { name: 'name', engines: { coc: '>=0.0.1' } }, code)
      let manager = create(tmpfolder)
      await manager.loadExtension(tmpfolder)
      let item = manager.getExtension('name')
      let fn = async () => {
        await item.extension.activate()
      }
      await expect(fn()).rejects.toThrow()
      fn = async () => {
        item.extension.exports
      }
      await expect(fn()).rejects.toThrow()
    })

    it('should catch error on deactivate', async () => {
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

    it('should not throw on register error', async () => {
      let manager = create()
      let spy = jest.spyOn(manager, 'registerExtension').mockImplementation(() => {
        throw new Error('my error')
      })
      manager.registerExtensions([{
        root: __filename,
        isLocal: false,
        packageJSON: {} as any
      }])
      spy.mockRestore()
    })
  })

  describe('toggleExtension()', () => {
    it('should not toggle disabled extension', async () => {
      tmpfolder = createFolder()
      let manager = create(tmpfolder)
      manager.states.setDisable('foo', true)
      await manager.toggleExtension('foo')
    })

    it('should toggle single file extension', async () => {
      tmpfolder = createFolder()
      let filepath = path.join(tmpfolder, 'test.js')
      fs.writeFileSync(filepath, `exports.activate = () => {return {file: "${filepath}"}};exports.deactivate = () => {}`, 'utf8')
      let manager = create(tmpfolder, true)
      await manager.loadExtensionFile(filepath)
      await manager.toggleExtension('single-test')
      let item = manager.getExtension('single-test')
      expect(item).toBeUndefined()
      await manager.toggleExtension('single-test')
    })

    it('should toggle global extension', async () => {
      tmpfolder = createFolder()
      let folder = createGlobalExtension('global')
      let manager = create(tmpfolder, true)
      manager.states.addExtension('global', '>=0.0.1')
      await manager.loadExtension(folder)
      let item = manager.getExtension('global')
      expect(item.extension.isActive).toBe(true)
      await manager.toggleExtension('global')
      item = manager.getExtension('global')
      expect(item).toBeUndefined()
      await manager.toggleExtension('global')
      item = manager.getExtension('global')
      expect(item.extension.isActive).toBe(true)
    })

    it('should toggle local extension', async () => {
      tmpfolder = createFolder()
      let folder = path.join(tmpfolder, 'local')
      createExtension(folder, { name: 'local', main: 'entry.js', engines: { coc: '>=0.0.1' } })
      let manager = create(tmpfolder, true)
      await manager.loadExtension(folder)
      let item = manager.getExtension('local')
      expect(item.extension.isActive).toBe(true)
      expect(item.isLocal).toBe(true)
      await manager.toggleExtension('local')
      item = manager.getExtension('local')
      expect(item).toBeUndefined()
      await manager.toggleExtension('local')
      let state = manager.getExtensionState('local')
      expect(state).toBe('activated')
    })
  })

  describe('watchExtension()', () => {
    it('should throw when watchman not found', async () => {
      tmpfolder = createFolder()
      let extFolder = path.join(tmpfolder, 'node_modules', 'name')
      createExtension(extFolder, { name: 'name', main: 'entry.js', engines: { coc: '>=0.0.1' } })
      let manager = create(tmpfolder)
      let res = await manager.loadExtension(extFolder)
      expect(res).toBe(true)
      let spy = jest.spyOn(workspace, 'getWatchmanPath').mockImplementation(() => {
        return ''
      })
      let fn = async () => {
        await manager.watchExtension('name')
      }
      await expect(fn()).rejects.toThrow(Error)
      spy.mockRestore()
      await expect(async () => {
        await helper.doAction('watchExtension', 'not_exists_extension')
      }).rejects.toThrow(/not found/)
    })

    it('should reload extension on file change', async () => {
      tmpfolder = createFolder()
      let extFolder = path.join(tmpfolder, 'node_modules', 'name')
      createExtension(extFolder, { name: 'name', main: 'entry.js', engines: { coc: '>=0.0.1' } })
      let manager = create(tmpfolder)
      let res = await manager.loadExtension(extFolder)
      expect(res).toBe(true)
      let called = false
      let fn = jest.fn()
      let r = jest.spyOn(workspace, 'getWatchmanPath').mockImplementation(() => {
        return 'watchman'
      })
      let s = jest.spyOn(manager, 'reloadExtension').mockImplementation(() => {
        fn()
        return Promise.resolve()
      })
      let spy = jest.spyOn(Watchman, 'createClient').mockImplementation(() => {
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
      await helper.waitValue(() => {
        return called
      }, true)
      expect(fn).toBeCalled()
      r.mockRestore()
      spy.mockRestore()
      s.mockRestore()
    })

    it('should watch single file extension', async () => {
      let dir = createFolder()
      let id = uuid()
      let filepath = path.join(dir, `${id}.js`)
      fs.writeFileSync(filepath, `exports.activate = () => {return {file: "${filepath}"}};exports.deactivate = () => {}`, 'utf8')
      let manager = create(dir)
      await manager.loadExtensionFile(filepath)
      await manager.watchExtension(`single-${id}`)
      let fn = async () => {
        await manager.watchExtension('single-unknown')
      }
      await expect(fn()).rejects.toThrow(Error)
      let called = false
      let spy = jest.spyOn(manager, 'loadExtensionFile').mockImplementation(() => {
        called = true
        return Promise.resolve('')
      })
      await helper.waitValue(() => {
        return called
      }, true)
      spy.mockRestore()
      fs.unlinkSync(filepath)
    })
  })

  describe('loadFileExtensions', () => {
    it('should load extension files', async () => {
      tmpfolder = createFolder()
      let filepath = path.join(tmpfolder, 'abc.js')
      fs.writeFileSync(filepath, `exports.activate = (ctx) => {return {storagePath: ctx.storagePath}}`, 'utf8')
      let manager = create(tmpfolder, true)
      Object.assign(manager, { singleExtensionsRoot: tmpfolder })
      await manager.loadFileExtensions()
      let item = manager.getExtension('single-abc')
      expect(item.extension.isActive).toBe(true)
    })
  })

  describe('registContribution', () => {
    it('should register definitions', async () => {
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
      manager.registContribution('@explorer', packageJSON, __dirname)
      const extensionRegistry = Registry.as<IExtensionRegistry>(ExtensionsInfo.ExtensionContribution)
      let info = extensionRegistry.getExtension('@explorer')
      let definitions = info.definitions
      expect(definitions['explorer.flexible']).toBeDefined()
      let refs: string[] = []
      deepIterate(definitions, (node, key) => {
        if (key == '$ref' && typeof node[key] === 'string') {
          refs.push(node[key])
        }
      })
      expect(refs).toEqual([
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
      expect(refs).toEqual([
        '#/properties/explorer.toggle',
        '#/definitions/explorer.mapping.keyMappings'
      ])
      let defs = getExtensionDefinitions()
      expect(defs['explorer.flexible']).toBeDefined()
    })
  })

  describe('loadFileOrFolder()', () => {

    it('should throw for invalid extension', async () => {
      tmpfolder = createFolder()
      let manager = create(tmpfolder, false)
      await expect(async () => {
        await manager.load('file_not_exists', false)
      }).rejects.toThrow(Error)
      let id = uuid()
      let filpath = path.join(os.tmpdir(), id)
      fs.writeFileSync(filpath, '', 'utf8')
      await manager.toggleExtension(`single-${id}`)
      await expect(async () => {
        await manager.load(filpath, false)
      }).rejects.toThrow(/disabled/)
      fs.rmSync(filpath, { force: true })
    })

    it('should load extension without active', async () => {
      tmpfolder = createFolder()
      let manager = create(tmpfolder, false)
      createExtension(tmpfolder, {
        name: 'name',
        engines: { coc: '>= 0.0.80' },
        activationEvents: ['*'],
        contributes: {}
      })
      let res = await manager.load(tmpfolder, false)
      expect(res.isActive).toBe(false)
      expect(res.name).toBe('name')
      expect(res.exports).toEqual({})
      await manager.activateExtensions()
      await res.unload()
      fs.rmSync(tmpfolder, { recursive: true })
    })

    it('should load and active extension', async () => {
      tmpfolder = createFolder()
      let manager = create(tmpfolder, false)
      createExtension(tmpfolder, {
        name: 'active',
        engines: { coc: '>= 0.0.80' },
        activationEvents: ['*'],
        contributes: {}
      }, `exports.activate = () => 'api';exports.foo = 'bar';`)
      let res = await manager.load(tmpfolder, true)
      expect(res.isActive).toBe(true)
      expect(res.name).toBe('active')
      expect(res.api).toBe('api')
      expect(res.exports).toEqual({ foo: 'bar' })
      await res.unload()
      fs.rmSync(tmpfolder, { recursive: true })
    })
  })
})
