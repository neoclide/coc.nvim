import fs from 'fs'
import os from 'os'
import path from 'path'
import { Disposable } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import Configurations, { folderSettingsSchemaId, userSettingsSchemaId } from '../../configuration'
import { ConfigurationModel } from '../../configuration/model'
import ConfigurationProxy from '../../configuration/shape'
import { FolderConfigutions } from '../../configuration/configuration'
import { ConfigurationTarget, ConfigurationUpdateTarget } from '../../configuration/types'
import { disposeAll, wait } from '../../util'
import { remove } from '../../util/fs'
import helper from '../helper'
import { resourceLanguageSettingsSchemaId } from '../../configuration/registry'
import { CONFIG_FILE_NAME } from '../../util/constants'

const workspaceConfigFile = path.resolve(__dirname, `../sample/.vim/${CONFIG_FILE_NAME}`)

function U(fsPath: string): string {
  return URI.file(fsPath).toString()
}

function createConfigurations(): Configurations {
  let userConfigFile = path.join(__dirname, '../configuration/settings.json')
  return new Configurations(userConfigFile)
}

const disposables: Disposable[] = []

afterEach(() => {
  disposeAll(disposables)
})

function generateTmpDir(): string {
  return path.join(os.tmpdir(), crypto.randomUUID())
}

describe('FolderConfigutions', () => {
  it('should getConfigurationByResource', async () => {
    let c = new FolderConfigutions()
    assert.strictEqual(c.getConfigurationByResource(''), undefined)
    assert.strictEqual(c.getConfigurationByResource('file:///a'), undefined)
    let model = new ConfigurationModel()
    c.set(os.tmpdir(), model)
    let uri = URI.file(path.join(os.tmpdir(), 'a/foo.js')).toString()
    let res = c.getConfigurationByResource(uri)
    assert.strictEqual(res.model, model)
  })
})

describe('Configurations', () => {
  describe('markdownPreference', () => {
    it('should get markdown preferences', async () => {
      let configurations = createConfigurations()
      let preferences = configurations.markdownPreference
      assert.deepStrictEqual(preferences, {
        excludeImages: true,
        breaks: true
      })
    })
  })

  describe('ConfigurationProxy', () => {
    it('should create file and parent folder when necessary', async () => {
      let folder = generateTmpDir()
      let uri = URI.file(path.join(folder, 'a/b/settings.json'))
      let proxy = new ConfigurationProxy({}, false)
      await proxy.modifyConfiguration(uri.fsPath, 'foo', true)
      let content = fs.readFileSync(uri.fsPath, 'utf8')
      assert.deepStrictEqual(JSON.parse(content), { foo: true })
      await proxy.modifyConfiguration(uri.fsPath, 'foo', false)
      content = fs.readFileSync(uri.fsPath, 'utf8')
      assert.deepStrictEqual(JSON.parse(content), { foo: false })
      await remove(folder)
    })

    it('should get folder from resolver', async () => {
      let proxy = new ConfigurationProxy({
        getWorkspaceFolder: (uri: string) => {
          let fsPath = URI.parse(uri).fsPath
          if (fsPath.startsWith(os.tmpdir())) {
            return { uri: URI.file(os.tmpdir()).toString(), name: 'tmp' }
          }
          if (fsPath.startsWith(os.homedir())) {
            return { uri: URI.file(os.homedir()).toString(), name: 'home' }
          }
          return undefined
        },
        root: __dirname
      })
      let uri = proxy.getWorkspaceFolder(URI.file(path.join(os.tmpdir(), 'foo')).toString())
      assert.strictEqual(uri.fsPath.startsWith(os.tmpdir()), true)
      uri = proxy.getWorkspaceFolder(URI.file('abc').toString())
      assert.strictEqual(uri, undefined)
      proxy = new ConfigurationProxy({})
      uri = proxy.getWorkspaceFolder(URI.file(path.join(os.tmpdir(), 'foo')).toString())
      assert.strictEqual(uri, undefined)
    })
  })

  describe('watchFile', () => {
    it('should watch user config file', async () => {
      let userConfigFile = path.join(os.tmpdir(), `settings-${crypto.randomUUID()}.json`)
      fs.writeFileSync(userConfigFile, '{"foo.bar": true}', { encoding: 'utf8' })
      let conf = new Configurations(userConfigFile, undefined, false)
      disposables.push(conf)
      assert.strictEqual(conf.getDefaultResource(), undefined)
      await wait(50)
      // Replace the file by rename like an atomic save: the watcher must
      // survive the inode replacement and keep tracking changes.
      let tmp = `${userConfigFile}.tmp`
      fs.writeFileSync(tmp, '{"foo.bar": false}', { encoding: 'utf8' })
      fs.renameSync(tmp, userConfigFile)
      await helper.waitValue(() => {
        let c = conf.getConfiguration('foo')
        return c.get('bar')
      }, false)
      fs.rmSync(userConfigFile, { recursive: true })
    })

    it('should watch folder config file', async () => {
      let dir = generateTmpDir()
      let configFile = path.join(dir, '.vim/coc-settings.json')
      fs.mkdirSync(path.dirname(configFile), { recursive: true })
      fs.writeFileSync(configFile, '{"foo.bar": true}', { encoding: 'utf8' })
      let conf = new Configurations('', {
        get root() {
          return dir
        },
        modifyConfiguration: async () => {},
        getWorkspaceFolder: () => {
          return URI.file(dir)
        }
      }, false)
      assert.ok((conf.getDefaultResource()).includes('file:'))
      disposables.push(conf)
      let uri = U(dir)
      let resolved = conf.locateFolderConfigution(uri)
      assert.notStrictEqual(resolved, undefined)
      await wait(20)
      fs.writeFileSync(configFile, '{"foo.bar": false}', { encoding: 'utf8' })
      await helper.waitValue(() => {
        let c = conf.getConfiguration('foo')
        return c.get('bar')
      }, false)
    })
  })

  describe('getJSONSchema()', () => {
    it('should getJSONSchema', () => {
      let userConfigFile = path.join(__dirname, '.vim/coc-settings.json')
      let conf = new Configurations(userConfigFile, undefined)
      assert.notStrictEqual(conf.getJSONSchema(userSettingsSchemaId), undefined)
      assert.notStrictEqual(conf.getJSONSchema(folderSettingsSchemaId), undefined)
      assert.notStrictEqual(conf.getJSONSchema(resourceLanguageSettingsSchemaId), undefined)
      assert.strictEqual(conf.getJSONSchema('vscode://not_exists'), undefined)
    })
  })

  describe('getDescription()', () => {
    it('should get description', () => {
      let userConfigFile = path.join(__dirname, '.vim/coc-settings.json')
      let conf = new Configurations(userConfigFile, undefined)
      assert.strictEqual(conf.getDescription('not_exists_key'), undefined)
    })
  })

  describe('addFolderFile()', () => {
    it('should not add invalid folder from cwd', async () => {
      let userConfigFile = path.join(__dirname, '.vim/coc-settings.json')
      let conf = new Configurations(userConfigFile, undefined, true, os.homedir())
      let res = conf.folderToConfigfile(os.homedir())
      assert.strictEqual(res, undefined)
      res = conf.folderToConfigfile(__dirname)
      assert.strictEqual(res, undefined)
    })

    it('should add folder as workspace configuration', () => {
      let configurations = createConfigurations()
      disposables.push(configurations)
      let fired = false
      configurations.onDidChange(() => {
        fired = true
      })
      configurations.addFolderFile(workspaceConfigFile)
      let resource = URI.file(path.resolve(workspaceConfigFile, '../../tmp'))
      let c = configurations.getConfiguration('coc.preferences', resource)
      let res = c.inspect('rootPath')
      assert.strictEqual(res.key, 'coc.preferences.rootPath')
      assert.strictEqual(res.workspaceFolderValue, './src')
      assert.strictEqual(c.get('rootPath'), './src')
      assert.strictEqual(fired, false)
    })

    it('should not add invalid folders', async () => {
      let configurations = createConfigurations()
      assert.strictEqual(configurations.addFolderFile('ab'), false)
    })

    it('should resolve folder configuration when possible', async () => {
      let configurations = createConfigurations()
      assert.strictEqual(configurations.locateFolderConfigution('test:///foo'), false)
      let fsPath = path.join(__dirname, `../sample/abc`)
      assert.strictEqual(configurations.locateFolderConfigution(URI.file(fsPath).toString()), true)
      fsPath = path.join(__dirname, `../sample/foo`)
      assert.strictEqual(configurations.locateFolderConfigution(URI.file(fsPath).toString()), true)
    })
  })

  describe('getConfiguration()', () => {
    it('should load default configurations', () => {
      let conf = new Configurations(undefined, {
        modifyConfiguration: async () => {}
      })
      disposables.push(conf)
      assert.notStrictEqual(conf.configuration.defaults.contents.coc, undefined)
      let c = conf.getConfiguration('languageserver')
      assert.deepStrictEqual(c, {})
      assert.strictEqual(c.has('not_exists'), false)
    })

    it('should load configuration without folder configuration', async () => {
      let conf = new Configurations(undefined, {
        root: path.join(path.dirname(__dirname), 'sample'),
        modifyConfiguration: async () => {}
      })
      disposables.push(conf)
      conf.addFolderFile(workspaceConfigFile)
      let c = conf.getConfiguration('coc.preferences')
      assert.notStrictEqual(c.rootPath, undefined)
      c = conf.getConfiguration('coc.preferences', null)
      assert.strictEqual(c.rootPath, undefined)
    })

    it('should inspect configuration', async () => {
      let conf = new Configurations()
      let c = conf.getConfiguration('suggest')
      let res = c.inspect('not_exists')
      assert.strictEqual(res.defaultValue, undefined)
      assert.strictEqual(res.globalValue, undefined)
      assert.strictEqual(res.workspaceValue, undefined)
      c = conf.getConfiguration()
      res = c.inspect('not_exists')
      assert.strictEqual(res.key, 'not_exists')
    })

    it('should update memory config #1', (t) => {
      let conf = new Configurations()
      let fn = t.mock.fn()
      conf.onDidChange(e => {
        assert.strictEqual(e.affectsConfiguration('x'), true)
        fn()
      })
      conf.updateMemoryConfig({ x: 1 })
      let config = conf.configuration.memory
      assert.deepStrictEqual(config.contents, { x: 1 })
      assert.ok((fn).mock.callCount() > 0)
      assert.notStrictEqual(conf.configuration.workspace, undefined)
    })

    it('should update memory config #2', () => {
      let conf = new Configurations()
      conf.updateMemoryConfig({ x: 1 })
      conf.updateMemoryConfig({ x: undefined })
      let config = conf.configuration.user
      assert.deepStrictEqual(config.contents, {})
    })

    it('should update memory config #3', () => {
      let conf = new Configurations()
      conf.updateMemoryConfig({ 'suggest.floatConfig': { border: true } })
      conf.updateMemoryConfig({ 'x.y': { foo: 1 } })
      let val = conf.getConfiguration()
      let res = val.get('suggest') as any
      assert.deepStrictEqual(res.floatConfig, { border: true })
      res = val.get('x.y') as any
      assert.deepStrictEqual(res, { foo: 1 })
    })

    it('should handle errors', () => {
      let tmpFile = path.join(os.tmpdir(), crypto.randomUUID())
      fs.writeFileSync(tmpFile, '{"x":', 'utf8')
      let conf = new Configurations(tmpFile)
      disposables.push(conf)
      let errors = conf.errors
      assert.ok((errors.size) > (0))
    })

    it('should get nested property', () => {
      let config = createConfigurations()
      disposables.push(config)
      let conf = config.getConfiguration('servers.c')
      let res = conf.get<string>('trace.server', '')
      assert.strictEqual(res, 'verbose')
    })

    it('should get user and workspace configuration', () => {
      let userConfigFile = path.join(__dirname, '../configuration/settings.json')
      let configurations = new Configurations(userConfigFile)
      disposables.push(configurations)
      let data = configurations.configuration.toData()
      assert.notStrictEqual(data.user, undefined)
      assert.notStrictEqual(data.workspace, undefined)
      assert.notStrictEqual(data.defaults, undefined)
      let value = configurations.configuration.getValue(undefined, {})
      assert.notStrictEqual(value.foo, undefined)
      assert.strictEqual(value.foo.bar, 1)
    })

    it('should update configuration', async (t) => {
      let configurations = createConfigurations()
      disposables.push(configurations)
      configurations.addFolderFile(workspaceConfigFile)
      let resource = URI.file(path.resolve(workspaceConfigFile, '../..'))
      let fn = t.mock.fn()
      configurations.onDidChange(e => {
        assert.strictEqual(e.affectsConfiguration('foo'), true)
        assert.strictEqual(e.affectsConfiguration('foo.bar'), true)
        assert.strictEqual(e.affectsConfiguration('foo.bar', 'file://tmp/foo.js'), false)
        fn()
      })
      let config = configurations.getConfiguration('foo', resource)
      let o = config.get<number>('bar')
      assert.strictEqual(o, 1)
      await config.update('bar', 6)
      config = configurations.getConfiguration('foo', resource)
      assert.strictEqual(config.get<number>('bar'), 6)
      assert.strictEqual((fn).mock.callCount(), 1)
    })

    it('should remove configuration', async (t) => {
      let configurations = createConfigurations()
      disposables.push(configurations)
      configurations.addFolderFile(workspaceConfigFile)
      let resource = URI.file(path.resolve(workspaceConfigFile, '../..'))
      let fn = t.mock.fn()
      configurations.onDidChange(e => {
        assert.strictEqual(e.affectsConfiguration('foo'), true)
        assert.strictEqual(e.affectsConfiguration('foo.bar'), true)
        fn()
      })
      let config = configurations.getConfiguration('foo', resource)
      let o = config.get<number>('bar')
      assert.strictEqual(o, 1)
      await config.update('bar', null, true)
      config = configurations.getConfiguration('foo', resource)
      assert.strictEqual(config.get<any>('bar'), undefined)
      assert.strictEqual((fn).mock.callCount(), 1)
    })
  })

  describe('changeConfiguration', () => {
    it('should change workspace configuration', async () => {
      let con = createConfigurations()
      let m = new ConfigurationModel({ x: { a: 1 } }, ['x.a'])
      con.changeConfiguration(ConfigurationTarget.Workspace, m, undefined)
      let res = con.getConfiguration('x')
      assert.strictEqual(res.a, 1)
    })

    it('should change default configuration', async () => {
      let m = new ConfigurationModel({ x: { a: 1 } }, ['x.a'])
      let con = createConfigurations()
      con.changeConfiguration(ConfigurationTarget.Default, m, undefined)
      let res = con.getConfiguration('x')
      assert.strictEqual(res.a, 1)
    })
  })

  describe('update()', () => {
    it('should update workspace configuration', async () => {
      let target = ConfigurationUpdateTarget.Workspace
      let con = createConfigurations()
      let res = con.getConfiguration()
      await res.update('x', 3, target)
      let val = con.getConfiguration().get('x')
      assert.strictEqual(val, 3)
    })

    it('should show error when workspace folder not resolved', async (t) => {
      let called = false
      let s = t.mock.method(console, 'error', () => {
        called = true
      })
      let con = new Configurations(undefined, {
        modifyConfiguration: async () => {},
        getWorkspaceFolder: () => {
          return undefined
        }
      })
      let conf = con.getConfiguration(undefined, 'file:///1')
      await conf.update('x', 3, ConfigurationUpdateTarget.WorkspaceFolder)
      s.mock.restore()
      assert.strictEqual(called, true)
    })
  })

  describe('getWorkspaceConfigUri()', () => {
    it('should not get config uri for undefined resource', async () => {
      let conf = createConfigurations()
      let res = conf.resolveWorkspaceFolderForResource()
      assert.strictEqual(res, undefined)
    })

    it('should not get config folder same as home', async () => {
      let conf = new Configurations(undefined, {
        modifyConfiguration: async () => {},
        getWorkspaceFolder: () => {
          return URI.file(os.homedir())
        }
      })
      let uri = U(__filename)
      let res = conf.resolveWorkspaceFolderForResource(uri)
      assert.strictEqual(res, undefined)
    })

    it('should create config file for workspace folder', async () => {
      let folder = path.join(os.tmpdir(), `test-workspace-folder-${crypto.randomUUID()}`)
      let conf = new Configurations(undefined, {
        modifyConfiguration: async () => {},
        getWorkspaceFolder: () => {
          return URI.file(folder)
        }
      })
      let res = conf.resolveWorkspaceFolderForResource('file:///1')
      assert.strictEqual(res, folder)
      let configFile = path.join(folder, '.vim/coc-settings.json')
      assert.strictEqual(fs.existsSync(configFile), true)
      res = conf.resolveWorkspaceFolderForResource('file:///1')
      assert.strictEqual(res, folder)
    })
  })
})
