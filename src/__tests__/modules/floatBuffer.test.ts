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
  return new FloatBuffer(buf, nvim, 1000)
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

  it('should be valid', async () => {
    let buf = await create()
    let valid = await buf.valid
    expect(valid).toBe(true)
  })

  it('should get highlightOffset & height', async () => {
    let buf = await create()
    let offset = buf.highlightOffset
    expect(offset).toBe(0)
    expect(buf.height).toBe(0)
  })

  it('should get code fragment', async () => {
    let buf = await create()
    let fragment: Fragment = {
      filetype: 'markdown',
      lines: [
        '',
        '``` js',
        'let foo = 5',
        '```',
        ''
      ],
      start: 1
    }
    let res = buf.getCodeFragments(fragment)
    expect(res.length).toBe(1)
    expect(res[0].lines).toEqual(['let foo = 5'])
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
})
