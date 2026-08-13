import * as shared from '../sharedUtil'
import { Neovim } from '@chemzqm/neovim'
import { Disposable } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import events from '../../events'
import { ProviderResult } from '../../provider'
import { TreeDataProvider, TreeViewOptions } from '../../tree'
import BasicDataProvider, { ProviderOptions, TreeNode } from '../../tree/BasicDataProvider'
import { getItemLabel, TreeItem, TreeItemCollapsibleState } from '../../tree/TreeItem'
import TreeView from '../../tree/TreeView'
import { disposeAll } from '../../util'
import workspace from '../../workspace'
import window from '../../window'
import { createNodes } from '../unit/testUtils'
import type { NodeDef } from '../unit/testUtils'

let nvim: Neovim
let disposables: Disposable[] = []
let treeView: TreeView<TreeNode>
let provider: BasicDataProvider<TreeNode>
let nodes: TreeNode[]
before(async () => {
  nvim = workspace.nvim
})

beforeEach(async () => {
  await shared.createDocument()
})

afterEach(async () => {
  if (provider) provider.dispose()
  if (treeView) treeView.dispose()
  disposeAll(disposables)
  // Disposal must complete before the outer suite resets the editor for the
  // next test: treeView.dispose() bwipeout's its (unlisted) buffer via
  // notification, while reset's %bwipeout! skips unlisted buffers.
})

function createNode(label: string, children?: TreeNode[], key?: string, tooltip?: string): TreeNode {
  let res: TreeNode = { label }
  if (children) res.children = children
  if (tooltip) res.tooltip = tooltip
  if (key) res.key = key
  return res
}

function createTreeView(defs: NodeDef[], opts: Partial<TreeViewOptions<TreeNode>> = {}, providerOpts: Partial<ProviderOptions<TreeNode>> = {}) {
  nodes = createNodes(defs)
  provider = new BasicDataProvider(Object.assign(providerOpts, {
    provideData: () => {
      return nodes
    }
  }))
  treeView = new TreeView('test', Object.assign(opts, {
    bufhidden: 'hide',
    treeDataProvider: provider
  }))
}

function updateData(defs: NodeDef[], reset = false) {
  nodes = createNodes(defs)
  provider.update(nodes, reset)
}

function makeUpdateUIThrowError(t: any) {
  t.mock.method(treeView as any, 'updateUI', () => {
    throw new Error('Test error')
  })
}

let defaultDef: NodeDef[] = [
  ['a', [['c'], ['d']]],
  ['b', [['e'], ['f']]],
  ['g']
]

async function checkLines(arr: string[]): Promise<void> {
  await shared.waitValue(async () => {
    return await nvim.call('getline', [1, '$'])
  }, arr)
}

afterEach(editorReset)

describe('TreeView', () => {
  describe('TreeItem()', () => {
    it('should create TreeItem from resourceUri', async t => {
      let item = new TreeItem(URI.file('/foo/bar.ts'))
      assert.notStrictEqual(item.resourceUri, undefined)
      assert.strictEqual(item.label, 'bar.ts')
      assert.notStrictEqual(item.label, undefined)
    })

    it('should get item label', async t => {
      let item = new TreeItem({ label: 'foo' }, TreeItemCollapsibleState.None)
      assert.strictEqual(getItemLabel(item), 'foo')
    })
  })

  describe('show()', () => {
    it('should show with title', async t => {
      createTreeView(defaultDef)
      assert.notStrictEqual(treeView, undefined)
      assert.strictEqual(treeView.visible, false)
      assert.strictEqual(await treeView.checkLines(), false)
      await treeView.show()
      let visible = treeView.visible
      assert.strictEqual(visible, true)
      await checkLines(['test', '+ a', '+ b', '  g'])
      treeView.registerLocalKeymap('n', undefined, () => {})
      let called = false
      treeView.registerLocalKeymap('n', 'p', () => {
        called = true
      }, false)
      await shared.wait(30)
      await nvim.input('p')
      await shared.waitValue(() => called, true)
    })

    it('should not show when visible', async t => {
      createTreeView(defaultDef)
      await treeView.show()
      let windowId = treeView.windowId
      await treeView.show()
      assert.strictEqual(treeView.windowId, windowId)
    })

    it('should reuse window', async t => {
      createTreeView(defaultDef)
      await treeView.show()
      let windowId = treeView.windowId
      provider.dispose()
      createTreeView(defaultDef)
      await treeView.show()
      assert.strictEqual(treeView.windowId, windowId)
    })

    it('should render item icon', async t => {
      createTreeView(defaultDef)
      nodes[0].icon = { text: 'i', hlGroup: 'Title' }
      nodes[1].icon = { text: 'i', hlGroup: 'Title' }
      nodes[2].icon = { text: 'i', hlGroup: 'Title' }
      await treeView.show()
      await checkLines(['test', '+ i a', '+ i b', '  i g'])
    })
  })

  describe('configuration', () => {
    it('should change open close icon', async t => {
      createTreeView(defaultDef)
      await treeView.show()
      let { configurations } = workspace
      configurations.updateMemoryConfig({
        'tree.openedIcon': '',
        'tree.closedIcon': '',
      })
      await checkLines(['test', ' a', ' b', '  g'])
    })
  })

  describe('events', () => {
    function waitVisibilityEvent(visible: boolean): Promise<void> {
      return new Promise((resolve, reject) => {
        let timer = setTimeout(() => {
          disposable.dispose()
          reject(new Error('event not fired after 2s'))
        }, 2000)
        let disposable = treeView.onDidChangeVisibility(e => {
          clearTimeout(timer)
          assert.strictEqual(e.visible, visible)
          disposable.dispose()
          resolve(undefined)
        })
      })
    }

    it('should emit visibility change event', async t => {
      createTreeView(defaultDef)
      let p = waitVisibilityEvent(true)
      await treeView.show()
      await p
      nvim.command('close', true)
      await waitVisibilityEvent(false)
      p = waitVisibilityEvent(true)
      await treeView.show()
      await p
      nvim.command('enew', true)
      await waitVisibilityEvent(false)
      p = waitVisibilityEvent(true)
      await treeView.show()
      await p
    })

    it('should dispose on tab close', async t => {
      await nvim.command('tabe')
      await nvim.command('tabe')
      createTreeView(defaultDef)
      await treeView.show()
      await nvim.command('close')
      await nvim.command('normal! 2gt')
      await nvim.command('close')
      await nvim.command('normal! 1gt')
      await nvim.command('tabonly')
      await shared.waitValue(() => {
        return treeView.valid
      }, false)
    })

    it('should registerLocalKeymap before shown', async t => {
      createTreeView(defaultDef)
      let called = false
      treeView.registerLocalKeymap('n', 'p', () => {
        called = true
      }, true)
      await treeView.show()
      await events.race(['TextChanged'], 50)
      await nvim.input('p')
      await shared.waitValue(() => {
        return called
      }, true)
    })
  })

  describe('public properties', () => {
    it('should change title', async t => {
      createTreeView(defaultDef)
      treeView.title = 'foo'
      await treeView.show()
      await checkLines(['foo', '+ a', '+ b', '  g'])
      treeView.title = 'bar'
      await events.race(['TextChanged'], 50)
      await checkLines(['bar', '+ a', '+ b', '  g'])
      treeView.title = undefined
      await events.race(['TextChanged'], 50)
    })

    it('should change description', async t => {
      createTreeView(defaultDef)
      treeView.description = 'desc'
      await treeView.show()
      await checkLines(['test desc', '+ a', '+ b', '  g'])
      treeView.description = 'foo bar'
      await events.race(['TextChanged'], 50)
      await checkLines(['test foo bar', '+ a', '+ b', '  g'])
      treeView.description = ''
      await events.race(['TextChanged'], 50)
      await checkLines(['test', '+ a', '+ b', '  g'])
    })

    it('should change message', async t => {
      createTreeView(defaultDef)
      treeView.message = 'hello'
      await treeView.show()
      await checkLines(['hello', '', 'test', '+ a', '+ b', '  g'])
      treeView.message = 'foo'
      await events.race(['TextChanged'], 50)
      await checkLines(['foo', '', 'test', '+ a', '+ b', '  g'])
      treeView.message = undefined
      await events.race(['TextChanged'], 50)
      await checkLines(['test', '+ a', '+ b', '  g'])
    })
  })

  describe('options', () => {
    it('should disable winfixwidth', async t => {
      createTreeView(defaultDef, { winfixwidth: false })
      await treeView.show()
      let res = await nvim.eval('&winfixwidth')
      assert.strictEqual(res, 0)
    })

    it('should disable leaf indent', async t => {
      createTreeView(defaultDef, { disableLeafIndent: true })
      await treeView.show()
      await checkLines(['test', '+ a', '+ b', 'g'])
    })

    it('should should adjust window width', async t => {
      let def: NodeDef[] = [
        ['a', [['c'], ['d']]],
        ['very long line']
      ]
      createTreeView(def, { autoWidth: true })
      await treeView.show('belowright 10vs')
      let width = await nvim.call('winwidth', [0])
      assert.ok(Number(width) > 10)
      assert.notStrictEqual(treeView.targetWinId, undefined)
    })

    it('should support many selection', async t => {
      createTreeView(defaultDef, { canSelectMany: true })
      await treeView.show()
      let selection: TreeNode[]
      treeView.onDidChangeSelection(e => {
        selection = e.selection
      })
      await nvim.command('exe 1')
      await nvim.input('<space>')
      await shared.wait(20)
      await nvim.command('exe 2')
      await nvim.input('<space>')
      await shared.waitValue(() => {
        return selection?.length
      }, 1)
      await nvim.command('exe 3')
      await nvim.input('<space>')
      await shared.waitValue(() => {
        return selection?.length
      }, 2)
      await nvim.input('<space>')
      await shared.waitValue(() => {
        return selection.length
      }, 1)
      let buf = await nvim.buffer
      let res = await nvim.call('sign_getplaced', [buf.id, { group: 'CocTree' }])
      let signs = res[0].signs
      assert.strictEqual(treeView.selection.length, 1)
      assert.strictEqual(signs.length, 1)
      assert.deepStrictEqual(signs[0], {
        lnum: 2,
        id: 3001,
        name: 'CocTreeSelected',
        priority: 10,
        group: 'CocTree'
      })
    })
  })

  describe('key-mappings', () => {
    async function getSingns() {
      let buf = await nvim.buffer
      let res = await nvim.call('sign_getplaced', [buf.id, { group: 'CocTree' }])
      return res[0].signs.length
    }

    it('should jump back by <C-o>', async t => {
      let winid = await nvim.call('win_getid')
      createTreeView(defaultDef)
      await treeView.show()
      await shared.wait(30)
      await nvim.input('<C-o>')
      await shared.waitValue(() => {
        return nvim.call('win_getid', [])
      }, winid)
    })

    it('should toggle selection by <space>', async t => {
      createTreeView(defaultDef)
      await treeView.show()
      let selection: TreeNode[]
      treeView.onDidChangeSelection(e => {
        selection = e.selection
      })
      await nvim.command('exe 1')
      await nvim.input('<space>')
      await shared.wait(20)
      await nvim.command('exe 2')
      await nvim.input('<space>')
      await shared.waitValue(() => selection?.length, 1)
      await nvim.command('exe 3')
      await nvim.input('<space>')
      await shared.waitValue(async () => {
        return await getSingns()
      }, 1)
      await nvim.input('<space>')
      await shared.waitValue(async () => {
        return await getSingns()
      }, 0)
    })

    it('should reset signs after expand & collapse', async t => {
      createTreeView(defaultDef)
      await treeView.show()
      await nvim.command('exe 2')
      await nvim.input('t')
      await checkLines([
        'test',
        '- a',
        '    c',
        '    d',
        '+ b',
        '  g',
      ])
      await nvim.command('exe 3')
      await nvim.input('<space>')
      await shared.waitValue(() => {
        return getSingns()
      }, 1)
      await nvim.command('exe 2')
      await nvim.input('t')
      await shared.waitValue(() => {
        return getSingns()
      }, 0)
      await nvim.input('t')
      await shared.waitValue(() => {
        return getSingns()
      }, 1)
    })

    it('should close tree view by close key', async t => {
      shared.updateConfiguration('tree.key.close', 'c')
      createTreeView(defaultDef)
      await treeView.show()
      await shared.wait(30)
      assert.strictEqual(treeView.visible, true)
      await nvim.input('c')
      await shared.waitValue(() => treeView.visible, false)
    })

    it('should invoke command by <cr>', async t => {
      let node: TreeNode
      createTreeView(defaultDef, {}, {
        handleClick: n => {
          node = n
        }
      })
      await treeView.show()
      await treeView.invokeCommand(undefined)
      await nvim.input('<cr>')
      await shared.waitValue(() => node, undefined)
      await nvim.command('exe 2')
      await nvim.input('<cr>')
      await shared.waitValue(() => node && node.label, 'a')
    })

    it('should not throw when resolve command cancelled', async t => {
      let node: TreeNode
      let cancelled = false
      createTreeView(defaultDef, {}, {
        handleClick: n => {
          node = n
        },
        resolveItem: (item, _node, token) => {
          return new Promise(resolve => {
            let timer = setTimeout(() => {
              item.command = {
                title: 'not exists',
                command: 'test'
              }
              resolve(item)
            }, 5000)
            token.onCancellationRequested(() => {
              cancelled = true
              clearTimeout(timer)
              resolve(item)
            })
          })
        }
      })
      await treeView.show()
      await nvim.command('exe 2')
      let spy = t.mock.method(console, 'error', () => {
        // noop
      })
      await nvim.input('<cr>')
      await shared.wait(20)
      await nvim.command('exe 1')
      await shared.waitValue(() => cancelled, true)
      assert.strictEqual(node, undefined)
    })

    it('should toggle expand by t', async t => {
      createTreeView(defaultDef)
      let c = nodes[0].children[0]
      c.children = [createNode('h')]
      await treeView.show()
      await nvim.command('exe 1')
      await nvim.input('t')
      await shared.wait(20)
      await nvim.command('exe 3')
      await nvim.input('t')
      await shared.wait(20)
      await nvim.command('exe 2')
      await nvim.input('t')
      await checkLines([
        'test', '- a', '  + c', '    d', '- b', '    e', '    f', '  g'
      ])
      await nvim.command('exe 2')
      await nvim.input('t')
      await checkLines([
        'test', '+ a', '- b', '    e', '    f', '  g'
      ])
    })

    it('should should collapse parent node by t', async t => {
      createTreeView(defaultDef)
      await treeView.show()
      await nvim.command('exe 2')
      await nvim.input('t')
      await checkLines([
        'test',
        '- a',
        '    c',
        '    d',
        '+ b',
        '  g',
      ])
      await nvim.command('exe 3')
      await nvim.input('t')
      await checkLines([
        'test',
        '+ a',
        '+ b',
        '  g',
      ])
    })

    it('should collapse all nodes by M', async t => {
      createTreeView(defaultDef)
      let c = nodes[0].children[0]
      c.children = [createNode('h')]
      await treeView.show()
      await shared.wait(50)
      await nvim.command('exe 2')
      await nvim.input('t')
      await shared.wait(50)
      await nvim.command('exe 3')
      await nvim.input('t')
      await shared.wait(50)
      await nvim.command('exe 6')
      await nvim.input('t')
      await checkLines([
        'test',
        '- a',
        '  - c',
        '      h',
        '    d',
        '- b',
        '    e',
        '    f',
        '  g',
      ])
      await nvim.input('M')
      await checkLines([
        'test',
        '+ a',
        '+ b',
        '  g',
      ])
      let res = await treeView.checkLines()
      assert.strictEqual(res, true)
    })

    it('should toggle expand on open/close icon click', async t => {
      createTreeView(defaultDef)
      await treeView.show()
      await nvim.call('cursor', [1, 1])
      await nvim.input('<LeftRelease>')
      await shared.wait(20)
      await nvim.call('cursor', [2, 1])
      await nvim.input('<LeftRelease>')
      await checkLines([
        'test',
        '- a',
        '    c',
        '    d',
        '+ b',
        '  g',
      ])
      await nvim.input('<LeftRelease>')
      await checkLines([
        'test',
        '+ a',
        '+ b',
        '  g',
      ])
      let res = await treeView.checkLines()
      assert.strictEqual(res, true)
    })

    it('should invoke command on node click', async t => {
      let node: TreeNode
      createTreeView(defaultDef, {}, {
        handleClick: n => {
          node = n
        }
      })
      await treeView.show()
      await nvim.call('cursor', [2, 3])
      await nvim.input('<LeftRelease>')
      await shared.waitValue(() => node != null, true)
      assert.strictEqual(node.label, 'a')
    })
  })

  describe('invokeActions', () => {
    it('should show warning when resolveActions does not exist', async t => {
      createTreeView(defaultDef)
      await treeView.show()
      await treeView.invokeActions(undefined)
      await nvim.call('cursor', [2, 3])
      await nvim.input('<tab>')
      await shared.waitValue(async () => {
        let cmdline = await shared.getCmdline()
        return cmdline.includes('No actions')
      }, true)
    })

    it('should show warning when resolveActions is empty', async t => {
      createTreeView(defaultDef, {}, {
        resolveActions: () => {
          return []
        }
      })
      await treeView.show()
      await nvim.call('cursor', [2, 3])
      await nvim.input('<tab>')
      await shared.waitValue(async () => {
        let cmdline = await shared.getCmdline()
        return cmdline.includes('No actions')
      }, true)
    })

    it('should invoke selected action', async t => {
      let args: any[]
      let called = false
      createTreeView(defaultDef, {}, {
        resolveActions: (item, element) => {
          args = [item, element]
          return [{
            title: 'one',
            handler: () => {
              called = true
            }
          }]
        }
      })
      await treeView.show()
      await nvim.call('cursor', [2, 3])
      await nvim.input('<tab>')
      t.mock.method(window, 'showPrompt', () => {
        return Promise.resolve(true)
      })
      await shared.wait(20)
      await nvim.input('<esc>')
      await shared.wait(20)
      await nvim.input('<tab>')
      await shared.waitFloat()
      await nvim.input('<cr>')
      await shared.waitValue(() => {
        return called
      }, true)
      assert.strictEqual(called, true)
      assert.strictEqual(args[0].label, 'a')
      assert.strictEqual(args[1].label, 'a')
    })
  })

  describe('events', () => {
    it('should emit visibility change on buffer unload', async t => {
      createTreeView(defaultDef)
      let visible
      treeView.onDidChangeVisibility(e => {
        visible = e.visible
      })
      await treeView.show()
      let buf = await nvim.buffer
      nvim.command(`bd! ${buf.id}`, true)
      await shared.waitValue(() => visible, false)
    })

    it('should show tooltip on CursorHold', async t => {
      let show = t.mock.fn()
      let factory = { show, dispose: t.mock.fn() } as any
      t.mock.method(window, 'createFloatFactory', () => factory)
      createTreeView(defaultDef, {}, {
        resolveItem: (item, node) => {
          if (node.label == 'a') {
            item.tooltip = 'first'
          }
          if (node.label == 'b') {
            item.tooltip = { kind: 'markdown', value: '#title' }
          }
          return item
        }
      })
      await treeView.show()
      let bufnr = (treeView as any).bufnr as number
      await events.fire('CursorHold', [bufnr, [2, 1]])
      assert.deepStrictEqual(show.mock.calls[0].arguments, [[{ filetype: 'txt', content: 'first' }]])
      await events.fire('CursorHold', [bufnr, [3, 1]])
      assert.deepStrictEqual(show.mock.calls[show.mock.calls.length - 1].arguments, [[{ filetype: 'markdown', content: '#title' }]])
    })
  })

  describe('data change', () => {
    it('should ignore hidden node change', async t => {
      createTreeView(defaultDef)
      await treeView.show()
      let tick = await nvim.eval('b:changedtick')
      updateData([
        ['a', [['c', [['h']]], ['d']]],
        ['b', [['e'], ['f']]],
        ['g']
      ])
      await shared.wait(20)
      let curr = await nvim.eval('b:changedtick')
      assert.strictEqual(curr, tick)
    })

    it('should render all nodes on root change', async t => {
      createTreeView(defaultDef)
      await treeView.show()
      updateData([
        ['g'],
        ['h'],
        ['b', [['e'], ['f']]],
        ['a', [['c'], ['d']]]
      ])
      await checkLines([
        'test',
        '  g',
        '  h',
        '+ b',
        '+ a',
      ])
      let res = await treeView.checkLines()
      assert.strictEqual(res, true)
    })

    it('should keep node open state', async t => {
      createTreeView(defaultDef)
      let c = nodes[0].children[0]
      c.children = [createNode('h')]
      await treeView.show()
      await nvim.command('exe 2')
      await nvim.input('t')
      await shared.wait(50)
      await nvim.command('exe 3')
      await nvim.input('t')
      await shared.wait(50)
      await nvim.command('exe 6')
      await nvim.input('t')
      await shared.wait(50)
      updateData([
        ['h'],
        ['g', [['i']]],
        ['b', [['f']]],
        ['a', [['c'], ['j']]]
      ])
      await checkLines([
        'test',
        '  h',
        '+ g',
        '- b',
        '    f',
        '- a',
        '    c',
        '    j',
      ])
      let res = await treeView.checkLines()
      assert.strictEqual(res, true)
    })

    it('should render changed nodes', async t => {
      createTreeView(defaultDef)
      await treeView.show()
      await nvim.command('exe 2')
      await nvim.input('t')
      await events.race(['TextChanged'])
      updateData([
        ['a', [['h', [['i']]], ['d']]],
        ['b', [['e'], ['f']]],
        ['g'],
      ])
      await checkLines([
        'test',
        '- a',
        '  + h',
        '    d',
        '+ b',
        '  g',
      ])
      let res = await treeView.checkLines()
      assert.strictEqual(res, true)
    })

    it('should error message on error', async t => {
      createTreeView(defaultDef)
      await treeView.show()
      await nvim.command('exe 2')
      await nvim.input('t')
      await events.race(['TextChanged'])
      let msg = 'Unable to fetch children'
      provider.getChildren = () => {
        throw new Error(msg)
      }
      updateData([['a']])
      await events.race(['TextChanged'])
      let line = await nvim.call('getline', [1])
      assert.match(String(line), new RegExp(msg))
      await shared.waitValue(() => treeView.checkLines(), true)
      let res = await treeView.checkLines()
      assert.strictEqual(res, true)
    })

    it('should reset message when data exists', async t => {
      createTreeView([])
      let curr = []
      provider.getChildren = () => {
        return Promise.resolve(curr)
      }
      await treeView.show()
      await checkLines([
        'No results',
        '',
        'test',
      ])
      curr = [createNode('h')]
      await treeView.render()
      await checkLines([
        'test',
        '  h',
      ])
    })

    it('should show error message on refresh error', async t => {
      createTreeView(defaultDef)
      await treeView.show()
      makeUpdateUIThrowError(t)
      updateData([
        ['a', [['h'], ['d']]],
        ['b', [['e'], ['f']]],
        ['g'],
      ])
      await shared.waitValue(async () => {
        let line = await shared.getCmdline()
        return line.includes('Error on tree refresh')
      }, true)
    })

    it('should render deprecated node with deprecated highlight', async t => {
      createTreeView(defaultDef)
      await treeView.show()
      let defs: NodeDef[] = [
        ['a'],
        ['b']
      ]
      let nodes = createNodes(defs)
      nodes[0].deprecated = true
      provider.update(nodes)
      await checkLines([
        'test',
        '  a',
        '  b',
      ])
      let ns = await nvim.call('coc#highlight#create_namespace', ['tree'])
      let bufnr = await nvim.call('bufnr', ['%'])
      let markers = await nvim.call('nvim_buf_get_extmarks', [bufnr, ns, [1, 0], [1, -1], { details: true }]) as any[]
      assert.strictEqual(markers.length > 0, true)
      assert.strictEqual(markers[0][3]['hl_group'], 'CocDeprecatedHighlight')
    })

    it('should not throw when getTreeItem return undefined', async t => {
      let provider: TreeDataProvider<any> = {
        getTreeItem: (): TreeItem => {
          return undefined
        },
        getChildren: (): ProviderResult<readonly any[]> => {
          return [{ label: 'a' }]
        }
      }
      let treeView = new TreeView('test', {
        bufhidden: 'hide',
        treeDataProvider: provider
      })
      await treeView.show()
      await checkLines([
        'test',
      ])
      treeView.dispose()
    })
  })

  describe('focusItem()', () => {
    it('should not throw when node not rendered', async t => {
      createTreeView(defaultDef)
      treeView.selectItem(undefined)
      treeView.focusItem(nodes[0])
      treeView.unselectItem(999)
      await treeView.show()
      let c = nodes[0].children[0]
      await treeView.onHover(3)
      treeView.focusItem(c)
      treeView.focusItem(undefined)
    })

    it('should focus rendered node', async t => {
      createTreeView(defaultDef)
      await treeView.show()
      treeView.focusItem(nodes[1])
      let line = await nvim.call('getline', ['.'])
      assert.strictEqual(line, '+ b')
    })
  })

  describe('reveal()', () => {
    it('should throw error when getParent does not exist', async t => {
      createTreeView(defaultDef)
      provider.getParent = undefined
      await treeView.show()
      let err
      try {
        await treeView.reveal(nodes[0].children[0])
      } catch (e) {
        err = e
      }
      assert.notStrictEqual(err, undefined)
    })

    it('should select item', async t => {
      createTreeView(defaultDef)
      let c = nodes[0].children[0]
      let h = createNode('h')
      c.children = [h]
      await treeView.show()
      await treeView.reveal(h, { expand: true })
      await checkLines([
        'test',
        '- a',
        '  - c',
        '      h',
        '    d',
        '+ b',
        '  g',
      ])
      let selection = treeView.selection
      assert.strictEqual(selection.length, 1)
      assert.strictEqual(selection[0].label, 'h')
      let line = await nvim.call('getline', ['.'])
      assert.match(String(line), new RegExp('h'))
    })

    it('should not select item', async t => {
      createTreeView(defaultDef)
      await treeView.show()
      await treeView.reveal(nodes[1], { select: false })
      let lnum = await nvim.call('line', ['.'])
      assert.strictEqual(lnum, 1)
    })

    it('should focus item', async t => {
      createTreeView(defaultDef)
      await treeView.show()
      await treeView.reveal(nodes[1], { focus: true })
      let line = await nvim.call('getline', ['.'])
      assert.match(String(line), new RegExp('b'))
    })

    it('should expand item which single level', async t => {
      createTreeView(defaultDef)
      let c = nodes[0].children[0]
      c.children = [createNode('h')]
      await treeView.show()
      await treeView.reveal(nodes[0], { expand: true })
      await checkLines([
        'test',
        '- a',
        '  + c',
        '    d',
        '+ b',
        '  g',
      ])
    })

    it('should expand item which 2 level', async t => {
      createTreeView(defaultDef)
      let c = nodes[0].children[0]
      c.children = [createNode('h')]
      await treeView.show()
      await treeView.reveal(nodes[0], { expand: 2 })
      await checkLines([
        'test',
        '- a',
        '  - c',
        '      h',
        '    d',
        '+ b',
        '  g',
      ])
    })
  })

  describe('filter', () => {
    afterEach(() => {
      nvim.call('coc#prompt#stop_prompt', ['filter'], true)
    })

    async function createFilterTreeView(opts: Partial<ProviderOptions<TreeNode>> = {}): Promise<void> {
      createTreeView(defaultDef, { enableFilter: true }, opts)
      await treeView.show()
      let tick = await nvim.eval('b:changedtick') as number
      await nvim.input('f')
      await shared.waitValue(async () => {
        let c = await nvim.eval('b:changedtick') as number
        return c - tick > 1
      }, true)
    }

    it('should start filter by input', async t => {
      await createFilterTreeView()
      await treeView.reveal(undefined)
      await checkLines([
        'test', ' ', '  a', '  c', '  d', '  b', '  e', '  f', '  g'
      ])
      await nvim.input('a')
      await shared.waitFor('getline', [2], 'a ')
    })

    it('should not throw error on filter', async t => {
      await createFilterTreeView()
      let resolveUpdate: () => void
      let updated = new Promise<void>(resolve => {
        resolveUpdate = resolve
      })
      let spy = t.mock.method(treeView as any, 'getRenderedLine', () => {
        resolveUpdate()
        throw new Error('Error on updateUI')
      })
      try {
        await nvim.input('a')
        await updated
      } finally {
      }
    })

    it('should add & remove Cursor highlight on window change', async t => {
      let winid = await nvim.call('win_getid')
      let ns = await nvim.call('coc#highlight#create_namespace', ['tree'])
      await createFilterTreeView()
      let bufnr = await nvim.call('bufnr', ['%'])
      let markers = await nvim.call('nvim_buf_get_extmarks', [bufnr, ns, [1, 0], [1, -1], {}]) as [number, number, number][]
      assert.notStrictEqual(markers[0], undefined)
      await nvim.call('win_gotoid', [winid])
      markers = await nvim.call('nvim_buf_get_extmarks', [bufnr, ns, [1, 0], [1, -1], {}]) as [number, number, number][]
      assert.strictEqual(markers.length, 0)
      await nvim.command('wincmd p')
      markers = await nvim.call('nvim_buf_get_extmarks', [bufnr, ns, [1, 0], [1, -1], {}]) as [number, number, number][]
      assert.strictEqual(markers.length, 1)
    })

    it('should filter new nodes on data change', async t => {
      await createFilterTreeView()
      await nvim.input('a')
      await shared.waitFor('getline', [2], 'a ')
      updateData([
        ['ab'],
        ['e'],
        ['fA']
      ])
      await shared.waitValue(async () => {
        return await nvim.call('getline', [1, '$'])
      }, ['test', 'a ', '  ab', '  fA',])
    })

    it('should change selected item by <up> and <down>', async t => {
      await createFilterTreeView()
      await nvim.input('a')
      await shared.waitFor('getline', [2], 'a ')
      updateData([
        ['ab'],
        ['fA']
      ])
      await shared.waitValue(async () => {
        return await nvim.call('getline', [1, '$'])
      }, ['test', 'a ', '  ab', '  fA'])
      await nvim.input('<down>')
      await shared.waitValue(() => {
        let curr = treeView.selection[0]
        return curr.label
      }, 'fA')
      await nvim.input('<down>')
      await shared.waitValue(() => {
        let curr = treeView.selection[0]
        return curr.label
      }, 'ab')
      await nvim.input('<up>')
      await shared.waitValue(() => {
        let curr = treeView.selection[0]
        return curr.label
      }, 'fA')
      await nvim.input('<up>')
      await shared.waitValue(() => {
        let curr = treeView.selection[0]
        return curr.label
      }, 'ab')
    })

    it('should not throw with empty nodes', async t => {
      await createFilterTreeView()
      await nvim.input('ab')
      await checkLines(['test', 'ab '])
      await nvim.input('<up><down><cr>')
      await checkLines(['test', 'ab '])
      let curr = treeView.selection[0]
      assert.strictEqual(curr, undefined)
    })

    it('should invoke command by <cr>', async t => {
      let node
      await createFilterTreeView({
        handleClick: n => {
          node = n
        }
      })
      await nvim.input('<cr>')
      await shared.waitValue(() => node != null, true)
      let curr = treeView.selection[0]
      assert.notStrictEqual(curr, undefined)
    })

    it('should keep state when press <cr> with empty selection', async t => {
      await createFilterTreeView()
      await nvim.input('ab')
      await shared.waitValue(async () => nvim.call('getline', [1, '$']), ['test', 'ab '])
      await nvim.input('<cr>')
      await checkLines(['test', 'ab '])
    })

    it('should delete last filter character by <bs>', async t => {
      await createFilterTreeView()
      await nvim.input('a')
      await shared.wait(20)
      await nvim.input('<bs>')
      await checkLines([
        'test', ' ', '  a', '  c', '  d', '  b', '  e', '  f', '  g'
      ])
    })

    it('should clean filter character by <C-u>', async t => {
      await createFilterTreeView()
      await nvim.input('ab')
      await shared.wait(20)
      await nvim.input('<C-u>')
      await checkLines([
        'test', ' ', '  a', '  c', '  d', '  b', '  e', '  f', '  g'
      ])
    })

    it('should cancel filter by <esc> and <C-o>', async t => {
      await createFilterTreeView()
      t.mock.method(window, 'showPrompt', () => {
        return Promise.resolve(true)
      })
      await shared.wait(20)
      await nvim.input('<esc>')
      await checkLines([
        'test',
        '+ a',
        '+ b',
        '  g',
      ])
      await nvim.input('f')
      await shared.wait(10)
      await nvim.input('<C-o>')
      await checkLines([
        'test',
        '+ a',
        '+ b',
        '  g',
      ])
    })

    it('should navigate input history by <C-n> and <C-p>', async t => {
      await createFilterTreeView()
      await nvim.input('a')
      await shared.wait(20)
      await nvim.input('<esc>')
      await shared.wait(20)
      await nvim.input('f')
      await shared.wait(20)
      await nvim.input('b')
      await shared.wait(20)
      await nvim.input('<C-o>')
      await shared.wait(20)
      await nvim.input('f')
      await shared.wait(20)
      await nvim.input('<C-n>')
      await checkLines(['test', 'b ', '  b',])
      await nvim.input('<C-p>')
      await checkLines(['test', 'a ', '  a',])
    })

    it('should not throw on filter error', async t => {
      await createFilterTreeView()
      let resolveRedraw: () => void
      let redrawn = new Promise<void>(resolve => {
        resolveRedraw = resolve
      })
      let spy = t.mock.method(treeView as any, 'redraw', () => {
        resolveRedraw()
        throw new Error('test error')
      })
      try {
        await nvim.input('a')
        await redrawn
      } finally {
      }
    })
  })
})
