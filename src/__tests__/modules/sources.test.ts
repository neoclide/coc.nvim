import sources from '../../sources'
import helper from '../helper'
import { ISource, SourceType } from '../../types'
import events from '../../events'

beforeAll(async () => {
  await helper.setup()
})

afterAll(async () => {
  await helper.shutdown()
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
    await events.fire('BufEnter', [1])
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
