import {
  contextDebounce,
  wait,
  isCocItem,
  filterWord
} from '../util/index'
import {
  getCharCodes,
  fuzzyMatch,
  fuzzyChar
} from '../util/fuzzy'
import {
  readFileByLine,
  statAsync,
  isGitIgnored,
  findSourceDir,
  createTmpFile
} from '../util/fs'
import watchObj from '../util/watch-obj'
import path = require('path')
import fs = require('fs')

describe('contextDebounce test',async () => {

  test('should debounce #1', async () => {
    let i = 0
    function incr(x:number):void {
      i = i + x
    }
    let fn = contextDebounce(incr, 100)
    expect(i).toBe(0)
    fn(1)
    await wait(30)
    fn(1)
    expect(i).toBe(0)
    await wait(110)
    expect(i).toBe(1)
    fn(1)
    expect(i).toBe(1)
    await wait(110)
    expect(i).toBe(2)
  })

  test('should debounce #2', async () => {
    let i = 0
    let j = 0
    function incr(x:number):void {
      if (x == 1) i = i + 1
      if (x == 2) j = j + 1
    }
    let fn = contextDebounce(incr, 100)
    fn(1)
    fn(2)
    expect(i).toBe(0)
    expect(j).toBe(0)
    await wait(110)
    expect(i).toBe(1)
    expect(j).toBe(1)
    fn(2)
    fn(2)
    fn(1)
    expect(i).toBe(1)
    expect(j).toBe(1)
    await wait(110)
    expect(i).toBe(2)
    expect(j).toBe(2)
  })
})

describe('isCocItem test', () => {
  test('should be coc item', () => {
    let item = {
      word: 'f',
      user_data: '{"cid": 123}'
    }
    expect(isCocItem(item)).toBeTruthy
  })

  test('shoud not be coc item', () => {
    expect(isCocItem(null)).toBeFalsy
    expect(isCocItem({})).toBeFalsy
    expect(isCocItem({word: ''})).toBeFalsy
    expect(isCocItem({word: '', user_data: 'abc'})).toBeFalsy
  })
})

describe('filter test', () => {

  test('filter word #2', () => {
    expect(filterWord('fo', 'foo', true)).toBeTruthy
    expect(filterWord('fo', 'Foo', true)).toBeTruthy
    expect(filterWord('fo', 'oFo', true)).toBeFalsy
  })
})

describe('fuzzy match test', () => {
  test('should be fuzzy match', () => {
    let needle = 'aBc'
    let codes = getCharCodes(needle)
    expect(fuzzyMatch(codes, 'abc')).toBeFalsy
    expect(fuzzyMatch(codes, 'ab')).toBeFalsy
    expect(fuzzyMatch(codes, 'addbdd')).toBeFalsy
    expect(fuzzyMatch(codes, 'abbbBc')).toBeTruthy
    expect(fuzzyMatch(codes, 'daBc')).toBeTruthy
    expect(fuzzyMatch(codes, 'ABCz')).toBeTruthy
  })

  test('should be fuzzy for character', () => {
    expect(fuzzyChar('a', 'a')).toBeTruthy
    expect(fuzzyChar('a', 'A')).toBeTruthy
    expect(fuzzyChar('z', 'z')).toBeTruthy
    expect(fuzzyChar('z', 'Z')).toBeTruthy
    expect(fuzzyChar('A', 'a')).toBeFalsy
    expect(fuzzyChar('A', 'A')).toBeTruthy
    expect(fuzzyChar('Z', 'z')).toBeFalsy
    expect(fuzzyChar('Z', 'Z')).toBeTruthy
  })
})

describe('fs test', () => {
  test('fs statAsync', async () => {
    let res = await statAsync(__filename)
    expect(res).toBeDefined
    expect(res.isFile()).toBe(true)
  })

  test('fs statAsync #1', async () => {
    let res = await statAsync(path.join(__dirname, 'file_not_exist'))
    expect(res).toBeNull
  })

  test('should be not ignored', async () => {
    let res = await isGitIgnored(__filename)
    expect(res).toBeFalsy
  })

  test('should be ignored', async () => {
    let res = await isGitIgnored(path.resolve(__dirname, '../lib/index.js.map'))
    expect(res).toBeTruthy
  })

  test('should find source directory', async () => {
    let dir = findSourceDir(path.resolve(__dirname, '../util/index.js'))
    expect(dir).toBe(path.resolve(__dirname, '..'))
  })

  test('should not find source directory', async () => {
    let dir = findSourceDir(__filename)
    expect(dir).toBeNull
  })

  test('should read file by line', async () => {
    let lines = []
    await readFileByLine(path.join(__dirname, 'tags'), line => {
      lines.push(line)
    })
    expect(lines.length > 0).toBeTruthy
  })

  test('should create tmp file', async () => {
    let filename = await createTmpFile('coc test')
    expect(typeof filename).toBe('string')
    let stat = fs.statSync(filename)
    expect(stat.isFile()).toBeTruthy
  })
})

describe('watchObj test', () => {
  test('should trigger watch', () => {
    const cached: {[index: string]: string} = {}
    let {watched, addWatcher} = watchObj(cached)
    let result:string|null = null
    addWatcher('foo',res => {
      result = res
    })
    watched.foo = 'bar'
    expect(result).toBe('bar')
  })

  test('should not trigger watch', () => {
    const cached: {[index: string]: string} = {}
    let {watched, addWatcher} = watchObj(cached)
    let result:string|null = null
    addWatcher('foo',res => {
      result = res
    })
    watched.bar = 'bar'
    delete watched.bar
    expect(result).toBeNull
  })
})
