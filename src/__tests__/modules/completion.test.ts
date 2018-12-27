import helper from '../helper'
import workspace from '../../workspace'
import { Neovim } from '@chemzqm/neovim'
import completion from '../../completion'
import languages from '../../languages'
import sources from '../../sources'
import { CompleteOption, ISource, CompleteResult, SourceType, CompletionContext } from '../../types'
import { CompletionItemProvider } from '../../provider'
import { TextDocument, Position, CompletionItem, InsertTextFormat } from 'vscode-languageserver-types'
import { CancellationToken } from 'vscode-jsonrpc'

let nvim: Neovim
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
})

beforeEach(async () => {
  await helper.createDocument()
  await nvim.input('<esc>')
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  await helper.reset()
})

async function startCompletion(): Promise<void> {
  let buf = await nvim.buffer
  await buf.setLines(['foo ', 'bar '], {
    start: 0,
    end: 0,
    strictIndexing: false
  })
  await nvim.call('cursor', [1, 1])
  await nvim.input('Af')
  await helper.waitPopup()
  expect(completion.isActivted).toBe(true)
}

describe('completion events', () => {

  it('should load preferences', () => {
    let preferences = (completion as any).preferences
    let minTriggerInputLength = preferences.get('minTriggerInputLength', 1)
    expect(minTriggerInputLength).toBe(1)
  })

  it('should reload preferences onChange', () => {
    let { configurations } = workspace
    configurations.updateUserConfig({ 'coc.preferences.snippetIndicator': '*' })
    let preferences = (completion as any).preferences
    let snippetIndicator = preferences.get('snippetIndicator', 1)
    expect(snippetIndicator).toBe('*')
  })
})

describe('completion getResumeInput', () => {

  it('should return null when document is null', async () => {
    let input = await completion.getResumeInput()
    expect(input).toBeNull()
  })

  it('should deactivate when cursor col below col of option', async () => {
    await startCompletion()
    let opt = completion.option
    await nvim.call('cursor', [opt.linenr, opt.col - 1])
    let input = await completion.getResumeInput()
    expect(input).toBeNull()
    expect(completion.isActivted).toBe(false)
  })

  it('should deactivate when cursor line not equal option linenr', async () => {
    await startCompletion()
    await nvim.call('cursor', [2, 0])
    let input = await completion.getResumeInput()
    expect(input).toBeNull()
    expect(completion.isActivted).toBe(false)
  })
})

describe('completion#startCompletion', () => {

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

  it('should use resume input to filter', async () => {
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
    sources.addSource(source)
    await helper.edit()
    await nvim.input('i.')
    await helper.wait(60)
    await nvim.input('f')
    await helper.waitPopup()
    expect(completion.isActivted).toBe(true)
    let items = completion.completeItems
    expect(items.length).toBe(1)
    expect(items[0].word).toBe('foo')
    sources.removeSource(source)
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
    sources.addSource(source)
    await helper.edit()
    await nvim.input('i.')
    await helper.waitPopup()
    expect(completion.isActivted).toBe(true)
    let items = completion.completeItems
    await nvim.input('a')
    await helper.wait(10)
    await nvim.input('b')
    await helper.wait(100)
    sources.removeSource(source)
    items = completion.completeItems
    expect(items[0].word).toBe('ab')
    await nvim.input('<esc>')
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
    let items = completion.completeItems
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
    await nvim.input('i.f')
    await helper.waitPopup()
    expect(completion.isActivted).toBe(true)
    sources.removeSource(source)
    let items = completion.completeItems
    expect(items[0].word).toBe('foo bar')
    await nvim.input(' ')
    await helper.wait(60)
    expect(completion.isActivted).toBe(false)
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
          insertText: '${1:foo} $1',
          insertTextFormat: InsertTextFormat.Snippet,
        }]
      }
    }
    let disposable = languages.registerCompletionItemProvider('snippets-test', 'st', null, provider)
    await nvim.input('if')
    await helper.waitPopup()
    let items = completion.completeItems
    expect(items[0].isSnippet).toBe(true)
    await helper.wait(100)
    await nvim.input('<C-n>')
    await helper.wait(100)
    let line = await nvim.line
    expect(line).toBe('foo')
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
    let items = completion.completeItems
    expect(items[0].info).toBe('detail')
    sources.removeSource(source)
  })
})

describe('completion#CompleteDone', () => {
  it('should fix word on CompleteDone', async () => {
    await nvim.setLine('fball football')
    await nvim.input('i')
    await nvim.call('cursor', [1, 2])
    let option: CompleteOption = await nvim.call('coc#util#get_complete_option')
    await completion.startCompletion(option)
    let items = completion.completeItems
    expect(items.length).toBe(1)
    await nvim.input('<C-n>')
    await helper.wait(30)
    await nvim.call('coc#_select')
    await helper.wait(100)
    let line = await nvim.line
    expect(line).toBe('football football')
  })
})

describe('completion#TextChangedI', () => {
  it('should respect commitCharacter', async () => {
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
    let line = await nvim.line
    expect(line).toBe('foo.')
    sources.removeSource(source)
  })

  it('should trigger completion when possible', async () => {
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
    await helper.pumvisible()
    await helper.wait(80)
    expect(completion.isActivted).toBe(true)
    let items = completion.completeItems
    expect(items.length).toBe(1)
    sources.removeSource(source)
  })
})

describe('completion#shouldTrigger', () => {

  it('should not trigger if autoTrigger is none', async () => {
    let config = workspace.getConfiguration('coc.preferences')
    config.update('autoTrigger', 'none')
    let autoTrigger = completion.getPreference('autoTrigger')
    expect(autoTrigger).toBe('none')
    await nvim.setLine('foo fo')
    await nvim.input('A')
    await helper.wait(100)
    expect(completion.isActivted).toBe(false)
    config.update('autoTrigger', 'always')
    await helper.wait(100)
  })
})

describe('completion#InsertEnter', () => {

  it('should trigger completion if triggerAfterInsertEnter is true', async () => {
    let config = workspace.getConfiguration('coc.preferences')
    config.update('triggerAfterInsertEnter', true)
    await helper.wait(100)
    let triggerAfterInsertEnter = completion.getPreference('triggerAfterInsertEnter')
    expect(triggerAfterInsertEnter).toBe(true)
    await nvim.setLine('foo fo')
    await nvim.input('A')
    await helper.waitPopup()
    expect(completion.isActivted).toBe(true)
    config.update('triggerAfterInsertEnter', undefined)
  })

  it('should not trigger when input length too small', async () => {
    let config = workspace.getConfiguration('coc.preferences')
    config.update('triggerAfterInsertEnter', true)
    await helper.wait(100)
    let triggerAfterInsertEnter = completion.getPreference('triggerAfterInsertEnter')
    expect(triggerAfterInsertEnter).toBe(true)
    await nvim.setLine('foo ')
    await nvim.input('A')
    await helper.wait(100)
    expect(completion.isActivted).toBe(false)
    config.update('triggerAfterInsertEnter', undefined)
  })
})
