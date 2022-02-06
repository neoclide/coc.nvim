import { Neovim } from '@chemzqm/neovim'
import events from '../../events'
import Documents from '../../core/documents'
import workspace from '../../workspace'
import helper from '../helper'

let documents: Documents
let nvim: Neovim

beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  documents = workspace.documentsManager
})

afterEach(async () => {
  await helper.reset()
})

afterAll(async () => {
  await helper.shutdown()
})

describe('documents', () => {
  it('should get document', async () => {
    await helper.createDocument('bar')
    let doc = await helper.createDocument('foo')
    let res = documents.getDocument(doc.uri)
    expect(res.uri).toBe(doc.uri)
  })

  it('should get bufnrs', async () => {
    await workspace.document
    let bufnrs = documents.bufnrs
    expect(bufnrs.length).toBe(1)
  })

  it('should get uri', async () => {
    let doc = await workspace.document
    expect(documents.uri).toBe(doc.uri)
  })

  it('should attach events on vim', async () => {
    await documents.attach(nvim, workspace.env)
    let env = Object.assign(workspace.env, { isVim: true })
    await documents.detach()
    await documents.attach(nvim, env)
    await documents.detach()
    await events.fire('CursorMoved', [1, [1, 1]])
  })
})
