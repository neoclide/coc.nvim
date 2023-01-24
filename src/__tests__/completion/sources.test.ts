import { Neovim } from '@chemzqm/neovim'
import path from 'path'
import os from 'os'
import fs from 'fs'
import { CancellationToken, CancellationTokenSource, Disposable } from 'vscode-languageserver-protocol'
import { Position, Range, TextEdit } from 'vscode-languageserver-types'
import { Around } from '../../completion/native/around'
import { Buffer } from '../../completion/native/buffer'
import { File, filterFiles, getDirectory, getFileItem, getItemsFromRoot, resolveEnvVariables } from '../../completion/native/file'
import Source, { firstMatchFuzzy } from '../../completion/source'
import VimSource from '../../completion/source-vim'
import sources, { Sources, logError, getSourceType } from '../../completion/sources'
import { CompleteOption, ExtendedCompleteItem, SourceConfig, SourceType } from '../../completion/types'
import { disposeAll } from '../../util'
import extensions from '../../extension'
import workspace from '../../workspace'
import helper, { createTmpFile } from '../helper'

let nvim: Neovim
let disposables: Disposable[] = []
const emptyFn = () => Promise.resolve(null)
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  disposeAll(disposables)
  await helper.reset()
})

describe('KeywordsBuffer', () => {
  it('should parse keywords', async () => {
    let filepath = await createTmpFile(' ab\nab')
    let doc = await helper.createDocument(filepath)
    let b = sources.getKeywordsBuffer(doc.bufnr)
    let words = b.getWords()
    expect(words).toEqual(['ab'])
    await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'foo\nbar')])
    words = b.getWords()
    expect(words).toEqual(['foo', 'bar', 'ab'])
    await doc.applyEdits([TextEdit.replace(Range.create(0, 0, 1, 3), 'def ')])
    words = b.getWords()
    expect(words).toEqual(['def', 'ab'])
  })

  it('should yield match words', async () => {
    let filepath = await createTmpFile(`_foo\nbar\n`)
    let doc = await helper.createDocument(filepath)
    let b = sources.getKeywordsBuffer(doc.bufnr)
    const getResults = (iterable: Iterable<string>) => {
      let res: string[] = []
      for (let word of iterable) {
        res.push(word)
      }
      return res
    }
    let iterable = b.matchWords(0)
    expect(getResults(iterable)).toEqual(['_foo', 'bar'])
    iterable = b.matchWords(2)
    expect(getResults(iterable)).toEqual(['_foo', 'bar'])
  })
})

describe('Source', () => {
  function createSource(opt: SourceConfig): Source {
    let s = new Source(opt)
    disposables.push(s)
    return s
  }

  function makeid(length) {
    let result = ''
    let characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    let charactersLength = characters.length
    for (let i = 0; i < length; i++) {
      result += characters.charAt(Math.floor(Math.random() *
        charactersLength))
    }
    return result
  }

  it('should check trigger only source', async () => {
    expect(typeof Sources).toBe('function')
    logError('')
    let name = 'foo'
    let s = createSource({ name, triggerOnly: true, doComplete: emptyFn })
    expect(s.triggerOnly).toBe(true)
    expect(s.triggerPatterns).toBeNull()
    s = createSource({ name, doComplete: emptyFn })
    helper.updateConfiguration(`coc.source.${name}.triggerPatterns`, [null, 'foo'])
    expect(s.triggerOnly).toBe(true)
  })

  it('should get source type', async () => {
    for (let t of [SourceType.Native, SourceType.Remote, SourceType.Service]) {
      expect(getSourceType(t)).toBeDefined()
    }
  })

  it('should check complete', async () => {
    let name = 'foo'
    let s = createSource({ name, doComplete: emptyFn })
    helper.updateConfiguration(`coc.source.${name}.disableSyntaxes`, ['comment'])
    await nvim.input('i')
    let opt = await nvim.call('coc#util#get_complete_option') as CompleteOption
    opt.synname = 'Comment'
    expect(await s.checkComplete(opt)).toBe(false)
    let result = await s.doComplete(opt, CancellationToken.None)
    expect(result).toBeNull()
    opt.synname = 'String'
    expect(await s.checkComplete(opt)).toBe(true)
    opt.synname = ''
    expect(await s.checkComplete(opt)).toBe(true)
    s = createSource({
      name, shouldComplete: () => {
        return Promise.resolve(false)
      },
      doComplete: emptyFn
    })
    expect(await s.checkComplete(opt)).toBe(false)
  })

  it('should call optional functions', async () => {
    await nvim.input('i')
    let opt = await nvim.call('coc#util#get_complete_option') as CompleteOption
    let name = 'foo'
    let n = 0
    let s = createSource({
      name,
      doComplete: emptyFn,
      refresh: () => {
        n++
        return Promise.resolve()
      },
      onCompleteDone: () => {
        n++
        return Promise.resolve()
      },
      onCompleteResolve: () => {
        n++
        return Promise.resolve()
      }
    })
    expect(s.optionalFns).toEqual([])
    await s.refresh()
    await s.onCompleteDone({} as any, opt)
    await s.doComplete(opt, CancellationToken.None)
    await s.onCompleteResolve({} as any, opt, CancellationToken.None)
    expect(n).toBe(3)
  })

  it('should get results', async () => {
    let name = 'foo'
    let s = createSource({ name, doComplete: emptyFn })
    let words = []
    for (let i = 0; i < 80000; i++) {
      words.push(makeid(10))
    }
    let items: Set<string> = new Set()
    let tokenSource = new CancellationTokenSource()
    let p = s.getResults([words], '_$c', '', items, tokenSource.token)
    tokenSource.cancel()
    let res = await p
    expect(res).toBe(true)
    let n = Date.now()
    p = s.getResults([words], '_$a', '', items, CancellationToken.None)
    let spy = jest.spyOn(Date, 'now').mockImplementation(() => {
      return n + 200
    })
    res = await p
    spy.mockRestore()
    expect(res).toBe(true)
    words = []
    for (let i = 0; i < 300; i++) {
      words.push('a' + makeid(10))
    }
    items = new Set()
    res = await s.getResults([words], 'a', '', items, CancellationToken.None)
    expect(items.size).toBe(50)
    items = new Set()
    res = await s.getResults([['你好']], 'ni', '', items, CancellationToken.None)
    expect(items.size).toBe(1)
  })
})

describe('vim source', () => {
  function createSourceFile(name: string, content: string): string {
    let dir = path.join(os.tmpdir(), `coc/source`)
    fs.mkdirSync(dir, { recursive: true })
    let filepath = path.join(dir, `${name}.vim`)
    fs.writeFileSync(filepath, content, 'utf8')
    return filepath
  }

  it('should not throw when pluginPath already used', async () => {
    await sources.createVimSources(process.cwd())
    await sources.createVimSources(process.cwd())
  })

  it('should show error for bad source file', async () => {
    let filepath = createSourceFile('tmp', '')
    await sources.createVimSourceExtension(filepath)
    let line = await helper.getCmdline()
    expect(line).toMatch('Error')
  })

  it('should register filetypes extension for vim source', async () => {
    let content = `
function! coc#source#foo#init()
  return {'filetypes': ['vim'], 'firstMatch': v:true}
endfunction
function! coc#source#foo#complete(opt, cb) abort
  call a:cb([])
endfunction `
    let filepath = createSourceFile('foo', content)
    await sources.createVimSourceExtension(filepath)
    let ext = extensions.getExtension('coc-vim-source-foo')
    expect(ext).toBeDefined()
    await Promise.resolve(ext.deactivate())
  })

  it('should not run by check complete', async () => {
    let opt = await nvim.call('coc#util#get_complete_option') as CompleteOption
    let source = new VimSource({
      name: 'vim',
      sourceType: SourceType.Remote,
      optionalFns: ['on_complete', 'on_enter']
    })
    helper.updateConfiguration('coc.source.vim.disableSyntaxes', ['comment'])
    helper.updateConfiguration('coc.source.vim.filetypes', ['vim'])
    opt.synname = 'VimComment'
    opt.filetype = 'vim'
    let res = await source.checkComplete(opt)
    expect(res).toBe(false)
    let result = await source.doComplete(opt, CancellationToken.None)
    expect(result).toBe(null)
    opt.synname = ''
    res = await source.checkComplete(opt)
    expect(res).toBe(true)
    result = await source.doComplete(opt, CancellationToken.Cancelled)
    expect(result).toBe(null)
    source.onEnter(999)
    let bufnr = await nvim.call('bufnr', ['%']) as number
    source.onEnter(bufnr)
  })

  it('should register extension for vim source', async () => {
    let content = `
function! coc#source#foo#init()
  return {'firstMatch': v:true, 'isSnippet': v:true}
endfunction

function! coc#source#foo#on_enter(...)
  let g:coc_entered = 1
endfunction

function! coc#source#foo#get_startcol(opt)
  if a:opt['col'] == 1
    return 0
  endif
  return a:opt['col']
endfunction

function! coc#source#foo#complete(opt, cb) abort
  if a:opt['col'] == 0
    call a:cb([{'word': '.f'}])
    return
  endif
  call a:cb([])
endfunction `
    let filepath = createSourceFile('foo', content)
    await sources.createVimSourceExtension(filepath)
    let source = sources.getSource('foo')
    expect(source).toBeDefined()
    let bufnr = await nvim.call('bufnr', ['%']) as number
    source.onEnter(bufnr)
    let val = await nvim.getVar('coc_entered')
    expect(val).toBe(1)
    await nvim.setLine('.')
    await nvim.input('A')
    let opt = await nvim.call('coc#util#get_complete_option') as CompleteOption
    let res = await source.doComplete(opt, CancellationToken.None)
    expect(res.startcol).toBe(0)
    expect(res.items).toEqual([{ word: '.f', isSnippet: true }])
    opt.col = 2
    res = await source.doComplete(opt, CancellationToken.None)
    expect(res).toBe(null)
  })

  it('should not insert snippet when on_complete exists', async () => {
    let opt = await nvim.call('coc#util#get_complete_option') as CompleteOption
    let source = new VimSource({
      name: 'vim',
      sourceType: SourceType.Remote,
      optionalFns: ['on_complete']
    })
    let item: ExtendedCompleteItem = {
      word: 'word',
      abbr: 'word',
      filterText: 'word',
      isSnippet: true,
      insertText: 'word($1)'
    }
    let spy = jest.spyOn(nvim, 'call').mockImplementation(() => {
      return undefined
    })
    await source.refresh()
    await source.onCompleteDone(item, opt)
    spy.mockRestore()
    let line = await nvim.line
    expect(line).toBe('')
  })

  it('should insert snippet', async () => {
    let opt = await nvim.call('coc#util#get_complete_option') as CompleteOption
    let source = new VimSource({
      name: 'vim',
      sourceType: SourceType.Remote
    })
    let item: ExtendedCompleteItem = {
      word: 'word',
      abbr: 'word',
      filterText: 'word',
      isSnippet: true,
      insertText: 'word($1)'
    }
    await source.onCompleteDone(item, opt)
    let line = await nvim.line
    expect(line).toBe('word()')
  })
})

describe('native sources', () => {
  it('should resolveEnvVariables', () => {
    expect(resolveEnvVariables('%HOME%/data%x%', { HOME: '/home' })).toBe('/home/data%x%')
    expect(resolveEnvVariables('$HOME/${USER}/data', { HOME: '/home', USER: 'foo' })).toBe('/home/foo/data')
    expect(resolveEnvVariables('$PART/data', {})).toBe('$PART/data')
  })

  it('should getDirectory', () => {
    expect(getDirectory('a/b', '/home')).toBe('/home/a')
    expect(getDirectory(__dirname, '/home')).toBe(path.dirname(__dirname))
  })

  it('should getItemsFromRoot', async () => {
    let res = await getItemsFromRoot('a/b', '/not_exists', true, [])
    expect(res).toEqual([])
  })

  it('should getFileItem', async () => {
    expect(await getFileItem(__dirname, '')).toBeDefined()
    expect(await getFileItem(__dirname, 'file_not_exists')).toBeNull()
    expect(await getFileItem(__dirname, path.basename(__filename))).toBeDefined()
  })

  it('should filterFiles', () => {
    expect(filterFiles(['.a', '.b', null], false)).toEqual(['.a', '.b'])
    expect(filterFiles(['a.js', 'b.ts'], true, ['*.js'])).toEqual(['b.ts'])
  })

  it('should getRoot', async () => {
    let file = new File(false)
    let filepath = __filename
    let cwd = process.cwd()
    let root = await file.getRoot('./a', '', '', cwd)
    expect(root).toBe(cwd)
    root = await file.getRoot('./a', '', filepath, cwd)
    expect(root).toBe(path.dirname(filepath))
    root = await file.getRoot('/a/b/', '', filepath, cwd)
    expect(root).toBe('/a/b/')
    root = await file.getRoot('/a/b', '', filepath, cwd)
    expect(root).toBe('/a')
    root = await file.getRoot('', 'a/b/not_exists', filepath, cwd)
    expect(root).toBeUndefined()
    let dir = path.dirname(__dirname)
    let base = path.basename(__dirname)
    root = await file.getRoot('', base, __dirname, cwd)
    expect(root).toBe(dir)
    root = await file.getRoot('', base, '/a/b', dir)
    expect(root).toBe(dir)
    root = await file.getRoot('', '', '', dir)
    expect(root).toBe(dir)
    file.isWindows = true
    root = await file.getRoot('C:\\user', '', filepath, cwd)
    expect(root).toBe('C:\\')
    root = await file.getRoot('C:\\user\\', '', filepath, cwd)
    expect(root).toBe('C:\\user\\')
    let arr = file.triggerCharacters
    expect(arr.includes('\\')).toBe(true)
  })

  it('should firstMatchFuzzy', async () => {
    expect(firstMatchFuzzy(97, true, '_a')).toBe(true)
    expect(firstMatchFuzzy(97, true, 'a')).toBe(true)
    expect(firstMatchFuzzy(97, true, 'A')).toBe(true)
    expect(firstMatchFuzzy(97, true, 'â')).toBe(true)
    expect(firstMatchFuzzy(226, false, 'â')).toBe(true)
  })

  it('should works for around source', async () => {
    let doc = await workspace.document
    await nvim.setLine('foo ')
    await doc.synchronize()
    let { mode } = await nvim.mode
    expect(mode).toBe('n')
    await nvim.input('Af')
    await helper.waitPopup()
    let res = await helper.visible('foo', 'around')
    expect(res).toBe(true)
    await nvim.input('<esc>')
  })

  it('should works for buffer source', async () => {
    await helper.createDocument()
    await nvim.command('set hidden')
    let doc = await helper.createDocument()
    await nvim.setLine('other')
    await nvim.command('bp')
    await doc.synchronize()
    let { mode } = await nvim.mode
    expect(mode).toBe('n')
    await nvim.input('io')
    let res = await helper.visible('other', 'buffer')
    expect(res).toBe(true)
  })

  it('should trigger for inComplete complete', async () => {
    await nvim.setLine('foo')
    await nvim.input('A')
    let opt = await nvim.call('coc#util#get_complete_option') as CompleteOption
    opt.triggerForInComplete = true
    let around = new Around(sources.keywords)
    let res = await around.doComplete(opt, CancellationToken.None)
    expect(res).toBeDefined()
    let buffer = new Buffer(sources.keywords)
    res = await buffer.doComplete(opt, CancellationToken.None)
    expect(res).toBeDefined()
  })

  it('should fix col for file source', async () => {
    await nvim.command(`edit t|setl iskeyword+=/`)
    await nvim.setLine('./')
    await nvim.input('A')
    nvim.call('coc#start', { source: 'file' }, true)
    await helper.waitPopup()
  })

  it('should trim ext for file source', async () => {
    let cwd = path.resolve(__dirname, '..')
    let file = path.join(cwd, 't.ts')
    await helper.edit(file)
    await nvim.setLine('./')
    await nvim.input('A')
    nvim.call('coc#start', { source: 'file' }, true)
    await helper.waitPopup()
    let items = helper.completion.activeItems
    let idx = items.findIndex(o => o.word.endsWith('.ts'))
    expect(idx).toBe(-1)
  })

  it('should not complete when cancelled', async () => {
    await nvim.setLine('/foo')
    await nvim.input('A')
    let file = new File(false)
    let tokenSource = new CancellationTokenSource()
    let opt = await nvim.call('coc#util#get_complete_option') as CompleteOption
    let p = file.doComplete(opt, tokenSource.token)
    tokenSource.cancel()
    let res = await p
    expect(res).toBeNull()
  })

  it('should complete with words source', async () => {
    let stats = sources.sourceStats()
    let find = stats.find(o => o.name === '$words')
    expect(find).toBeUndefined()
    let s = sources.getSource('$words')
    expect(s.name).toBe('$words')
    expect(s.shortcut).toBe('')
    expect(s.triggerOnly).toBe(true)
    sources.setWords(['foo', 'bar'])
    await nvim.setLine('longwords')
    await nvim.input('A')
    nvim.call('coc#start', { source: '$words' }, true)
    await helper.waitPopup()
    let items = await helper.items()
    expect(items.map(o => o.word)).toEqual(['foo', 'bar'])
  })
})
