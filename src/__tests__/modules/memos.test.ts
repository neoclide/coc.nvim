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
    expect(res).toBe('memo')
    await memo.update('foo.bar', undefined)
    res = memo.get<string>('foo.bar')
    expect(res).toBeUndefined()
  })

  it('should get value for key if it does not exist', async () => {
    let memo = memos.createMemento('y')
    let res = memo.get<any>('xyz')
    expect(res).toBeUndefined()
  })

  it('should use defaultValue when it does not exist', async () => {
    let memo = memos.createMemento('y')
    let res = memo.get<any>('f.o.o', 'default')
    expect(res).toBe('default')
  })

  it('should update multiple values', async () => {
    let memo = memos.createMemento('x')
    await memo.update('foo', 'x')
    await memo.update('bar', 'y')
    expect(memo.get<string>('foo')).toBe('x')
    expect(memo.get<string>('bar')).toBe('y')
  })

  it('should merge content', async () => {
    memos.merge(path.join(os.tmpdir(), 'file_not_exists_memos'))
    let oldPath = path.join(os.tmpdir(), 'old_memos.json')
    writeJson(oldPath, { old: { release: true } })
    memos.merge(oldPath)
    let obj = loadJson(filepath) as any
    expect(obj.old.release).toBe(true)
    expect(fs.existsSync(oldPath)).toBe(false)
  })
})
