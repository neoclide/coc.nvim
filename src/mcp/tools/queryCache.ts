'use strict'
import { Disposable } from '../../util/protocol'

export interface QueryCacheOptions {
  maxEntries: number
  ttlMs: number
}

interface CacheEntry<T> {
  value: T
  expires: number
}

/**
 * Small LRU cache with a TTL for idempotent MCP queries. Keys are plain
 * strings starting with the document uri so a document can be invalidated
 * with a cheap prefix scan. A Map keeps insertion order and re-inserting an
 * accessed key moves it to the end, so the first key is always the least
 * recently used one and gets evicted first when the cache is full.
 */
export class QueryCache<T> implements Disposable {
  private entries = new Map<string, CacheEntry<T>>()

  constructor(private options: QueryCacheOptions) {}

  public get size(): number {
    return this.entries.size
  }

  public get(key: string): T | undefined {
    let entry = this.entries.get(key)
    if (!entry) return undefined
    if (Date.now() >= entry.expires) {
      this.entries.delete(key)
      return undefined
    }
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.value
  }

  public set(key: string, value: T): void {
    this.entries.delete(key)
    this.entries.set(key, { value, expires: Date.now() + this.options.ttlMs })
    while (this.entries.size > this.options.maxEntries) {
      let oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
  }

  /**
   * Remove every entry belonging to a document uri. Keys start with
   * `uri + '\0'` and uris never contain NUL, so the prefix check is exact.
   */
  public deleteUri(uri: string): void {
    let prefix = uri + '\0'
    for (let key of this.entries.keys()) {
      if (key.startsWith(prefix)) this.entries.delete(key)
    }
  }

  public clear(): void {
    this.entries.clear()
  }

  public dispose(): void {
    this.clear()
  }
}
