process.env.COC_NO_PLUGINS = '1'
import { Neovim } from '@chemzqm/neovim'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { Disposable } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
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
  let folder = path.join(os.tmpdir(), crypto.randomUUID())
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
      assert.strictEqual(Array.isArray(res), true)
    })
  })

  describe('loadGlobalJsonAsync()', () => {
    it('should throw when engines not valid', async () => {
      let folder = createFolder()
      let file = path.join(folder, 'package.json')
      fs.writeFileSync(file, '{}', 'utf8')
      await assert.rejects(loadGlobalJsonAsync(folder, '0.0.80'), /Invalid engines/)
      fs.writeFileSync(file, '{"engines": {}}', 'utf8')
      await assert.rejects(loadGlobalJsonAsync(folder, '0.0.80'), /Invalid engines/)
    })

    it('should throw when version not match', async () => {
      let folder = createFolder()
      let file = path.join(folder, 'package.json')
      fs.writeFileSync(file, '{"engines": {"coc": ">=0.0.80"}}', 'utf8')
      await assert.rejects(loadGlobalJsonAsync(folder, '0.0.79'), /not match/)
    })

    it('should throw when main file not found', async () => {
      let folder = createFolder()
      let file = path.join(folder, 'package.json')
      fs.writeFileSync(file, '{"engines": {"coc": ">=0.0.80"}}', 'utf8')
      await assert.rejects(loadGlobalJsonAsync(folder, '0.0.80'), /not found/)
    })

    it('should load json', async () => {
      let folder = createFolder()
      let file = path.join(folder, 'package.json')
      fs.writeFileSync(file, '{"name": "foo","engines": {"coc": ">=0.0.80"}}', 'utf8')
      fs.writeFileSync(path.join(folder, 'index.js'), '', 'utf8')
      let res = await loadGlobalJsonAsync(folder, '0.0.80')
      assert.strictEqual(res.name, 'foo')
    })
  })

  describe('validExtensionFolder()', () => {
    it('should check validExtensionFolder', async () => {
      assert.strictEqual(validExtensionFolder(__dirname, ''), false)
      let folder = path.join(os.tmpdir(), crypto.randomUUID())
      fs.mkdirSync(folder)
      disposables.push(Disposable.create(() => {
        fs.rmSync(folder, { recursive: true, force: true })
      }))
      writeJson(path.join(folder, 'index.js'), '')
      let filepath = path.join(folder, 'package.json')
      writeJson(filepath, { name: 'name', engines: { coc: '>=0.0.81' } })
      assert.strictEqual(validExtensionFolder(folder, '0.0.82'), true)
    })
  })

  describe('checkExtensionRoot', () => {

    it('should not throw on error', async (t) => {
      let spy = t.mock.method(fs, 'existsSync', () => {
        throw new Error('my error')
      })
      let called = false
      let s = t.mock.method(console, 'error', () => {
        called = true
      })
      let root = path.join(os.tmpdir(), 'foo-bar')
      let res = checkExtensionRoot(root)
      s.mock.restore()
      spy.mock.restore()
      assert.strictEqual(res, false)
    })

    it('should create root when it does not exist', async () => {
      let root = path.join(os.tmpdir(), 'foo-bar')
      let res = checkExtensionRoot(root)
      assert.strictEqual(res, true)
      assert.strictEqual(fs.existsSync(path.join(root, 'package.json')), true)
      let method = typeof fs['rmSync'] === 'function' ? 'rmSync' : 'rmdirSync'
      fs[method](root, { recursive: true })
    })

    it('should remove unexpted file', async () => {
      let root = path.join(os.tmpdir(), crypto.randomUUID())
      fs.writeFileSync(root, '')
      let res = checkExtensionRoot(root)
      assert.strictEqual(res, true)
      assert.strictEqual(fs.existsSync(path.join(root, 'package.json')), true)
      let method = typeof fs['rmSync'] === 'function' ? 'rmSync' : 'rmdirSync'
      fs[method](root, { recursive: true })
    })
  })

  describe('loadExtensionJson()', () => {
    function testErrors(data: any, version: string, count, createJs = false): any {
      let folder = path.join(os.tmpdir(), crypto.randomUUID())
      fs.mkdirSync(folder)
      disposables.push(Disposable.create(() => {
        fs.rmSync(folder, { recursive: true, force: true })
      }))
      if (createJs) writeJson(path.join(folder, 'index.js'), '')
      let filepath = path.join(folder, 'package.json')
      if (data) writeJson(filepath, data)
      let errors: string[] = []
      let json = loadExtensionJson(folder, version, errors)
      assert.strictEqual(errors.length, count)
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
      assert.strictEqual(getExtensionName('foo'), 'foo')
      assert.strictEqual(getExtensionName('http://1'), 'http://1')
      assert.strictEqual(getExtensionName('@a/b'), '@a/b')
      assert.strictEqual(getExtensionName('semver@1.2.3'), 'semver')
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
    let folder = path.join(os.tmpdir(), crypto.randomUUID())
    fs.mkdirSync(folder)
    disposables.push(Disposable.create(() => {
      fs.rmSync(folder, { force: true, recursive: true })
    }))
    return [new ExtensionStat(folder), path.join(folder, 'package.json')]
  }

  it('should not throw on create', async (t) => {
    let spy = t.mock.method(ExtensionStat.prototype, 'migrate' as any, () => {
      throw new Error('my error')
    })
    let folder = path.join(os.tmpdir(), crypto.randomUUID())
    fs.mkdirSync(folder)
    let stat = new ExtensionStat(folder)
    spy.mock.restore()
    assert.notStrictEqual(stat, undefined)
  })

  it('should add local extension', async () => {
    let folder = path.join(os.tmpdir(), crypto.randomUUID())
    let stat = new ExtensionStat(folder)
    stat.addLocalExtension('name', folder)
    assert.strictEqual(stat.getFolder('name'), folder)
    assert.strictEqual(stat.getFolder('unknown'), undefined)
  })

  it('should addNoPromptFolder', async () => {
    let [state, filepath] = create()
    let uri = URI.file(path.dirname(filepath)).toString()
    assert.strictEqual(state.shouldPrompt(uri), true)
    state.addNoPromptFolder(uri)
    state.addNoPromptFolder(uri)
    assert.strictEqual(state.shouldPrompt(uri), false)
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
    assert.deepStrictEqual(names, ['z', 'a'])
  })

  it('should migrate #1', async () => {
    let folder = createFolder()
    let stat = new ExtensionStat(folder)
    assert.deepStrictEqual(stat.getExtensionsStat(), {})
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
    assert.deepStrictEqual(res, { x: 1, y: 2, z: 0, a: 0 })
    let obj = loadJson(path.join(folder, 'package.json')) as any
    assert.deepStrictEqual(obj.disabled, ['x'])
    assert.deepStrictEqual(obj.locked, ['y'])
    assert.strictEqual(fs.existsSync(filepath), false)
  })

  it('should migrate #2', async () => {
    let folder = createFolder()
    let stat = new ExtensionStat(folder)
    assert.deepStrictEqual(stat.getExtensionsStat(), {})
    let data = {}
    createDB(folder, data)
    writeJson(path.join(folder, 'package.json'), {})
    stat = new ExtensionStat(folder)
    let res = stat.getExtensionsStat()
    assert.deepStrictEqual(res, {})
    let obj = loadJson(path.join(folder, 'package.json')) as any
    assert.deepStrictEqual(obj.disabled, [])
    assert.deepStrictEqual(obj.locked, [])
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
    assert.deepStrictEqual(stat.disabledExtensions, ['foo'])
    assert.deepStrictEqual(stat.lockedExtensions, ['bar'])
    assert.strictEqual(stat.getExtensionsStat()['z'], 0)
  })

  it('should add & remove extension', async () => {
    let [stat, jsonFile] = create()
    stat.addExtension('foo', '')
    assert.deepStrictEqual(stat.getExtensionsStat(), { foo: 0 })
    let res = loadJson(jsonFile) as any
    assert.deepStrictEqual(res, { dependencies: { foo: '' } })
    stat.removeExtension('foo',)
    assert.strictEqual(stat.isDisabled('foo'), false)
    assert.deepStrictEqual(stat.getExtensionsStat(), {})
    res = loadJson(jsonFile) as any
    assert.deepStrictEqual(res, { dependencies: {} })
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
    assert.deepStrictEqual(res.disabled, ['foo'])
    assert.deepStrictEqual(res.locked, ['foo'])
    stat.removeExtension('foo')
    res = loadJson(jsonFile) as any
    assert.deepStrictEqual(res.disabled, [])
    assert.deepStrictEqual(res.locked, [])
  })

  it('should setDisable', async () => {
    let [stat] = create()
    stat.addExtension('foo', '')
    stat.setDisable('foo', true)
    assert.strictEqual(stat.hasExtension('foo'), true)
    assert.strictEqual(stat.isDisabled('foo'), true)
    stat.setDisable('foo', false)
    assert.strictEqual(stat.isDisabled('foo'), false)
    assert.deepStrictEqual(stat.disabledExtensions, [])
  })

  it('should setLocked', async () => {
    let [stat] = create()
    stat.addExtension('foo', '')
    stat.setLocked('foo', true)
    assert.deepStrictEqual(stat.lockedExtensions, ['foo'])
    stat.setLocked('foo', false)
    assert.deepStrictEqual(stat.lockedExtensions, [])
  })

  it('should check update', async () => {
    let [stat] = create()
    assert.strictEqual(stat.shouldUpdate('never'), false)
    assert.strictEqual(stat.shouldUpdate('daily'), true)
    stat.setLastUpdate()
    assert.strictEqual(stat.shouldUpdate('weekly'), false)
  })

  it('should toInterval', async () => {
    assert.strictEqual(typeof toInterval('daily'), 'number')
    assert.strictEqual(typeof toInterval('weekly'), 'number')
  })

  it('should get dependencies', async () => {
    let [stat] = create()
    assert.deepStrictEqual(stat.dependencies, {})
    assert.deepStrictEqual(stat.globalIds, [])
    stat.addExtension('foo', '')
    assert.deepStrictEqual(stat.dependencies, { foo: '' })
    assert.deepStrictEqual(stat.globalIds, ['foo'])
  })

  it('should filterGlobalExtensions', async () => {
    let [stat, jsonFile] = create()
    assert.deepStrictEqual(stat.filterGlobalExtensions(['foo', 'bar', undefined, 3] as any), ['foo', 'bar'])
    stat.addExtension('foo', '')
    assert.deepStrictEqual(stat.filterGlobalExtensions(['foo', 'bar']), ['bar'])
    stat.setDisable('bar', true)
    assert.deepStrictEqual(stat.filterGlobalExtensions(['foo', 'bar']), [])
    let folder = path.resolve(jsonFile, '../node_modules')
    fs.mkdirSync(folder)
    fs.mkdirSync(path.join(folder, 'uri'))
    writeJson(path.join(folder, 'uri', 'package.json'), {})
    stat.addExtension('uri', 'http://git')
    stat.addExtension('simple', '')
    fs.mkdirSync(path.join(folder, 'simple'))
    writeJson(path.join(folder, 'simple', 'package.json'), {})
    let res = stat.filterGlobalExtensions(['http://git'])
    assert.deepStrictEqual(res, [])
  })
})

describe('InstallBuffer', () => {
  afterEach(() => {
    events.requesting = false
  })

  it('should sync by not split', async () => {
    global.__TEST__ = false
    let buf = new InstallBuffer({ isUpdate: false, updateUIInTab: false })
    disposables.push(buf)
    events.requesting = true
    await buf.start(['a', 'b', 'c'])
    // scratch buffer should carry a meaningful name (#5061)
    const bufname = await nvim.call('bufname', ['%']) as string
    assert.strictEqual(bufname, '[Coc Extensions]')
    let wins = await nvim.windows
    assert.strictEqual(wins.length, 1)
    global.__TEST__ = true
  })

  it('should draw buffer with stats', async () => {
    let buf = new InstallBuffer({ isUpdate: true, updateUIInTab: true })
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
    assert.strictEqual(lines.length, 6)
    buf.draw()
  })

  it('should stop when all items finished', async () => {
    let buf = new InstallBuffer({ isUpdate: false })
    disposables.push(buf)
    await buf.start(['a', 'b'])
    buf.startProgress('a')
    buf.startProgress('b')
    assert.strictEqual(buf.remains, 2)
    buf.finishProgress('a', true)
    buf.finishProgress('b', true)
    buf.draw()
    assert.deepStrictEqual(buf.getMessages(0), [])
    assert.strictEqual(buf.stopped, true)
  })

  it('should show messages and dispose', async () => {
    events.requesting = true
    let buf = new InstallBuffer({ isUpdate: true })
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
    assert.strictEqual(lines.join(' '), 'start finish')
    await nvim.command(`bd! ${bufnr}`)
    assert.strictEqual(buf.stopped, true)
  })
})

describe('InstallChannel', () => {
  it('should create install InstallChannel', async () => {
    let outputChannel = window.createOutputChannel('test')
    let channel = new InstallChannel({ isUpdate: true }, outputChannel)
    channel.start(['a', 'b'])
    channel.startProgress('a')
    channel.addMessage('a', 'msg', true)
    channel.addMessage('a', 'msg', false)
    channel.finishProgress('a', true)
    channel.finishProgress('b', false)
  })

  it('should create update InstallChannel', async () => {
    let outputChannel = window.createOutputChannel('test')
    let channel = new InstallChannel({ isUpdate: false }, outputChannel)
    channel.start(['a', 'b'])
    channel.startProgress('a')
    channel.finishProgress('a', true)
    channel.finishProgress('b', false)
  })
})
