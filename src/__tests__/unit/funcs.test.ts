import fs from 'fs'
import os from 'os'
import path from 'path'
import cp from 'child_process'
import which from 'which'
import Configurations from '../../configuration/index'
import * as funcs from '../../core/funcs'
import Resolver from '../../model/resolver'
import * as processes from '../../util/processes'
let configurations: Configurations

before(async () => {
  let userConfigFile = path.join(process.env.COC_VIMCONFIG, 'coc-settings.json')
  configurations = new Configurations(userConfigFile, undefined)
})

describe('Resolver()', () => {
  it('should return empty string when file not exists', async t => {
    t.mock.method(fs, 'existsSync', () => {
      return false
    })
    // Avoid spawning the yarnpkg child process, the folder check below is
    // what this test exercises. runCommand is an esbuild-generated
    // non-configurable export, so stub child_process.exec instead.
    t.mock.method(cp, 'exec', ((_cmd: string, _opts: any, cb: any) => {
      cb(null, Buffer.from('/nonexistent'), Buffer.alloc(0))
    }) as any)
    let r = new Resolver()
    let res = await r.yarnFolder
    assert.strictEqual(res, '')
  })

  it('should resolve null', async t => {
    let r = new Resolver()
    t.mock.method(which, 'sync', () => {
      throw new Error('not found')
    })
    let res = await r.resolveModule('mode')
    assert.strictEqual(res, null)
  })

  it('should resolve npm module', async () => {
    let r = new Resolver()
    let folder = path.join(os.tmpdir(), crypto.randomUUID())
    Object.assign(r, {
      _npmFolder: folder,
      _yarnFolder: import.meta.dirname,
    })
    fs.mkdirSync(path.join(folder, 'name'), { recursive: true })
    fs.writeFileSync(path.join(folder, 'name', 'package.json'), '', 'utf8')
    let res = await r.resolveModule('name')
    assert.strictEqual(res, path.join(folder, 'name'))
  })
})

describe('has()', () => {
  it('should throw for invalid argument', async () => {
    let env = {
      isVim: true,
      version: '8023956'
    }
    let err
    try {
      assert.strictEqual(funcs.has(env, '0.5.0'), true)
    } catch (e) {
      err = e
    }
    assert.notStrictEqual(err, undefined)
  })

  it('should detect version on vim8', async () => {
    let env = {
      isVim: true,
      version: '8023956'
    }
    assert.strictEqual(funcs.has(env, 'patch-7.4.248'), true)
    assert.strictEqual(funcs.has(env, 'patch-8.5.1'), false)
    assert.strictEqual(funcs.has(env, 'patch-9.0.0125'), false)
  })

  it('should delete version on neovim', async () => {
    let env = {
      isVim: false,
      version: '0.6.1'
    }
    assert.strictEqual(funcs.has(env, 'nvim-0.5.0'), true)
    assert.strictEqual(funcs.has(env, 'nvim-0.7.0'), false)
  })
})

describe('createNameSpace()', () => {
  it('should create namespace', async () => {
    let nr = funcs.createNameSpace('ns')
    assert.notStrictEqual(nr, undefined)
    assert.strictEqual(nr, funcs.createNameSpace('ns'))
  })
})

describe('getWatchmanPath()', () => {
  it('should get watchman path', async () => {
    let res = funcs.getWatchmanPath(configurations)
    assert.strictEqual(typeof res === 'string' || res == null, true)
    configurations.updateMemoryConfig({ 'coc.preferences.watchmanPath': 'not_exists_watchman' })
    res = funcs.getWatchmanPath(configurations)
    assert.strictEqual(res, null)
    configurations.updateMemoryConfig({ 'coc.preferences.watchmanPath': null })
  })
})

describe('findUp()', () => {
  it('should return null when can not find', async () => {
    let nvim: any = {
      call: () => {
        return import.meta.filename
      }
    }
    let res = await funcs.findUp(nvim, os.homedir(), ['file_not_exists'])
    assert.strictEqual(res, null)
  })

  it('should return null when unable find cwd in cwd', async () => {
    let nvim: any = {
      call: () => {
        return ''
      }
    }
    let res = await funcs.findUp(nvim, os.homedir(), ['file_not_exists'])
    assert.strictEqual(res, null)
  })
})

describe('score()', () => {
  it('should return score', () => {
    assert.strictEqual(funcs.score(undefined, 'untitled:///1', ''), 0)
    assert.strictEqual(funcs.score({ scheme: '*' }, 'untitled:///1', ''), 3)
    assert.strictEqual(funcs.score('vim', 'untitled:///1', 'vim'), 10)
    assert.strictEqual(funcs.score('*', 'untitled:///1', ''), 5)
    assert.strictEqual(funcs.score('', 'untitled:///1', 'vim'), 0)
    assert.strictEqual(funcs.score({ pattern: '/*' }, 'untitled:///1', 'vim', false), 5)
    assert.strictEqual(funcs.score({ pattern: { pattern: '/*', baseUri: '/tmp' } }, 'untitled:///1', 'vim', false), 0)
    assert.strictEqual(funcs.score({ pattern: { pattern: '/**', baseUri: '/tmp' } }, 'file:///tmp/a/b', 'vim'), 5)
    assert.strictEqual(funcs.score({ pattern: { pattern: '/**', baseUri: '/tmp' } }, 'file:///foo', 'vim'), 0)
  })
})
