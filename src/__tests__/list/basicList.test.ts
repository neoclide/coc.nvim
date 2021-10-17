import { Neovim } from '@chemzqm/neovim'
import { URI } from 'vscode-uri'
import { Disposable, Range, Location } from 'vscode-languageserver-protocol'
import BasicList, { getFiletype, PreviewOptions } from '../../list/basic'
import manager from '../../list/manager'
import { ListItem } from '../../types'
import { disposeAll } from '../../util'
import helper from '../helper'

let nvim: Neovim
let disposables: Disposable[] = []
let previewOptions: PreviewOptions

let list: SimpleList
class SimpleList extends BasicList {
  public name = 'simple'
  public defaultAction: 'preview'
  constructor(nvim: Neovim) {
    super(nvim)
    this.addAction('preview', async (_item, context) => {
      await this.preview(previewOptions, context)
    })
  }
  public loadItems(): Promise<ListItem[]> {
    return Promise.resolve(['a', 'b', 'c'].map((s, idx) => {
      return { label: s, location: Location.create('test:///a', Range.create(idx, 0, idx + 1, 0)) } as ListItem
    }))
  }
}

beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
})

afterAll(async () => {
  await helper.shutdown()
})

beforeEach(() => {
  list = new SimpleList(nvim)
  disposables.push(manager.registerList(list))
})

afterEach(async () => {
  disposeAll(disposables)
  manager.reset()
  await helper.reset()
})

describe('getFiletype()', () => {
  it('should get filetype', async () => {
    expect(getFiletype('javascriptreact')).toBe('javascript')
    expect(getFiletype('typescriptreact')).toBe('typescript')
    expect(getFiletype('latex')).toBe('tex')
    expect(getFiletype('foo.bar')).toBe('foo')
    expect(getFiletype('foo')).toBe('foo')
  })
})

describe('BasicList', () => {
  async function doPreview(opts: PreviewOptions): Promise<number> {
    previewOptions = opts
    await manager.start(['--normal', 'simple'])
    await manager.session.ui.ready
    await manager.doAction('preview')
    let res = await nvim.call('coc#list#has_preview') as number
    expect(res).toBeGreaterThan(0)
    let winid = await nvim.call('win_getid', [res])
    return winid
  }

  describe('preview()', () => {
    it('should preview lines', async () => {
      await doPreview({ filetype: '', lines: ['foo', 'bar'] })
    })

    it('should preview with bufname', async () => {
      await doPreview({
        bufname: 't.js',
        filetype: 'typescript',
        lines: ['foo', 'bar']
      })
    })

    it('should preview with range highlight', async () => {
      let winid = await doPreview({
        bufname: 't.js',
        filetype: 'typescript',
        lines: ['foo', 'bar'],
        range: Range.create(0, 0, 0, 3)
      })
      let res = await nvim.call('getmatches', [winid])
      expect(res.length).toBeGreaterThan(0)
    })

  })

  describe('createAction()', () => {
    it('should overwrite action', async () => {
      let idx: number
      list.createAction({
        name: 'foo',
        execute: () => { idx = 0 }
      })
      list.createAction({
        name: 'foo',
        execute: () => { idx = 1 }
      })
      await manager.start(['--normal', 'simple'])
      await manager.session.ui.ready
      await manager.doAction('foo')
      expect(idx).toBe(1)
    })
  })

  describe('jumpTo()', () => {
    it('should jump to uri', async () => {
      let uri = URI.file(__filename).toString()
      await list.jumpTo(uri, 'edit')
      let bufname = await nvim.call('bufname', ['%'])
      expect(bufname).toMatch('basicList.test.ts')
    })

    it('should jump to location', async () => {
      let uri = URI.file(__filename).toString()
      let loc = Location.create(uri, Range.create(0, 0, 1, 0))
      await list.jumpTo(loc, 'edit')
      let bufname = await nvim.call('bufname', ['%'])
      expect(bufname).toMatch('basicList.test.ts')
    })

    it('should jump to location with empty range', async () => {
      let uri = URI.file(__filename).toString()
      let loc = Location.create(uri, Range.create(0, 0, 0, 0))
      await list.jumpTo(loc, 'edit')
      let bufname = await nvim.call('bufname', ['%'])
      expect(bufname).toMatch('basicList.test.ts')
    })
  })

  describe('convertLocation()', () => {
    it('should convert uri', async () => {
      let uri = URI.file(__filename).toString()
      let res = await list.convertLocation(uri)
      expect(res.uri).toBe(uri)
    })

    it('should convert location with line', async () => {
      let uri = URI.file(__filename).toString()
      let res = await list.convertLocation({ uri, line: 'convertLocation()', text: 'convertLocation' })
      expect(res.uri).toBe(uri)
      res = await list.convertLocation({ uri, line: 'convertLocation()' })
      expect(res.uri).toBe(uri)
    })

    it('should convert location with custom schema', async () => {
      let uri = 'test:///foo'
      let res = await list.convertLocation({ uri, line: 'convertLocation()'})
      expect(res.uri).toBe(uri)
    })
  })

  describe('quickfix action', () => {
    it('should invoke quickfix action', async () => {
      list.addLocationActions()
      await manager.start(['--normal', 'simple', '-arg'])
      await manager.session.ui.ready
      await manager.session.ui.selectAll()
      await manager.doAction('quickfix')
      let res = await nvim.call('getqflist')
      expect(res.length).toBeGreaterThan(1)
    })
  })
})
