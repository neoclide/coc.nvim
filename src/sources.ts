import { attach, Neovim } from '@chemzqm/neovim'
import cp from 'child_process'
import { EventEmitter } from 'events'
import fs from 'fs'
import path from 'path'
import pify from 'pify'
import { Disposable } from 'vscode-jsonrpc'
import which from 'which'
import VimSource from './model/source-vim'
import { CompleteOption, ISource, SourceConfig, SourceType, VimCompleteItem, SourceStat } from './types'
import { disposeAll } from './util'
import { statAsync } from './util/fs'
import workspace from './workspace'
import events from './events'
const logger = require('./util/logger')('sources')

export class Sources extends EventEmitter {
  private sourceMap: Map<string, ISource> = new Map()
  private disposables: Disposable[] = []
  private customs: string[]
  private _ready = false

  private get nvim(): Neovim {
    return workspace.nvim
  }

  private async createNativeSources(): Promise<void> {
    this.disposables.push((await import('./source/around')).regist(this.sourceMap))
    this.disposables.push((await import('./source/dictionary')).regist(this.sourceMap))
    this.disposables.push((await import('./source/buffer')).regist(this.sourceMap))
    this.disposables.push((await import('./source/emoji')).regist(this.sourceMap))
    this.disposables.push((await import('./source/file')).regist(this.sourceMap))
    this.disposables.push((await import('./source/include')).regist(this.sourceMap))
    this.disposables.push((await import('./source/tag')).regist(this.sourceMap))
    this.disposables.push((await import('./source/gocode')).regist(this.sourceMap))
    this.disposables.push((await import('./source/word')).regist(this.sourceMap))
    this.disposables.push((await import('./source/omni')).regist(this.sourceMap))
  }

  private async createVimSourceFromPath(nvim: Neovim, filepath: string): Promise<void> {
    let name = path.basename(filepath, '.vim')
    await nvim.command(`source ${filepath}`)
    let fns = await nvim.call('coc#util#remote_fns', name) as string[]
    for (let fn of ['init', 'complete']) {
      if (fns.indexOf(fn) == -1) {
        workspace.showMessage(`${fn} not found for source ${name}`, 'error')
        return null
      }
    }
    let config: SourceConfig | null
    let source
    try {
      config = await nvim.call(`coc#source#${name}#init`, [])
      config = Object.assign(config, {
        name,
        filepath,
        sourceType: SourceType.Remote,
        optionalFns: fns.filter(n => ['init', 'complete'].indexOf(n) == -1)
      })
      source = new VimSource(config)
      this.addSource(source)
    } catch (e) {
      workspace.showMessage(`Error on create vim source ${name}: ${e.message}`, 'error')
    }
  }

  private createNvimProcess(): cp.ChildProcess {
    try {
      let p = which.sync('nvim')
      let proc = cp.spawn(p, ['-u', 'NORC', '-i', 'NONE', '--embed', '--headless'], {
        shell: false
      })
      return proc
    } catch (e) {
      return null
    }
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
    let proc = this.createNvimProcess()
    if (proc) {
      try {
        nvim = attach({ proc })
        let utilPath = path.join(workspace.pluginRoot, 'autoload/coc/util.vim')
        await nvim.command(`source ${utilPath}`)
      } catch (e) {
        nvim = this.nvim
      }
    }
    await Promise.all(files.map(p => {
      return this.createVimSourceFromPath(nvim, p)
    }))
    if (proc) proc.kill()
  }

  private onDocumentEnter(bufnr: number): void {
    this.ready.then(() => { // tslint:disable-line
      if (bufnr != workspace.bufnr) return
      let { sources } = this
      for (let s of sources) {
        if (!s.enable) continue
        if (typeof s.onEnter == 'function') {
          s.onEnter(bufnr)
        }
      }
    })
  }

  public init(): void {
    Promise.all([
      this.createNativeSources(),
      this.createRemoteSources(),
    ]).then(() => {
      this._ready = true
      this.emit('ready')
      logger.debug(`Created sources ${this.names}`)
    }, e => {
      this._ready = true
      this.emit('ready')
      workspace.showMessage(`Error on source create ${e.message}`, 'error')
    })
    events.on('BufEnter', this.onDocumentEnter, this, this.disposables)
    this.customs = workspace.getConfiguration('coc.preferences').get<string[]>('customSources', [])
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
      sources = this.getTriggerSources(triggerCharacter, filetype, custom)
      if (sources.length) return sources
    }
    return this.getSourcesForFiletype(filetype, false, custom)
  }

  public shouldTrigger(character: string, languageId: string): boolean {
    let idx = this.sources.findIndex(s => {
      let { enable, triggerCharacters, filetypes } = s
      if (!enable) return false
      if (filetypes && filetypes.indexOf(languageId) == -1) return false
      return triggerCharacters && triggerCharacters.indexOf(character) !== -1
    })
    return idx !== -1
  }

  public getTriggerCharacters(languageId: string, custom = false): Set<string> {
    let res: Set<string> = new Set()
    let sources = this.getSourcesForFiletype(languageId, false, custom)
    for (let s of sources) {
      for (let c of s.triggerCharacters) {
        res.add(c)
      }
    }
    return res
  }

  public getTriggerSources(character: string, languageId: string, custom = false): ISource[] {
    let sources = this.getSourcesForFiletype(languageId, false, custom)
    return sources.filter(o => {
      return o.triggerCharacters.indexOf(character) !== -1
    })
  }

  public getSourcesForFiletype(filetype: string, includeDisabled = false, includeCustom = false): ISource[] {
    return this.sources.filter(source => {
      let { filetypes, name } = source
      if (!includeDisabled && !source.enable) return false
      if (!filetypes || filetypes.indexOf(filetype) !== -1) {
        if (includeCustom) {
          return this.customs.indexOf(name) !== -1
        }
        return this.customs.indexOf(name) == -1
      }
      return false
    })
  }

  public addSource(source: ISource): void {
    let { name } = source
    if (this.names.indexOf(name) !== -1) {
      workspace.showMessage(`Source "${name}" recreated`, 'warning')
    }
    this.sourceMap.set(name, source)
  }

  public removeSource(source: ISource): void {
    let { name } = source
    if (source == this.sourceMap.get(name)) {
      this.sourceMap.delete(name)
    }
  }

  public async refresh(name?: string): Promise<void> {
    for (let source of this.sources) {
      if (!name || source.name == name) {
        if (typeof source.refresh === 'function') {
          try {
            await Promise.resolve(source.refresh())
          } catch (e) {
            workspace.showMessage(`Refresh ${name} error: ${e.message}`, 'error')
          }
        }
      }
    }
  }

  public toggleSource(name: string): void {
    if (!name) return
    let source = this.getSource(name)
    if (!source) return
    if (typeof source.toggle === 'function') {
      source.toggle()
    }
  }

  public sourceStat(): SourceStat[] {
    let res: SourceStat[] = []
    let items = this.sources
    for (let item of items) {
      res.push({
        name: item.name,
        filepath: item.filepath || '',
        type: item.sourceType == SourceType.Native
          ? 'native' : item.sourceType == SourceType.Remote
            ? 'remote' : 'service',
        disabled: !item.enable
      })
    }
    return res
  }

  public dispose(): void {
    this.removeAllListeners()
    disposeAll(this.disposables)
  }
}

export default new Sources()
