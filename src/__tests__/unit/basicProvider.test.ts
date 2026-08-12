import { CancellationTokenSource, Disposable } from 'vscode-languageserver-protocol'
import commandsManager from '../../commands'
import { TreeItemCollapsibleState } from '../../tree'
import { HistoryInput } from '../../tree/filter'
import BasicDataProvider, { TreeNode } from '../../tree/BasicDataProvider'
import { disposeAll } from '../../util'
import { createNode, createNodes, CustomNode, NodeDef } from '../helper'

let disposables: Disposable[] = []

afterEach(async () => {
  disposeAll(disposables)
  disposables = []
})

let defaultDef: NodeDef[] = [
  ['a', [['c'], ['d']]],
  ['b', [['e'], ['f']]],
  ['g']
]

function createLabels(data: ReadonlyArray<TreeNode>): string[] {
  let res: string[] = []
  const addLabels = (n: TreeNode, level: number) => {
    res.push(' '.repeat(level) + n.label)
    if (n.children) {
      for (let node of n.children) {
        addLabels(node, level + 1)
      }
    }
  }
  for (let item of data || []) {
    addLabels(item, 0)
  }
  return res
}

function findNode(label: string, nodes: ReadonlyArray<TreeNode>): TreeNode | undefined {
  for (let n of nodes) {
    if (n.label == label) {
      return n
    }
    let children = n.children
    if (Array.isArray(children)) {
      let find = findNode(label, children)
      if (find) return find
    }
  }
}

describe('HistoryInput()', () => {
  it('should manage history inputs', async () => {
    let h = new HistoryInput()
    h.add('a')
    h.add('b')
    assert.strictEqual(h.next(''), 'b')
    assert.strictEqual(h.next('a'), 'b')
    assert.strictEqual(h.next('b'), 'a')
    assert.strictEqual(h.toJSON(), `[b,a]`)
    assert.strictEqual(h.previous(''), 'a')
    assert.strictEqual(h.previous('a'), 'b')
    assert.strictEqual(h.previous('b'), 'a')
  })
})

describe('BasicDataProvider', () => {
  describe('getChildren()', () => {
    it('should get children from root', async () => {
      let nodes = createNodes(defaultDef)
      let provider = new BasicDataProvider({
        provideData: () => {
          return nodes
        }
      })
      disposables.push(provider)
      let res = await provider.getChildren()
      assert.strictEqual(res.length, 3)
      assert.deepStrictEqual(res.map(o => o.label), ['a', 'b', 'g'])
    })

    it('should throw when result is not array', async () => {
      let provider = new BasicDataProvider({
        provideData: () => {
          return undefined
        }
      })
      disposables.push(provider)
      await assert.rejects(provider.getChildren(), Error)
      assert.strictEqual(provider.getLevel(undefined), 0)
    })

    it('should get children from child node', async () => {
      let provider = new BasicDataProvider({
        provideData: () => {
          return createNodes(defaultDef)
        }
      })
      disposables.push(provider)
      let res = await provider.getChildren()
      let nodes = await provider.getChildren(res[0])
      assert.strictEqual(nodes.length, 2)
      assert.deepStrictEqual(nodes.map(o => o.label), ['c', 'd'])
    })

    it('should throw when provideData throws', async () => {
      let provider = new BasicDataProvider({
        provideData: () => {
          throw new Error('my error')
        }
      })
      disposables.push(provider)
      let err
      try {
        await provider.getChildren()
      } catch (e) {
        err = e
      }
      assert.notStrictEqual(err, undefined)
    })
  })

  describe('getTreeItem()', () => {
    it('should get tree item from node', async () => {
      let provider = new BasicDataProvider({
        provideData: () => {
          return createNodes(defaultDef)
        }
      })
      disposables.push(provider)
      let res = await provider.getChildren()
      let item = provider.getTreeItem(res[0])
      assert.notStrictEqual(item, undefined)
      assert.strictEqual(item.collapsibleState, TreeItemCollapsibleState.Collapsed)
      item = provider.getTreeItem(res[2])
      assert.strictEqual(item.collapsibleState, TreeItemCollapsibleState.None)
    })

    it('should respect expandLevel option', async () => {
      let def: NodeDef[] = [
        ['a', [['c', [['e'], ['f']]], ['d']]],
        ['b']
      ]
      let provider = new BasicDataProvider({
        expandLevel: 1,
        provideData: () => {
          return createNodes(def)
        }
      })
      disposables.push(provider)
      let res = await provider.getChildren()
      let item = provider.getTreeItem(res[0])
      assert.notStrictEqual(item, undefined)
      assert.strictEqual(item.collapsibleState, TreeItemCollapsibleState.Expanded)
      item = provider.getTreeItem(res[0].children[0])
      assert.strictEqual(item.collapsibleState, TreeItemCollapsibleState.Collapsed)
      let n = 0
      provider.iterate(res[0], undefined, 0, () => {
        n++
        return true
      })
      assert.strictEqual(n, 5)
    })

    it('should include highlights', async () => {
      let provider = new BasicDataProvider({
        provideData: () => {
          return [createNode('a', [], undefined, 'tip')]
        }
      })
      disposables.push(provider)
      let res = await provider.getChildren()
      let item = provider.getTreeItem(res[0])
      assert.notStrictEqual(item, undefined)
      assert.strictEqual(item.tooltip, 'tip')
    })

    it('should use icon from node', async () => {
      let node = createNode('a', [], undefined, 'tip')
      node.icon = {
        text: 'i',
        hlGroup: 'Function'
      }
      let provider = new BasicDataProvider({
        provideData: () => {
          return [node]
        }
      })
      disposables.push(provider)
      let res = await provider.getChildren()
      let item = provider.getTreeItem(res[0])
      assert.notStrictEqual(item, undefined)
      assert.notStrictEqual(item.icon, undefined)
      assert.deepStrictEqual(item.icon, {
        text: 'i',
        hlGroup: 'Function'
      })
    })

    it('should resolve icon', async () => {
      let provider = new BasicDataProvider<CustomNode>({
        provideData: () => {
          let node = createNode('a', [], undefined, 'tip')
          node.kind = 'function'
          return [node]
        },
        resolveIcon: item => {
          if (item.kind === 'function') {
            return {
              text: 'f',
              hlGroup: 'Function'
            }
          }
        }
      })
      disposables.push(provider)
      let res = await provider.getChildren()
      let item = provider.getTreeItem(res[0])
      assert.notStrictEqual(item, undefined)
      assert.deepStrictEqual(item.icon, {
        text: 'f',
        hlGroup: 'Function'
      })
    })
  })

  describe('getParent()', () => {
    it('should get undefined when data does not exist', async () => {
      let node = createNode('a')
      let provider = new BasicDataProvider({
        provideData: () => {
          return [node]
        }
      })
      disposables.push(provider)
      let res = provider.getParent(node)
      assert.strictEqual(res, undefined)
    })

    it('should get parent node', async () => {
      let node = createNode('g')
      let provider = new BasicDataProvider({
        provideData: () => {
          return [
            createNode('a', [createNode('c', [node]), createNode('d')]),
            createNode('b', [createNode('e'), createNode('f')]),
            createNode('g')
          ]
        }
      })
      disposables.push(provider)
      await provider.getChildren()
      let res = provider.getParent(node)
      assert.notStrictEqual(res, undefined)
      assert.strictEqual(res.label, 'c')
      // console.log(provider.labels.join('\n'))
    })
  })

  describe('resolveTreeItem()', () => {
    it('should resolve tooltip and command', async () => {
      let node = createNode('a')
      let provider = new BasicDataProvider({
        provideData: () => {
          return [node]
        },
        resolveItem: item => {
          item.tooltip = 'tip'
          item.command = {
            command: 'test command',
            title: 'test'
          }
          return item
        }
      })
      disposables.push(provider)
      await provider.getChildren()
      let source = new CancellationTokenSource()
      let item = provider.getTreeItem(node)
      let resolved = await provider.resolveTreeItem(item, node, source.token)
      assert.strictEqual(resolved.tooltip, 'tip')
      assert.strictEqual(resolved.command.command, 'test command')
    })

    it('should register command invoke click', async () => {
      let node = createNode('a')
      let called: TreeNode
      let provider = new BasicDataProvider({
        provideData: () => {
          return [node]
        },
        handleClick: item => {
          called = item
        }
      })
      disposables.push(provider)
      await provider.getChildren()
      let source = new CancellationTokenSource()
      let item = provider.getTreeItem(node)
      let resolved = await provider.resolveTreeItem(item, node, source.token)
      assert.notStrictEqual(resolved.command, undefined)
      assert.ok((resolved.command.command).includes('invoke'))
      await commandsManager.execute(resolved.command)
      assert.notStrictEqual(called, undefined)
      assert.strictEqual(called, node)
    })
  })

  describe('update()', () => {
    it('should add children with event', async () => {
      let defs: NodeDef[] = [
        ['a', [['b']]],
        ['b', [['f']]]
      ]
      let nodes = createNodes(defs)
      let b = nodes[0].children[0]
      let provider = new BasicDataProvider({
        provideData: () => {
          return nodes
        }
      })
      disposables.push(provider)
      await provider.getChildren()
      let called = false
      provider.onDidChangeTreeData(node => {
        assert.strictEqual(node, b)
        called = true
      })
      let newDefs: NodeDef[] = [
        ['a', [['b', [['c'], ['d']]]]],
        ['b', [['f']]]
      ]
      let curr = provider.update(createNodes(newDefs))
      let labels = createLabels(curr)
      assert.deepStrictEqual(labels, [
        'a', ' b', '  c', '  d', 'b', ' f'
      ])
      assert.strictEqual(called, true)
      assert.notStrictEqual(b.children, undefined)
      assert.strictEqual(b.children.length, 2)
    })

    it('should remove children with event', async () => {
      let defs: NodeDef[] = [
        ['a', [['b', [['c'], ['d']]]]],
        ['e', [['f']]]
      ]
      let nodes = createNodes(defs)
      let b = nodes[0].children[0]
      let provider = new BasicDataProvider({
        provideData: () => {
          return nodes
        }
      })
      disposables.push(provider)
      await provider.getChildren()
      let called = false
      provider.onDidChangeTreeData(node => {
        assert.strictEqual(node, b)
        called = true
      })
      let newDefs: NodeDef[] = [
        ['a', [['b']]],
        ['e', [['f']]]
      ]
      let curr = provider.update(createNodes(newDefs))
      let labels = createLabels(curr)
      assert.deepStrictEqual(labels, [
        'a', ' b', 'e', ' f'
      ])
      assert.strictEqual(called, true)
      assert.strictEqual(b.children, undefined)
    })

    it('should not fire event for children when parent have changed', async () => {
      let defs: NodeDef[] = [
        ['a', [['b', [['c'], ['d']]]]]
      ]
      let nodes = createNodes(defs)
      let provider = new BasicDataProvider({
        provideData: () => {
          return nodes
        }
      })
      disposables.push(provider)
      await provider.getChildren()
      let called = 0
      provider.onDidChangeTreeData(node => {
        assert.strictEqual(node, undefined)
        called += 1
      })
      let newDefs: NodeDef[] = [
        ['a', [['b', [['c'], ['d'], ['g']]]]],
        ['e', [['f']]]
      ]
      let curr = provider.update(createNodes(newDefs))
      assert.strictEqual(called, 1)
      let labels = createLabels(curr)
      assert.deepStrictEqual(labels, [
        'a', ' b', '  c', '  d', '  g', 'e', ' f'
      ])
    })

    it('should fire events for independent node change', async () => {
      let defs: NodeDef[] = [
        ['a', [['b', [['c']]]]],
        ['e', [['f']]]
      ]
      let nodes = createNodes(defs)
      let provider = new BasicDataProvider({
        provideData: () => {
          return nodes
        }
      })
      disposables.push(provider)
      await provider.getChildren()
      let called = []
      provider.onDidChangeTreeData(node => {
        called.push(node)
      })
      let newDefs: NodeDef[] = [
        ['a', [['b', [['c'], ['d']]]]],
        ['e', [['f', [['g']]]]]
      ]
      let curr = provider.update(createNodes(newDefs))
      assert.strictEqual(called.length, 2)
      assert.strictEqual(called[0].label, 'b')
      assert.strictEqual(called[1].label, 'f')
      let labels = createLabels(curr)
      assert.deepStrictEqual(labels, [
        'a', ' b', '  c', '  d', 'e', ' f', '  g'
      ])
    })

    it('should apply new properties', async () => {
      let defs: NodeDef[] = [
        ['a', [['b']]],
        ['e', [['f']]]
      ]
      let nodes = createNodes(defs)
      let provider = new BasicDataProvider<CustomNode>({
        provideData: () => {
          return nodes
        }
      })
      disposables.push(provider)
      await provider.getChildren()
      let newNodes = createNodes([
        ['a', [['b', [['c']]]]],
        ['e', [['f', [['g']]]]]
      ])
      let b = newNodes[0].children[0]
      Object.assign(b, { x: 1, y: 2 })
      let curr = provider.update(newNodes)
      let node = curr[0].children[0]
      assert.notStrictEqual(node, undefined)
      assert.strictEqual(node.x, 1)
      assert.strictEqual(node.y, 2)
    })

    it('should keep references and have new data sequence', async () => {
      let defs: NodeDef[] = [
        ['a', [['b'], ['c']]],
        ['e', [['f']]],
        ['g']
      ]
      let nodes = createNodes(defs)
      let keeps = [
        findNode('a', nodes),
        findNode('b', nodes),
        findNode('c', nodes),
        findNode('e', nodes),
        findNode('f', nodes),
      ]
      let provider = new BasicDataProvider({
        provideData: () => {
          return nodes
        }
      })
      disposables.push(provider)
      await provider.getChildren()
      let newNodes = createNodes([
        ['a', [['c', [['d'], ['h']]], ['b']]],
        ['e', [['f', [['j']]], ['i']]]
      ])
      let curr = provider.update(newNodes)
      assert.strictEqual(curr, nodes)
      assert.strictEqual(keeps[0], findNode('a', curr))
      assert.strictEqual(keeps[1], findNode('b', curr))
      assert.strictEqual(keeps[2], findNode('c', curr))
      assert.strictEqual(keeps[3], findNode('e', curr))
      assert.strictEqual(keeps[4], findNode('f', curr))
      let labels = createLabels(curr)
      assert.deepStrictEqual(labels, [
        'a', ' c', '  d', '  h', ' b', 'e', ' f', '  j', ' i'
      ])
    })

    it('should use key for nodes', async () => {
      let nodes = [
        createNode('a', [], 'x'),
        createNode('a', [], 'y'),
        createNode('a', [], 'z'),
      ]
      let provider = new BasicDataProvider({
        provideData: () => {
          return nodes
        }
      })
      disposables.push(provider)
      await provider.getChildren()
      let newNodes = [
        createNode('a', [], 'x'),
        createNode('a', [], 'z'),
      ]
      let curr = provider.update(newNodes)
      assert.strictEqual(curr.length, 2)
      assert.strictEqual(curr[0].key, 'x')
      assert.strictEqual(curr[1].key, 'z')
    })

    it('should reset data', async () => {
      let nodes = [
        createNode('a', [], 'x'),
      ]
      let provider = new BasicDataProvider({
        provideData: () => {
          return nodes
        }
      })
      disposables.push(provider)
      await provider.getChildren()
      let newNodes = [
        createNode('a', [], 'x'),
      ]
      let curr = provider.update(newNodes, true)
      assert.strictEqual(curr === nodes, false)
    })
  })

  describe('dispose', () => {
    it('should invoke onDispose from opts', async () => {
      let called = false
      let provider = new BasicDataProvider({
        provideData: () => {
          return []
        },
        onDispose: () => {
          called = true
        }
      })
      provider.dispose()
      assert.strictEqual(called, true)
    })
  })
})
