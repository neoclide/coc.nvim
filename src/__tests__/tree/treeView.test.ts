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
import helper from '../helper'

type NodeDef = [string, NodeDef[]?]

let nvim: Neovim
let disposables: Disposable[] = []
let treeView: TreeView<TreeNode>
let provider: BasicDataProvider<TreeNode>
let nodes: TreeNode[]
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
})

afterAll(async () => {
  await helper.shutdown()
})

beforeEach(async () => {
  await helper.createDocument()
})

afterEach(async () => {
  if (provider) provider.dispose()
  if (treeView) treeView.dispose()
  disposeAll(disposables)
  await helper.reset()
})

function createNode(label: string, children?: TreeNode[], key?: string, tooltip?: string): TreeNode {
  let res: TreeNode = { label }
  if (children) res.children = children
  if (tooltip) res.tooltip = tooltip
  if (key) res.key = key
  return res
}

function createNodes(defs: NodeDef[]): TreeNode[] {
  return defs.map(o => {
    let children
    if (Array.isArray(o[1])) {
      children = createNodes(o[1])
    }
    return createNode(o[0], children)
  })
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

function makeUpdateUIThrowError() {
  let spy = jest.spyOn(treeView as any, 'updateUI').mockImplementation(() => {
    throw new Error('Test error')
  })
  disposables.push(Disposable.create(() => {
    spy.mockRestore()
  }))
}

let defaultDef: NodeDef[] = [
  ['a', [['c'], ['d']]],
  ['b', [['e'], ['f']]],
  ['g']
]

async function checkLines(arr: string[]): Promise<void> {
  await helper.waitValue(async () => {
    return await nvim.call('getline', [1, '$'])
  }, arr)
}

describe('TreeView', () => {
  describe('TreeItem()', () => {
    it('should create TreeItem from resourceUri', async () => {
      let item = new TreeItem(URI.file('/foo/bar.ts'))
      expect(item.resourceUri).toBeDefined()
      expect(item.label).toBe('bar.ts')
      expect(item.label).toBeDefined()
    })

    it('should get item label', async () => {
      let item = new TreeItem({ label: 'foo' }, TreeItemCollapsibleState.None)
      expect(getItemLabel(item)).toBe('foo')
    })
  })

  describe('show()', () => {
    it('should show with title', async () => {
      createTreeView(defaultDef)
      expect(treeView).toBeDefined()
      expect(treeView.visible).toBe(false)
      expect(await treeView.checkLines()).toBe(false)
      await treeView.show()
      let visible = treeView.visible
      expect(visible).toBe(true)
      await checkLines(['test', '+ a', '+ b', '  g'])
      treeView.registerLocalKeymap('n', undefined, () => {})
      let called = false
      treeView.registerLocalKeymap('n', 'p', () => {
        called = true
      }, false)
      await helper.wait(30)
      await nvim.input('p')
      await helper.waitValue(() => called, true)
    })

    it('should not show when visible', async () => {
      createTreeView(defaultDef)
      await treeView.show()
      let windowId = treeView.windowId
      await treeView.show()
      expect(treeView.windowId).toBe(windowId)
    })

    it('should reuse window', async () => {
      createTreeView(defaultDef)
      await treeView.show()
      let windowId = treeView.windowId
      provider.dispose()
      createTreeView(defaultDef)
      await treeView.show()
      expect(treeView.windowId).toBe(windowId)
    })

    it('should render item icon', async () => {
      createTreeView(defaultDef)
      nodes[0].icon = { text: 'i', hlGroup: 'Title' }
      nodes[1].icon = { text: 'i', hlGroup: 'Title' }
      nodes[2].icon = { text: 'i', hlGroup: 'Title' }
      await treeView.show()
      await checkLines(['test', '+ i a', '+ i b', '  i g'])
    })
  })

  describe('configuration', () => {
    it('should change open close icon', async () => {
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
          reject('event not fired after 2s')
        }, 2000)
        let disposable = treeView.onDidChangeVisibility(e => {
          clearTimeout(timer)
          expect(e.visible).toBe(visible)
          disposable.dispose()
          resolve(undefined)
        })
      })
    }

    it('should emit visibility change event', async () => {
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

    it('should dispose on tab close', async () => {
      await nvim.command('tabe')
      await nvim.command('tabe')
      createTreeView(defaultDef)
      await treeView.show()
      await nvim.command('close')
      await nvim.command('normal! 2gt')
      await nvim.command('close')
      await nvim.command('normal! 1gt')
      await nvim.command('tabonly')
      await helper.waitValue(() => {
        return treeView.valid
      }, false)
    })

    it('should registerLocalKeymap before shown', async () => {
      createTreeView(defaultDef)
      let called = false
      treeView.registerLocalKeymap('n', 'p', () => {
        called = true
      }, true)
      await treeView.show()
      await events.race(['TextChanged'], 50)
      await nvim.input('p')
      await helper.waitValue(() => {
        return called
      }, true)
    })
  })

  describe('public properties', () => {
    it('should change title', async () => {
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

    it('should change description', async () => {
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

    it('should change message', async () => {
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
    it('should disable winfixwidth', async () => {
      createTreeView(defaultDef, { winfixwidth: false })
      await treeView.show()
      let res = await nvim.eval('&winfixwidth')
      expect(res).toBe(0)
    })

    it('should disable leaf indent', async () => {
      createTreeView(defaultDef, { disableLeafIndent: true })
      await treeView.show()
      await checkLines(['test', '+ a', '+ b', 'g'])
    })

    it('should should adjust window width', async () => {
      let def: NodeDef[] = [
        ['a', [['c'], ['d']]],
        ['very long line']
      ]
      createTreeView(def, { autoWidth: true })
      await treeView.show('belowright 10vs')
      let width = await nvim.call('winwidth', [0])
      expect(width).toBeGreaterThan(10)
      expect(treeView.targetWinId).toBeDefined()
    })

    it('should support many selection', async () => {
      createTreeView(defaultDef, { canSelectMany: true })
      await treeView.show()
      let selection: TreeNode[]
      treeView.onDidChangeSelection(e => {
        selection = e.selection
      })
      await nvim.command('exe 1')
      await nvim.input('<space>')
      await helper.wait(10)
      await nvim.command('exe 2')
      await nvim.input('<space>')
      await helper.waitValue(() => {
        return selection?.length
      }, 1)
      await nvim.command('exe 3')
      await nvim.input('<space>')
      await helper.waitValue(() => {
        return selection?.length
      }, 2)
      await nvim.input('<space>')
      await helper.waitValue(() => {
        return selection.length
      }, 1)
      let buf = await nvim.buffer
      let res = await nvim.call('sign_getplaced', [buf.id, { group: 'CocTree' }])
      let signs = res[0].signs
      expect(treeView.selection.length).toBe(1)
      expect(signs.length).toBe(1)
      expect(signs[0]).toEqual({
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

    it('should jump back by <C-o>', async () => {
      let winid = await nvim.call('win_getid')
      createTreeView(defaultDef)
      await treeView.show()
      await helper.wait(30)
      await nvim.input('<C-o>')
      await helper.waitValue(() => {
        return nvim.call('win_getid', [])
      }, winid)
    })

    it('should toggle selection by <space>', async () => {
      createTreeView(defaultDef)
      await treeView.show()
      let selection: TreeNode[]
      treeView.onDidChangeSelection(e => {
        selection = e.selection
      })
      await nvim.command('exe 1')
      await nvim.input('<space>')
      await helper.wait(10)
      await nvim.command('exe 2')
      await nvim.input('<space>')
      await helper.waitValue(() => selection.length, 1)
      await nvim.command('exe 3')
      await nvim.input('<space>')
      await helper.waitValue(async () => {
        return await getSingns()
      }, 1)
      await nvim.input('<space>')
      await helper.waitValue(async () => {
        return await getSingns()
      }, 0)
    })

    it('should reset signs after expand & collapse', async () => {
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
      await helper.waitValue(() => {
        return getSingns()
      }, 1)
      await nvim.command('exe 2')
      await nvim.input('t')
      await helper.waitValue(() => {
        return getSingns()
      }, 0)
      await nvim.input('t')
      await helper.waitValue(() => {
        return getSingns()
      }, 1)
    })

    it('should close tree view by close key', async () => {
      helper.updateConfiguration('tree.key.close', 'c')
      createTreeView(defaultDef)
      await treeView.show()
      await helper.wait(30)
      expect(treeView.visible).toBe(true)
      await nvim.input('c')
      await helper.waitValue(() => treeView.visible, false)
    })

    it('should invoke command by <cr>', async () => {
      let node: TreeNode
      createTreeView(defaultDef, {}, {
        handleClick: n => {
          node = n
        }
      })
      await treeView.show()
      await treeView.invokeCommand(undefined)
      await nvim.input('<cr>')
      await helper.waitValue(() => node, undefined)
      await nvim.command('exe 2')
      await nvim.input('<cr>')
      await helper.waitValue(() => node && node.label, 'a')
    })

    it('should not throw when resolve command cancelled', async () => {
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
      let spy = jest.spyOn(console, 'error').mockImplementation(() => {
        // noop
      })
      await nvim.input('<cr>')
      await helper.wait(10)
      await nvim.command('exe 1')
      await helper.waitValue(() => cancelled, true)
      spy.mockRestore()
      expect(node).toBeUndefined()
    })

    it('should toggle expand by t', async () => {
      createTreeView(defaultDef)
      let c = nodes[0].children[0]
      c.children = [createNode('h')]
      await treeView.show()
      await nvim.command('exe 1')
      await nvim.input('t')
      await helper.wait(10)
      await nvim.command('exe 3')
      await nvim.input('t')
      await helper.wait(10)
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

    it('should should collapse parent node by t', async () => {
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

    it('should collapse all nodes by M', async () => {
      createTreeView(defaultDef)
      let c = nodes[0].children[0]
      c.children = [createNode('h')]
      await treeView.show()
      await helper.wait(50)
      await nvim.command('exe 2')
      await nvim.input('t')
      await helper.wait(50)
      await nvim.command('exe 3')
      await nvim.input('t')
      await helper.wait(50)
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
      expect(res).toBe(true)
    })

    it('should toggle expand on open/close icon click ', async () => {
      createTreeView(defaultDef)
      await treeView.show()
      await nvim.call('cursor', [1, 1])
      await nvim.input('<LeftRelease>')
      await helper.wait(20)
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
      expect(res).toBe(true)
    })

    it('should invoke command on node click', async () => {
      let node: TreeNode
      createTreeView(defaultDef, {}, {
        handleClick: n => {
          node = n
        }
      })
      await treeView.show()
      await nvim.call('cursor', [2, 3])
      await nvim.input('<LeftRelease>')
      await helper.waitValue(() => node != null, true)
      expect(node.label).toBe('a')
    })
  })

  describe('invokeActions', () => {
    it('should show warning when resolveActions does not exist', async () => {
      createTreeView(defaultDef)
      await treeView.show()
      await treeView.invokeActions(undefined)
      await nvim.call('cursor', [2, 3])
      await nvim.input('<tab>')
      await helper.waitValue(async () => {
        let cmdline = await helper.getCmdline()
        return cmdline.includes('No actions')
      }, true)
    })

    it('should show warning when resolveActions is empty', async () => {
      createTreeView(defaultDef, {}, {
        resolveActions: () => {
          return []
        }
      })
      await treeView.show()
      await nvim.call('cursor', [2, 3])
      await nvim.input('<tab>')
      await helper.waitValue(async () => {
        let cmdline = await helper.getCmdline()
        return cmdline.includes('No actions')
      }, true)
    })

    it('should invoke selected action', async () => {
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
      await helper.waitPrompt()
      await nvim.input('<esc>')
      await helper.wait(20)
      await nvim.input('<tab>')
      await helper.waitPrompt()
      await nvim.input('<cr>')
      await helper.waitValue(() => {
        return called
      }, true)
      expect(called).toBe(true)
      expect(args[0].label).toBe('a')
      expect(args[1].label).toBe('a')
    })
  })

  describe('events', () => {
    it('should emit visibility change on buffer unload', async () => {
      createTreeView(defaultDef)
      let visible
      treeView.onDidChangeVisibility(e => {
        visible = e.visible
      })
      await treeView.show()
      let buf = await nvim.buffer
      nvim.command(`bd! ${buf.id}`, true)
      await helper.waitValue(() => visible, false)
    })

    it('should show tooltip on CursorHold', async () => {
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
      await nvim.command('exe 2')
      let bufnr = await nvim.eval(`bufnr('%')`) as number
      await events.fire('CursorHold', [bufnr, [2, 1]])
      let win = await helper.getFloat()
      expect(win).toBeDefined()
      let buf = await win.buffer
      let lines = await buf.lines
      expect(lines).toEqual(['first'])
      await nvim.command('exe 3')
      await events.fire('CursorHold', [bufnr, [3, 1]])
      lines = await buf.lines
      expect(lines).toEqual(['#title'])
      await events.fire('CursorHold', [bufnr, [1, 1]])
    })
  })

  describe('data change', () => {
    it('should ignore hidden node change', async () => {
      createTreeView(defaultDef)
      await treeView.show()
      let tick = await nvim.eval('b:changedtick')
      updateData([
        ['a', [['c', [['h']]], ['d']]],
        ['b', [['e'], ['f']]],
        ['g']
      ])
      await helper.wait(20)
      let curr = await nvim.eval('b:changedtick')
      expect(curr).toBe(tick)
    })

    it('should render all nodes on root change', async () => {
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
      expect(res).toBe(true)
    })

    it('should keep node open state', async () => {
      createTreeView(defaultDef)
      let c = nodes[0].children[0]
      c.children = [createNode('h')]
      await treeView.show()
      await nvim.command('exe 2')
      await nvim.input('t')
      await helper.wait(50)
      await nvim.command('exe 3')
      await nvim.input('t')
      await helper.wait(50)
      await nvim.command('exe 6')
      await nvim.input('t')
      await helper.wait(50)
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
      expect(res).toBe(true)
    })

    it('should render changed nodes', async () => {
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
      expect(res).toBe(true)
    })

    it('should error message on error', async () => {
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
      expect(line).toMatch(msg)
      await helper.wait(50)
      let res = await treeView.checkLines()
      expect(res).toBe(true)
    })

    it('should reset message when data exists', async () => {
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

    it('should show error message on refresh error', async () => {
      createTreeView(defaultDef)
      await treeView.show()
      makeUpdateUIThrowError()
      updateData([
        ['a', [['h'], ['d']]],
        ['b', [['e'], ['f']]],
        ['g'],
      ])
      await helper.waitValue(async () => {
        let line = await helper.getCmdline()
        return line.includes('Error on tree refresh')
      }, true)
    })

    it('should render deprecated node with deprecated highlight', async () => {
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
      expect(markers.length > 0).toBe(true)
      expect(markers[0][3]['hl_group']).toBe('CocDeprecatedHighlight')
    })

    it('should not throw when getTreeItem return undefined', async () => {
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
    it('should not throw when node not rendered', async () => {
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

    it('should focus rendered node', async () => {
      createTreeView(defaultDef)
      await treeView.show()
      treeView.focusItem(nodes[1])
      let line = await nvim.call('getline', ['.'])
      expect(line).toBe('+ b')
    })
  })

  describe('reveal()', () => {
    it('should throw error when getParent does not exist', async () => {
      createTreeView(defaultDef)
      provider.getParent = undefined
      await treeView.show()
      let err
      try {
        await treeView.reveal(nodes[0].children[0])
      } catch (e) {
        err = e
      }
      expect(err).toBeDefined()
    })

    it('should select item', async () => {
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
      expect(selection.length).toBe(1)
      expect(selection[0].label).toBe('h')
      let line = await nvim.call('getline', ['.'])
      expect(line).toMatch('h')
    })

    it('should not select item', async () => {
      createTreeView(defaultDef)
      await treeView.show()
      await treeView.reveal(nodes[1], { select: false })
      let lnum = await nvim.call('line', ['.'])
      expect(lnum).toBe(1)
    })

    it('should focus item', async () => {
      createTreeView(defaultDef)
      await treeView.show()
      await treeView.reveal(nodes[1], { focus: true })
      let line = await nvim.call('getline', ['.'])
      expect(line).toMatch('b')
    })

    it('should expand item whih single level', async () => {
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

    it('should expand item whih 2 level', async () => {
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
      await helper.wait(20)
      let tick = await nvim.eval('b:changedtick') as number
      await nvim.input('f')
      await helper.waitValue(async () => {
        let c = await nvim.eval('b:changedtick') as number
        return c - tick > 1
      }, true)
    }

    it('should start filter by input', async () => {
      await createFilterTreeView()
      await treeView.reveal(undefined)
      await checkLines([
        'test', ' ', '  a', '  c', '  d', '  b', '  e', '  f', '  g'
      ])
      await nvim.input('a')
      await helper.waitFor('getline', [2], 'a ')
    })

    it('should not throw error on filter', async () => {
      await createFilterTreeView()
      let spy = jest.spyOn(treeView as any, 'getRenderedLine').mockImplementation(() => {
        throw new Error('Error on updateUI')
      })
      await nvim.input('a')
      await helper.wait(50)
      spy.mockRestore()
    })

    it('should add & remove Cursor highlight on window change', async () => {
      let winid = await nvim.call('win_getid')
      let ns = await nvim.call('coc#highlight#create_namespace', ['tree'])
      await createFilterTreeView()
      let bufnr = await nvim.call('bufnr', ['%'])
      let markers = await nvim.call('nvim_buf_get_extmarks', [bufnr, ns, [1, 0], [1, -1], {}]) as [number, number, number][]
      expect(markers[0]).toBeDefined()
      await nvim.call('win_gotoid', [winid])
      markers = await nvim.call('nvim_buf_get_extmarks', [bufnr, ns, [1, 0], [1, -1], {}]) as [number, number, number][]
      expect(markers.length).toBe(0)
      await nvim.command('wincmd p')
      markers = await nvim.call('nvim_buf_get_extmarks', [bufnr, ns, [1, 0], [1, -1], {}]) as [number, number, number][]
      expect(markers.length).toBe(1)
    })

    it('should filter new nodes on data change', async () => {
      await createFilterTreeView()
      await nvim.input('a')
      await helper.wait(50)
      updateData([
        ['ab'],
        ['e'],
        ['fA']
      ])
      await helper.waitValue(async () => {
        return await nvim.call('getline', [1, '$'])
      }, ['test', 'a ', '  ab', '  fA',])
    })

    it('should change selected item by <up> and <down>', async () => {
      await createFilterTreeView()
      await nvim.input('a')
      await helper.wait(50)
      updateData([
        ['ab'],
        ['fA']
      ])
      await helper.wait(30)
      await nvim.input('<down>')
      await helper.waitValue(() => {
        let curr = treeView.selection[0]
        return curr.label
      }, 'fA')
      await nvim.input('<down>')
      await helper.waitValue(() => {
        let curr = treeView.selection[0]
        return curr.label
      }, 'ab')
      await nvim.input('<up>')
      await helper.waitValue(() => {
        let curr = treeView.selection[0]
        return curr.label
      }, 'fA')
      await nvim.input('<up>')
      await helper.waitValue(() => {
        let curr = treeView.selection[0]
        return curr.label
      }, 'ab')
    })

    it('should not throw with empty nodes', async () => {
      await createFilterTreeView()
      await nvim.input('ab')
      await helper.wait(50)
      await nvim.input('<up>')
      await helper.wait(50)
      await nvim.input('<down>')
      await helper.wait(50)
      await nvim.input('<cr>')
      await checkLines(['test', 'ab '])
      let curr = treeView.selection[0]
      expect(curr).toBeUndefined()
    })

    it('should invoke command by <cr>', async () => {
      let node
      await createFilterTreeView({
        handleClick: n => {
          node = n
        }
      })
      await nvim.input('<cr>')
      await helper.waitValue(() => node != null, true)
      let curr = treeView.selection[0]
      expect(curr).toBeDefined()
    })

    it('should keep state when press <cr> with empty selection', async () => {
      await createFilterTreeView()
      await nvim.input('ab')
      await helper.wait(50)
      await nvim.input('<cr>')
      await checkLines(['test', 'ab '])
    })

    it('should delete last filter character by <bs>', async () => {
      await createFilterTreeView()
      await nvim.input('a')
      await helper.wait(20)
      await nvim.input('<bs>')
      await checkLines([
        'test', ' ', '  a', '  c', '  d', '  b', '  e', '  f', '  g'
      ])
    })

    it('should clean filter character by <C-u>', async () => {
      await createFilterTreeView()
      await nvim.input('ab')
      await helper.wait(20)
      await nvim.input('<C-u>')
      await checkLines([
        'test', ' ', '  a', '  c', '  d', '  b', '  e', '  f', '  g'
      ])
    })

    it('should cancel filter by <esc> and <C-o>', async () => {
      await createFilterTreeView()
      await helper.waitPrompt()
      await nvim.input('<esc>')
      await checkLines([
        'test',
        '+ a',
        '+ b',
        '  g',
      ])
      await nvim.input('f')
      await helper.wait(10)
      await nvim.input('<C-o>')
      await checkLines([
        'test',
        '+ a',
        '+ b',
        '  g',
      ])
    })

    it('should navigate input history by <C-n> and <C-p>', async () => {
      await createFilterTreeView()
      await nvim.input('a')
      await helper.wait(10)
      await nvim.input('<esc>')
      await helper.wait(10)
      await nvim.input('f')
      await helper.wait(10)
      await nvim.input('b')
      await helper.wait(10)
      await nvim.input('<C-o>')
      await helper.wait(10)
      await nvim.input('f')
      await helper.wait(10)
      await nvim.input('<C-n>')
      await checkLines(['test', 'b ', '  b',])
      await nvim.input('<C-p>')
      await checkLines(['test', 'a ', '  a',])
    })

    it('should not throw on filter error', async () => {
      await createFilterTreeView()
      let spy = jest.spyOn(treeView as any, 'redraw').mockImplementation(() => {
        throw new Error('test error')
      })
      await nvim.input('a')
      await helper.wait(20)
      spy.mockRestore()
    })
  })
})
