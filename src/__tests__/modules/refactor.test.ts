import { Neovim } from '@chemzqm/neovim'
import fs from 'fs'
import helper from '../helper'
import { URI } from 'vscode-uri'
import Refactor, { FileItem } from '../../handler/refactor'
import { Range } from 'vscode-languageserver-types'
import Document from '../../model/document'

let nvim: Neovim
let refactor: Refactor

beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  refactor = new Refactor()
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  await helper.reset()
})

describe('refactor#getFileChanges', () => {
  it('should get changes #1', async () => {
    let lines = `
Save current buffer to make changes
\u3000
\u3000
\u3000a.ts:1:2
    })
  } `
    let doc = await helper.createDocument()
    await doc.buffer.setLines(lines.split(/\n/), { start: 0, end: -1, strictIndexing: false })
    let changes = await refactor.getFileChanges(doc.buffer)
    expect(changes).toEqual([{ filepath: 'a.ts', lines: ['    })', '  } '], start: 0, end: 2 }])
  })

  it('should get changes #2', async () => {
    let lines = `
\u3000a.ts:1:2
    })
  } `
    let doc = await helper.createDocument()
    await doc.buffer.setLines(lines.split(/\n/), { start: 0, end: -1, strictIndexing: false })
    let changes = await refactor.getFileChanges(doc.buffer)
    expect(changes).toEqual([{ filepath: 'a.ts', lines: ['    })', '  } '], start: 0, end: 2 }])
  })

  it('should get changes #3', async () => {
    let lines = `
\u3000a.ts:1:2
    })
  }
\u3000`
    let doc = await helper.createDocument()
    await doc.buffer.setLines(lines.split(/\n/), { start: 0, end: -1, strictIndexing: false })
    let changes = await refactor.getFileChanges(doc.buffer)
    expect(changes).toEqual([{ filepath: 'a.ts', lines: ['    })', '  }'], start: 0, end: 2 }])
  })

  it('should get changes #4', async () => {
    let lines = `
\u3000a.ts:1:1
foo
\u3000b.ts:2:2
bar
\u3000`
    let doc = await helper.createDocument()
    await doc.buffer.setLines(lines.split(/\n/), { start: 0, end: -1, strictIndexing: false })
    let changes = await refactor.getFileChanges(doc.buffer)
    expect(changes).toEqual([
      { filepath: 'a.ts', lines: ['foo'], start: 0, end: 1 },
      { filepath: 'b.ts', lines: ['bar'], start: 1, end: 2 }
    ])
  })
})

describe('Refactor#createRefactorBuffer', () => {
  it('should create refactor buffer', async () => {
    let winid = await nvim.call('win_getid')
    await refactor.createRefactorBuffer(winid)
    let curr = await nvim.call('win_getid')
    expect(curr).toBeGreaterThan(winid)
  })

  it('should jump to position by <CR>', async () => {
    let winid = await nvim.call('win_getid')
    let buf = await refactor.createRefactorBuffer(winid)
    let fileItem: FileItem = {
      filepath: __filename,
      ranges: [{ start: 10, end: 11 }, { start: 15, end: 20 }]
    }
    await refactor.addFileItems([fileItem], buf)
    await nvim.call('cursor', [5, 1])
    await nvim.input('<CR>')
    await helper.wait(300)
    let line = await nvim.eval('line(".")')
    let bufname = await nvim.eval('bufname("%")')
    expect(bufname).toMatch('refactor.test.ts')
    expect(line).toBe(11)
  })
})

describe('Refactor#saveRefactor', () => {
  it('should not save when no change made', async () => {
    let winid = await nvim.call('win_getid')
    let buf = await refactor.createRefactorBuffer(winid)
    let fileItem: FileItem = {
      filepath: __filename,
      ranges: [{ start: 10, end: 11 }, { start: 15, end: 20 }]
    }
    await refactor.addFileItems([fileItem], buf)
    let res = await refactor.saveRefactor(buf.id)
    expect(res).toBe(false)
  })

  it('should sync buffer change to file', async () => {
    let doc = await helper.createDocument()
    await doc.buffer.replace(['foo', 'bar', 'line'], 0)
    await helper.wait(30)
    let filename = URI.parse(doc.uri).fsPath
    let fileItem: FileItem = {
      filepath: filename,
      ranges: [{ start: 0, end: 2 }]
    }
    let winid = await nvim.call('win_getid')
    let buf = await refactor.createRefactorBuffer(winid)
    await refactor.addFileItems([fileItem], buf)
    await nvim.call('setline', [5, 'changed'])
    let res = await refactor.saveRefactor(buf.id)
    expect(res).toBe(true)
    expect(fs.existsSync(filename)).toBe(true)
    let content = fs.readFileSync(filename, 'utf8')
    let lines = content.split('\n')
    expect(lines).toEqual(['changed', 'bar', 'line', ''])
    fs.unlinkSync(filename)
  })
})
