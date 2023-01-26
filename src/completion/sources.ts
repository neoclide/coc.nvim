'use strict'
import { Neovim } from '@chemzqm/neovim'
import events from '../events'
import extensions from '../extension'
import { createLogger } from '../logger'
import BufferSync from '../model/bufferSync'
import type { CompletionItemProvider, DocumentSelector } from '../provider'
import { disposeAll } from '../util'
import { intersect, isFalsyOrEmpty, toArray } from '../util/array'
import { statAsync } from '../util/fs'
import * as Is from '../util/is'
import { fs, path, promisify } from '../util/node'
import { Disposable } from '../util/protocol'
import { toText } from '../util/string'
import window from '../window'
import workspace from '../workspace'
import { KeywordsBuffer } from './keywords'
import Source from './source'
import LanguageSource from './source-language'
import VimSource from './source-vim'
import { CompleteItem, CompleteOption, ExtendedCompleteItem, ISource, SourceConfig, SourceStat, SourceType } from './types'
import { getPriority } from './util'
const logger = createLogger('sources')

interface VimSourceConfig {
  filetypes?: string[]
  isSnippet?: boolean
  firstMatch?: boolean
  triggerCharacters?: string[]
  priority?: number
  shortcut?: string
  triggerOnly?: boolean
}

/**
 * For static words, must be triggered by source option.
 * Used for completion of snippet choices.
 */
class WordsSource implements ISource<ExtendedCompleteItem> {
  public readonly name = '$words'
  public readonly shortcut = ''
  public readonly triggerOnly = true
  public words: string[] = []

  public doComplete(opt: CompleteOption) {
    return {
      items: this.words.map(s => {
        return { word: s, filterText: opt.input }
      })
    }
  }
}

export class Sources {
  private sourceMap: Map<string, ISource> = new Map()
  private disposables: Disposable[] = []
  private remoteSourcePaths: string[] = []
  public keywords: BufferSync<KeywordsBuffer>
  private wordsSource = new WordsSource()

  public init(): void {
    this.keywords = workspace.registerBufferSync(doc => {
      return new KeywordsBuffer(doc)
    })
    this.createNativeSources()
    this.createRemoteSources()
    events.on('BufEnter', this.onDocumentEnter, this, this.disposables)
    workspace.onDidRuntimePathChange(newPaths => {
      for (let p of newPaths) {
        this.createVimSources(p).catch(logError)
      }
    }, null, this.disposables)
  }

  private get nvim(): Neovim {
    return workspace.nvim
  }

  public getKeywordsBuffer(bufnr: number): KeywordsBuffer {
    return this.keywords.getItem(bufnr)
  }

  public setWords(words: string[]): void {
    this.wordsSource.words = words
  }

  private createNativeSources(): void {
    this.sourceMap.set(this.wordsSource.name, this.wordsSource)
    void Promise.all([
      import('./native/around').then(module => { module.register(this.sourceMap, this.keywords) }),
      import('./native/buffer').then(module => { module.register(this.sourceMap, this.keywords) }),
      import('./native/file').then(module => { module.register(this.sourceMap) })
    ])
  }

  public createLanguageSource(
    name: string,
    shortcut: string,
    selector: DocumentSelector | null,
    provider: CompletionItemProvider,
    triggerCharacters: string[],
    priority?: number | undefined,
    allCommitCharacters?: string[]
  ): Disposable {
    let source = new LanguageSource(
      name,
      shortcut,
      provider,
      selector,
      toArray(triggerCharacters),
      toArray(allCommitCharacters),
      priority)
    logger.trace('created service source', name)
    this.sourceMap.set(name, source)
    return {
      dispose: () => {
        this.sourceMap.delete(name)
      }
    }
  }

  public async createVimSourceExtension(filepath: string): Promise<void> {
    let { nvim } = this
    try {
      let name = path.basename(filepath, '.vim')
      await nvim.command(`source ${filepath}`)
      let fns = await nvim.call('coc#_remote_fns', name) as string[]
      for (let fn of ['init', 'complete']) {
        if (!fns.includes(fn)) {
          throw new Error(`function "coc#source#${name}#${fn}" not found`)
        }
      }
      let props = await nvim.call(`coc#source#${name}#init`, []) as VimSourceConfig
      let packageJSON = {
        name: `coc-vim-source-${name}`,
        engines: {
          coc: ">= 0.0.1"
        },
        activationEvents: props.filetypes ? props.filetypes.map(f => `onLanguage:${f}`) : ['*'],
        contributes: {
          configuration: {
            properties: {
              [`coc.source.${name}.enable`]: {
                type: 'boolean',
                default: true
              },
              [`coc.source.${name}.firstMatch`]: {
                type: 'boolean',
                default: !!props.firstMatch
              },
              [`coc.source.${name}.triggerCharacters`]: {
                type: 'number',
                default: props.triggerCharacters ?? []
              },
              [`coc.source.${name}.priority`]: {
                type: 'number',
                default: props.priority ?? 9
              },
              [`coc.source.${name}.shortcut`]: {
                type: 'string',
                default: props.shortcut ?? name.slice(0, 3).toUpperCase(),
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
      let isActive = false
      let extension: any = {
        id: packageJSON.name,
        packageJSON,
        exports: void 0,
        extensionPath: filepath,
        activate: () => {
          isActive = true
          let source = new VimSource({
            name,
            filepath,
            isSnippet: props.isSnippet,
            sourceType: SourceType.Remote,
            triggerOnly: !!props.triggerOnly,
            optionalFns: fns.filter(n => !['init', 'complete'].includes(n))
          })
          this.addSource(source)
          return Promise.resolve()
        }
      }
      Object.defineProperty(extension, 'isActive', {
        get: () => isActive
      })
      await extensions.manager.registerInternalExtension(extension, () => {
        isActive = false
        this.removeSource(name)
      })
    } catch (e) {
      void window.showErrorMessage(`Error on create vim source from ${filepath}: ${e}`)
    }
  }

  private createRemoteSources(): void {
    let paths = workspace.env.runtimepath.split(',')
    for (let path of paths) {
      this.createVimSources(path).catch(logError)
    }
  }

  public async createVimSources(pluginPath: string): Promise<void> {
    if (this.remoteSourcePaths.includes(pluginPath) || !pluginPath) return
    this.remoteSourcePaths.push(pluginPath)
    let folder = path.join(pluginPath, 'autoload/coc/source')
    let stat = await statAsync(folder)
    if (stat && stat.isDirectory()) {
      let arr = await promisify(fs.readdir)(folder)
      let files = arr.filter(s => s.endsWith('.vim')).map(s => path.join(folder, s))
      await Promise.allSettled(files.map(p => this.createVimSourceExtension(p)))
    }
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
    return this.sourceMap.get(name) ?? null
  }

  public shouldCommit(source: ISource | undefined, item: CompleteItem | undefined, commitCharacter: string): boolean {
    if (!item || source == null) return false
    if (Is.func(source.shouldCommit)) {
      return source.shouldCommit(item, commitCharacter)
    }
    return false
  }

  public getSources(opt: CompleteOption): ISource[] {
    let { source } = opt
    if (source) return toArray(this.getSource(source))
    let uri = workspace.getUri(opt.bufnr)
    return this.getNormalSources(opt.filetype, uri)
  }

  /**
   * Get sources should be used without trigger.
   *
   * @param {string} filetype
   * @returns {ISource[]}
   */
  public getNormalSources(filetype: string, uri: string): ISource[] {
    let languageIds = filetype.split('.')
    let res = this.sources.filter(source => {
      let { filetypes, triggerOnly, documentSelector, enable } = source
      if (!enable || triggerOnly || (filetypes && !intersect(filetypes, languageIds))) return false
      if (documentSelector && languageIds.every(filetype => workspace.match(documentSelector, { uri, languageId: filetype }) == 0)) return false
      return true
    })
    return res
  }

  private checkTrigger(source: ISource, pre: string, character: string): boolean {
    let { triggerCharacters, triggerPatterns } = source
    if (!isFalsyOrEmpty(triggerCharacters) && triggerCharacters.includes(character)) {
      return true
    }
    if (!isFalsyOrEmpty(triggerPatterns) && triggerPatterns.findIndex(p => p.test(pre)) !== -1) {
      return true
    }
    return false
  }

  public shouldTrigger(pre: string, filetype: string, uri: string): boolean {
    return this.getTriggerSources(pre, filetype, uri).length > 0
  }

  public getTriggerSources(pre: string, filetype: string, uri: string, disabled: ReadonlyArray<string> = []): ISource[] {
    if (!pre) return []
    let character = pre[pre.length - 1]
    let languageIds = filetype.split('.')
    return this.sources.filter(source => {
      let { filetypes, enable, documentSelector, name } = source
      if (disabled.includes(name)) return false
      if (!enable || (filetypes && !intersect(filetypes, languageIds))) return false
      if (documentSelector && languageIds.every(languageId => workspace.match(documentSelector, { uri, languageId }) == 0)) {
        return false
      }
      return this.checkTrigger(source, pre, character)
    })
  }

  public addSource(source: ISource): Disposable {
    let { name } = source
    if (this.names.includes(name)) {
      logger.warn(`Recreate source ${name}`)
    }
    this.sourceMap.set(name, source)
    return Disposable.create(() => {
      this.removeSource(source)
    })
  }

  public removeSource(source: ISource | string): void {
    let name = typeof source == 'string' ? source : source.name
    let obj = typeof source === 'string' ? this.sourceMap.get(source) : source
    if (obj && typeof obj.dispose === 'function') obj.dispose()
    this.sourceMap.delete(name)
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
    let source = this.getSource(name)
    if (source && typeof source.toggle === 'function') {
      source.toggle()
    }
  }

  public sourceStats(): SourceStat[] {
    let stats: SourceStat[] = []
    let languageSourcePriority = workspace.initialConfiguration.get<number>('suggest.languageSourcePriority')
    for (let item of this.sourceMap.values()) {
      if (item.name === '$words') continue
      stats.push({
        name: item.name,
        priority: getPriority(item, languageSourcePriority),
        triggerCharacters: toArray(item.triggerCharacters),
        shortcut: toText(item.shortcut),
        filetypes: toArray(item.filetypes ?? item.documentSelector?.map(o => Is.string(o) ? o : o.language)),
        filepath: toText(item.filepath),
        type: getSourceType(item.sourceType),
        disabled: !item.enable
      })
    }
    return stats
  }

  private onDocumentEnter(bufnr: number): void {
    let { sources } = this
    for (let s of sources) {
      if (s.enable && Is.func(s.onEnter)) {
        s.onEnter(bufnr)
      }
    }
  }

  public createSource(config: SourceConfig): Disposable {
    if (typeof config.name !== 'string' || typeof config.doComplete !== 'function') {
      logger.error(`Bad config for createSource:`, config)
      throw new TypeError(`name and doComplete required for createSource`)
    }
    let source = new Source(Object.assign({ sourceType: SourceType.Service } as any, config))
    return this.addSource(source)
  }

  public dispose(): void {
    disposeAll(this.disposables)
  }
}

export function logError(err: any): void {
  logger.error('Error on source create', err)
}

export function getSourceType(sourceType: SourceType): string {
  if (sourceType === SourceType.Native) return 'native'
  if (sourceType === SourceType.Remote) return 'remote'
  return 'service'
}

export default new Sources()
