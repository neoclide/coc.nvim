import { Neovim } from '@chemzqm/neovim'
import languages from './languages'
import VimSource from './model/source-vim'
import { CompleteOption, ISource, SourceConfig, SourceType, VimCompleteItem, WorkspaceConfiguration, DocumentInfo } from './types'
import { echoErr, echoMessage, disposeAll } from './util'
import { statAsync } from './util/fs'
import { isWord } from './util/string'
import workspace from './workspace'
import path from 'path'
import fs from 'fs'
import pify from 'pify'
import { EventEmitter } from 'events'
import { Disposable } from 'vscode-jsonrpc'
const logger = require('./util/logger')('sources')

export default class Sources extends EventEmitter {
  private sourceMap: Map<string, ISource> = new Map()
  private sourceConfig: WorkspaceConfiguration
  private disposables:Disposable[] = []
  private _ready = false

  constructor(private nvim: Neovim) {
    super()
    this.sourceConfig = workspace.getConfiguration('coc.source')
    Promise.all([
      this.createNativeSources(),
      this.createRemoteSources(),
    ]).finally(() => {
      this._ready = true
      this.emit('ready')
      logger.debug(`Created sources ${this.names}`)
    }).catch(e => {
      logger.error(`Error on source create ${e.message}`)
    })
    languages.onDidCompletionSourceCreated(source => {
      let { name } = source
      if (source.enable) {
        this.addSource(name, source)
        logger.debug('created service source', name)
      }
    }, this, this.disposables)
    workspace.onDidEnterTextDocument(this.onDocumentEnter, this, this.disposables)
  }

  public get ready(): Promise<void> {
    if (this._ready) {
      return Promise.resolve()
    }
    return new Promise(resolve => {
      this.once('ready', resolve)
    })
  }

  public get names(): string[] {
    return Array.from(this.sourceMap.keys())
  }

  public get sources(): ISource[] {
    return Array.from(this.sourceMap.values())
  }

  public has(name): boolean {
    return this.names.findIndex(o => o == name) != -1
  }

  public getSource(name: string): ISource | null {
    return this.sourceMap.get(name) || null
  }

  /**
   * Make only one source available
   *
   * @public
   * @param {string} name - source name
   * @returns {Promise<void>}
   */
  public async onlySource(name: string): Promise<void> {
    for (let n of this.names) {
      let source = this.sourceMap.get(n)
      source.enable = name == n
    }
    if (this.names.indexOf(name) == -1) {
      require(`./__tests__/test-sources/${name}`)
    }
  }

  public async doCompleteResolve(item: VimCompleteItem): Promise<void> {
    let { user_data } = item
    if (!user_data) return
    try {
      let data = JSON.parse(user_data)
      if (!data.source) return
      let source = this.getSource(data.source)
      if (source) await source.onCompleteResolve(item)
    } catch (e) {
      logger.error(e.stack)
    }
  }

  public async doCompleteDone(item: VimCompleteItem): Promise<void> {
    let data = JSON.parse(item.user_data)
    let source = this.getSource(data.source)
    if (source && typeof source.onCompleteDone === 'function') {
      await source.onCompleteDone(item)
    }
  }

  public getCompleteSources(opt: CompleteOption): ISource[] {
    let { triggerCharacter, filetype, custom } = opt
    let sources: ISource[]
    if (triggerCharacter) {
      sources = this.getTriggerSources(triggerCharacter, filetype)
    } else {
      sources = this.getSourcesForFiletype(filetype, false)
    }
    let customs = workspace.getConfiguration('coc.preferences').get<string[]>('customSources', [])
    return sources.filter(source => {
      if (custom) return customs.indexOf(source.name) !== -1
      return customs.indexOf(source.name) == -1
    })
  }

  public shouldTrigger(character: string, languageId: string): boolean {
    return this.getTriggerSources(character, languageId).length > 0
  }

  public getTriggerSources(character: string, languageId: string): ISource[] {
    let special = !isWord(character)
    let sources = this.sources.filter(s => {
      if (!s.enable) return false
      let { filetypes } = s
      if (filetypes && filetypes[0] == '-') return true
      if (filetypes && filetypes.indexOf(languageId) == -1) {
        return false
      }
      return true
    })
    if (special) {
      return sources.filter(o => {
        return o.triggerCharacters.indexOf(character) !== -1
      })
    }
    return sources
  }

  public getSourcesForFiletype(filetype: string, includeDisabled = true): ISource[] {
    return this.sources.filter(source => {
      let { filetypes } = source
      if (!includeDisabled && !source.enable) return false
      if (!filetypes || filetypes[0] == '-') return true
      if (filetype && filetypes.indexOf(filetype) !== -1) {
        return true
      }
      return false
    })
  }

  private addSource(name: string, source: ISource): void {
    if (this.names.indexOf(name) !== -1) {
      echoMessage(this.nvim, `Source "${name}" recreated`)
    }
    this.sourceMap.set(name, source)
  }

  private async createNativeSources(): Promise<void> {
    (await import('./source/around')).regist(this.sourceMap)
    ;(await import('./source/dictionary')).regist(this.sourceMap)
    ;(await import('./source/buffer')).regist(this.sourceMap)
    ;(await import('./source/emoji')).regist(this.sourceMap)
    ;(await import('./source/file')).regist(this.sourceMap)
    ;(await import('./source/include')).regist(this.sourceMap)
    ;(await import('./source/tag')).regist(this.sourceMap)
    ;(await import('./source/gocode')).regist(this.sourceMap)
    ;(await import('./source/word')).regist(this.sourceMap)
    ;(await import('./source/omni')).regist(this.sourceMap)
  }

  private getSourceConfig(name: string): Partial<SourceConfig> {
    let opt = this.sourceConfig.get(name, {} as any) as any
    let res = {}
    for (let key of Object.keys(opt)) {
      res[key] = opt[key]
    }
    return res
  }

  private async createVimSourceFromPath(p: string): Promise<void> {
    let { nvim } = this
    let name = path.basename(p, '.vim')
    let opts = this.getSourceConfig(name)
    if (opts.disabled) return
    opts.filepath = p
    try {
      await nvim.command(`source ${p}`)
    } catch (e) {
      echoErr(nvim, `Vim error from ${name} source: ${e.message}`)
      return
    }
    let source = await this.createRemoteSource(name, opts)
    if (source) this.addSource(name, source)
  }

  private async createRemoteSources(): Promise<void> {
    let { nvim } = this
    let runtimepath = await nvim.eval('&runtimepath')
    let paths = (runtimepath as string).split(',')
    paths = paths.map(p => {
      return path.join(p, 'autoload/coc/source')
    })
    let files = []
    for (let p of paths) {
      let stat = await statAsync(p)
      if (stat && stat.isDirectory()) {
        let arr = await pify(fs.readdir)(p)
        arr = arr.filter(s => s.slice(-4) == '.vim')
        files = files.concat(arr.map(s => path.join(p, s)))
      }
    }
    await Promise.all(files.map(p => {
      return this.createVimSourceFromPath(p)
    }))
  }

  private async createRemoteSource(name: string, opts: Partial<SourceConfig>): Promise<ISource | null> {
    let { nvim } = this
    let fns = await nvim.call('coc#util#remote_fns', name) as string[]
    for (let fn of ['init', 'complete']) {
      if (fns.indexOf(fn) == -1) {
        echoErr(nvim, `${fn} not found for source ${name}`)
        return null
      }
    }
    let config: SourceConfig | null
    let source
    try {
      config = await nvim.call(`coc#source#${name}#init`, [])
      config = Object.assign(config, opts, {
        sourceType: SourceType.Remote,
        name,
        optionalFns: fns.filter(n => ['init', 'complete'].indexOf(n) == -1)
      })
      source = new VimSource(nvim, config)
    } catch (e) {
      echoErr(nvim, `Error on create vim source ${name}: ${e.message}`)
      return null
    }
    return source
  }

  private onDocumentEnter(info: DocumentInfo): void {
    this.ready.then(() => { // tslint:disable-line
      if (info.bufnr != workspace.bufnr) return
      let { sources } = this
      for (let s of sources) {
        if (!s.enable) continue
        if (typeof s.onEnter == 'function') {
          s.onEnter(info)
        }
      }
    })
  }

  public dispose():void {
    this.removeAllListeners()
    disposeAll(this.disposables)
  }
}
