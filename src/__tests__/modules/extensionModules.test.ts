process.env.COC_NO_PLUGINS = '1'
import { Neovim } from '@chemzqm/neovim'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { v4 as uuid } from 'uuid'
import { Disposable } from 'vscode-languageserver-protocol'
import events from '../../events'
import { checkExtensionRoot, ExtensionStat, getExtensionName, getJsFiles, loadExtensionJson, loadGlobalJsonAsync, toInterval, validExtensionFolder } from '../../extension/stat'
import { InstallBuffer, InstallChannel } from '../../extension/ui'
import { disposeAll } from '../../util'
import { loadJson, writeJson } from '../../util/fs'
import window from '../../window'
import helper from '../helper'

let disposables: Disposable[] = []
let nvim: Neovim
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
})

afterEach(() => {
  disposeAll(disposables)
})

afterAll(async () => {
  await helper.shutdown()
})

function createFolder(): string {
  let folder = path.join(os.tmpdir(), uuid())
  fs.mkdirSync(folder, { recursive: true })
  disposables.push(Disposable.create(() => {
    fs.rmSync(folder, { recursive: true, force: true })
  }))
  return folder
}

describe('utils', () => {
  describe('getJsFiles', () => {
    it('should get js files', async () => {
      let res = await getJsFiles(__dirname)
      expect(Array.isArray(res)).toBe(true)
    })
  })

  describe('loadGlobalJsonAsync()', () => {
    it('should throw when engines not valid', async () => {
      let folder = createFolder()
      let file = path.join(folder, 'package.json')
      fs.writeFileSync(file, '{}', 'utf8')
      await expect(async () => {
        await loadGlobalJsonAsync(folder, '0.0.80')
      }).rejects.toThrow(/Invalid engines/)
      fs.writeFileSync(file, '{"engines": {}}', 'utf8')
      await expect(async () => {
        await loadGlobalJsonAsync(folder, '0.0.80')
      }).rejects.toThrow(/Invalid engines/)
    })

    it('should throw when version not match', async () => {
      let folder = createFolder()
      let file = path.join(folder, 'package.json')
      fs.writeFileSync(file, '{"engines": {"coc": ">=0.0.80"}}', 'utf8')
      await expect(async () => {
        await loadGlobalJsonAsync(folder, '0.0.79')
      }).rejects.toThrow(/not match/)
    })

    it('should throw when main file not found', async () => {
      let folder = createFolder()
      let file = path.join(folder, 'package.json')
      fs.writeFileSync(file, '{"engines": {"coc": ">=0.0.80"}}', 'utf8')
      await expect(async () => {
        await loadGlobalJsonAsync(folder, '0.0.80')
      }).rejects.toThrow(/not found/)
    })

    it('should load json', async () => {
      let folder = createFolder()
      let file = path.join(folder, 'package.json')
      fs.writeFileSync(file, '{"name": "foo","engines": {"coc": ">=0.0.80"}}', 'utf8')
      fs.writeFileSync(path.join(folder, 'index.js'), '', 'utf8')
      let res = await loadGlobalJsonAsync(folder, '0.0.80')
      expect(res.name).toBe('foo')
    })
  })

  describe('validExtensionFolder()', () => {
    it('should check validExtensionFolder', async () => {
      expect(validExtensionFolder(__dirname, '')).toBe(false)
      let folder = path.join(os.tmpdir(), uuid())
      fs.mkdirSync(folder)
      disposables.push(Disposable.create(() => {
        fs.rmSync(folder, { recursive: true, force: true })
      }))
      writeJson(path.join(folder, 'index.js'), '')
      let filepath = path.join(folder, 'package.json')
      writeJson(filepath, { name: 'name', engines: { coc: '>=0.0.81' } })
      expect(validExtensionFolder(folder, '0.0.82')).toBe(true)
    })
  })

  describe('checkExtensionRoot', () => {

    it('should not throw on error', async () => {
      let spy = jest.spyOn(fs, 'existsSync').mockImplementation(() => {
        throw new Error('my error')
      })
      let called = false
      let s = jest.spyOn(console, 'error').mockImplementation(() => {
        called = true
      })
      let root = path.join(os.tmpdir(), 'foo-bar')
      let res = checkExtensionRoot(root)
      s.mockRestore()
      spy.mockRestore()
      expect(res).toBe(false)
    })

    it('should create root when it does not exist', async () => {
      let root = path.join(os.tmpdir(), 'foo-bar')
      let res = checkExtensionRoot(root)
      expect(res).toBe(true)
      expect(fs.existsSync(path.join(root, 'package.json'))).toBe(true)
      let method = typeof fs['rmSync'] === 'function' ? 'rmSync' : 'rmdirSync'
      fs[method](root, { recursive: true })
    })

    it('should remove unexpted file', async () => {
      let root = path.join(os.tmpdir(), uuid())
      fs.writeFileSync(root, '')
      let res = checkExtensionRoot(root)
      expect(res).toBe(true)
      expect(fs.existsSync(path.join(root, 'package.json'))).toBe(true)
      let method = typeof fs['rmSync'] === 'function' ? 'rmSync' : 'rmdirSync'
      fs[method](root, { recursive: true })
    })
  })

  describe('loadExtensionJson()', () => {
    function testErrors(data: any, version: string, count, createJs = false): any {
      let folder = path.join(os.tmpdir(), uuid())
      fs.mkdirSync(folder)
      disposables.push(Disposable.create(() => {
        fs.rmSync(folder, { recursive: true, force: true })
      }))
      if (createJs) writeJson(path.join(folder, 'index.js'), '')
      let filepath = path.join(folder, 'package.json')
      if (data) writeJson(filepath, data)
      let errors: string[] = []
      let json = loadExtensionJson(folder, version, errors)
      expect(errors.length).toBe(count)
      return json
    }

    it('should add errors', async () => {
      testErrors(undefined, '', 1)
      testErrors({}, '', 2)
      testErrors({ name: 'name', main: 'main' }, '', 1)
      testErrors({ name: 'name', engines: {} }, '', 2)
      testErrors({ name: 'name', engines: { coc: '>=0.0.81' } }, '0.0.79', 1, true)
      testErrors({ name: 'name', engines: { coc: '>=0.0.81', main: 'index.js' } }, '0.0.82', 0, true)
    })

    it('should not check entry for vscode extension', async () => {
      testErrors({ name: 'name', engines: { vscode: '0.10.x' } }, '', 0)
    })
  })

  describe('getExtensionName', () => {
    it('should get extension name', async () => {
      expect(getExtensionName('foo')).toBe('foo')
      expect(getExtensionName('http://1')).toBe('http://1')
      expect(getExtensionName('@a/b')).toBe('@a/b')
      expect(getExtensionName('semver@1.2.3')).toBe('semver')
    })
  })
})

describe('ExtensionStat', () => {
  function createDB(folder: string, data: any): string {
    let s = JSON.stringify(data, null, 2)
    let filepath = path.join(folder, 'db.json')
    fs.writeFileSync(filepath, s, 'utf8')
    return filepath
  }

  function create(): [ExtensionStat, string] {
    let folder = path.join(os.tmpdir(), uuid())
    fs.mkdirSync(folder)
    disposables.push(Disposable.create(() => {
      fs.rmSync(folder, { force: true, recursive: true })
    }))
    return [new ExtensionStat(folder), path.join(folder, 'package.json')]
  }

  it('should not throw on create', async () => {
    let spy = jest.spyOn(ExtensionStat.prototype, 'migrate' as any).mockImplementation(() => {
      throw new Error('my error')
    })
    let folder = path.join(os.tmpdir(), uuid())
    fs.mkdirSync(folder)
    let stat = new ExtensionStat(folder)
    spy.mockRestore()
    expect(stat).toBeDefined()
  })

  it('should add local extension', async () => {
    let folder = path.join(os.tmpdir(), uuid())
    let stat = new ExtensionStat(folder)
    stat.addLocalExtension('name', folder)
    expect(stat.getFolder('name')).toBe(folder)
    expect(stat.getFolder('unknown')).toBeUndefined()
  })

  it('should iterate activated extensions', () => {
    let folder = createFolder()
    writeJson(path.join(folder, 'package.json'), {
      disabled: ['x', 'y'],
      dependencies: { x: '', y: '', z: '', a: '' }
    })
    let names: string[] = []
    let stat = new ExtensionStat(folder)
    for (let name of stat.activated()) {
      names.push(name)
    }
    expect(names).toEqual(['z', 'a'])
  })

  it('should migrate #1', async () => {
    let folder = createFolder()
    let stat = new ExtensionStat(folder)
    expect(stat.getExtensionsStat()).toEqual({})
    let data = {
      extension: {
        x: { disabled: true },
        y: { locked: true },
        z: {}
      }
    }
    let filepath = createDB(folder, data)
    writeJson(path.join(folder, 'package.json'), {
      dependencies: { x: '', y: '', z: '', a: '' }
    })
    stat = new ExtensionStat(folder)
    let res = stat.getExtensionsStat()
    expect(res).toEqual({ x: 1, y: 2, z: 0, a: 0 })
    let obj = loadJson(path.join(folder, 'package.json')) as any
    expect(obj.disabled).toEqual(['x'])
    expect(obj.locked).toEqual(['y'])
    expect(fs.existsSync(filepath)).toBe(false)
  })

  it('should migrate #2', async () => {
    let folder = createFolder()
    let stat = new ExtensionStat(folder)
    expect(stat.getExtensionsStat()).toEqual({})
    let data = {}
    createDB(folder, data)
    writeJson(path.join(folder, 'package.json'), {})
    stat = new ExtensionStat(folder)
    let res = stat.getExtensionsStat()
    expect(res).toEqual({})
    let obj = loadJson(path.join(folder, 'package.json')) as any
    expect(obj.disabled).toEqual([])
    expect(obj.locked).toEqual([])
  })

  it('should load disabled & locked from package.json', async () => {
    let folder = createFolder()
    let obj = {
      disabled: ['foo'],
      locked: ['bar'],
      dependencies: {
        foo: '',
        bar: '',
        z: ''
      }
    }
    writeJson(path.join(folder, 'package.json'), obj)
    let stat = new ExtensionStat(folder)
    expect(stat.disabledExtensions).toEqual(['foo'])
    expect(stat.lockedExtensions).toEqual(['bar'])
    expect(stat.getExtensionsStat()['z']).toBe(0)
  })

  it('should add & remove extension', async () => {
    let [stat, jsonFile] = create()
    stat.addExtension('foo', '')
    expect(stat.getExtensionsStat()).toEqual({ foo: 0 })
    let res = loadJson(jsonFile) as any
    expect(res).toEqual({ dependencies: { foo: '' } })
    stat.removeExtension('foo',)
    expect(stat.isDisabled('foo')).toBe(false)
    expect(stat.getExtensionsStat()).toEqual({})
    res = loadJson(jsonFile) as any
    expect(res).toEqual({ dependencies: {} })
  })

  it('should remove extension not exists', async () => {
    let [stat] = create()
    stat.removeExtension('foo')
  })

  it('should remove from disabled and locked extensions', async () => {
    let [stat, jsonFile] = create()
    stat.addExtension('foo', '')
    stat.setDisable('foo', true)
    stat.setLocked('foo', true)
    let res = loadJson(jsonFile) as any
    expect(res.disabled).toEqual(['foo'])
    expect(res.locked).toEqual(['foo'])
    stat.removeExtension('foo')
    res = loadJson(jsonFile) as any
    expect(res.disabled).toEqual([])
    expect(res.locked).toEqual([])
  })

  it('should setDisable', async () => {
    let [stat] = create()
    stat.addExtension('foo', '')
    stat.setDisable('foo', true)
    expect(stat.hasExtension('foo')).toBe(true)
    expect(stat.isDisabled('foo')).toBe(true)
    stat.setDisable('foo', false)
    expect(stat.isDisabled('foo')).toBe(false)
    expect(stat.disabledExtensions).toEqual([])
  })

  it('should setLocked', async () => {
    let [stat] = create()
    stat.addExtension('foo', '')
    stat.setLocked('foo', true)
    expect(stat.lockedExtensions).toEqual(['foo'])
    stat.setLocked('foo', false)
    expect(stat.lockedExtensions).toEqual([])
  })

  it('should check update', async () => {
    let [stat] = create()
    expect(stat.shouldUpdate('never')).toBe(false)
    expect(stat.shouldUpdate('daily')).toBe(true)
    stat.setLastUpdate()
    expect(stat.shouldUpdate('weekly')).toBe(false)
  })

  it('should toInterval', async () => {
    expect(typeof toInterval('daily')).toBe('number')
    expect(typeof toInterval('weekly')).toBe('number')
  })

  it('should get dependencies', async () => {
    let [stat] = create()
    expect(stat.dependencies).toEqual({})
    expect(stat.globalIds).toEqual([])
    stat.addExtension('foo', '')
    expect(stat.dependencies).toEqual({ foo: '' })
    expect(stat.globalIds).toEqual(['foo'])
  })

  it('should filterGlobalExtensions', async () => {
    let [stat, jsonFile] = create()
    expect(stat.filterGlobalExtensions(['foo', 'bar', undefined, 3] as any)).toEqual(['foo', 'bar'])
    stat.addExtension('foo', '')
    expect(stat.filterGlobalExtensions(['foo', 'bar'])).toEqual(['bar'])
    stat.setDisable('bar', true)
    expect(stat.filterGlobalExtensions(['foo', 'bar'])).toEqual([])
    let folder = path.resolve(jsonFile, '../node_modules')
    fs.mkdirSync(folder)
    fs.mkdirSync(path.join(folder, 'uri'))
    writeJson(path.join(folder, 'uri', 'package.json'), {})
    stat.addExtension('uri', 'http://git')
    stat.addExtension('simple', '')
    fs.mkdirSync(path.join(folder, 'simple'))
    writeJson(path.join(folder, 'simple', 'package.json'), {})
    let res = stat.filterGlobalExtensions(['http://git'])
    expect(res).toEqual([])
  })
})

describe('InstallBuffer', () => {
  afterEach(() => {
    events.requesting = false
  })

  it('should sync by not split', async () => {
    global.__TEST__ = false
    let buf = new InstallBuffer(false)
    disposables.push(buf)
    events.requesting = true
    await buf.start(['a', 'b', 'c'])
    let wins = await nvim.windows
    expect(wins.length).toBe(1)
    global.__TEST__ = true
  })

  it('should draw buffer with stats', async () => {
    let buf = new InstallBuffer(true)
    disposables.push(buf)
    buf.draw()
    await buf.start(['a', 'b', 'c', 'd'])
    buf.startProgress('a')
    buf.startProgress('b')
    buf.startProgress('c')
    buf.addMessage('a', 'Updated to 1.0.0')
    buf.addMessage('b', 'message')
    buf.finishProgress('a', true)
    buf.finishProgress('b', false)
    buf.draw()
    buf.finishProgress('c', true)
    buf.finishProgress('d', true)
    let buffer = await nvim.buffer
    let lines = await buffer.lines
    expect(lines.length).toBe(6)
    buf.draw()
  })

  it('should stop when all items finished', async () => {
    let buf = new InstallBuffer(false)
    disposables.push(buf)
    await buf.start(['a', 'b'])
    buf.startProgress('a')
    buf.startProgress('b')
    expect(buf.remains).toBe(2)
    buf.finishProgress('a', true)
    buf.finishProgress('b', true)
    buf.draw()
    expect(buf.getMessages(0)).toEqual([])
    expect(buf.stopped).toBe(true)
  })

  it('should show messages and dispose', async () => {
    events.requesting = true
    let buf = new InstallBuffer(true)
    disposables.push(buf)
    await buf.start(['a', 'b'])
    buf.startProgress('a')
    buf.addMessage('a', 'start')
    buf.addMessage('a', 'finish')
    buf.finishProgress('a', true)
    buf.draw()
    let bufnr = await nvim.call('bufnr', ['%'])
    await nvim.call('cursor', [3, 4])
    let id = await helper.waitFloat()
    let win = nvim.createWindow(id)
    let buffer = await win.buffer
    let lines = await buffer.lines
    expect(lines.join(' ')).toBe('start finish')
    await nvim.command(`bd! ${bufnr}`)
    expect(buf.stopped).toBe(true)
  })
})

describe('InstallChannel', () => {
  it('should create install InstallChannel', async () => {
    let outputChannel = window.createOutputChannel('test')
    let channel = new InstallChannel(true, outputChannel)
    channel.start(['a', 'b'])
    channel.startProgress('a')
    channel.addMessage('a', 'msg', true)
    channel.addMessage('a', 'msg', false)
    channel.finishProgress('a', true)
    channel.finishProgress('b', false)
  })

  it('should create update InstallChannel', async () => {
    let outputChannel = window.createOutputChannel('test')
    let channel = new InstallChannel(false, outputChannel)
    channel.start(['a', 'b'])
    channel.startProgress('a')
    channel.finishProgress('a', true)
    channel.finishProgress('b', false)
  })
})
