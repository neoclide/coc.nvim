import { Neovim } from '@chemzqm/neovim'
import Refactor from '../../handler/refactor'
import Search from '../../handler/search'
import helper from '../helper'
import path from 'path'

let nvim: Neovim
let refactor: Refactor
let cmd = path.resolve(__dirname, '../rg')
let cwd = process.cwd()

beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
})

beforeEach(async () => {
  refactor = new Refactor()
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  if (refactor) {
    refactor.dispose()
  }
  await helper.reset()
})

describe('search', () => {

  it('should open refactor window', async () => {
    let search = new Search(nvim, cmd)
    await refactor.createRefactorBuffer()
    await search.run([], cwd, refactor)
    let fileItems = (refactor as any).fileItems
    expect(fileItems.length).toBe(2)
    expect(fileItems[0].ranges.length).toBe(2)
  })

  it('should fail on invalid command', async () => {
    let search = new Search(nvim, 'rrg')
    await refactor.createRefactorBuffer()
    let err
    try {
      await search.run([], cwd, refactor)
    } catch (e) {
      err = e
    }
    expect(err).toBeDefined()
  })
})
