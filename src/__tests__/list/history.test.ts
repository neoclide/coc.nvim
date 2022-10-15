import History from '../../list/history'
import { DataBase } from '../../list/db'
import os from 'os'
import fs from 'fs'
import path from 'path'
import { v4 as uuid } from 'uuid'

function createTmpDir(): string {
  let dir = path.join(os.tmpdir(), uuid())
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

afterEach(() => {
  let DB_PATH = path.join(process.env.COC_DATA_HOME, 'list_history.dat')
  if (fs.existsSync(DB_PATH)) {
    fs.unlinkSync(DB_PATH)
  }
})

describe('History', () => {
  it('should migrate history.json', async () => {
    let dir = createTmpDir()
    History.migrate(dir)
    History.migrate(path.join(os.tmpdir(), 'not_exists'))
    dir = createTmpDir()
    let file = path.join(dir, 'list-a-history.json')
    fs.writeFileSync(file, '{"x": 1}')
    History.migrate(dir)
    dir = createTmpDir()
    file = path.join(dir, 'list-mrn-history.json')
    let obj = {
      'L1VzZXJzL2NoZW16cW0vdmltLWRldi9jb2MubnZpbQ==': ['list']
    }
    fs.writeFileSync(file, JSON.stringify(obj, null, 2))
    History.migrate(dir)
  })

  it('should filter history', async () => {
    let db = new DataBase()
    db.save()
    db.addItem('name', 'text', '/a/b')
    let p = { input: '' }
    let history = new History(p, 'name', db, '/a/b')
    history.filter()
    expect(history.filtered).toEqual(['text'])
    p.input = 't'
    history.filter()
    expect(history.filtered).toEqual(['text'])
    history.previous()
    history.filter()
    expect(history.filtered).toEqual(['text'])
  })

  it('should add item', async () => {
    let db = new DataBase()
    let p = { input: '' }
    let history = new History(p, 'name', db, '/a/b')
    history.add()
    p.input = 'input'
    history.add()
    p.input = ''
    history.filter()
    expect(history.filtered).toEqual(['input'])
  })

  it('should change to previous', async () => {
    let db = new DataBase()
    let p = { input: '' }
    let history = new History(p, 'name', db, '/a/b')
    history.previous()
    db.addItem('name', 'one', '/a/b')
    db.addItem('name', 'two', '/a/b')
    db.addItem('name', 'three', '/a/b/c')
    history.filter()
    history.previous()
    history.previous()
    expect(history.index).toBe(0)
    expect(history.curr).toBe('one')
  })

  it('should change to next', async () => {
    let db = new DataBase()
    let p = { input: '' }
    let history = new History(p, 'name', db, '/a/b')
    history.next()
    db.addItem('name', 'one', '/a/b')
    db.addItem('name', 'two', '/a/b')
    db.addItem('name', 'three', '/a/b/c')
    history.filter()
    history.next()
    history.next()
    history.next()
    expect(history.index).toBe(0)
    expect(history.curr).toBe('one')
  })
})

describe('DataBase', () => {
  it('should not throw on load', async () => {
    let spy = jest.spyOn(DataBase.prototype, 'load').mockImplementation(() => {
      throw new Error('error')
    })
    new DataBase()
    spy.mockRestore()
  })

  it('should add items', async () => {
    let db = new DataBase()
    db.addItem('name', 'x'.repeat(260), '/a/b/c')
    let item = db.currItems[0]
    expect(item[0].length).toBe(255)
    db.addItem('name', 'xy', '/a/b/c')
    db.addItem('name', 'xy', '/a/b/c')
    expect(db.currItems.length).toBe(2)
  })

  it('should save data', async () => {
    let db = new DataBase()
    db.addItem('name', 'text', '/a/b/c')
    db.addItem('other_name', 'te', '/a/b/x/y')
    db.save()
    let d = new DataBase()
    expect(d.currItems.length).toBe(2)
  })
})

