import fs from 'fs'
import os from 'os'
import path from 'path'
import { v4 as uuid } from 'uuid'
import which from 'which'
import commands from '../../commands'
import extensions, { Extensions, toUrl } from '../../extension'
import { writeFile, writeJson } from '../../util/fs'
import workspace from '../../workspace'
import helper from '../helper'

let tmpfolder: string
beforeAll(async () => {
  await helper.setup()
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(() => {
  if (tmpfolder) {
    fs.rmSync(tmpfolder, { force: true, recursive: true })
    tmpfolder = undefined
  }
})

describe('extensions', () => {
  it('should convert url', async () => {
    expect(toUrl('https://github.com/a/b.git#master')).toBe('https://github.com/a/b')
    expect(toUrl('https://github.com/a/b.git#main')).toBe('https://github.com/a/b')
    expect(toUrl('url')).toBe('')
  })

  it('should have events', async () => {
    expect(Extensions).toBeDefined()
    expect(extensions.onDidLoadExtension).toBeDefined()
    expect(extensions.onDidActiveExtension).toBeDefined()
    expect(extensions.onDidUnloadExtension).toBeDefined()
    expect(extensions.schemes).toBeDefined()
    expect(extensions.creteInstaller('npm', 'id')).toBeDefined()
  })

  it('should not throw with addSchemeProperty', async () => {
    extensions.addSchemeProperty('', null)
  })

  it('should toggle auto update', async () => {
    await commands.executeCommand('extensions.toggleAutoUpdate')
    let config = workspace.getConfiguration('coc.preferences').get('extensionUpdateCheck')
    expect(config).toBe('daily')
    await commands.executeCommand('extensions.toggleAutoUpdate')
    config = workspace.getConfiguration('coc.preferences').get('extensionUpdateCheck')
    expect(config).toBe('never')
  })

  it('should get extensions stat', async () => {
    process.env.COC_NO_PLUGINS = '1'
    await extensions.globalExtensions()
    let stats = await extensions.getExtensionStates()
    expect(stats.length).toBe(0)
    process.env.COC_NO_PLUGINS = '0'
  })

  it('should add global extensions', async () => {
    extensions.states.addExtension('foo', '0.0.1')
    extensions.states.addExtension('bar', '0.0.1')
    extensions.modulesFolder = path.join(os.tmpdir(), uuid())
    let folder = path.join(extensions.modulesFolder, 'foo')
    writeJson(path.join(folder, 'package.json'), { name: 'foo', engines: { coc: '>=0.0.1' } })
    fs.writeFileSync(path.join(folder, 'index.js'), '')
    let res = await extensions.globalExtensions()
    expect(res.length).toBe(1)
    fs.rmSync(extensions.modulesFolder, { recursive: true })
    extensions.states.removeExtension('foo')
  })

  it('should has extension', async () => {
    let res = extensions.has('test')
    expect(res).toBe(false)
    expect(extensions.isActivated('unknown')).toBe(false)
    let loaded = await helper.doAction('loadedExtensions')
    expect(loaded).toEqual([])
    let stats = await helper.doAction('extensionStats')
    expect(stats).toBeDefined()
  })

  it('should load global extensions', async () => {
    extensions.states.addExtension('foo', '0.0.1')
    let stats = extensions.globalExtensionStats()
    expect(stats).toEqual([])
    extensions.states.removeExtension('foo')
    process.env.COC_NO_PLUGINS = '1'
    stats = extensions.globalExtensionStats()
    expect(stats).toEqual([])
    process.env.COC_NO_PLUGINS = '0'
  })

  it('should load extension stats from runtimepath', () => {
    let f1 = path.join(os.tmpdir(), uuid())
    fs.mkdirSync(f1)
    writeJson(path.join(f1, 'package.json'), { name: 'name', engines: { coc: '>=0.0.1' } })
    fs.writeFileSync(path.join(f1, 'index.js'), '')
    let f2 = path.join(os.tmpdir(), uuid())
    fs.mkdirSync(f2)
    writeJson(path.join(f2, 'package.json'), { name: 'folder', engines: { coc: '>=0.0.1' } })
    fs.writeFileSync(path.join(f2, 'index.js'), '')
    extensions.states.addExtension('folder', '0.0.1')
    let res = extensions.runtimeExtensionStats(`${f1},${f2}`)
    expect(res.length).toBe(1)
    expect(res[0].id).toBe('name')
    extensions.states.removeExtension('folder')
    fs.rmSync(f1, { recursive: true, force: true })
    fs.rmSync(f2, { recursive: true, force: true })
  })

  it('should force update extensions', async () => {
    let spy = jest.spyOn(extensions, 'installExtensions').mockImplementation(() => {
      return Promise.resolve()
    })
    await commands.executeCommand('extensions.forceUpdateAll')
    spy.mockRestore()
  })

  it('should auto update', async () => {
    let spy = jest.spyOn(extensions.states, 'shouldUpdate').mockImplementation(() => {
      return true
    })
    let s = jest.spyOn(extensions, 'updateExtensions').mockImplementation(() => {
      return Promise.reject(new Error('error on update'))
    })
    await extensions.activateExtensions()
    spy.mockRestore()
    s.mockRestore()
  })

  it('should use absolute path for npm', async () => {
    let res = extensions.npm
    expect(path.isAbsolute(res)).toBe(true)
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

  it('should get all extensions', () => {
    let list = extensions.all
    expect(Array.isArray(list)).toBe(true)
  })

  it('should call extension API', async () => {
    let fn = async () => {
      await extensions.call('test', 'echo', ['5'])
    }
    await expect(fn()).rejects.toThrow(Error)
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
    await helper.doAction('updateExtensions', true)
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
        update: async () => {
          await helper.wait(1)
          return ''
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
        update: async url => {
          await helper.wait(1)
          called = true
          expect(url).toBe('http://example.com')
          return ''
        }
      } as any
    })
    await extensions.updateExtensions()
    expect(called).toBe(true)
    spy.mockRestore()
    s.mockRestore()
  })

  it('should clean unnecessary folders & links', async () => {
    // create folder and link in modulesFolder
    let folder = path.join(extensions.modulesFolder, 'test')
    let link = path.join(extensions.modulesFolder, 'test-link')
    fs.mkdirSync(folder, { recursive: true })
    fs.symlinkSync(folder, link)
    let stats = extensions.states
    stats.addExtension('foo', '1.0.0')
    let extensionFolder = path.join(extensions.modulesFolder, 'foo')
    fs.mkdirSync(extensionFolder, { recursive: true })
    extensions.cleanModulesFolder()
    expect(fs.existsSync(folder)).toBe(false)
    expect(fs.existsSync(link)).toBe(false)
    stats.removeExtension('foo')
    expect(fs.existsSync(extensionFolder)).toBe(true)
    fs.rmSync(extensionFolder, { recursive: true })
  })

  it('should install global extension', async () => {
    expect(extensions.getExtensionById('coc-omni')).toBeUndefined()
    let folder = path.join(extensions.modulesFolder, 'coc-omni')
    let spy = jest.spyOn(extensions, 'creteInstaller').mockImplementation(() => {
      return {
        on: () => {},
        install: async () => {
          fs.mkdirSync(folder, { recursive: true })
          let file = path.join(folder, 'package.json')
          await writeFile(file, JSON.stringify({ name: 'coc-omni', engines: { coc: '>=0.0.1' }, version: '0.0.1' }, null, 2))
          await writeFile(path.join(folder, 'index.js'), 'exports.activate = () => {}')
          return { name: 'coc-omni', version: '1.0.0', folder }
        }
      } as any
    })
    await helper.doAction('installExtensions', 'coc-omni')
    let item = extensions.getExtension('coc-omni')
    expect(item).toBeDefined()
    expect(extensions.getExtensionById('coc-omni')).toBeDefined()
    expect(item.extension.isActive).toBe(true)
    expect(extensions.isActivated('coc-omni')).toBe(true)
    let globals = extensions.globalExtensionStats()
    expect(globals.length).toBe(1)
    expect((await extensions.getExtensionStates()).length).toBeGreaterThan(0)
    spy.mockRestore()
    await helper.doAction('reloadExtension', 'coc-omni')
    await helper.doAction('deactivateExtension', 'coc-omni')
    await helper.doAction('activeExtension', 'coc-omni')
    await helper.doAction('toggleExtension', 'coc-omni')
    await helper.doAction('uninstallExtension', 'coc-omni')
    item = extensions.getExtension('coc-omni')
    expect(item).toBeUndefined()
  })
})
