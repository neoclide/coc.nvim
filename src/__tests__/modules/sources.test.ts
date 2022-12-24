import { Neovim } from '@chemzqm/neovim'
import path from 'path'
import { Disposable } from 'vscode-languageserver-protocol'
import sources from '../../completion/sources'
import { ISource, SourceType } from '../../completion/types'
import events from '../../events'
import { disposeAll } from '../../util'
import helper from '../helper'

let nvim: Neovim
let disposables: Disposable[] = []
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  disposeAll(disposables)
})

describe('sources', () => {
  it('should check commit', () => {
    expect(sources.shouldCommit(undefined, undefined, '')).toBe(false)
    let source = sources.getSource('$words')
    expect(sources.shouldCommit(source, { word: '' }, '.')).toBe(false)
  })

  it('should get normal sources', () => {
    sources.createSource({
      name: 'name',
      documentSelector: [{ language: 'vim' }],
      doComplete: () => null
    })
    let arr = sources.getNormalSources('', 'test:///1')
    let res = arr.find(o => o.name === 'name')
    expect(res).toBeUndefined()
    sources.createSource({
      name: 'name',
      documentSelector: [{ language: '*' }],
      doComplete: () => null
    })
    arr = sources.getNormalSources('x', 'test:///1')
    res = arr.find(o => o.name === 'name')
    expect(res).toBeDefined()
  })

  it('should get trigger sources', () => {
    let res = sources.getTriggerSources('', 'vim', 'test:///1')
    expect(res).toEqual([])
    let arr = ['around', 'buffer', 'file']
    res = sources.getTriggerSources('', 'vim', 'test:///1', arr)
    let find = res.find(o => arr.includes(o.name))
    expect(find).toBeUndefined()
    sources.createSource({
      name: 'name',
      documentSelector: [{ language: 'vim' }],
      doComplete: () => null
    })
    helper.updateConfiguration('coc.source.name.triggerCharacters', ['.'])
    res = sources.getTriggerSources('.', 'vim', 'test:///1', arr)
    find = res.find(o => o.name === 'name')
    expect(find).toBeDefined()
    res = sources.getTriggerSources('.', 'txt', 'test:///1', arr)
    find = res.find(o => o.name === 'name')
    expect(find).toBeUndefined()
  })

  it('should do document enter', async () => {
    let fn = jest.fn()
    let source: ISource = {
      name: 'enter',
      enable: true,
      priority: 0,
      sourceType: SourceType.Service,
      triggerCharacters: [],
      doComplete: () => Promise.resolve({ items: [] }),
      onEnter: fn
    }
    disposables.push(sources.addSource(source))
    let buffer = await nvim.buffer
    await events.fire('BufEnter', [buffer.id])
    expect(fn).toBeCalled()
  })

  it('should get sources by split filetypes', async () => {
    disposables.push(sources.addSource({
      name: 'foo',
      filetypes: ['foo'],
      enable: true,
      doComplete: () => Promise.resolve({ items: [] }),
    }))
    disposables.push(sources.addSource({
      name: 'bar',
      filetypes: ['bar'],
      enable: true,
      doComplete: () => Promise.resolve({ items: [] }),
    }))
    let arr = sources.getNormalSources('foo.bar', 'file:///a')
    let names = arr.map(s => s.name)
    expect(names.includes('foo')).toBe(true)
    expect(names.includes('bar')).toBe(true)
  })

  it('should return source states', async () => {
    let stats = await helper.doAction('sourceStat')
    expect(stats.length > 1).toBe(true)
  })

  it('should toggle source state', async () => {
    await helper.doAction('toggleSource', 'around')
    let s = sources.getSource('around')
    expect(s.enable).toBe(false)
    sources.toggleSource('around')
  })
})

describe('sources#has', () => {

  it('should has source', () => {
    expect(sources.has('around')).toBe(true)
  })

  it('should not has source', () => {
    expect(sources.has('NotExists')).toBe(false)
  })
})

describe('sources#refresh', () => {
  it('should refresh if possible', async () => {
    let fn = jest.fn()
    let source: ISource = {
      name: 'refresh',
      enable: true,
      priority: 0,
      sourceType: SourceType.Service,
      triggerCharacters: [],
      doComplete: () => Promise.resolve({ items: [] }),
      refresh: fn
    }
    disposables.push(sources.addSource(source))
    await helper.doAction('refreshSource', 'refresh')
    expect(fn).toBeCalled()
  })

  it('should work if refresh not defined', async () => {
    let source: ISource = {
      name: 'refresh',
      enable: true,
      priority: 0,
      sourceType: SourceType.Service,
      triggerCharacters: [],
      doComplete: () => Promise.resolve({ items: [] })
    }
    disposables.push(sources.addSource(source))
    await sources.refresh('refresh')
  })
})

describe('sources#createSource', () => {
  it('should throw on create source', async () => {
    expect(() => {
      sources.createSource({
        doComplete: () => Promise.resolve({
          items: [{
            word: 'custom'
          }]
        })
      } as any)
    }).toThrow()
  })

  it('should create vim source', async () => {
    let folder = path.resolve(__dirname, '..')
    await nvim.command(`set runtimepath+=${folder}`)
    disposables.push({
      dispose: () => {
        sources.removeSource('email')
      }
    })
    await helper.waitValue(() => {
      return sources.has('email')
    }, true)
    await helper.createDocument()
    await nvim.input('i@')
    await helper.visible('foo@gmail.com')
  })
})

describe('sources#getTriggerSources()', () => {
  it('should filter by filetypes', async () => {
    let source: ISource = {
      name: 'test',
      enable: true,
      priority: 0,
      filetypes: ['javascript'],
      sourceType: SourceType.Service,
      triggerCharacters: ['#'],
      doComplete: () => Promise.resolve({ items: [] })
    }
    disposables.push(sources.addSource(source))
    let res = sources.getTriggerSources('#', 'javascript', 'file:///tmp.js')
    expect(res.find(o => o.name == 'test')).toBeDefined()
  })

  it('should filter by documentSelector', async () => {
    let source: ISource = {
      name: 'test',
      enable: true,
      priority: 0,
      documentSelector: [{ language: 'javascript' }],
      sourceType: SourceType.Service,
      triggerCharacters: ['#'],
      doComplete: () => Promise.resolve({ items: [] })
    }
    disposables.push(sources.addSource(source))
    let res = sources.getTriggerSources('#', 'javascript', 'file:///tmp.js')
    expect(res.find(o => o.name == 'test')).toBeDefined()
  })

  it('should filter disabled sources', async () => {
    await nvim.setLine('foo bar ')
    let buf = await nvim.buffer
    await buf.setVar('coc_disabled_sources', ['around', 'buffer', 'file'])
    await nvim.input('Af')
    await helper.wait(30)
    await nvim.input('/')
    await helper.wait(100)
    let visible = await nvim.call('pumvisible')
    expect(visible).toBe(0)
  })
})
