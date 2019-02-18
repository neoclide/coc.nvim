import fastDiff from 'fast-diff'
import { Neovim } from '@chemzqm/neovim'
import fs from 'fs'
import path from 'path'
import pify from 'pify'
import { Disposable, CancellationToken } from 'vscode-jsonrpc'
import events from './events'
import extensions from './extensions'
import VimSource from './model/source-vim'
import { CompleteOption, ISource, SourceStat, SourceType, VimCompleteItem } from './types'
import { disposeAll } from './util'
import { statAsync } from './util/fs'
import workspace from './workspace'
const logger = require('./util/logger')('sources')

export class Sources {
  private sourceMap: Map<string, ISource> = new Map()
  private disposables: Disposable[] = []
  private remoteSourcePaths: string[] = []

  private get nvim(): Neovim {
    return workspace.nvim
  }

  private async createNativeSources(): Promise<void> {
    try {
      this.disposables.push((await import('./source/around')).regist(this.sourceMap))
      this.disposables.push((await import('./source/buffer')).regist(this.sourceMap))
      this.disposables.push((await import('./source/file')).regist(this.sourceMap))
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
    let { nvim } = this
    let runtimepath = await nvim.eval('&runtimepath')
    let paths = (runtimepath as string).split(',')
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
      let arr = await pify(fs.readdir)(folder)
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
    let { triggerCharacter, filetype } = opt
    if (isTriggered) {
      return this.getTriggerSources(triggerCharacter, filetype)
    }
    return this.getSourcesForFiletype(filetype)
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

  public getTriggerCharacters(languageId: string): Set<string> {
    let res: Set<string> = new Set()
    let sources = this.getSourcesForFiletype(languageId)
    for (let s of sources) {
      for (let c of s.triggerCharacters) {
        res.add(c)
      }
    }
    return res
  }

  public getTriggerSources(character: string, languageId: string): ISource[] {
    let sources = this.getSourcesForFiletype(languageId)
    return sources.filter(o => {
      return o.triggerCharacters.indexOf(character) !== -1
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

  public dispose(): void {
    disposeAll(this.disposables)
  }
}

export default new Sources()
