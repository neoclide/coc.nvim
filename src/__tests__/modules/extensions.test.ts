import { Neovim } from '@chemzqm/neovim'
import path from 'path'
import events from '../../events'
import extensions, { API } from '../../extensions'
import { Extension } from '../../types'
import helper from '../helper'
import uuidv1 = require('uuid/v1')

let nvim: Neovim
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
})

afterAll(async () => {
  await helper.shutdown()
})

jest.setTimeout(30000)

describe('extensions', () => {

  it('should load global extensions', async () => {
    let stat = extensions.getExtensionState('test')
    expect(stat).toBe('activated')
  })

  it('should load local extensions', async () => {
    let folder = path.resolve(__dirname, '../extensions/local')
    await nvim.command(`set runtimepath^=${folder}`)
    await helper.wait(200)
    let stat = extensions.getExtensionState('local')
    expect(stat).toBe('activated')
  })

  it('should install extension', async () => {
    await extensions.installExtensions(['coc-json', 'https://github.com/neoclide/coc-tsserver'])
    let root = await nvim.call('coc#util#extension_root', [])
    expect(root).toBeDefined()
  })

  it('should udpate extensions', async () => {
    let disposable = await extensions.updateExtensions('', true)
    disposable.dispose()
  })

  it('should get all extensions', () => {
    let list = extensions.all
    expect(list.length).toBeGreaterThan(0)
  })

  it('should commands from extensions', () => {
    let { commands } = extensions
    expect(Object.keys(commands).length).toBeGreaterThan(0)
  })

  it('should get extensions stat', async () => {
    let stats = await extensions.getExtensionStates()
    expect(stats.length).toBeGreaterThan(0)
  })

  it('should toggle extension', async () => {
    await extensions.toggleExtension('test')
    let stat = extensions.getExtensionState('test')
    expect(stat).toBe('disabled')
    await extensions.toggleExtension('test')
    stat = extensions.getExtensionState('test')
    expect(stat).toBe('activated')
  })

  it('should reload extension', async () => {
    await extensions.reloadExtension('test')
    let stat = extensions.getExtensionState('test')
    expect(stat).toBe('activated')
  })

  it('should unload extension', async () => {
    await extensions.uninstallExtension(['test'])
    let stat = extensions.getExtensionState('test')
    expect(stat).toBe('unknown')
    let folder = path.resolve(__dirname, '../extensions/test')
    await extensions.loadExtension(folder)
    await extensions.loadExtension(folder)
  })

  it('should load extension on install', async () => {
    await extensions.onExtensionInstall('coc-json')
    let stat = extensions.getExtensionState('coc-json')
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
    extensions.deactivate('test')
    let stat = extensions.getExtensionState('test')
    expect(stat).toBe('loaded')
    extensions.activate('test')
    stat = extensions.getExtensionState('test')
    expect(stat).toBe('activated')
  })

  it('should call extension API', async () => {
    let res = await extensions.call('test', 'echo', ['5'])
    expect(res).toBe('5')
    let p: string = await extensions.call('test', 'asAbsolutePath', ['..'])
    expect(p.endsWith('extensions')).toBe(true)
  })

  it('should get extension API', () => {
    let res = extensions.getExtensionApi('test') as any
    expect(typeof res.echo).toBe('function')
  })

  it('should get package name from url', () => {
    let name = extensions.packageNameFromUrl('https://github.com/neoclide/coc-tsserver')
    expect(name).toBe('coc-tsserver')
  })
})

describe('extensions active events', () => {

  function createExtension(event: string): Extension<API> {
    let id = uuidv1()
    let isActive = false
    let packageJSON = {
      name: id,
      activationEvents: [event]
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
      get: () => {
        return isActive
      }
    })
    extensions.registerExtension(ext, () => {
      isActive = false
    })
    return ext
  }

  it('should activate on language', async () => {
    let ext = createExtension('onLanguage:javascript')
    expect(ext.isActive).toBe(false)
    await nvim.command('edit /tmp/a.js')
    await helper.wait(300)
    expect(ext.isActive).toBe(true)
    ext = createExtension('onLanguage:javascript')
    expect(ext.isActive).toBe(true)
  })

  it('should activate on command', async () => {
    let ext = createExtension('onCommand:test.echo')
    await events.fire('Command', ['test.echo'])
    await helper.wait(30)
    expect(ext.isActive).toBe(true)
  })

  it('should activate on workspace contains', async () => {
    let ext = createExtension('workspaceContains:package.json')
    let root = path.resolve(__dirname, '../../..')
    await nvim.command(`cd ${root}`)
    await helper.wait(30)
    expect(ext.isActive).toBe(true)
  })

  it('should activate on file system', async () => {
    let ext = createExtension('onFileSystem:zip')
    await nvim.command('edit zip:///a')
    await helper.wait(30)
    expect(ext.isActive).toBe(true)
    ext = createExtension('onFileSystem:zip')
    expect(ext.isActive).toBe(true)
  })
})

describe('extension properties', () => {
  it('should get extensionPath', () => {
    let ext = extensions.getExtension('test')
    let p = ext.extension.extensionPath
    expect(p.endsWith('test')).toBe(true)
  })

  it('should deactivate', () => {
    let ext = extensions.getExtension('test')
    ext.deactivate()
    expect(ext.extension.isActive).toBe(false)
    extensions.activate('test')
  })
})
