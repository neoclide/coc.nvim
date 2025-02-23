import { Neovim } from '@chemzqm/neovim'
import Highlighter from '../../model/highlighter'
import helper from '../helper'

let nvim: Neovim
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
})

afterAll(async () => {
  await helper.shutdown()
})

describe('Highlighter', () => {

  let highlighter: Highlighter
  beforeEach(() => {
    highlighter = new Highlighter()
  })

  it('should add line', () => {
    highlighter.addLine('foo', 'Comment')
    expect(highlighter.getline(0)).toBe('foo')
    expect(highlighter.getline(2)).toBe('')
    expect(highlighter.highlights).toEqual([{ lnum: 0, colStart: 0, colEnd: 3, hlGroup: 'Comment' }])
    expect(highlighter.content).toBe('foo')
  })

  it('should add lines', () => {
    highlighter.addLines(['foo', 'bar'])
    expect(highlighter.content).toBe('foo\nbar')
  })

  it('should parse ansi highlights', () => {
    const redOpen = '\x1B[31m'
    const redClose = '\x1B[39m'
    highlighter.addLine(redOpen + 'foo' + redClose + 'bar' + redOpen + redClose)
    expect(highlighter.content).toBe('foobar')
  })

  it('should add texts', () => {
    highlighter.addTexts([{ text: 'foo' }, { text: 'bar', hlGroup: 'Comment' }])
    highlighter.addText('')
    highlighter.addText(undefined)
    expect(highlighter.highlights).toEqual([{ lnum: 0, colStart: 3, colEnd: 6, hlGroup: 'Comment' }])
    expect(highlighter.content).toBe('foobar')
  })

  it('should render to buffer', async () => {
    let buf = await nvim.createNewBuffer(true, true)
    highlighter.addLine('foo', 'Comment')
    highlighter.addLine('bar')
    nvim.pauseNotification()
    highlighter.render(buf)
    await nvim.resumeNotification()
    let lines = await buf.lines
    expect(lines).toEqual(['foo', 'bar'])
  })
})

