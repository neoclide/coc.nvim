import { Neovim } from '@chemzqm/neovim'
import Editors, { TextEditor, renamed } from '../../core/editors'
import workspace from '../../workspace'
import window from '../../window'
import events from '../../events'
import helper from '../helper'
import { disposeAll } from '../../util'
import { Disposable } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'

let editors: Editors
let nvim: Neovim
let disposables: Disposable[] = []

beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  editors = workspace.editors
})

afterEach(async () => {
  await helper.reset()
})

afterAll(async () => {
  disposeAll(disposables)
  await helper.shutdown()
})

describe('util', () => {
  it('should check renamed', async () => {
    await helper.edit('foo')
    let editor = editors.activeTextEditor
    expect(renamed(editor, {
      bufnr: 0,
      fullpath: '',
      tabid: 1,
      winid: 1000,
    })).toBe(false)
    expect(renamed(editor, {
      bufnr: editor.document.bufnr,
      fullpath: '',
      tabid: 1,
      winid: 1000,
    })).toBe(true)
    expect(renamed(editor, {
      bufnr: editor.document.bufnr,
      fullpath: URI.parse(editor.document.uri).fsPath,
      tabid: 1,
      winid: 1000,
    })).toBe(false)
    Object.assign(editor, { uri: 'lsp:///1' })
    expect(renamed(editor, {
      bufnr: editor.document.bufnr,
      fullpath: '',
      tabid: 1,
      winid: 1000,
    })).toBe(false)
  })
})

describe('editors', () => {

  function assertEditor(editor: TextEditor, tabpagenr: number, winid: number) {
    expect(editor).toBeDefined()
    expect(editor.tabpageid).toBe(tabpagenr)
    expect(editor.winid).toBe(winid)
  }

  it('should have active editor', async () => {
    let winid = await nvim.call('win_getid') as number
    let editor = window.activeTextEditor
    assertEditor(editor, 1, winid)
    let editors = window.visibleTextEditors
    expect(editors.length).toBe(1)
    workspace.editors.checkTabs([])
    workspace.editors.checkUnloadedBuffers([])
  })

  it('should create editor not created', async () => {
    await nvim.command(`edit +setl\\ buftype=nofile foo`)
    let doc = await workspace.document
    await nvim.command('setl buftype=')
    await events.fire('BufDetach', [doc.bufnr])
    await events.fire('CursorHold', [doc.bufnr])
    expect(window.activeTextEditor).toBeDefined()
    expect(window.visibleTextEditors.length).toBe(1)
  })

  it('should detect buffer rename', async () => {
    let doc = await helper.createDocument('foo')
    await doc.buffer.setName('bar')
    await events.fire('CursorHold', [doc.bufnr])
    expect(window.activeTextEditor).toBeDefined()
    expect(window.activeTextEditor.id).toMatch(/bar$/)
  })

  it('should detect buffer switch', async () => {
    let doc = await helper.createDocument('foo')
    await helper.createDocument('bar')
    await nvim.command('noa b ' + doc.bufnr)
    await events.fire('CursorHold', [doc.bufnr])
    expect(window.activeTextEditor).toBeDefined()
    expect(window.activeTextEditor.id).toMatch(/foo$/)
  })

  it('should change active editor on split', async () => {
    let promise = new Promise<TextEditor>(resolve => {
      editors.onDidChangeActiveTextEditor(e => {
        resolve(e)
      }, null, disposables)
    })
    await nvim.command('vnew')
    let editor = await promise
    let winid = await nvim.call('win_getid')
    expect(editor.winid).toBe(winid)
  })

  it('should change active editor on tabe', async () => {
    let promise = new Promise<TextEditor>(resolve => {
      editors.onDidChangeActiveTextEditor(e => {
        if (e.document.uri.includes('foo')) {
          resolve(e)
        }
      }, null, disposables)
    })
    await nvim.command('tabe a | tabe b | tabe foo')
    let editor = await promise
    let winid = await nvim.call('win_getid')
    expect(editor.winid).toBe(winid)
  })

  it('should change active editor on edit', async () => {
    await nvim.call('win_getid')
    let n = 0
    let promise = new Promise<TextEditor>(resolve => {
      window.onDidChangeVisibleTextEditors(() => {
        n++
      }, null, disposables)
      editors.onDidChangeActiveTextEditor(e => {
        n++
        resolve(e)
      })
    })
    await nvim.command('edit foo')
    let editor = await promise
    expect(editor.document.uri).toMatch('foo')
    await helper.waitValue(() => {
      return n
    }, 2)
  })

  it('should change active editor on window switch', async () => {
    let winid = await nvim.call('win_getid')
    await nvim.command('vs foo')
    await nvim.command('wincmd p')
    let curr = editors.activeTextEditor
    expect(curr.winid).toBe(winid)
    expect(editors.visibleTextEditors.length).toBe(2)
  })

  it('should cleanup on CursorHold', async () => {
    let promise = new Promise<TextEditor>(resolve => {
      editors.onDidChangeActiveTextEditor(e => {
        if (e.document.uri.includes('foo')) {
          resolve(e)
        }
      }, null, disposables)
    })
    await nvim.command('sp foo')
    await promise
    await nvim.command('noa close')
    let bufnr = await nvim.eval("bufnr('%')")
    await events.fire('CursorHold', [bufnr])
    expect(editors.visibleTextEditors.length).toBe(1)
  })

  it('should cleanup on create', async () => {
    let winid = await nvim.call('win_getid')
    let promise = new Promise<TextEditor>(resolve => {
      editors.onDidChangeActiveTextEditor(e => {
        if (e.document.uri.includes('foo')) {
          resolve(e)
        }
      }, null, disposables)
    })
    await nvim.command('tabe foo')
    await promise
    await nvim.call('win_execute', [winid, 'noa close'])
    await nvim.command('edit bar')
  })

  it('should have current tabpageid after tab changed', async () => {
    await nvim.command('tabe|doautocmd CursorHold')
    await helper.waitValue(() => {
      return editors.visibleTextEditors.length
    }, 2)
    let ids: number[] = []
    editors.visibleTextEditors.forEach(editor => {
      ids.push(editor.tabpageid)
    })
    let editor = editors.visibleTextEditors[editors.visibleTextEditors.length - 1]
    let previousId = editor.tabpageid
    await nvim.command('normal! 1gt')
    await nvim.command('tabe')
    await helper.waitValue(() => {
      return editors.visibleTextEditors.length
    }, 3)
    expect(editor.tabpageid).toBe(previousId)
    let tid: number
    let disposable = editors.onDidTabClose(id => {
      tid = id
    })
    await nvim.command('tabc')
    await helper.waitValue(() => {
      return editors.visibleTextEditors.length
    }, 2)
    disposable.dispose()
    expect(editor.tabpageid).toBe(previousId)
    expect(tid).toBeDefined()
    editor = editors.visibleTextEditors.find(o => o.tabpageid == tid)
    expect(editor).toBeUndefined()
  })
})
