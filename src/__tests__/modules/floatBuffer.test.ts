import FloatBuffer from '../../model/floatBuffer'
import helper from '../helper'
import { Neovim } from '@chemzqm/neovim'
import { Documentation } from '../../types'

let nvim: Neovim
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
})

afterAll(async () => {
  await helper.shutdown()
})

async function create(): Promise<FloatBuffer> {
  return new FloatBuffer(nvim, false)
}

describe('FloatBuffer', () => {

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
    buf.setDocuments(docs, 60)
    nvim.pauseNotification()
    let buffer = await nvim.createNewBuffer(false, false)
    buf.setLines(buffer.id, 0)
    await nvim.resumeNotification()
    let lines = await buffer.lines
    expect(lines.length).toBe(4)
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
})
