import { Neovim } from '@chemzqm/neovim'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { v1 as uuidv1 } from 'uuid'
import events from '../../events'
import extensions, { Extensions, toUrl } from '../../extension'
import commandManager from '../../commands'
import { API, Extension } from '../../extension/manager'
import which from 'which'
import { v4 as uuid } from 'uuid'
import helper from '../helper'
import { writeJson } from '../../extension/extensionStat'

let nvim: Neovim
let tmpfolder: string
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(() => {
  if (tmpfolder && fs.existsSync(tmpfolder)) {
    fs.rmSync(tmpfolder, { force: true, recursive: true })
    tmpfolder = undefined
  }
})
describe('extensions', () => {
  it('should convert url', async () => {
    expect(toUrl('https://github.com/a/b.git#master')).toBe('https://github.com/a/b')
    expect(toUrl('https://github.com/a/b.git#main')).toBe('https://github.com/a/b')
  })

  it('should have events', async () => {
    expect(Extensions).toBeDefined()
    expect(extensions.onDidLoadExtension).toBeDefined()
    expect(extensions.onDidActiveExtension).toBeDefined()
    expect(extensions.onDidUnloadExtension).toBeDefined()
    expect(extensions.schemes).toBeDefined()
    expect(extensions.creteInstaller('npm', 'id')).toBeDefined()
  })

  it('should load global extensions', async () => {
    tmpfolder = path.join(os.tmpdir(), uuid())
    fs.mkdirSync(tmpfolder)
    writeJson(path.join(tmpfolder, 'package.json'), {})
    let extensions = new Extensions()
    Object.assign(extensions, { modulesFolder: tmpfolder })
    let stats = extensions.globalExtensionStats()
    expect(stats).toEqual([])
  })

  it('should load extension stats from runtimepath', async () => {
    let f1 = path.join(os.tmpdir(), uuid())
    fs.mkdirSync(f1)
    writeJson(path.join(f1, 'package.json'), { name: 'name', engines: { coc: '>=0.0.1' } })
    fs.writeFileSync(path.join(f1, 'index.js'), '')
    let f2 = path.join(os.tmpdir(), uuid())
    fs.mkdirSync(f2)
    writeJson(path.join(f2, 'package.json'), { name: 'folder', engines: { coc: '>=0.0.1' } })
    fs.writeFileSync(path.join(f2, 'index.js'), '')
    let res = extensions.runtimeExtensionStats(['folder'], `${f1},${f2}`)
    expect(res.length).toBe(1)
    expect(res[0].id).toBe('name')
  })

  it('should force update extensions', async () => {
    let spy = jest.spyOn(extensions, 'installExtensions').mockImplementation(() => {
      return Promise.resolve()
    })
    await commandManager.executeCommand('extensions.forceUpdateAll')
    spy.mockRestore()
  })

  it('should auto update', async () => {
    let spy = jest.spyOn(extensions.states, 'shouldUpdate').mockImplementation(() => {
      return true
    })
    let s = jest.spyOn(extensions, 'updateExtensions').mockImplementation(() => {
      return Promise.reject(new Error('error on update'))
    })
    extensions.activateExtensions()
    spy.mockRestore()
    s.mockRestore()
  })

  it('should check isActivated', async () => {
    expect(extensions.isActivated('unknown')).toBe(false)
    expect(extensions.isActivated('test')).toBe(true)
  })

  it('should not throw when npm not found', async () => {
    let spy = jest.spyOn(which, 'sync').mockImplementation(() => {
      throw new Error('not executable')
    })
    let res = extensions.npm
    expect(res).toBeNull()
    await extensions.updateExtensions()
    spy.mockRestore()
  })

  it('should catch error when installExtensions', async () => {
    let spy = jest.spyOn(extensions, 'creteInstaller').mockImplementation(() => {
      return {
        on: (_key, cb) => {
          cb('msg', false)
        },
        install: () => {
          return Promise.resolve({ name: 'name', url: 'http://e', version: '1.0.0' })
        }
      } as any
    })
    let s = jest.spyOn(extensions.states, 'setLocked').mockImplementation(() => {
      throw new Error('my error')
    })
    await extensions.installExtensions(['abc@1.0.0'])
    spy.mockRestore()
    s.mockRestore()
  })

  it('should update enabled extensions', async () => {
    let spy = jest.spyOn(extensions, 'globalExtensionStats').mockImplementation(() => {
      return [{ id: 'test' }, { id: 'global', isLocked: true }, { id: 'disabled', state: 'disabled' }] as any
    })
    let s = jest.spyOn(extensions, 'creteInstaller').mockImplementation(() => {
      return {
        on: (_key, cb) => {
          cb('msg', false)
        },
        update: () => {
          return Promise.resolve('')
        }
      } as any
    })
    await extensions.updateExtensions()
    spy.mockRestore()
    s.mockRestore()
  })

  it('should update extensions by url', async () => {
    let spy = jest.spyOn(extensions, 'globalExtensionStats').mockImplementation(() => {
      return [{ id: 'test', exotic: true, uri: 'http://example.com' }] as any
    })
    let called = false
    let s = jest.spyOn(extensions, 'creteInstaller').mockImplementation(() => {
      return {
        on: (_key, cb) => {
          cb('msg', false)
        },
        update: url => {
          called = true
          expect(url).toBe('http://example.com')
          return Promise.resolve('')
        }
      } as any
    })
    await extensions.updateExtensions()
    expect(called).toBe(true)
    spy.mockRestore()
    s.mockRestore()
  })

  it('should catch error on updateExtensions', async () => {
    let spy = jest.spyOn(extensions, 'globalExtensionStats').mockImplementation(() => {
      return [{ id: 'test' }] as any
    })
    let s = jest.spyOn(extensions, 'creteInstaller').mockImplementation(() => {
      return {
        on: () => {},
        update: () => {
          return Promise.resolve(path.join(os.tmpdir(), uuid()))
        }
      } as any
    })
    await extensions.updateExtensions(true)
    spy.mockRestore()
    s.mockRestore()
  })

  it('should load global extensions', async () => {
    let stat = extensions.getExtensionState('test')
    expect(stat).toBe('activated')
  })

  it('should load local extensions from &rtp', async () => {
    let folder = path.resolve(__dirname, '../extensions/vim/local')
    await nvim.command(`set runtimepath^=${folder}`)
    await helper.wait(200)
    let stat = extensions.getExtensionState('local')
    expect(stat).toBe('activated')
  })

  it('should not throw when uninstall extension not exists', async () => {
    await extensions.manager.uninstallExtensions(['coc-not_exists'])
    let line = await helper.getCmdline()
    expect(line).toMatch('not found')
  })

  it('should install/uninstall npm extension', async () => {
    let folder = path.join(os.tmpdir(), uuid())
    let spy = jest.spyOn(extensions, 'creteInstaller').mockImplementation(() => {
      return {
        on: () => {},
        install: () => {
          let file = path.join(folder, 'package.json')
          writeJson(file, { name: 'coc-omni', engines: { coc: '>=0.0.1' }, version: '0.0.1' })
          fs.writeFileSync(path.join(folder, 'index.js'), 'exports.activate = () => {}')
          return Promise.resolve({ name: 'coc-omni', version: '1.0.0', folder })
        }
      } as any
    })
    await extensions.installExtensions(['coc-omni'])
    let item = extensions.getExtension('coc-omni')
    expect(item).toBeDefined()
    expect(item.extension.isActive).toBe(true)
    spy.mockRestore()
    await extensions.manager.uninstallExtensions(['coc-omni'])
    item = extensions.getExtension('coc-omni')
    expect(item).toBeUndefined()
  })

  it('should get all extensions', () => {
    let list = extensions.all
    expect(Array.isArray(list)).toBe(true)
  })

  it('should get extensions stat', async () => {
    let stats = await extensions.getExtensionStates()
    expect(stats.length).toBeGreaterThan(0)
  })

  it('should toggle extension', async () => {
    await extensions.manager.toggleExtension('test')
    let stat = extensions.getExtensionState('test')
    expect(stat).toBe('disabled')
    await extensions.manager.toggleExtension('test')
    stat = extensions.getExtensionState('test')
    expect(stat).toBe('activated')
  })

  it('should has extension', () => {
    let res = extensions.has('test')
    expect(res).toBe(true)
  })

  it('should be activated', async () => {
    let res = extensions.has('test')
    expect(res).toBe(true)
  })

  it('should activate & deactivate extension', async () => {
    await extensions.manager.deactivate('test')
    let stat = extensions.getExtensionState('test')
    expect(stat).toBe('loaded')
    await extensions.manager.activate('test')
    stat = extensions.getExtensionState('test')
    expect(stat).toBe('activated')
  })

  it('should call extension API', async () => {
    let res = await extensions.call('test', 'echo', ['5'])
    expect(res).toBe('5')
    let p: string = await extensions.call('test', 'asAbsolutePath', ['..'])
    expect(p.endsWith('extensions')).toBe(true)
  })

  it('should load single file extension', async () => {
    let filepath = path.join(__dirname, '../extensions/root.js')
    await extensions.manager.loadExtensionFile(filepath)
    expect(extensions.has('single-root')).toBe(true)
  })
})

describe('extensions active events', () => {

  async function createExtension(...events: string[]): Promise<Extension<API>> {
    let id = uuidv1()
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
    await extensions.manager.registerInternalExtension(ext, () => {
      isActive = false
    })
    return ext
  }

  it('should activate on language', async () => {
    let ext = await createExtension('workspaceContains:foobar', 'onLanguage:javascript')
    expect(ext.isActive).toBe(false)
    await nvim.command('edit /tmp/a.js')
    await nvim.command('setf javascript')
    await helper.wait(50)
    expect(ext.isActive).toBe(true)
    ext = await createExtension('onLanguage:javascript')
    expect(ext.isActive).toBe(true)
  })

  it('should activate on command', async () => {
    let ext = await createExtension('onCommand:test.echo')
    await events.fire('Command', ['test.bac'])
    await events.fire('Command', ['test.echo'])
    await helper.wait(30)
    expect(ext.isActive).toBe(true)
  })

  it('should activate on workspace contains', async () => {
    let ext = await createExtension('workspaceContains:package.json')
    await createExtension('workspaceContains:file_not_exists')
    let root = path.resolve(__dirname, '../../..')
    await nvim.command(`edit ${path.join(root, 'file.js')}`)
    await helper.wait(50)
    expect(ext.isActive).toBe(true)
  })

  it('should activate on file system', async () => {
    let ext = await createExtension('onFileSystem:zip')
    await nvim.command('edit zip:///a')
    await helper.wait(30)
    expect(ext.isActive).toBe(true)
    ext = await createExtension('onFileSystem:zip')
    expect(ext.isActive).toBe(true)
  })
})

describe('extension properties', () => {
  it('should get extensionPath', () => {
    let ext = extensions.getExtension('test')
    let p = ext.extension.extensionPath
    expect(p.endsWith('test')).toBe(true)
  })

  it('should deactivate', async () => {
    let ext = extensions.getExtension('test')
    await ext.deactivate()
    expect(ext.extension.isActive).toBe(false)
    await extensions.manager.activate('test')
  })
})
