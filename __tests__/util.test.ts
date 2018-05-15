import {uniqueItems} from '../src/util/unique'
import {
  getUserData,
  equalChar,
  contextDebounce,
  wait,
  isCocItem
} from '../src/util/index'
import {
  filterFuzzy,
  filterWord
} from '../src/util/filter'
import {
  statAsync,
  isGitIgnored,
  findSourceDir
} from '../src/util/fs'
import {
  wordSortItems
} from '../src/util/sorter'
import watchObj from '../src/util/watch-obj'
import path = require('path')

describe('equalChar test', () => {
  test('should not ignore case', () => {
    expect(equalChar('a', 'b', false)).toBeFalsy
    expect(equalChar('a', 'A', false)).toBeFalsy
    expect(equalChar('a', 'a', false)).toBeTruthy
  })

  test('should ignore case', () => {
    expect(equalChar('a', 'b', false)).toBeFalsy
    expect(equalChar('a', 'A', false)).toBeTruthy
    expect(equalChar('a', 'a', false)).toBeTruthy
  })
})

describe('getUserData test', () => {
  test('should return null if no data', () => {
    let item = {word:''}
    expect(getUserData(item)).toBeNull
  })

  test('should return null if no cid', () => {
    let item = {word:'', user_data: '{"foo": 1}'}
    expect(getUserData(item)).toBeNull
  })

  test('should return null if user_data not a json', () => {
    let item = {word:'', user_data: 'foo'}
    expect(getUserData(item)).toBeNull
  })

  test('should return object if cid is in user_data', () => {
    let item = {word:'', user_data: '{"cid": 123}'}
    let obj = getUserData(item)
    expect(obj).toBeDefined
    expect(obj.cid).toBe(123)
  })
})

describe('unique test', () => {
  test('should find out better abbr', async () => {
    let items = [{
      word: 'foo'
    }, {
      word: 'foo',
      abbr: 'bar'
    }]
    let res = uniqueItems(items)
    expect(res.length).toBe(1)
    expect(res[0].abbr).toBe('bar')
  })

  test('should find out better abbr #1', async () => {
    let items = [
      {
        info: "",
        additionalTextEdits: null,
        word: "getConfig",
        kind: "",
        abbr: "getConfig",
        score: 0.13
      },
      {
        word: "getConfig",
        score: 0.13
      }
    ]
    let res = uniqueItems(items)
    expect(res.length).toBe(1)
    expect(res[0].abbr).toBe('getConfig')
  })

  test('should find out better kind', async () => {
    let items = [{
      word: 'foo'
    }, {
      word: 'foo',
      kind: 'M'
    }, {
      word: 'foo',
      kind: 'Method'
    }]
    let res = uniqueItems(items)
    expect(res.length).toBe(1)
    expect(res[0].kind).toBe('Method')
  })

  test('should find out better info', async () => {
    let items = [{
      word: 'foo'
    }, {
      word: 'foo',
      info: 'bar'
    }]
    let res = uniqueItems(items)
    expect(res.length).toBe(1)
    expect(res[0].info).toBe('bar')
  })
})

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
  test('filter fuzzy #1', () => {
    expect(filterFuzzy('fo', 'foo', false)).toBeTruthy
    expect(filterFuzzy('fo', 'Foo', false)).toBeFalsy
    expect(filterFuzzy('fo', 'ofo', false)).toBeTruthy
    expect(filterFuzzy('fo', 'oof', false)).toBeFalsy
  })

  test('filter fuzzy #2', () => {
    expect(filterFuzzy('fo', 'foo', true)).toBeTruthy
    expect(filterFuzzy('fo', 'Foo', true)).toBeTruthy
    expect(filterFuzzy('fo', 'oFo', true)).toBeTruthy
    expect(filterFuzzy('fo', 'oof', true)).toBeFalsy
  })

  test('filter word #1', () => {
    expect(filterWord('fo', 'foo', false)).toBeTruthy
    expect(filterWord('fo', 'Foo', false)).toBeFalsy
    expect(filterWord('fo', 'ofo', false)).toBeFalsy
  })

  test('filter word #2', () => {
    expect(filterWord('fo', 'foo', true)).toBeTruthy
    expect(filterWord('fo', 'Foo', true)).toBeTruthy
    expect(filterWord('fo', 'oFo', true)).toBeFalsy
  })
})

describe('fs test', () => {
  test('fs statAsync', async() => {
    let res = await statAsync(__filename)
    expect(res).toBeDefined
    expect(res.isFile()).toBe(true)
  })

  test('fs statAsync #1', async() => {
    let res = await statAsync(path.join(__dirname, 'file_not_exist'))
    expect(res).toBeNull
  })

  test('should be not ignored', async() => {
    let res = await isGitIgnored(__filename)
    expect(res).toBeFalsy
  })

  test('should be ignored', async() => {
    let res = await isGitIgnored(path.resolve(__dirname, '../lib/index.js.map'))
    expect(res).toBeTruthy
  })

  test('should find source directory', async() => {
    let dir = await findSourceDir(path.resolve(__dirname, '../src/util/index.js'))
    expect(dir).toBe(path.resolve(__dirname, '../src'))
  })

  test('should not find source directory', async() => {
    let dir = await findSourceDir(__filename)
    expect(dir).toBeNull
  })
})

describe('sort test', () => {
  test('should sort item by word', () => {
    let items = [{word: 'ab'}, {word: 'ac'}]
    let res = wordSortItems(items)
    expect(res.length).toBe(2)
    expect(res[0].word).toBe('ab')
  })
})

describe('watchObj test', () => {
  test('should trigger watch', () => {
    const cached: {[index: string]: string} = {}
    let {watched, addWatcher} = watchObj(cached)
    let result:string|null = null
    addWatcher('foo', (res) => {
      result = res
    })
    watched.foo = 'bar'
    expect(result).toBe('bar')
  })

  test('should not trigger watch', () => {
    const cached: {[index: string]: string} = {}
    let {watched, addWatcher} = watchObj(cached)
    let result:string|null = null
    addWatcher('foo', (res) => {
      result = res
    })
    watched.bar = 'bar'
    delete watched.bar
    expect(result).toBeNull
  })
})
