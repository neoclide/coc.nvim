import { Neovim } from '@chemzqm/neovim'
import fs from 'fs'
import path from 'path'
import events from '../../events'
import extensions, { API, Extension } from '../../extensions'
import helper from '../helper'
import { v1 as uuidv1 } from 'uuid'

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

  it('should filter global extensions', async () => {
    let res = extensions.filterGlobalExtensions(['test', 'foo'])
    expect(res).toEqual(['foo'])
  })

  it('should load local extensions from &rtp', async () => {
    let folder = path.resolve(__dirname, '../extensions/vim/local')
    await nvim.command(`set runtimepath^=${folder}`)
    await helper.wait(300)
    let stat = extensions.getExtensionState('local')
    expect(stat).toBe('activated')
  })

  it('should install/uninstall npm extension', async () => {
    await extensions.installExtensions(['coc-omni'])
    let folder = path.join(__dirname, '../extensions/coc-omni')
    let exists = fs.existsSync(folder)
    expect(exists).toBe(true)
    await helper.wait(200)
    await extensions.uninstallExtension(['coc-omni'])
    exists = fs.existsSync(folder)
    expect(exists).toBe(false)
  })

  it('should install/uninstall extension by url', async () => {
    await extensions.installExtensions(['https://github.com/hollowtree/vscode-vue-snippets'])
    let folder = path.join(__dirname, '../extensions/vue-snippets')
    let exists = fs.existsSync(folder)
    expect(exists).toBe(true)
    await extensions.uninstallExtension(['vue-snippets'])
    exists = fs.existsSync(folder)
    expect(exists).toBe(false)
  })

  it('should install/uninstall extension by url with branch', async () => {
    await extensions.installExtensions(['https://github.com/sdras/vue-vscode-snippets@main'])
    let folder = path.join(__dirname, '../extensions/vue-vscode-snippets')
    let exists = fs.existsSync(folder)
    expect(exists).toBe(true)
    await extensions.uninstallExtension(['vue-vscode-snippets'])
    exists = fs.existsSync(folder)
    expect(exists).toBe(false)
  })

  it('should parse extension info', () => {
    const installer = extensions.installer
    const scoped = installer('@yaegassy/coc-intelephense').info
    expect(scoped.name).toBe('@yaegassy/coc-intelephense')

    const scopedVer = installer('@yaegassy/coc-intelephense@0.2.1').info
    expect(scopedVer.name).toBe('@yaegassy/coc-intelephense')
    expect(scopedVer.version).toBe('0.2.1')
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
    await extensions.toggleExtension('test')
    let stat = extensions.getExtensionState('test')
    expect(stat).toBe('disabled')
    await extensions.toggleExtension('test')
    stat = extensions.getExtensionState('test')
    expect(stat).toBe('activated')
  })

  it('should reload extension', async () => {
    await extensions.reloadExtension('test')
    await helper.wait(100)
    let stat = extensions.getExtensionState('test')
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
    await extensions.deactivate('test')
    let stat = extensions.getExtensionState('test')
    expect(stat).toBe('loaded')
    await extensions.activate('test')
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

  it('should load single file extension', async () => {
    let filepath = path.join(__dirname, '../extensions/root.js')
    await extensions.loadExtensionFile(filepath)
    expect(extensions.has('single-root')).toBe(true)
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
      get: () => isActive
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
    await nvim.command(`edit ${path.join(root, 'file.js')}`)
    await helper.wait(100)
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

  it('should deactivate', async () => {
    let ext = extensions.getExtension('test')
    await ext.deactivate()
    expect(ext.extension.isActive).toBe(false)
    await extensions.activate('test')
  })
})
