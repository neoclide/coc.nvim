import helper from '../helper'
import workspace from '../../workspace'
import { Neovim } from '@chemzqm/neovim'
import completion from '../../completion'
import languages from '../../languages'
import sources from '../../sources'
import { CompleteOption, ISource, CompleteResult, SourceType, CompletionContext } from '../../types'
import { CompletionItemProvider } from '../../provider'
import { TextDocument, Position, CompletionItem, InsertTextFormat, TextEdit } from 'vscode-languageserver-types'
import { CancellationToken } from 'vscode-jsonrpc'

let nvim: Neovim
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
})

beforeEach(async () => {
  await helper.createDocument()
  await nvim.call('feedkeys', [String.fromCharCode(27), 'in'])
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  await helper.reset()
})

describe('completion events', () => {

  it('should load preferences', () => {
    let minTriggerInputLength = completion.config.minTriggerInputLength
    expect(minTriggerInputLength).toBe(1)
  })

  it('should reload preferences onChange', () => {
    let { configurations } = workspace
    configurations.updateUserConfig({ 'suggest.maxCompleteItemCount': 30 })
    let snippetIndicator = completion.config.maxItemCount
    expect(snippetIndicator).toBe(30)
  })
})

describe('completion start', () => {

  it('should deactivate on doComplete error', async () => {
    let fn = (completion as any)._doComplete
      ; (completion as any)._doComplete = async () => {
        throw new Error('fake')
      }
    let option: CompleteOption = await nvim.call('coc#util#get_complete_option')
    await completion.startCompletion(option)
      ; (completion as any)._doComplete = fn
    expect(completion.isActivted).toBe(false)
    await nvim.input('<esc>')
  })

  it('should start completion', async () => {
    await nvim.setLine('foo football')
    await nvim.input('a')
    await nvim.call('cursor', [1, 2])
    let option: CompleteOption = await nvim.call('coc#util#get_complete_option')
    await completion.startCompletion(option)
    await helper.wait(30)
    expect(completion.isActivted).toBe(true)
  })

  it('should show slow source', async () => {
    let source: ISource = {
      priority: 0,
      enable: true,
      name: 'slow',
      sourceType: SourceType.Service,
      triggerCharacters: ['.'],
      doComplete: (_opt: CompleteOption): Promise<CompleteResult> => {
        return new Promise(resolve => {
          setTimeout(() => {
            resolve({ items: [{ word: 'foo' }, { word: 'bar' }] })
          }, 600)
        })
      }
    }
    let disposable = sources.addSource(source)
    await helper.edit()
    await nvim.input('i.')
    await helper.waitPopup()
    expect(completion.isActivted).toBe(true)
    let items = await helper.items()
    expect(items.length).toBe(2)
    disposable.dispose()
  })
})

describe('completion#resumeCompletion', () => {

  it('should stop if no filtered items', async () => {
    await nvim.setLine('foo ')
    await helper.wait(50)
    await nvim.input('Af')
    await helper.waitPopup()
    expect(completion.isActivted).toBe(true)
    await nvim.input('d')
    await helper.wait(60)
    expect(completion.isActivted).toBe(false)
    await nvim.input('<esc>')
  })

  it('should deactivate without filtered items', async () => {
    await nvim.setLine('foo fbi ')
    await nvim.input('Af')
    await helper.waitPopup()
    await nvim.input('c')
    await helper.wait(100)
    let items = await helper.items()
    expect(items.length).toBe(0)
    expect(completion.isActivted).toBe(false)
    await nvim.input('<esc>')
  })

  it('should deactivate when insert space', async () => {
    let source: ISource = {
      priority: 0,
      enable: true,
      name: 'empty',
      sourceType: SourceType.Service,
      triggerCharacters: ['.'],
      doComplete: (_opt: CompleteOption): Promise<CompleteResult> => {
        return new Promise(resolve => {
          resolve({ items: [{ word: 'foo bar' }] })
        })
      }
    }
    sources.addSource(source)
    await helper.edit()
    await nvim.input('i.')
    await helper.waitPopup()
    expect(completion.isActivted).toBe(true)
    sources.removeSource(source)
    let items = await helper.items()
    expect(items[0].word).toBe('foo bar')
    await nvim.input(' ')
    await helper.wait(60)
    expect(completion.isActivted).toBe(false)
  })

  it('should use resume input to filter', async () => {
    let source: ISource = {
      priority: 0,
      enable: true,
      name: 'source',
      sourceType: SourceType.Service,
      triggerCharacters: ['.'],
      doComplete: (_opt: CompleteOption): Promise<CompleteResult> => {
        return new Promise(resolve => {
          setTimeout(() => {
            resolve({ items: [{ word: 'foo' }, { word: 'bar' }] })
          }, 60)
        })
      }
    }
    sources.addSource(source)
    await helper.edit()
    await nvim.input('i.')
    await helper.wait(20)
    await nvim.input('f')
    await helper.waitPopup()
    expect(completion.isActivted).toBe(true)
    let items = await helper.items()
    expect(items.length).toBe(1)
    expect(items[0].word).toBe('foo')
    sources.removeSource(source)
  })

  it('should filter slow source', async () => {
    let source: ISource = {
      priority: 0,
      enable: true,
      name: 'slow',
      sourceType: SourceType.Service,
      triggerCharacters: ['.'],
      doComplete: (_opt: CompleteOption): Promise<CompleteResult> => {
        return new Promise(resolve => {
          setTimeout(() => {
            resolve({ items: [{ word: 'foo' }, { word: 'bar' }] })
          }, 600)
        })
      }
    }
    let disposable = sources.addSource(source)
    await helper.edit()
    await nvim.input('i.')
    await helper.wait(60)
    await nvim.input('f')
    await helper.waitPopup()
    await nvim.input('o')
    await helper.wait(100)
    expect(completion.isActivted).toBe(true)
    let items = await helper.items()
    expect(items.length).toBe(1)
    expect(items[0].word).toBe('foo')
    disposable.dispose()
  })

  it('should complete inComplete source', async () => {
    let source: ISource = {
      priority: 0,
      enable: true,
      name: 'inComplete',
      sourceType: SourceType.Service,
      triggerCharacters: ['.'],
      doComplete: async (opt: CompleteOption): Promise<CompleteResult> => {
        await helper.wait(30)
        if (opt.input.length <= 1) {
          return { isIncomplete: true, items: [{ word: 'foo' }, { word: opt.input }] }
        }
        return { isIncomplete: false, items: [{ word: 'foo' }, { word: opt.input }] }
      }
    }
    let disposable = sources.addSource(source)
    await helper.edit()
    await nvim.input('i.')
    await helper.waitPopup()
    expect(completion.isActivted).toBe(true)
    let items = await helper.items()
    await nvim.input('a')
    await helper.wait(10)
    await nvim.input('b')
    await helper.wait(100)
    disposable.dispose()
    items = await helper.items()
    expect(items[0].word).toBe('ab')
    await nvim.input('<esc>')
  })

  it('should not complete inComplete source when none word inserted', async () => {
    let lastOption: CompleteOption
    let source: ISource = {
      priority: 0,
      enable: true,
      name: 'inComplete',
      sourceType: SourceType.Service,
      triggerCharacters: ['.'],
      doComplete: async (opt: CompleteOption): Promise<CompleteResult> => {
        lastOption = opt
        await helper.wait(30)
        if (opt.input.length <= 1) {
          return { isIncomplete: true, items: [{ word: 'foo' }, { word: opt.input }] }
        }
        return { isIncomplete: false, items: [{ word: 'foo' }, { word: opt.input }] }
      }
    }
    sources.addSource(source)
    await helper.edit()
    await nvim.input('i.')
    await helper.waitPopup()
    expect(completion.isActivted).toBe(true)
    await nvim.input('a')
    await helper.wait(10)
    await nvim.input(',')
    await helper.wait(300)
    sources.removeSource(source)
    expect(lastOption.triggerForInComplete).toBeFalsy()
    await nvim.input('<esc>')
  })
})

describe('completion#TextChangedP', () => {

  it('should stop when input length below option input length', async () => {
    await nvim.setLine('foo fbi ')
    await nvim.input('Afo')
    await helper.waitPopup()
    await nvim.input('<backspace>')
    await helper.wait(100)
    expect(completion.isActivted).toBe(false)
  })

  it('should fix cursor position on additionalTextEdits', async () => {
    let provider: CompletionItemProvider = {
      provideCompletionItems: async (
        _document: TextDocument,
        _position: Position,
        _token: CancellationToken,
        _context: CompletionContext
      ): Promise<CompletionItem[]> => {
        return [{
          label: 'foo',
          filterText: 'foo',
          additionalTextEdits: [TextEdit.insert(Position.create(0, 0), 'a\nbar')]
        }]
      }
    }
    let disposable = languages.registerCompletionItemProvider('edits', 'edit', null, provider)
    await nvim.input('if')
    await helper.waitPopup()
    await helper.wait(100)
    await nvim.input('<C-n>')
    await helper.wait(100)
    await nvim.input('<C-y>')
    await helper.wait(200)
    let line = await nvim.line
    expect(line).toBe('barfoo')
    let [, lnum, col] = await nvim.call('getcurpos')
    expect(lnum).toBe(2)
    expect(col).toBe(7)
    disposable.dispose()

  })

  it('should fix input for snippet item', async () => {
    let provider: CompletionItemProvider = {
      provideCompletionItems: async (
        _document: TextDocument,
        _position: Position,
        _token: CancellationToken,
        _context: CompletionContext
      ): Promise<CompletionItem[]> => {
        return [{
          label: 'foo',
          filterText: 'foo',
          insertText: '${1:foo}($2)',
          insertTextFormat: InsertTextFormat.Snippet,
        }]
      }
    }
    let disposable = languages.registerCompletionItemProvider('snippets-test', 'st', null, provider)
    await nvim.input('if')
    await helper.waitPopup()
    await nvim.input('<C-n>')
    await helper.wait(100)
    let line = await nvim.line
    expect(line).toBe('foo')
    disposable.dispose()
  })

  it('should filter on none keyword input', async () => {
    let source: ISource = {
      priority: 99,
      enable: true,
      name: 'temp',
      sourceType: SourceType.Service,
      doComplete: (_opt: CompleteOption): Promise<CompleteResult> => {
        return Promise.resolve({ items: [{ word: 'foo#abc' }] })
      },
    }
    let disposable = sources.addSource(source)
    await nvim.input('if')
    await helper.waitPopup()
    await nvim.input('#')
    await helper.wait(100)
    let items = await helper.getItems()
    expect(items[0].word).toBe('foo#abc')
    disposable.dispose()
  })

  it('should do resolve for complete item', async () => {
    let source: ISource = {
      priority: 0,
      enable: true,
      name: 'resolve',
      sourceType: SourceType.Service,
      triggerCharacters: ['.'],
      doComplete: (_opt: CompleteOption): Promise<CompleteResult> => {
        return Promise.resolve({ items: [{ word: 'foo' }] })
      },
      onCompleteResolve: item => {
        item.info = 'detail'
      }
    }
    sources.addSource(source)
    await nvim.input('i.')
    await helper.waitPopup()
    await helper.wait(100)
    await nvim.input('<C-n>')
    await helper.wait(100)
    // let items = completion.completeItems
    // expect(items[0].info).toBe('detail')
    sources.removeSource(source)
  })
})

describe('completion done', () => {
  it('should fix word on CompleteDone', async () => {
    await nvim.setLine('fball football')
    await nvim.input('i')
    await nvim.call('cursor', [1, 2])
    let option: CompleteOption = await nvim.call('coc#util#get_complete_option')
    await completion.startCompletion(option)
    let items = await helper.items()
    expect(items.length).toBe(1)
    await nvim.input('<C-n>')
    await helper.wait(30)
    await nvim.call('coc#_select')
    await helper.wait(100)
    let line = await nvim.line
    expect(line).toBe('football football')
  })
})

describe('completion option', () => {
  it('should hide kind and menu when configured', async () => {
    helper.updateConfiguration('suggest.disableKind', true)
    helper.updateConfiguration('suggest.disableMenu', true)
    await nvim.setLine('fball football')
    await nvim.input('of')
    await helper.waitPopup()
    let items = await helper.getItems()
    expect(items[0].kind).toBeUndefined()
    expect(items[0].menu).toBeUndefined()
    helper.updateConfiguration('suggest.disableKind', false)
    helper.updateConfiguration('suggest.disableMenu', false)
  })
})

describe('completion resume', () => {
  it('should respect commitCharacter on TextChangedI', async () => {
    let source: ISource = {
      priority: 0,
      enable: true,
      name: 'slow',
      sourceType: SourceType.Service,
      triggerCharacters: ['.'],
      doComplete: (opt: CompleteOption): Promise<CompleteResult> => {
        if (opt.triggerCharacter == '.') {
          return Promise.resolve({ items: [{ word: 'bar' }] })
        }
        return Promise.resolve({ items: [{ word: 'foo' }] })
      },
      shouldCommit: (_item, character) => {
        return character == '.'
      }
    }
    sources.addSource(source)
    await nvim.input('if')
    await helper.pumvisible()
    await helper.wait(100)
    await nvim.input('.')
    await helper.wait(100)
    sources.removeSource(source)
  })
})

describe('completion trigger', () => {
  it('should trigger completion on CursorMovedI', async () => {
    let source: ISource = {
      priority: 0,
      enable: true,
      name: 'trigger',
      sourceType: SourceType.Service,
      triggerCharacters: ['>'],
      doComplete: async (opt: CompleteOption): Promise<CompleteResult> => {
        if (opt.triggerCharacter == '>') {
          return { items: [{ word: 'foo' }] }
        }
        return null
      }
    }
    let disposable = sources.addSource(source)
    await helper.edit()
    await nvim.input('i><esc>a')
    await helper.waitPopup()
    let items = await helper.getItems()
    expect(items.length).toBe(1)
    disposable.dispose()
  })

  it('should trigger completion on type trigger character', async () => {
    let source: ISource = {
      priority: 1,
      enable: true,
      name: 'trigger',
      sourceType: SourceType.Service,
      triggerCharacters: ['.'],
      doComplete: (opt: CompleteOption): Promise<CompleteResult> => {
        if (opt.triggerCharacter == '.') {
          return Promise.resolve({ items: [{ word: 'bar' }] })
        }
        return Promise.resolve({ items: [{ word: 'foo#bar' }] })
      }
    }
    sources.addSource(source)
    await nvim.input('i')
    await helper.wait(30)
    await nvim.input('.')
    await helper.waitPopup()
    let items = await helper.items()
    expect(items.length).toBeGreaterThan(0)
    sources.removeSource(source)
  })

  it('should not trigger if autoTrigger is none', async () => {
    let config = workspace.getConfiguration('suggest')
    config.update('autoTrigger', 'none')
    let autoTrigger = completion.config.autoTrigger
    expect(autoTrigger).toBe('none')
    await nvim.setLine('foo fo')
    await nvim.input('A')
    await helper.wait(100)
    expect(completion.isActivted).toBe(false)
    config.update('autoTrigger', 'always')
    await helper.wait(100)
  })

  it('should trigger complete on trigger patterns match', async () => {
    let source: ISource = {
      priority: 99,
      enable: true,
      name: 'temp',
      triggerPatterns: [/EM/],
      sourceType: SourceType.Service,
      doComplete: (opt: CompleteOption): Promise<CompleteResult> => {
        if (!opt.input.startsWith('EM')) return null
        return Promise.resolve({
          items: [
            { word: 'foo', filterText: 'EMfoo' },
            { word: 'bar', filterText: 'EMbar' }
          ]
        })
      },
    }
    let disposable = sources.addSource(source)
    await nvim.input('i')
    await nvim.input('EM')
    await helper.waitPopup()
    let items = await helper.getItems()
    expect(items.length).toBe(2)
    disposable.dispose()
  })

  it('should trigger complete when pumvisible and triggerPatterns match', async () => {
    await nvim.setLine('EnumMember')
    let source: ISource = {
      priority: 99,
      enable: true,
      name: 'temp',
      triggerPatterns: [/EM/],
      sourceType: SourceType.Service,
      doComplete: (opt: CompleteOption): Promise<CompleteResult> => {
        if (!opt.input.startsWith('EM')) return null
        return Promise.resolve({
          items: [
            { word: 'a', filterText: 'EMa' },
            { word: 'b', filterText: 'EMb' }
          ]
        })
      },
    }
    let disposable = sources.addSource(source)
    await nvim.input('o')
    await helper.wait(10)
    await nvim.input('E')
    await helper.wait(30)
    await nvim.input('M')
    await helper.waitPopup()
    let items = await helper.getItems()
    expect(items.length).toBeGreaterThan(2)
    disposable.dispose()
  })
})

describe('completion#InsertEnter', () => {

  it('should trigger completion if triggerAfterInsertEnter is true', async () => {
    let config = workspace.getConfiguration('suggest')
    config.update('triggerAfterInsertEnter', true)
    await helper.wait(100)
    let triggerAfterInsertEnter = completion.config.triggerAfterInsertEnter
    expect(triggerAfterInsertEnter).toBe(true)
    await nvim.setLine('foo fo')
    await nvim.input('A')
    await helper.waitPopup()
    expect(completion.isActivted).toBe(true)
    config.update('triggerAfterInsertEnter', undefined)
  })

  it('should not trigger when input length too small', async () => {
    let config = workspace.getConfiguration('suggest')
    config.update('triggerAfterInsertEnter', true)
    await helper.wait(100)
    let triggerAfterInsertEnter = completion.config.triggerAfterInsertEnter
    expect(triggerAfterInsertEnter).toBe(true)
    await nvim.setLine('foo ')
    await nvim.input('A')
    await helper.wait(100)
    expect(completion.isActivted).toBe(false)
    config.update('triggerAfterInsertEnter', undefined)
  })
})
