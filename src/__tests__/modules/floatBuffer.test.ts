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
  let buf = await nvim.createNewBuffer(false, false)
  return new FloatBuffer(nvim, buf)
}

describe('FloatBuffer', () => {

  it('should get highlight', async () => {
    let buf = await create()
    let docs: Documentation[] = [{
      filetype: 'markdown',
      content: 'f'.repeat(81)
    }, {
      filetype: 'markdown',
      content: 'b'.repeat(81)
    }]
    let height = buf.getHeight(docs, 80)
    expect(height).toBe(5)
  })

  it('should get highlight with code block', async () => {
    let buf = await create()
    let docs: Documentation[] = [{
      filetype: 'markdown',
      content: '``` js\nlet x = 1;\n```'
    }]
    let height = buf.getHeight(docs, 80)
    expect(height).toBe(1)
  })

  it('should be valid', async () => {
    let buf = await create()
    let valid = await buf.valid
    expect(valid).toBe(true)
  })

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
    buf.setLines()
    await nvim.resumeNotification()
    let lines = await buf.buffer.lines
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
    await buf.setDocuments(docs, 60)
    nvim.pauseNotification()
    buf.setLines()
    await nvim.resumeNotification()
    let lines = await buf.buffer.lines
    expect(lines).toEqual([
      '# head',
      '**note**',
      'console.log(3)',
      '——————————————',
      'class Foo'
    ])
  })
})
