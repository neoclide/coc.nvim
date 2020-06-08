import FloatBuffer from '../../model/floatBuffer'
import helper from '../helper'
import { Neovim } from '@chemzqm/neovim'
import { Documentation, Fragment } from '../../types'

let nvim: Neovim
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
})

afterAll(async () => {
  await helper.shutdown()
})

async function create(): Promise<FloatBuffer> {
  return new FloatBuffer(nvim)
}

describe('FloatBuffer', () => {

  it('should get code fragment #1', async () => {
    let buf = await create()
    let fragment: Fragment = {
      filetype: 'markdown',
      lines: [
        '``` js',
        'let foo = 5',
        '```',
        'bar'
      ],
      start: 1
    }
    let res = buf.splitFragment(fragment, 'js')
    expect(res.length).toBe(2)
    expect(res[0].lines).toEqual(['let foo = 5'])
    expect(res[0].start).toEqual(1)
    expect(res[1].lines).toEqual(['bar'])
  })

  it('should get code fragment #2', async () => {
    let buf = await create()
    let fragment: Fragment = {
      filetype: 'markdown',
      lines: [
        'abc',
        '```',
        '```',
        'bar'
      ],
      start: 1
    }
    let res = buf.splitFragment(fragment, 'js')
    expect(res.length).toBe(2)
  })

  it('should get code fragment #3', async () => {
    let buf = await create()
    let fragment: Fragment = {
      filetype: 'markdown',
      lines: [
        'abc',
        '``` ts',
        'let x = 3',
        '```',
        'bar'
      ],
      start: 1
    }
    let res = buf.splitFragment(fragment, 'typescript')
    expect(res.length).toBe(3)
  })

  it('should set documents', async () => {
    let buf = await create()
    let docs: Documentation[] = [{
      filetype: 'markdown',
      content: '# head\n**note**'
    }, {
      filetype: 'typescript',
      content: "class Foo",
      active: [0, 5]
    }]
    await buf.setDocuments(docs, 60)
    nvim.pauseNotification()
    let buffer = await nvim.createNewBuffer(false, false)
    buf.setLines(buffer.id)
    await nvim.resumeNotification()
    let lines = await buffer.lines
    expect(lines.length).toBe(4)
  })

  it('should set documents with code blocks', async () => {
    let buf = await create()
    let docs: Documentation[] = [{
      filetype: 'markdown',
      content: '# head\n**note**\n``` js\nconsole.log(3)\n```'
    }, {
      filetype: 'typescript',
      content: "class Foo",
      active: [0, 5]
    }]
    await buf.setDocuments(docs, 16)
    nvim.pauseNotification()
    let buffer = await nvim.createNewBuffer(false, false)
    buf.setLines(buffer.id)
    await nvim.resumeNotification()
    let lines = await buffer.lines
    expect(lines).toEqual([
      '# head',
      '**note**',
      'console.log(3)',
      '——————————————',
      'class Foo'
    ])
  })

  it('should get documents height & width', async () => {
    let docs: Documentation[] = [{
      filetype: 'markdown',
      content: '# head\n**note**\n``` js\nconsole.log(3)\n```'
    }, {
      filetype: 'typescript',
      content: "class Foo",
      active: [0, 5]
    }]
    let res = FloatBuffer.getDimension(docs, 100, 100)
    expect(res).toEqual({ width: 16, height: 5 })
  })

  it('should get documents width for multiple docs', async () => {
    let docs: Documentation[] = [
      {
        filetype: "typescript",
        content: "(method) JSON.stringify(value: any, replacer?: (this: any, key: string, value: any) => any, space?: string | number): string (+1 overload)"
      },
      {
        content: "Converts a JavaScript value to a JavaScript Object Notation (JSON) string.\n\n*@param* `value` — A JavaScript value, usually an object or array, to be converted.  \n\n*@param* `replacer` — A function that transforms the results.  \n\n*@param* `space` — Adds indentation, white space, and line break characters to the return-value JSON text to make it easier to read.",
        filetype: "markdown"
      }
    ]
    let res = FloatBuffer.getDimension(docs, 80, 100)
    expect(res).toEqual({ width: 80, height: 12 })
  })
})
