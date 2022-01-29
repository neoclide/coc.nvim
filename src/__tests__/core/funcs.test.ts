import os from 'os'
import path from 'path'
import Configurations from '../../configuration/index'
import * as funcs from '../../core/funcs'
let configurations: Configurations

beforeAll(async () => {
  let userConfigFile = path.join(process.env.COC_VIMCONFIG, 'coc-settings.json')
  configurations = new Configurations(userConfigFile, {
    $removeConfigurationOption: () => {},
    $updateConfigurationOption: () => {},
    workspaceConfigFile: ''
  })
})

describe('has()', () => {
  it('should detect version on vim8', async () => {
    let env = {
      isVim: true,
      version: '8023956'
    }
    expect(funcs.has(env, 'patch-7.4.248')).toBe(true)
    expect(funcs.has(env, 'patch-8.5.1')).toBe(false)
  })

  it('should delete version on neovim', async () => {
    let env = {
      isVim: false,
      version: '0.6.1'
    }
    expect(funcs.has(env, 'nvim-0.5.0')).toBe(true)
    expect(funcs.has(env, 'nvim-0.7.0')).toBe(false)
  })
})

describe('createNameSpace()', () => {
  it('should create namespace', async () => {
    let nr = funcs.createNameSpace('ns')
    expect(nr).toBeDefined()
    expect(nr).toBe(funcs.createNameSpace('ns'))
  })
})

describe('getWatchmanPath()', () => {
  it('should get watchman path', async () => {
    let res = funcs.getWatchmanPath(configurations)
    expect(typeof res === 'string' || res == null).toBe(true)
  })
})

describe('findUp()', () => {
  it('should return null when can not find ', async () => {
    let nvim: any = {
      call: () => {
        return __filename
      }
    }
    let res = await funcs.findUp(nvim, os.homedir(), ['file_not_exists'])
    expect(res).toBeNull()
  })
})
