import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import Memos from '../../model/memos'
import os from 'os'
import path from 'path'
import fs from 'fs'
import { loadJson, writeJson } from '../../util/fs'

let filepath = path.join(os.tmpdir(), 'test')
let memos: Memos
beforeEach(() => {
  memos = new Memos(filepath)
})

afterEach(() => {
  if (fs.existsSync(filepath)) {
    fs.unlinkSync(filepath)
  }
})

describe('Memos', () => {
  it('should update and get', async () => {
    let memo = memos.createMemento('x')
    await memo.update('foo.bar', 'memo')
    let res = memo.get<string>('foo.bar')
    assert.strictEqual(res, 'memo')
    await memo.update('foo.bar', undefined)
    res = memo.get<string>('foo.bar')
    assert.strictEqual(res, undefined)
  })

  it('should get value for key if it does not exist', async () => {
    let memo = memos.createMemento('y')
    let res = memo.get<any>('xyz')
    assert.strictEqual(res, undefined)
  })

  it('should use defaultValue when it does not exist', async () => {
    let memo = memos.createMemento('y')
    let res = memo.get<any>('f.o.o', 'default')
    assert.strictEqual(res, 'default')
  })

  it('should update multiple values', async () => {
    let memo = memos.createMemento('x')
    await memo.update('foo', 'x')
    await memo.update('bar', 'y')
    assert.strictEqual(memo.get<string>('foo'), 'x')
    assert.strictEqual(memo.get<string>('bar'), 'y')
  })

  it('should merge content', async () => {
    memos.merge(path.join(os.tmpdir(), 'file_not_exists_memos'))
    let oldPath = path.join(os.tmpdir(), 'old_memos.json')
    writeJson(oldPath, { old: { release: true } })
    memos.merge(oldPath)
    let obj = loadJson(filepath) as any
    assert.strictEqual(obj.old.release, true)
    assert.strictEqual(fs.existsSync(oldPath), false)
  })
})
