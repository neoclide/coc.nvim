import * as shared from '../sharedUtil'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { URI } from 'vscode-uri'
import which from 'which'
import commands from '../../commands'
import { ConfigurationUpdateTarget } from '../../configuration/types'
import extensions, { Extensions, toUrl } from '../../extension'
import { Disposable, disposeAll } from '../../util'
import { writeFile, writeJson } from '../../util/fs'
import window from '../../window'
import workspace from '../../workspace'

let tmpfolder: string
let disposables: Disposable[] = []

afterEach(() => {
  if (tmpfolder) {
    fs.rmSync(tmpfolder, { force: true, recursive: true })
    tmpfolder = undefined
  }
  disposeAll(disposables)
})

describe('extensions', () => {
  it('should convert url', async t => {
    assert.strictEqual(toUrl('https://github.com/a/b.git#master'), 'https://github.com/a/b')
    assert.strictEqual(toUrl('https://github.com/a/b.git#main'), 'https://github.com/a/b')
    assert.strictEqual(toUrl('url'), '')
  })

  it('should have events', async t => {
    assert.notStrictEqual(Extensions, undefined)
    assert.notStrictEqual(extensions.onDidLoadExtension, undefined)
    assert.notStrictEqual(extensions.onDidActiveExtension, undefined)
    assert.notStrictEqual(extensions.onDidUnloadExtension, undefined)
    assert.notStrictEqual(extensions.schemes, undefined)
    assert.notStrictEqual(extensions.createInstaller('npm', 'id'), undefined)
  })

  it('should not throw with addSchemeProperty', async t => {
    extensions.addSchemeProperty('', null)
  })

  it('should get update settings', async t => {
    let settings = extensions.getUpdateSettings()
    assert.strictEqual(settings.updateCheck, 'never')
    assert.strictEqual(settings.updateUIInTab, false)
    assert.strictEqual(settings.silentAutoupdate, true)
    let config = workspace.getConfiguration('extensions')
    await config.update('updateCheck', 'weekly', ConfigurationUpdateTarget.Global)
    await config.update('updateUIInTab', true, ConfigurationUpdateTarget.Global)
    await config.update('silentAutoupdate', false, ConfigurationUpdateTarget.Global)
    settings = extensions.getUpdateSettings()
    assert.strictEqual(settings.updateCheck, 'weekly')
    assert.strictEqual(settings.updateUIInTab, true)
    assert.strictEqual(settings.silentAutoupdate, false)
    await config.update('updateCheck', undefined, ConfigurationUpdateTarget.Global)
    await config.update('updateUIInTab', undefined, ConfigurationUpdateTarget.Global)
    await config.update('silentAutoupdate', undefined, ConfigurationUpdateTarget.Global)
  })

  it('should toggle auto update', async t => {
    await commands.executeCommand('extensions.toggleAutoUpdate')
    let config = workspace.getConfiguration('extensions')
    assert.strictEqual(config.get('updateCheck'), 'daily')
    await commands.executeCommand('extensions.toggleAutoUpdate')
    config = workspace.getConfiguration('extensions')
    assert.strictEqual(config.get('updateCheck'), 'never')
    await config.update('extensions.updateCheck', undefined, ConfigurationUpdateTarget.Global)
  })

  it('should get extensions stat', async t => {
    process.env.COC_NO_PLUGINS = '1'
    await extensions.globalExtensions()
    let stats = await extensions.getExtensionStates()
    assert.strictEqual(stats.length, 0)
    process.env.COC_NO_PLUGINS = '0'
  })

  it('should add global extensions', async t => {
    extensions.states.addExtension('foo', '0.0.1')
    extensions.states.addExtension('bar', '0.0.1')
    extensions.modulesFolder = path.join(os.tmpdir(), crypto.randomUUID())
    let folder = path.join(extensions.modulesFolder, 'foo')
    writeJson(path.join(folder, 'package.json'), { name: 'foo', engines: { coc: '>=0.0.1' } })
    fs.writeFileSync(path.join(folder, 'index.js'), '')
    let res = await extensions.globalExtensions()
    assert.strictEqual(res.length, 1)
    fs.rmSync(extensions.modulesFolder, { recursive: true })
    extensions.states.removeExtension('foo')
  })

  it('should has extension', async t => {
    let res = extensions.has('test')
    assert.strictEqual(res, false)
    assert.strictEqual(extensions.isActivated('unknown'), false)
    let loaded = await shared.doAction('loadedExtensions')
    assert.deepStrictEqual(loaded, [])
    let stats = await shared.doAction('extensionStats')
    assert.notStrictEqual(stats, undefined)
  })

  it('should load global extensions', async t => {
    extensions.states.addExtension('foo', '0.0.1')
    let stats = extensions.globalExtensionStats()
    assert.deepStrictEqual(stats, [])
    extensions.states.removeExtension('foo')
    process.env.COC_NO_PLUGINS = '1'
    stats = extensions.globalExtensionStats()
    assert.deepStrictEqual(stats, [])
    process.env.COC_NO_PLUGINS = '0'
  })

  it('should load extension stats from runtimepath', t => {
    let f1 = path.join(os.tmpdir(), crypto.randomUUID())
    fs.mkdirSync(f1)
    writeJson(path.join(f1, 'package.json'), { name: 'name', engines: { coc: '>=0.0.1' } })
    fs.writeFileSync(path.join(f1, 'index.js'), '')
    let f2 = path.join(os.tmpdir(), crypto.randomUUID())
    fs.mkdirSync(f2)
    writeJson(path.join(f2, 'package.json'), { name: 'folder', engines: { coc: '>=0.0.1' } })
    fs.writeFileSync(path.join(f2, 'index.js'), '')
    extensions.states.addExtension('folder', '0.0.1')
    let res = extensions.runtimeExtensionStats([f1, f2])
    assert.strictEqual(res.length, 1)
    assert.strictEqual(res[0].id, 'name')
    extensions.states.removeExtension('folder')
    fs.rmSync(f1, { recursive: true, force: true })
    fs.rmSync(f2, { recursive: true, force: true })
  })

  it('should force update extensions', async t => {
    t.mock.method(extensions, 'installExtensions', () => {
      return Promise.resolve()
    })
    await commands.executeCommand('extensions.forceUpdateAll')
  })

  it('should auto update', async t => {
    t.mock.method(extensions.states, 'shouldUpdate', () => {
      return true
    })
    t.mock.method(extensions, 'updateExtensions', () => {
      return Promise.reject(new Error('error on update'))
    })
    await extensions.activateExtensions()
  })

  it('should use absolute path for npm', async t => {
    let res = extensions.npm
    assert.strictEqual(path.isAbsolute(res), true)
  })

  it('should not throw when npm not found', async t => {
    t.mock.method(which, 'sync', () => {
      throw new Error('not executable')
    })
    let res = extensions.npm
    assert.strictEqual(res, null)
    await extensions.updateExtensions()
  })

  it('should get all extensions', t => {
    let list = extensions.all
    assert.strictEqual(Array.isArray(list), true)
  })

  it('should call extension API', async t => {
    let fn = async () => {
      await extensions.call('test', 'echo', ['5'])
    }
    await assert.rejects(fn(), Error)
  })

  it('should catch error when installExtensions', async t => {
    t.mock.method(extensions, 'createInstaller', () => {
      return {
        on: (_key, cb) => {
          cb('msg', false)
        },
        install: () => {
          return Promise.resolve({ name: 'name', url: 'http://e', version: '1.0.0' })
        }
      } as any
    })
    t.mock.method(extensions.states, 'setLocked', () => {
      throw new Error('my error')
    })
    await extensions.installExtensions(['abc@1.0.0'])
  })

  it('should catch error on updateExtensions', async t => {
    t.mock.method(extensions, 'globalExtensionStats', () => {
      return [{ id: 'test' }] as any
    })
    t.mock.method(extensions, 'createInstaller', () => {
      return {
        on: () => {},
        update: () => {
          return Promise.resolve(path.join(os.tmpdir(), crypto.randomUUID()))
        }
      } as any
    })
    await shared.doAction('updateExtensions', true)
  })

  it('should update enabled extensions', async t => {
    t.mock.method(extensions, 'globalExtensionStats', () => {
      return [{ id: 'test' }, { id: 'global', isLocked: true }, { id: 'disabled', state: 'disabled' }] as any
    })
    t.mock.method(extensions, 'createInstaller', () => {
      return {
        on: (_key, cb) => {
          cb('msg', false)
        },
        update: async () => {
          await shared.wait(20)
          return ''
        }
      } as any
    })
    await extensions.updateExtensions(true, true)
  })

  it('should update extensions by url', async t => {
    t.mock.method(extensions, 'globalExtensionStats', () => {
      return [{ id: 'test', exotic: true, uri: 'http://example.com' }] as any
    })
    let called = false
    t.mock.method(extensions, 'createInstaller', () => {
      return {
        on: (_key, cb) => {
          cb('msg', false)
        },
        update: async url => {
          await shared.wait(20)
          called = true
          assert.strictEqual(url, 'http://example.com')
          return ''
        }
      } as any
    })
    await extensions.updateExtensions()
    assert.strictEqual(called, true)
  })

  it('should clean unnecessary folders & links', async t => {
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
    assert.strictEqual(fs.existsSync(folder), false)
    assert.strictEqual(fs.existsSync(link), false)
    stats.removeExtension('foo')
    assert.strictEqual(fs.existsSync(extensionFolder), true)
    fs.rmSync(extensionFolder, { recursive: true })
  })

  it('should install global extension', async t => {
    assert.strictEqual(extensions.getExtensionById('coc-omni'), undefined)
    let folder = path.join(extensions.modulesFolder, 'coc-omni')
    t.mock.method(extensions, 'createInstaller', () => {
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
    await shared.doAction('installExtensions', 'coc-omni')
    let item = extensions.getExtension('coc-omni')
    assert.notStrictEqual(item, undefined)
    assert.notStrictEqual(extensions.getExtensionById('coc-omni'), undefined)
    assert.strictEqual(item.extension.isActive, true)
    assert.strictEqual(extensions.isActivated('coc-omni'), true)
    let globals = extensions.globalExtensionStats()
    assert.strictEqual(globals.length, 1)
    assert.ok((await extensions.getExtensionStates()).length > 0)
    await shared.doAction('reloadExtension', 'coc-omni')
    await shared.doAction('deactivateExtension', 'coc-omni')
    await shared.doAction('activeExtension', 'coc-omni')
    await shared.doAction('toggleExtension', 'coc-omni')
    await shared.doAction('uninstallExtension', 'coc-omni')
    item = extensions.getExtension('coc-omni')
    assert.strictEqual(item, undefined)
  })

  it('should checkRecommendation', async t => {
    await extensions.checkRecommendation({ name: 'tmp', uri: URI.file(import.meta.dirname).toString() })
    tmpfolder = path.join(os.tmpdir(), crypto.randomUUID())
    let folder = path.join(tmpfolder, '.vim')
    fs.mkdirSync(folder, { recursive: true })

    // fs.mkdirSync(path.join(tmpfolder, '.git'), { recursive: true })
    let jsonFile = path.join(folder, 'coc-settings.json')
    fs.writeFileSync(jsonFile, `{"extensions.recommendations": ["coc-abc", "coc-def"]}`)
    let returnValue
    let calledTimes = 0
    t.mock.method(window, 'showInformationMessage', () => {
      calledTimes++
      return Promise.resolve(returnValue)
    })
    disposables.push({
      dispose: () => {
      }
    })
    await shared.edit(jsonFile)
    workspace.workspaceFolderControl.addWorkspaceFolder(tmpfolder, true)
    await shared.waitValue(() => calledTimes, 1)
    let called = false
    t.mock.method(extensions, 'installExtensions', () => {
      called = true
      return Promise.resolve(undefined)
    })
    disposables.push({
      dispose: () => {
      }
    })
    returnValue = { index: 1 }
    let uri = URI.file(tmpfolder).toString()
    await extensions.checkRecommendation({ name: 'tmp', uri })
    assert.strictEqual(called, true)
    returnValue = { index: 2 }
    await extensions.checkRecommendation({ name: 'tmp', uri })
    assert.strictEqual(extensions.states.shouldPrompt(uri), false)
    let curr = calledTimes
    await extensions.checkRecommendation({ name: 'tmp', uri })
    assert.strictEqual(calledTimes, curr)
    extensions.states.reset()
  })
})
