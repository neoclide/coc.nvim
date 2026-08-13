'use strict'
import { QueryCache } from '../../mcp/tools/queryCache'

describe('mcp QueryCache', () => {
  it('returns cached values within the ttl', t => {
    t.mock.timers.enable()
    let cache = new QueryCache<string>({ maxEntries: 10, ttlMs: 1000 })
    cache.set('a', '1')
    assert.strictEqual(cache.get('a'), '1')
    t.mock.timers.tick(500)
    assert.strictEqual(cache.get('a'), '1')
    assert.strictEqual(cache.size, 1)
  })

  it('returns undefined for a missing key', () => {
    let cache = new QueryCache<string>({ maxEntries: 10, ttlMs: 1000 })
    assert.strictEqual(cache.get('missing'), undefined)
    assert.strictEqual(cache.size, 0)
  })

  it('drops entries after the ttl', t => {
    t.mock.timers.enable()
    let cache = new QueryCache<string>({ maxEntries: 10, ttlMs: 1000 })
    cache.set('a', '1')
    t.mock.timers.tick(1001)
    assert.strictEqual(cache.get('a'), undefined)
    assert.strictEqual(cache.size, 0)
  })

  it('expires exactly at the ttl boundary', t => {
    t.mock.timers.enable()
    let cache = new QueryCache<string>({ maxEntries: 10, ttlMs: 1000 })
    cache.set('a', '1')
    t.mock.timers.tick(1000)
    assert.strictEqual(cache.get('a'), undefined)
    assert.strictEqual(cache.size, 0)
  })

  it('evicts the least recently used entry when full', t => {
    t.mock.timers.enable()
    let cache = new QueryCache<string>({ maxEntries: 2, ttlMs: 1000 })
    cache.set('a', '1')
    cache.set('b', '2')
    cache.get('a')
    cache.set('c', '3')
    assert.strictEqual(cache.get('a'), '1')
    assert.strictEqual(cache.get('b'), undefined)
    assert.strictEqual(cache.get('c'), '3')
  })

  it('re-inserting a key refreshes recency and value', () => {
    let cache = new QueryCache<string>({ maxEntries: 2, ttlMs: 1000 })
    cache.set('a', '1')
    cache.set('b', '2')
    cache.set('a', '3')
    cache.set('c', '4')
    assert.strictEqual(cache.get('b'), undefined)
    assert.strictEqual(cache.get('a'), '3')
    assert.strictEqual(cache.get('c'), '4')
  })

  it('deleteUri removes only entries of that document', () => {
    let cache = new QueryCache<string>({ maxEntries: 10, ttlMs: 1000 })
    let key = (uri: string, method: string, version: number): string => [uri, method, version, -1, -1].join('\u0000')
    cache.set(key('file:///a', 'hover', 1), 'a1')
    cache.set(key('file:///a', 'definition', 2), 'a2')
    cache.set(key('file:///ab', 'hover', 1), 'ab')
    cache.deleteUri('file:///a')
    assert.strictEqual(cache.size, 1)
    assert.strictEqual(cache.get(key('file:///ab', 'hover', 1)), 'ab')
    assert.strictEqual(cache.get(key('file:///a', 'hover', 1)), undefined)
  })

  it('deleteUri is a no-op for an unknown document', () => {
    let cache = new QueryCache<string>({ maxEntries: 10, ttlMs: 1000 })
    cache.set('file:///a\u0000hover', 'a1')
    cache.deleteUri('file:///b')
    assert.strictEqual(cache.size, 1)
    assert.strictEqual(cache.get('file:///a\u0000hover'), 'a1')
  })

  it('clear removes all entries', () => {
    let cache = new QueryCache<string>({ maxEntries: 10, ttlMs: 1000 })
    cache.set('a', '1')
    cache.set('b', '2')
    cache.clear()
    assert.strictEqual(cache.size, 0)
    assert.strictEqual(cache.get('a'), undefined)
  })

  it('dispose clears the cache', () => {
    let cache = new QueryCache<string>({ maxEntries: 10, ttlMs: 1000 })
    cache.set('a', '1')
    cache.dispose()
    assert.strictEqual(cache.size, 0)
    assert.strictEqual(cache.get('a'), undefined)
  })

  it('handles a non-positive entry limit without looping', () => {
    let cache = new QueryCache<string>({ maxEntries: -1, ttlMs: 1000 })
    cache.set('a', '1')
    assert.strictEqual(cache.size, 0)
  })
})
