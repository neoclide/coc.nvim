import { Neovim } from '@chemzqm/neovim'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { v4 as uuid } from 'uuid'
import { Disposable, WorkspaceFolder } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import { ExtensionJson, ExtensionStat } from '../../extension/extensionStat'
import { checkCommand, checkFileSystem, checkLanguageId, getActivationEvents, checkWorkspaceContains, ExtensionManager, getEvents, ExtensionType } from '../../extension/manager'
import { disposeAll } from '../../util'
import Watchman from '../../core/watchman'
import helper from '../helper'
import workspace from '../../workspace'

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

  it('should checkWorkspaceContains', async () => {
    const toFolder = (folder: string): WorkspaceFolder => {
      return { uri: URI.file(folder).toString(), name: path.basename(folder) }
    }
    tmpfolder = createFolder()
    let res = await checkWorkspaceContains([toFolder(tmpfolder)], ['workspaceContains:', 'workspaceContains:abc'])
    expect(res).toBe(false)
    fs.rmSync(tmpfolder, { force: true, recursive: true })
    let folders = [toFolder(tmpfolder)]
    tmpfolder = createFolder()
    folders.push(toFolder(tmpfolder))
    let file = path.join(tmpfolder, '.xyz')
    fs.writeFileSync(file, '', 'utf8')
    res = await checkWorkspaceContains(folders, ['workspaceContains:def', 'workspaceContains:.xyz'])
    expect(res).toBe(true)
  })
})

describe('ExtensionManager', () => {
  function create(folder = createFolder()): ExtensionManager {
    let stats = new ExtensionStat(folder)
    return new ExtensionManager(stats, tmpfolder)
  }

  function createExtension(folder: string, packageJSON: ExtensionJson, code?: string): void {
    fs.mkdirSync(folder, { recursive: true })
    code = code ?? `exports.activate = () => {return {folder: "${folder}"}}`
    let jsonfile = path.join(folder, 'package.json')
    fs.writeFileSync(jsonfile, JSON.stringify(packageJSON), 'utf8')
    let file = packageJSON.main ?? 'index.js'
    fs.writeFileSync(path.join(folder, file), code, 'utf8')
  }

  describe('activateExtensions()', () => {
    it('should not throw no error', async () => {
      tmpfolder = createFolder()
      createExtension(tmpfolder, {
        name: 'name',
        engines: { coc: '>= 0.0.80' },
        activationEvents: ['onLanguage:vim'],
        contributes: {}
      })
      let manager = create(tmpfolder)
      await manager.loadExtension(tmpfolder)
      manager.tryActivateExtensions('onLanguage', () => {
        return Promise.reject(new Error('test error'))
      })
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
      createExtension(tmpfolder, {
        name: 'name',
        engines: { coc: '>= 0.0.80' },
        activationEvents: ['workspaceContains:extensionManager.test.ts']
      })
      let manager = create(tmpfolder)
      await manager.activateExtensions()
      await manager.loadExtension(tmpfolder)
      let item = manager.getExtension('name')
      expect(item.extension.isActive).toBe(true)
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

  describe('getExtensionsInfo()', () => {
    it('should getExtensionsInfo', async () => {
      tmpfolder = createFolder()
      let filepath = path.join(tmpfolder, 'test.js')
      fs.writeFileSync(filepath, `exports.activate = () => {return {file: "${filepath}"}}`, 'utf8')
      let manager = create(tmpfolder)
      await manager.loadExtensionFile(filepath)
      let arr = manager.getExtensionsInfo()
      expect(arr[0].directory.endsWith(path.sep)).toBe(true)
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
    })

    it('should load and activate global extension', async () => {
      tmpfolder = createFolder()
      let extFolder = path.join(tmpfolder, 'node_modules', 'name')
      createExtension(extFolder, { name: 'name', main: 'entry.js', engines: { coc: '>=0.0.1' } })
      let manager = create(tmpfolder)
      let res = await manager.loadExtension(extFolder)
      await manager.activateExtensions()
      expect(res).toBe(true)
      let item = manager.getExtension('name')
      expect(item.isLocal).toBe(false)
      let result = await item.extension.activate()
      expect(result).toBeDefined()
      expect(result).toEqual(item.extension.exports)
      await manager.deactivate('name')
      manager.dispose()
    })
  })

  describe('unloadExtension()', () => {
    it('should unload extension', async () => {
      tmpfolder = createFolder()
      let extFolder = path.join(tmpfolder, 'node_modules', 'name')
      createExtension(extFolder, { name: 'name', main: 'entry.js', engines: { coc: '>=0.0.1' } })
      let manager = create(tmpfolder)
      await manager.loadExtension(extFolder)
      let res = manager.getExtension('name')
      expect(res).toBeDefined()
      await manager.unloadExtension('name')
      res = manager.getExtension('name')
      expect(res).toBeUndefined()
      await manager.unloadExtension('name')
      manager.dispose()
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
      await manager.loadFileExtensions(tmpfolder)
      let item = manager.getExtension('single-test')
      expect(item.extension.isActive).toBe(true)
      await manager.activate('single-test')
      await manager.reloadExtension('single-test')
      item = manager.getExtension('single-test')
      expect(item.extension.isActive).toBe(true)
      await item.deactivate()
      expect(item.extension.isActive).toBe(false)
      manager.dispose()
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
      manager.dispose()
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
        id: 'id',
        version: '0.0.1',
        root: __filename,
        exotic: false,
        state: 'unknown',
        isLocal: false,
        isLocked: false,
        packageJSON: {} as any
      }])
      spy.mockRestore()
    })
  })

  describe('toggleExtension()', () => {
    it('should toggle extension', async () => {
      tmpfolder = createFolder()
      let filepath = path.join(tmpfolder, 'test.js')
      fs.writeFileSync(filepath, `exports.activate = () => {return {file: "${filepath}"}};exports.deactivate = () => {}`, 'utf8')
      let manager = create(tmpfolder)
      await manager.loadFileExtensions(tmpfolder)
      await manager.toggleExtension('single-test')
      let item = manager.getExtension('single-test')
      expect(item).toBeUndefined()
      await manager.toggleExtension('single-test')
    })
  })

  describe('watchExtension()', () => {
    it('should watch single file extension', async () => {
      let dir = createFolder()
      let id = uuid()
      let filepath = path.join(dir, `${id}.js`)
      fs.writeFileSync(filepath, `exports.activate = () => {return {file: "${filepath}"}};exports.deactivate = () => {}`, 'utf8')
      let manager = create(dir)
      await manager.loadFileExtensions(dir)
      await manager.watchExtension(`single-${id}`)
      let fn = async () => {
        await manager.watchExtension('single-unknown')
      }
      await expect(fn()).rejects.toThrow(Error)
      let called = false
      let spy = jest.spyOn(manager, 'loadExtensionFile').mockImplementation(() => {
        called = true
        return Promise.resolve()
      })
      await helper.waitValue(() => {
        return called
      }, true)
      spy.mockRestore()
      fs.unlinkSync(filepath)
      manager.dispose()
    })
  })

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
    let s = jest.spyOn(manager, 'reloadExtension').mockImplementation(() => {
      fn()
      return Promise.resolve()
    })
    let spy = jest.spyOn(Watchman, 'createClient').mockImplementation(() => {
      return {
        dispose: () => {},
        subscribe: (key: string, cb: Function) => {
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
    spy.mockRestore()
    s.mockRestore()
  })
})
