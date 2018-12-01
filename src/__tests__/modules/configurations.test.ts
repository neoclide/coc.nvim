import Configurations, { convertErrors } from '../../model/configurations'
import { IConfigurationData, IConfigurationModel } from '../../types'
import { ParseError } from 'jsonc-parser'

const config = JSON.stringify({
  'foo.bar': 1,
  'bar.foo': 2,
  schema: {
    'https://example.com': '*.yaml'
  },
  servers: {
    c: {
      'trace.server': 'verbose'
    }
  }
})

function getConfigurationModel(): IConfigurationModel {
  let [, contents] = Configurations.parseConfiguration(config)
  return { contents }
}

function createConfigurations(): Configurations {
  let data: IConfigurationData = {
    defaults: getConfigurationModel(),
    user: { contents: {} },
    workspace: { contents: {} }
  }
  return new Configurations(data)
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

  it('should parse configurations', () => {
    let { contents } = getConfigurationModel()
    expect(contents.foo.bar).toBe(1)
    expect(contents.bar.foo).toBe(2)
    expect(contents.schema).toEqual({ 'https://example.com': '*.yaml' })
  })

  it('should update default configurations', () => {
    let config = createConfigurations()
    config.updateDefaults('x.y', 1)
    let res = config.getConfiguration('x')
    let n = res.get<number>('y', 0)
    expect(n).toBe(1)
    config.updateDefaults('x.y', void 0)
    n = config.getConfiguration('x').get('y', 5)
    expect(n).toBe(5)
  })

  it('should get nested property', () => {
    let configurations = createConfigurations()
    let config = configurations.getConfiguration('servers.c')
    let res = config.get<string>('trace.server', '')
    expect(res).toBe('verbose')
  })

  it('should get user and workspace configuration', () => {
    let user = Configurations.parseConfiguration('{"user": 1}')[1]
    let workspace = Configurations.parseConfiguration('{"workspace": 1}')[1]
    let data: IConfigurationData = {
      defaults: getConfigurationModel(),
      user: { contents: user },
      workspace: { contents: workspace }
    }
    let configurations = new Configurations(data)
    expect(configurations.user.contents).toEqual({ user: 1 })
    expect(configurations.workspace.contents).toEqual({ workspace: 1 })
    data = configurations.toData()
    expect(data.user).toBeDefined()
    expect(data.workspace).toBeDefined()
    expect(data.defaults).toBeDefined()
  })

  it('should override with new value', () => {
    let configurations = createConfigurations()
    configurations.updateDefaults('foo', 1)
    let { contents } = configurations.defaults
    expect(contents.foo).toBe(1)
  })

  it('should not override', () => {
    let configurations = createConfigurations()
    configurations.updateDefaults('foo.bar.bar', 3)
    let { contents } = configurations.defaults
    expect(contents.foo).toEqual({ bar: 1 })
  })
})
