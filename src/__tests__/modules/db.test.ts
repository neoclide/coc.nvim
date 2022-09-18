import DB from '../../model/db'
import path from 'path'
import Mru from '../../model/mru'
import os from 'os'
import fs from 'fs'
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-mru-'))

let db: DB
beforeAll(async () => {
  db = new DB(path.join(root, 'db.json'))
})

afterAll(async () => {
  db.destroy()
})

afterEach(async () => {
  db.clear()
})

describe('DB', () => {

  test('db.exists()', async () => {
    let exists = db.exists('a.b')
    expect(exists).toBe(false)
    db.push('a.b', { foo: 1 })
    exists = db.exists('a.b.foo')
    expect(exists).toBe(true)
  })

  test('db.fetch()', async () => {
    let res = await db.fetch('x')
    expect(res).toBeUndefined()
    db.push('x', 1)
    res = await db.fetch('x')
    expect(res).toBe(1)
    db.push('x', { foo: 1 })
    res = await db.fetch('x')
    expect(res).toEqual({ foo: 1 })
  })

  test('db.delete()', async () => {
    db.push('foo.bar', 1)
    db.delete('foo.bar')
    let exists = db.exists('foo.bar')
    expect(exists).toBe(false)
  })

  test('db.push()', async () => {
    db.push('foo.x', 1)
    db.push('foo.y', '2')
    db.push('foo.z', true)
    db.push('foo.n', null)
    db.push('foo.o', { x: 1 })
    let res = db.fetch('foo')
    expect(res).toEqual({
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
    expect(res.length).toBe(0)
    res = mru.loadSync()
    expect(res.length).toBe(0)
  })

  it('should add items', async () => {
    let mru = new Mru('test', root)
    await mru.add('a')
    await mru.add('b')
    let res = await mru.load()
    expect(res.length).toBe(2)
    await mru.clean()
  })

  it('should add when file it does not exist', async () => {
    let mru = new Mru('test', root)
    await mru.clean()
    await mru.add('a')
    let res = await mru.load()
    expect(res).toEqual(['a'])
  })

  it('should remove item', async () => {
    let mru = new Mru('test', root)
    await mru.add('a')
    await mru.remove('a')
    let res = await mru.load()
    expect(res.length).toBe(0)
    await mru.clean()
  })
})
