import { Neovim } from '@chemzqm/neovim'
import { Disposable } from 'vscode-languageserver-protocol'
import { disposeAll } from '../../util'
import helper from '../helper'

let nvim: Neovim
let disposables: Disposable[] = []
jest.setTimeout(30000)

beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  await helper.reset()
  disposeAll(disposables)
  disposables = []
})

describe('document model properties', () => {
  it('should parse iskeyword', async () => {
    let doc = await helper.createDocument('foo')
    await nvim.setLine('foo bar')
    await helper.wait(100)
    let words = doc.words
    expect(words).toEqual(['foo', 'bar'])
  })

  it('should parse iskeyword of character range', async () => {
    await nvim.setOption('iskeyword', 'a-z,A-Z,48-57,_')
    let doc = await helper.createDocument('foo')
    let opt = await nvim.getOption('iskeyword')
    expect(opt).toBe('a-z,A-Z,48-57,_')
    await nvim.setLine('foo bar')
    doc.forceSync()
    await helper.wait(100)
    let words = doc.words
    expect(words).toEqual(['foo', 'bar'])
  })
})
