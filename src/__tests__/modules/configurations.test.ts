import fs from 'fs'
import os from 'os'
import { ParseError } from 'jsonc-parser'
import path from 'path'
import Configurations from '../../configuration'
import { convertErrors, getChangedKeys, getConfigurationValue, getKeys, parseConfiguration } from '../../configuration/util'
import { IConfigurationModel } from '../../types'
import { URI } from 'vscode-uri'
import { v1 as uuidv1 } from 'uuid'
import { CONFIG_FILE_NAME } from '../../util'

const config = fs.readFileSync(path.join(__dirname, './settings.json'), 'utf8')
const workspaceConfigFile = path.resolve(__dirname, `../sample/.vim/${CONFIG_FILE_NAME}`)

function getConfigurationModel(): IConfigurationModel {
  let [, contents] = parseConfiguration(config)
  return { contents }
}

function createConfigurations(): Configurations {
  let userConfigFile = path.join(__dirname, './settings.json')
  return new Configurations(userConfigFile)
}

describe('Configurations', () => {
  it('should convert errors', () => {
    let errors: ParseError[] = []
    for (let i = 0; i < 17; i++) {
      errors.push({
        error: i,
        offset: 0,
        length: 10
      })
    }
    let res = convertErrors('file:///1', 'abc', errors)
    expect(res.length).toBe(17)
  })

  it('should get all keys', () => {
    let res = getKeys({
      foo: {
        bar: 1,
        from: {
          to: 2
        }
      },
      bar: [1, 2]
    })
    expect(res).toEqual(['foo', 'foo.bar', 'foo.from', 'foo.from.to', 'bar'])
  })

  it('should get configuration value', () => {
    let root = {
      foo: {
        bar: 1,
        from: {
          to: 2
        }
      },
      bar: [1, 2]
    }
    let res = getConfigurationValue(root, 'foo.from.to', 1)
    expect(res).toBe(2)
    res = getConfigurationValue(root, 'foo.from', 1)
    expect(res).toEqual({ to: 2 })
  })

  it('should add folder as workspace configuration', () => {
    let configurations = createConfigurations()
    configurations.onDidChange(e => {
      let affects = e.affectsConfiguration('coc')
      expect(affects).toBe(true)
    })
    configurations.addFolderFile(workspaceConfigFile)
    let o = configurations.configuration.workspace.contents
    expect(o.coc.preferences.rootPath).toBe('./src')
    configurations.dispose()
  })

  it('should get changed keys #1', () => {
    let res = getChangedKeys({ y: 2 }, { x: 1 })
    expect(res).toEqual(['x', 'y'])
  })

  it('should get changed keys #2', () => {
    let res = getChangedKeys({ x: 1, c: { d: 4 } }, { x: 1, b: { x: 5 } })
    expect(res).toEqual(['b', 'b.x', 'c', 'c.d'])
  })

  it('should load default configurations', () => {
    let conf = new Configurations()
    expect(conf.defaults.contents.coc).toBeDefined()
    let c = conf.getConfiguration('languageserver')
    expect(c).toEqual({})
    conf.dispose()
  })

  it('should parse configurations', () => {
    let { contents } = getConfigurationModel()
    expect(contents.foo.bar).toBe(1)
    expect(contents.bar.foo).toBe(2)
    expect(contents.schema).toEqual({ 'https://example.com': '*.yaml' })
  })

  it('should update user config #1', () => {
    let conf = new Configurations()
    let fn = jest.fn()
    conf.onDidChange(e => {
      expect(e.affectsConfiguration('x')).toBe(true)
      fn()
    })
    conf.updateUserConfig({ x: 1 })
    let config = conf.configuration.user
    expect(config.contents).toEqual({ x: 1 })
    expect(fn).toBeCalled()
  })

  it('should update user config #2', () => {
    let conf = new Configurations()
    conf.updateUserConfig({ x: 1 })
    conf.updateUserConfig({ x: undefined })
    let config = conf.configuration.user
    expect(config.contents).toEqual({})
  })

  it('should update workspace config', () => {
    let conf = new Configurations()
    conf.updateUserConfig({ foo: { bar: 1 } })
    let curr = conf.getConfiguration('foo')
    curr.update('bar', 2, false)
    curr = conf.getConfiguration('foo')
    let n = curr.get<number>('bar')
    expect(n).toBe(2)
  })

  it('should handle errors', () => {
    let tmpFile = path.join(os.tmpdir(), uuidv1())
    fs.writeFileSync(tmpFile, '{"x":', 'utf8')
    let conf = new Configurations(tmpFile)
    let errors = conf.errorItems
    expect(errors.length > 1).toBe(true)
    conf.dispose()
  })

  it('should change to new folder configuration', () => {
    let conf = new Configurations()
    conf.addFolderFile(workspaceConfigFile)
    let configFile = path.join(__dirname, './settings.json')
    conf.addFolderFile(configFile)
    let file = path.resolve(__dirname, '../sample/tmp.js')
    let fn = jest.fn()
    conf.onDidChange(fn)
    conf.setFolderConfiguration(URI.file(file).toString())
    let { contents } = conf.workspace
    expect(contents.foo).toBeUndefined()
    expect(fn).toBeCalled()
    conf.dispose()
  })

  it('should get nested property', () => {
    let config = createConfigurations()
    let conf = config.getConfiguration('servers.c')
    let res = conf.get<string>('trace.server', '')
    expect(res).toBe('verbose')
    config.dispose()
  })

  it('should get user and workspace configuration', () => {
    let userConfigFile = path.join(__dirname, './settings.json')
    let configurations = new Configurations(userConfigFile)
    let data = configurations.configuration.toData()
    expect(data.user).toBeDefined()
    expect(data.workspace).toBeDefined()
    expect(data.defaults).toBeDefined()
    let value = configurations.configuration.getValue()
    expect(value.foo).toBeDefined()
    expect(value.foo.bar).toBe(1)
    configurations.dispose()
  })

  it('should override with new value', () => {
    let configurations = createConfigurations()
    configurations.configuration.defaults.setValue('foo', 1)
    let { contents } = configurations.defaults
    expect(contents.foo).toBe(1)
    configurations.dispose()
  })

  it('should extends defaults', () => {
    let configurations = createConfigurations()
    configurations.extendsDefaults({ 'a.b': 1 })
    configurations.extendsDefaults({ 'a.b': 2 })
    let o = configurations.defaults.contents
    expect(o.a.b).toBe(2)
    configurations.dispose()
  })

  it('should update configuration', async () => {
    let configurations = createConfigurations()
    configurations.addFolderFile(workspaceConfigFile)
    let fn = jest.fn()
    configurations.onDidChange(e => {
      expect(e.affectsConfiguration('foo')).toBe(true)
      expect(e.affectsConfiguration('foo.bar')).toBe(true)
      expect(e.affectsConfiguration('foo.bar', 'file://tmp/foo.js')).toBe(false)
      fn()
    })
    let config = configurations.getConfiguration('foo')
    let o = config.get<number>('bar')
    expect(o).toBe(1)
    config.update('bar', 6)
    config = configurations.getConfiguration('foo')
    expect(config.get<number>('bar')).toBe(6)
    expect(fn).toBeCalledTimes(1)
    configurations.dispose()
  })

  it('should remove configuration', async () => {
    let configurations = createConfigurations()
    configurations.addFolderFile(workspaceConfigFile)
    let fn = jest.fn()
    configurations.onDidChange(e => {
      expect(e.affectsConfiguration('foo')).toBe(true)
      expect(e.affectsConfiguration('foo.bar')).toBe(true)
      fn()
    })
    let config = configurations.getConfiguration('foo')
    let o = config.get<number>('bar')
    expect(o).toBe(1)
    config.update('bar', null, true)
    config = configurations.getConfiguration('foo')
    expect(config.get<any>('bar')).toBeUndefined()
    expect(fn).toBeCalledTimes(1)
    configurations.dispose()
  })
})

describe('parse configuration', () => {
  it('should only split top level dot keys', () => {
    let o = { 'x.y': 'foo' }
    let [, contents] = parseConfiguration(JSON.stringify(o))
    expect(contents).toEqual({ x: { y: 'foo' } })
    let schema = { 'my.schema': { 'foo.bar': 1 } }
    let [, obj] = parseConfiguration(JSON.stringify(schema))
    expect(obj).toEqual({ my: { schema: { 'foo.bar': 1 } } })
  })
})
