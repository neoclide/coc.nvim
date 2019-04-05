import fastDiff from 'fast-diff'
import { Neovim } from '@chemzqm/neovim'
import fs from 'fs'
import path from 'path'
import util from 'util'
import { Disposable, CancellationToken } from 'vscode-jsonrpc'
import events from './events'
import extensions from './extensions'
import Source from './model/source'
import VimSource from './model/source-vim'
import { CompleteOption, ISource, SourceStat, SourceType, VimCompleteItem } from './types'
import { disposeAll } from './util'
import { statAsync } from './util/fs'
import workspace from './workspace'
import { byteSlice } from './util/string'
const logger = require('./util/logger')('sources')

type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>

// priority,triggerPatterns,shortcut,enable,filetypes,disableSyntaxes,firstMatch
type ReadonlyProps = 'priority' | 'sourceType' | 'triggerPatterns' | 'enable' | 'filetypes' | 'disableSyntaxes' | 'firstMatch'

export class Sources {
  private sourceMap: Map<string, ISource> = new Map()
  private disposables: Disposable[] = []
  private remoteSourcePaths: string[] = []

  private get nvim(): Neovim {
    return workspace.nvim
  }

  private async createNativeSources(): Promise<void> {
    try {
      this.disposables.push((require('./source/around')).regist(this.sourceMap))
      this.disposables.push((require('./source/buffer')).regist(this.sourceMap))
      this.disposables.push((require('./source/file')).regist(this.sourceMap))
    } catch (e) {
      console.error('Create source error:' + e.message) // tslint:disable-line
    }
  }

  private async createVimSourceExtension(nvim: Neovim, filepath: string): Promise<void> {
    let name = path.basename(filepath, '.vim')
    try {
      await nvim.command(`source ${filepath}`)
      let fns = await nvim.call('coc#util#remote_fns', name) as string[]
      for (let fn of ['init', 'complete']) {
        if (fns.indexOf(fn) == -1) {
          workspace.showMessage(`${fn} not found for source ${name}`, 'error')
          return null
        }
      }
      let props = await nvim.call(`coc#source#${name}#init`, [])
      let packageJSON = {
        name: `coc-source-${name}`,
        activationEvents: props.filetypes ? props.filetypes.map(f => `onLanguage:${f}`) : ['*'],
        contributes: {
          configuration: {
            properties: {
              [`coc.source.${name}.enable`]: {
                type: 'boolean',
                default: true
              },
              [`coc.source.${name}.priority`]: {
                type: 'number',
                default: props.priority || 9
              },
              [`coc.source.${name}.shortcut`]: {
                type: 'string',
                default: props.shortcut || name.slice(0, 3).toUpperCase(),
                description: 'Shortcut text shown in complete menu.'
              },
              [`coc.source.${name}.disableSyntaxes`]: {
                type: 'array',
                default: [],
                items: {
                  type: 'string'
                }
              },
              [`coc.source.${name}.filetypes`]: {
                type: 'array',
                default: props.filetypes || null,
                description: 'Enabled filetypes.',
                items: {
                  type: 'string'
                }
              }
            }
          }
        }
      }
      let source = new VimSource({
        name,
        filepath,
        sourceType: SourceType.Remote,
        optionalFns: fns.filter(n => ['init', 'complete'].indexOf(n) == -1)
      })
      let isActive = false
      let extension: any = {
        id: packageJSON.name,
        packageJSON,
        exports: void 0,
        extensionPath: filepath,
        activate: async () => {
          isActive = true
          this.addSource(source)
        }
      }
      Object.defineProperty(extension, 'isActive', {
        get: () => {
          return isActive
        }
      })
      extensions.registerExtension(extension, () => {
        isActive = false
        this.removeSource(source)
      })
    } catch (e) {
      workspace.showMessage(`Error on create vim source ${name}: ${e.message}`, 'error')
    }
  }

  private async createRemoteSources(): Promise<void> {
    let { runtimepath } = workspace.env
    let paths = runtimepath.split(',')
    for (let path of paths) {
      await this.createVimSources(path)
    }
  }

  private async createVimSources(pluginPath: string): Promise<void> {
    if (this.remoteSourcePaths.indexOf(pluginPath) != -1) return
    this.remoteSourcePaths.push(pluginPath)
    let folder = path.join(pluginPath, 'autoload/coc/source')
    let stat = await statAsync(folder)
    if (stat && stat.isDirectory()) {
      let arr = await util.promisify(fs.readdir)(folder)
      arr = arr.filter(s => s.slice(-4) == '.vim')
      let files = arr.map(s => path.join(folder, s))
      if (files.length == 0) return
      await Promise.all(files.map(p => {
        return this.createVimSourceExtension(this.nvim, p)
      }))
    }
  }

  public init(): void {
    this.createNativeSources() // tslint:disable-line
    this.createRemoteSources() // tslint:disable-line
    events.on('BufEnter', this.onDocumentEnter, this, this.disposables)
    workspace.watchOption('runtimepath', async (oldValue, newValue) => {
      let result = fastDiff(oldValue, newValue)
      for (let [changeType, value] of result) {
        if (changeType == 1) {
          let paths = value.replace(/,$/, '').split(',')
          for (let p of paths) {
            await this.createVimSources(p)
          }
        }
      }
    }, this.disposables)
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
    if (!name) return null
    return this.sourceMap.get(name) || null
  }

  public async doCompleteResolve(item: VimCompleteItem, token: CancellationToken): Promise<void> {
    let source = this.getSource(item.source)
    if (source && typeof source.onCompleteResolve == 'function') {
      try {
        await source.onCompleteResolve(item, token)
      } catch (e) {
        logger.error('Error on complete resolve:', e.stack)
      }
    }
  }

  public async doCompleteDone(item: VimCompleteItem, opt: CompleteOption): Promise<void> {
    let data = JSON.parse(item.user_data)
    let source = this.getSource(data.source)
    if (source && typeof source.onCompleteDone === 'function') {
      await Promise.resolve(source.onCompleteDone(item, opt))
    }
  }

  public shouldCommit(item: VimCompleteItem, commitCharacter: string): boolean {
    if (!item || !item.source) return false
    let source = this.getSource(item.source)
    if (source && source.sourceType == SourceType.Service && typeof source.shouldCommit === 'function') {
      return source.shouldCommit(item, commitCharacter)
    }
    return false
  }

  public getCompleteSources(opt: CompleteOption, isTriggered: boolean): ISource[] {
    let { filetype } = opt
    let pre = byteSlice(opt.line, 0, opt.col)
    if (isTriggered) return this.getTriggerSources(pre, filetype)
    return this.getSourcesForFiletype(filetype)
  }

  public shouldTrigger(pre: string, languageId: string): boolean {
    if (pre.length == 0) return false
    let last = pre[pre.length - 1]
    let idx = this.sources.findIndex(s => {
      let { enable, triggerCharacters, triggerPatterns, filetypes } = s
      if (!enable) return false
      if ((filetypes && filetypes.indexOf(languageId) == -1)) return false
      if (triggerCharacters) return triggerCharacters.indexOf(last) !== -1
      if (triggerPatterns) return triggerPatterns.findIndex(p => p.test(pre)) !== -1
      return false
    })
    return idx !== -1
  }

  public getTriggerSources(pre: string, languageId: string): ISource[] {
    let sources = this.getSourcesForFiletype(languageId)
    let character = pre[pre.length - 1]
    return sources.filter(o => {
      if (o.triggerCharacters && o.triggerCharacters.indexOf(character) !== -1) return true
      if (o.triggerPatterns && o.triggerPatterns.findIndex(p => p.test(pre)) !== -1) return true
      return false
    })
  }

  public getSourcesForFiletype(filetype: string): ISource[] {
    return this.sources.filter(source => {
      let { filetypes } = source
      if (source.enable && (!filetypes || filetypes.indexOf(filetype) !== -1)) {
        return true
      }
      return false
    })
  }

  public addSource(source: ISource): Disposable {
    let { name } = source
    if (this.names.indexOf(name) !== -1) {
      workspace.showMessage(`Source "${name}" recreated`, 'warning')
    }
    this.sourceMap.set(name, source)
    return Disposable.create(() => {
      this.sourceMap.delete(name)
    })
  }

  public removeSource(source: ISource | string): void {
    let name = typeof source == 'string' ? source : source.name
    if (source == this.sourceMap.get(name)) {
      this.sourceMap.delete(name)
    }
  }

  public async refresh(name?: string): Promise<void> {
    for (let source of this.sources) {
      if (!name || source.name == name) {
        if (typeof source.refresh === 'function') {
          await Promise.resolve(source.refresh())
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

  public sourceStats(): SourceStat[] {
    let res: SourceStat[] = []
    let items = this.sources
    for (let item of items) {
      res.push({
        name: item.name,
        filetypes: item.filetypes || [],
        filepath: item.filepath || '',
        type: item.sourceType == SourceType.Native
          ? 'native' : item.sourceType == SourceType.Remote
            ? 'remote' : 'service',
        disabled: !item.enable
      })
    }
    return res
  }

  private onDocumentEnter(bufnr: number): void {
    let { sources } = this
    for (let s of sources) {
      if (!s.enable) continue
      if (typeof s.onEnter == 'function') {
        s.onEnter(bufnr)
      }
    }
  }

  public createSource(config: Omit<ISource, ReadonlyProps>): Disposable {
    let source = new Source({ name: config.name, sourceType: SourceType.Remote })
    Object.assign(source, config)
    return this.addSource(source)
  }

  public dispose(): void {
    disposeAll(this.disposables)
  }
}

export default new Sources()
