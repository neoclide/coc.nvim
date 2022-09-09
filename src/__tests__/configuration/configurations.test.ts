import fs from 'fs'
import os from 'os'
import path from 'path'
import { v1 as uuid } from 'uuid'
import { Disposable } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import Configurations from '../../configuration'
import { ConfigurationModel } from '../../configuration/model'
import ConfigurationProxy from '../../configuration/shape'
import { ConfigurationTarget, ConfigurationUpdateTarget } from '../../types'
import { CONFIG_FILE_NAME, disposeAll, wait } from '../../util'
import helper, { rmdir } from '../helper'

const workspaceConfigFile = path.resolve(__dirname, `../sample/.vim/${CONFIG_FILE_NAME}`)

function U(fsPath: string): string {
  return URI.file(fsPath).toString()
}

function createConfigurations(): Configurations {
  let userConfigFile = path.join(__dirname, './settings.json')
  return new Configurations(userConfigFile)
}

const disposables: Disposable[] = []

afterEach(() => {
  disposeAll(disposables)
})

function generateTmpDir(): string {
  return path.join(os.tmpdir(), uuid())
}

describe('Configurations', () => {
  describe('ConfigurationProxy', () => {
    it('should create file and parent folder when necessary', async () => {
      let folder = generateTmpDir()
      let uri = URI.file(path.join(folder, 'a/b/settings.json'))
      let proxy = new ConfigurationProxy({}, false)
      await proxy.modifyConfiguration(uri.fsPath, 'foo', true)
      let content = fs.readFileSync(uri.fsPath, 'utf8')
      expect(JSON.parse(content)).toEqual({ foo: true })
      await proxy.modifyConfiguration(uri.fsPath, 'foo', false)
      content = fs.readFileSync(uri.fsPath, 'utf8')
      expect(JSON.parse(content)).toEqual({ foo: false })
      rmdir(folder)
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
      expect(uri.fsPath.startsWith(os.tmpdir())).toBe(true)
      uri = proxy.getWorkspaceFolder(URI.file('abc').toString())
      expect(uri).toBeUndefined()
      proxy = new ConfigurationProxy({})
      uri = proxy.getWorkspaceFolder(URI.file(path.join(os.tmpdir(), 'foo')).toString())
      expect(uri).toBeUndefined()
    })
  })

  describe('watchFile', () => {
    it('should watch user config file', async () => {
      let userConfigFile = path.join(os.tmpdir(), 'settings.json')
      fs.writeFileSync(userConfigFile, '{"foo.bar": true}', { encoding: 'utf8' })
      let conf = new Configurations(userConfigFile, undefined, false)
      disposables.push(conf)
      await wait(20)
      fs.writeFileSync(userConfigFile, '{"foo.bar": false}', { encoding: 'utf8' })
      await helper.waitValue(() => {
        let c = conf.getConfiguration('foo')
        return c.get('bar')
      }, false)
      fs.unlinkSync(userConfigFile)
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
      disposables.push(conf)
      let uri = U(dir)
      let resolved = conf.locateFolderConfigution(uri)
      expect(resolved).toBeDefined()
      await wait(20)
      fs.writeFileSync(configFile, '{"foo.bar": false}', { encoding: 'utf8' })
      await helper.waitValue(() => {
        let c = conf.getConfiguration('foo')
        return c.get('bar')
      }, false)
    })
  })

  describe('loadDefaultConfigurations', () => {
    it('should not throw', async () => {
      let fn = fs.readFileSync
      let spy = jest.spyOn(fs, 'readFileSync').mockImplementation((path, opt) => {
        if (typeof path === 'string' && path.endsWith('/data/schema.json')) {
          return '{"properties":{"x":{"default":1},"x.y":{"default":{}}}}'
        }
        return fn(path, opt)
      })
      let called = false
      let s = jest.spyOn(console, 'error').mockImplementation(() => {
        called = true
      })
      new Configurations(undefined, undefined, true, os.homedir())
      s.mockRestore()
      spy.mockRestore()
      expect(called).toBe(true)
    })
  })

  describe('addFolderFile()', () => {
    it('should not add invalid folder from cwd', async () => {
      let userConfigFile = path.join(__dirname, '.vim/coc-settings.json')
      let conf = new Configurations(userConfigFile, undefined, true, os.homedir())
      let res = conf.folderToConfigfile(os.homedir())
      expect(res).toBeUndefined()
      res = conf.folderToConfigfile(__dirname)
      expect(res).toBeUndefined()
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
      expect(res.key).toBe('coc.preferences.rootPath')
      expect(res.workspaceFolderValue).toBe('./src')
      expect(c.get('rootPath')).toBe('./src')
    })

    it('should not add invalid folders', async () => {
      let configurations = createConfigurations()
      expect(configurations.addFolderFile('ab')).toBe(false)
    })

    it('should resolve folder configuration when possible', async () => {
      let configurations = createConfigurations()
      expect(configurations.locateFolderConfigution('test:///foo')).toBe(false)
      let fsPath = path.join(__dirname, `../sample/abc`)
      expect(configurations.locateFolderConfigution(URI.file(fsPath).toString())).toBe(true)
      fsPath = path.join(__dirname, `../sample/foo`)
      expect(configurations.locateFolderConfigution(URI.file(fsPath).toString())).toBe(true)
    })
  })

  describe('getConfiguration()', () => {
    it('should load default configurations', () => {
      let conf = new Configurations(undefined, {
        modifyConfiguration: async () => {}
      })
      disposables.push(conf)
      expect(conf.configuration.defaults.contents.coc).toBeDefined()
      let c = conf.getConfiguration('languageserver')
      expect(c).toEqual({})
      expect(c.has('not_exists')).toBe(false)
    })

    it('should load configuration without folder configuration', async () => {
      let conf = new Configurations(undefined, {
        root: path.join(path.dirname(__dirname), 'sample'),
        modifyConfiguration: async () => {}
      })
      disposables.push(conf)
      conf.addFolderFile(workspaceConfigFile)
      let c = conf.getConfiguration('coc.preferences')
      expect(c.rootPath).toBeDefined()
      c = conf.getConfiguration('coc.preferences', null)
      expect(c.rootPath).toBeUndefined()
    })

    it('should inspect configuration', async () => {
      let conf = new Configurations()
      let c = conf.getConfiguration('suggest')
      let res = c.inspect('not_exists')
      expect(res.defaultValue).toBeUndefined()
      expect(res.globalValue).toBeUndefined()
      expect(res.workspaceValue).toBeUndefined()
      c = conf.getConfiguration()
      res = c.inspect('not_exists')
      expect(res.key).toBe('not_exists')
    })

    it('should update memory config #1', () => {
      let conf = new Configurations()
      let fn = jest.fn()
      conf.onDidChange(e => {
        expect(e.affectsConfiguration('x')).toBe(true)
        fn()
      })
      conf.updateMemoryConfig({ x: 1 })
      let config = conf.configuration.memory
      expect(config.contents).toEqual({ x: 1 })
      expect(fn).toBeCalled()
      expect(conf.configuration.workspace).toBeDefined()
    })

    it('should update memory config #2', () => {
      let conf = new Configurations()
      conf.updateMemoryConfig({ x: 1 })
      conf.updateMemoryConfig({ x: undefined })
      let config = conf.configuration.user
      expect(config.contents).toEqual({})
    })

    it('should update memory config #3', () => {
      let conf = new Configurations()
      conf.updateMemoryConfig({ 'suggest.floatConfig': { border: true } })
      conf.updateMemoryConfig({ 'x.y': { foo: 1 } })
      let val = conf.getConfiguration()
      let res = val.get('suggest') as any
      expect(res.floatConfig).toEqual({ border: true })
      res = val.get('x.y') as any
      expect(res).toEqual({ foo: 1 })
    })

    it('should handle errors', () => {
      let tmpFile = path.join(os.tmpdir(), uuid())
      fs.writeFileSync(tmpFile, '{"x":', 'utf8')
      let conf = new Configurations(tmpFile)
      disposables.push(conf)
      let errors = conf.errorItems
      expect(errors.length > 1).toBe(true)
    })

    it('should get nested property', () => {
      let config = createConfigurations()
      disposables.push(config)
      let conf = config.getConfiguration('servers.c')
      let res = conf.get<string>('trace.server', '')
      expect(res).toBe('verbose')
    })

    it('should get user and workspace configuration', () => {
      let userConfigFile = path.join(__dirname, './settings.json')
      let configurations = new Configurations(userConfigFile)
      disposables.push(configurations)
      let data = configurations.configuration.toData()
      expect(data.user).toBeDefined()
      expect(data.workspace).toBeDefined()
      expect(data.defaults).toBeDefined()
      let value = configurations.configuration.getValue(undefined, {})
      expect(value.foo).toBeDefined()
      expect(value.foo.bar).toBe(1)
    })

    it('should extends defaults', () => {
      let configurations = createConfigurations()
      disposables.push(configurations)
      configurations.extendsDefaults({ 'a.b': 1 })
      configurations.extendsDefaults({ 'a.b': 2 })
      let o = configurations.configuration.defaults.contents
      expect(o.a.b).toBe(2)
      configurations.configuration.defaults.freeze()
      configurations.extendsDefaults({ 'a.b': 3 })
      o = configurations.configuration.defaults.contents
      expect(o.a.b).toBe(3)
    })

    it('should not extends builtin keys', async () => {
      let configurations = new Configurations(undefined, {
        modifyConfiguration: async () => {}
      })
      disposables.push(configurations)
      configurations.extendsDefaults({ 'npm.binPath': 'cnpm' }, 'test')
      let o = configurations.configuration.defaults.contents
      expect(o.npm.binPath).toBe('npm')
    })

    it('should update configuration', async () => {
      let configurations = createConfigurations()
      disposables.push(configurations)
      configurations.addFolderFile(workspaceConfigFile)
      let resource = URI.file(path.resolve(workspaceConfigFile, '../..'))
      let fn = jest.fn()
      configurations.onDidChange(e => {
        expect(e.affectsConfiguration('foo')).toBe(true)
        expect(e.affectsConfiguration('foo.bar')).toBe(true)
        expect(e.affectsConfiguration('foo.bar', 'file://tmp/foo.js')).toBe(false)
        fn()
      })
      let config = configurations.getConfiguration('foo', resource)
      let o = config.get<number>('bar')
      expect(o).toBe(1)
      await config.update('bar', 6)
      config = configurations.getConfiguration('foo', resource)
      expect(config.get<number>('bar')).toBe(6)
      expect(fn).toBeCalledTimes(1)
    })

    it('should remove configuration', async () => {
      let configurations = createConfigurations()
      disposables.push(configurations)
      configurations.addFolderFile(workspaceConfigFile)
      let resource = URI.file(path.resolve(workspaceConfigFile, '../..'))
      let fn = jest.fn()
      configurations.onDidChange(e => {
        expect(e.affectsConfiguration('foo')).toBe(true)
        expect(e.affectsConfiguration('foo.bar')).toBe(true)
        fn()
      })
      let config = configurations.getConfiguration('foo', resource)
      let o = config.get<number>('bar')
      expect(o).toBe(1)
      await config.update('bar', null, true)
      config = configurations.getConfiguration('foo', resource)
      expect(config.get<any>('bar')).toBeUndefined()
      expect(fn).toBeCalledTimes(1)
    })
  })

  describe('changeConfiguration', () => {
    it('should change workspace configuration', async () => {
      let con = createConfigurations()
      let m = new ConfigurationModel({ x: { a: 1 } }, ['x.a'])
      con.changeConfiguration(ConfigurationTarget.Workspace, m, undefined)
      let res = con.getConfiguration('x')
      expect(res.a).toBe(1)
    })

    it('should change default configuration', async () => {
      let m = new ConfigurationModel({ x: { a: 1 } }, ['x.a'])
      let con = createConfigurations()
      con.changeConfiguration(ConfigurationTarget.Default, m, undefined)
      let res = con.getConfiguration('x')
      expect(res.a).toBe(1)
    })
  })

  describe('update()', () => {
    it('should update workspace configuration', async () => {
      let target = ConfigurationUpdateTarget.Workspace
      let con = createConfigurations()
      let res = con.getConfiguration()
      await res.update('x', 3, target)
      let val = con.getConfiguration().get('x')
      expect(val).toBe(3)
    })

    it('should show error when workspace folder not resovled', async () => {
      let called = false
      let s = jest.spyOn(console, 'error').mockImplementation(() => {
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
      s.mockRestore()
      expect(called).toBe(true)
    })
  })

  describe('getWorkspaceConfigUri()', () => {
    it('should not get config uri for undefined resource', async () => {
      let conf = createConfigurations()
      let res = conf.resolveWorkspaceFolderForResource()
      expect(res).toBeUndefined()
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
      expect(res).toBeUndefined()
    })

    it('should create config file for workspace folder', async () => {
      let folder = path.join(os.tmpdir(), `test-workspace-folder-${uuid()}`)
      let conf = new Configurations(undefined, {
        modifyConfiguration: async () => {},
        getWorkspaceFolder: () => {
          return URI.file(folder)
        }
      })
      let res = conf.resolveWorkspaceFolderForResource('file:///1')
      expect(res).toBe(folder)
      let configFile = path.join(folder, '.vim/coc-settings.json')
      expect(fs.existsSync(configFile)).toBe(true)
      res = conf.resolveWorkspaceFolderForResource('file:///1')
      expect(res).toBe(folder)
    })
  })
})
