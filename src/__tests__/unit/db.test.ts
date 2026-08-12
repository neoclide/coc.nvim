import fs from 'fs'
import os from 'os'
import path from 'path'
import DB from '../../model/db'
import Mru from '../../model/mru'
import { after, afterEach, before, describe, it, test } from 'node:test'
import assert from 'node:assert/strict'
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-mru-'))

let db: DB
before(async () => {
  db = new DB(path.join(root, 'db.json'))
})

after(async () => {
  db.destroy()
})

afterEach(async () => {
  db.clear()
})

describe('DB', () => {

  test('db.exists()', () => {
    let exists = db.exists('a.b')
    assert.strictEqual(exists, false)
    db.push('a.b', { foo: 1 })
    exists = db.exists('a.b.foo')
    assert.strictEqual(exists, true)
  })

  test('db.load()', () => {
    fs.rmSync(root, { force: true, recursive: true })
    db.clear()
    assert.deepStrictEqual(db.fetch(undefined), {})
  })

  test('db.fetch()', () => {
    let res = db.fetch('x')
    assert.strictEqual(res, undefined)
    db.push('x', 1)
    res = db.fetch('x')
    assert.strictEqual(res, 1)
    db.push('x', { foo: 1 })
    res = db.fetch('x')
    assert.deepStrictEqual(res, { foo: 1 })
  })

  test('db.delete()', () => {
    db.push('foo.bar', 1)
    db.delete('not_exists')
    db.delete('foo.bar')
    let exists = db.exists('foo.bar')
    assert.strictEqual(exists, false)
  })

  test('db.push()', () => {
    db.push('foo.x', 1)
    db.push('foo.y', '2')
    db.push('foo.z', true)
    db.push('foo.n', null)
    db.push('foo.o', { x: 1 })
    let res = db.fetch('foo')
    assert.deepStrictEqual(res, {
      x: 1,
      y: '2',
      z: true,
      n: null,
      o: { x: 1 }
    })
  })
})

describe('Mru', () => {
  it('should load items', async () => {
    let mru = new Mru('test', root)
    await mru.clean()
    let res = await mru.load()
    assert.strictEqual(res.length, 0)
    res = mru.loadSync()
    assert.strictEqual(res.length, 0)
  })

  it('should consider last line break', async () => {
    let file = path.join(root, 'test')
    fs.writeFileSync(file, '1\n2\n3\n4\n5\n', 'utf8')
    let mru = new Mru('test', root)
    let res = await mru.load()
    assert.strictEqual(res.length, 5)
    await mru.clean()
  })

  it('should load sync', async () => {
    let file = path.join(root, 'test')
    fs.writeFileSync(file, '\n', 'utf8')
    let mru = new Mru('test', root)
    let res = mru.loadSync()
    assert.strictEqual(res.length, 0)
    fs.writeFileSync(file, '1\n2\n3\n4\n5\n', 'utf8')
    res = mru.loadSync()
    assert.strictEqual(res.length, 5)
  })

  it('should limit lines', async () => {
    let file = path.join(root, 'test')
    fs.writeFileSync(file, '1\n2\n3\n4\n5\n', 'utf8')
    let mru = new Mru('test', root, 3)
    let lines = await mru.load()
    assert.deepStrictEqual(lines, ['1', '2', '3'])
    await mru.clean()
  })

  it('should add items', async () => {
    let mru = new Mru('test', root)
    await mru.add('a')
    await mru.add('b')
    let res = await mru.load()
    assert.strictEqual(res.length, 2)
    await mru.clean()
  })

  it('should consider BOM', async () => {
    let mru = new Mru('test', root)
    let file = path.join(root, 'test')
    let buf = Buffer.from([239, 187, 191])
    fs.writeFileSync(file, buf)
    await mru.add('item')
    let res = await mru.load()
    assert.strictEqual(res.length, 1)
  })

  it('should add when file it does not exist', async () => {
    let mru = new Mru('test', root)
    await mru.clean()
    await mru.add('a')
    let res = await mru.load()
    assert.deepStrictEqual(res, ['a'])
  })

  it('should remove item', async () => {
    let mru = new Mru('test', root)
    await mru.add('a')
    await mru.remove('a')
    let res = await mru.load()
    assert.strictEqual(res.length, 0)
    await mru.clean()
  })
})
