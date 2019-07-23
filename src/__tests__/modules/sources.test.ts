import { Neovim } from '@chemzqm/neovim'
import path from 'path'
import events from '../../events'
import sources from '../../sources'
import { ISource, SourceType } from '../../types'
import helper from '../helper'

let nvim: Neovim
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  await helper.reset()
})

describe('sources', () => {

  it('should do document enter', async () => {
    let fn = jest.fn()
    let source: ISource = {
      name: 'enter',
      enable: true,
      priority: 0,
      sourceType: SourceType.Service,
      triggerCharacters: [],
      doComplete: () => {
        return Promise.resolve({ items: [] })
      },
      onEnter: fn
    }
    sources.addSource(source)
    let buffer = await nvim.buffer
    await events.fire('BufEnter', [buffer.id])
    expect(fn).toBeCalled()
    sources.removeSource(source)
  })

  it('should return source states', () => {
    let stats = sources.sourceStats()
    expect(stats.length > 1).toBe(true)
  })

  it('should toggle source state', () => {
    sources.toggleSource('around')
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
      doComplete: () => {
        return Promise.resolve({ items: [] })
      },
      refresh: fn
    }
    sources.addSource(source)
    await sources.refresh('refresh')
    expect(fn).toBeCalled()
    sources.removeSource(source)
  })

  it('should work if refresh not defined', async () => {
    let source: ISource = {
      name: 'refresh',
      enable: true,
      priority: 0,
      sourceType: SourceType.Service,
      triggerCharacters: [],
      doComplete: () => {
        return Promise.resolve({ items: [] })
      }
    }
    sources.addSource(source)
    await sources.refresh('refresh')
    sources.removeSource(source)
  })
})

describe('sources#createSource', () => {
  it('should create source', async () => {
    let disposable = sources.createSource({
      name: 'custom',
      doComplete: () => {
        return Promise.resolve({
          items: [{
            word: 'custom'
          }]
        })
      }
    })
    await helper.createDocument()
    await nvim.input('i')
    await helper.wait(30)
    await nvim.input('c')
    let visible = await helper.visible('custom', 'custom')
    expect(visible).toBe(true)
    disposable.dispose()
  })

  it('should create vim source', async () => {
    let folder = path.resolve(__dirname, '..')
    await nvim.command(`set runtimepath+=${folder}`)
    await helper.wait(100)
    let exists = sources.has('email')
    expect(exists).toBe(true)
    await helper.createDocument()
    await nvim.input('i')
    await helper.wait(10)
    await nvim.input('@')
    await helper.visible('foo@gmail.com')
  })
})
