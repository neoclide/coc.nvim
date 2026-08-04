'use strict'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryCache } from '../../mcp/tools/queryCache'

describe('mcp QueryCache', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns cached values within the ttl', () => {
    vi.useFakeTimers()
    let cache = new QueryCache<string>({ maxEntries: 10, ttlMs: 1000 })
    cache.set('a', '1')
    expect(cache.get('a')).toBe('1')
    vi.advanceTimersByTime(500)
    expect(cache.get('a')).toBe('1')
    expect(cache.size).toBe(1)
  })

  it('returns undefined for a missing key', () => {
    let cache = new QueryCache<string>({ maxEntries: 10, ttlMs: 1000 })
    expect(cache.get('missing')).toBeUndefined()
    expect(cache.size).toBe(0)
  })

  it('drops entries after the ttl', () => {
    vi.useFakeTimers()
    let cache = new QueryCache<string>({ maxEntries: 10, ttlMs: 1000 })
    cache.set('a', '1')
    vi.advanceTimersByTime(1001)
    expect(cache.get('a')).toBeUndefined()
    expect(cache.size).toBe(0)
  })

  it('expires exactly at the ttl boundary', () => {
    vi.useFakeTimers()
    let cache = new QueryCache<string>({ maxEntries: 10, ttlMs: 1000 })
    cache.set('a', '1')
    vi.advanceTimersByTime(1000)
    expect(cache.get('a')).toBeUndefined()
    expect(cache.size).toBe(0)
  })

  it('evicts the least recently used entry when full', () => {
    vi.useFakeTimers()
    let cache = new QueryCache<string>({ maxEntries: 2, ttlMs: 1000 })
    cache.set('a', '1')
    cache.set('b', '2')
    cache.get('a')
    cache.set('c', '3')
    expect(cache.get('a')).toBe('1')
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('c')).toBe('3')
  })

  it('re-inserting a key refreshes recency and value', () => {
    let cache = new QueryCache<string>({ maxEntries: 2, ttlMs: 1000 })
    cache.set('a', '1')
    cache.set('b', '2')
    cache.set('a', '3')
    cache.set('c', '4')
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('a')).toBe('3')
    expect(cache.get('c')).toBe('4')
  })

  it('deleteUri removes only entries of that document', () => {
    let cache = new QueryCache<string>({ maxEntries: 10, ttlMs: 1000 })
    let key = (uri: string, method: string, version: number): string => [uri, method, version, -1, -1].join('\u0000')
    cache.set(key('file:///a', 'hover', 1), 'a1')
    cache.set(key('file:///a', 'definition', 2), 'a2')
    cache.set(key('file:///ab', 'hover', 1), 'ab')
    cache.deleteUri('file:///a')
    expect(cache.size).toBe(1)
    expect(cache.get(key('file:///ab', 'hover', 1))).toBe('ab')
    expect(cache.get(key('file:///a', 'hover', 1))).toBeUndefined()
  })

  it('deleteUri is a no-op for an unknown document', () => {
    let cache = new QueryCache<string>({ maxEntries: 10, ttlMs: 1000 })
    cache.set('file:///a\u0000hover', 'a1')
    cache.deleteUri('file:///b')
    expect(cache.size).toBe(1)
    expect(cache.get('file:///a\u0000hover')).toBe('a1')
  })

  it('clear removes all entries', () => {
    let cache = new QueryCache<string>({ maxEntries: 10, ttlMs: 1000 })
    cache.set('a', '1')
    cache.set('b', '2')
    cache.clear()
    expect(cache.size).toBe(0)
    expect(cache.get('a')).toBeUndefined()
  })

  it('dispose clears the cache', () => {
    let cache = new QueryCache<string>({ maxEntries: 10, ttlMs: 1000 })
    cache.set('a', '1')
    cache.dispose()
    expect(cache.size).toBe(0)
    expect(cache.get('a')).toBeUndefined()
  })
})
