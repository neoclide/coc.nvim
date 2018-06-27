import {Neovim} from 'neovim'
import VimSource from './model/source-vim'
import workspace from './workspace'
import languages from './languages'
import {
  VimCompleteItem,
  ISource,
  SourceConfig,
  WorkspaceConfiguration,
  SourceType,
  CompleteOption,
} from './types'
import {
  echoErr,
  echoMessage,
} from './util'
import {
  isWord
} from './util/string'
import {statAsync} from './util/fs'
import path = require('path')
import fs = require('fs')
import pify = require('pify')
const logger = require('./util/logger')('sources')

export default class Sources {
  private sourceMap:Map<string, ISource> = new Map()
  private sourceConfig: WorkspaceConfiguration

  constructor(private nvim:Neovim) {
    this.sourceConfig = workspace.getConfiguration('coc.source')
    Promise.all([
      this.createNativeSources(),
      this.createRemoteSources(),
    ]).then(() => {
      logger.debug(`Created sources ${this.names}`)
    }, err => {
      logger.error(err.stack)
    })
    languages.onDidCompletionSourceCreated(source => {
      let {name} = source
      let config:Partial<SourceConfig> = this.getSourceConfig(name)
      if (!config.disabled) {
        delete config.name
        delete config.sourceType
        // priority filetypes triggerCharacters
        Object.assign(source, config)
        this.addSource(name, source)
      }
      logger.debug('created service source ', name)
    })
  }

  public get names():string[] {
    return Array.from(this.sourceMap.keys())
  }

  public get sources():ISource[] {
    return Array.from(this.sourceMap.values())
  }

  public has(name):boolean{
    return this.names.findIndex(o => o == name) != -1
  }

  public getSource(name:string):ISource | null {
    return this.sourceMap.get(name) || null
  }

  /**
   * Make only one source available
   *
   * @public
   * @param {string} name - source name
   * @returns {Promise<void>}
   */
  public async onlySource(name:string):Promise<void> {
    for (let n of this.names) {
      let source = this.sourceMap.get(n)
      if (name != n) {
        source.disabled = true
      } else {
        source.disabled = false
      }
    }
    if (this.names.indexOf(name) == -1) {
      require(`./__tests__/test-sources/${name}`)
    }
  }

  public async doCompleteResolve(item: VimCompleteItem):Promise<void> {
    let {user_data} = item
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

  public async doCompleteDone(item: VimCompleteItem):Promise<void> {
    let data = JSON.parse(item.user_data)
    let source = this.getSource(data.source)
    if (source && typeof source.onCompleteDone === 'function') {
      await source.onCompleteDone(item)
    }
  }

  public getCompleteSources(opt:CompleteOption):ISource[] {
    let {triggerCharacter, filetype} = opt
    if (triggerCharacter) return this.getTriggerSources(triggerCharacter, filetype)
    return this.getSourcesForFiletype(filetype, false)
  }

  public shouldTrigger(character:string, languageId: string):boolean {
    return this.getTriggerSources(character, languageId).length > 0
  }

  public getTriggerSources(character:string, languageId: string):ISource[] {
    let special = !isWord(character)
    let sources = this.sources.filter(s => {
      if (s.disabled) return false
      let {filetypes} = s
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

  public getSourcesForFiletype(filetype:string, includeDisabled = true):ISource[] {
    return this.sources.filter(source => {
      let {filetypes} = source
      if (!includeDisabled && source.disabled) return false
      if (!filetypes || filetypes[0] == '-') return true
      if (filetype && filetypes.indexOf(filetype) !== -1) {
        return true
      }
      return false
    })
  }

  private addSource(name:string, source:ISource):void {
    if (this.names.indexOf(name) !== -1) {
      echoMessage(this.nvim, `Source "${name}" recreated`).catch(_e => { })
    }
    this.sourceMap.set(name, source)
  }

  private async createNativeSources():Promise<void> {
    let root = path.join(__dirname, 'source')
    let files = await pify(fs.readdir)(root, 'utf8')
    for (let file of files) {
      if (/\.js$/.test(file)) {
        let name = file.replace(/\.js$/, '')
        try {
          let Clz = await require(`./source/${name}`).default
          let config:Partial<SourceConfig> = this.getSourceConfig(name)
          if (!config.disabled) {
            config.name = name
            config.filepath = path.join(__dirname, `source/${name}.ts`)
            let instance = new Clz(this.nvim, config || {})
            if (typeof instance.onInit === 'function') {
              await instance.onInit()
            }
            this.addSource(name, instance)
          }
        } catch (e) {
          logger.error(`Native source ${name} error: ${e.message}`)
        }
      }
    }
  }

  private getSourceConfig(name:string):Partial<SourceConfig> {
    let opt = this.sourceConfig.get(name, {} as any) as any
    let res = {}
    for (let key of Object.keys(opt)) {
      res[key] = opt[key]
    }
    return res
  }

  private async createVimSourceFromPath(p:string):Promise<void> {
    let {nvim} = this
    let name = path.basename(p, '.vim')
    let opts = this.getSourceConfig(name)
    if (opts.disabled) return
    opts.filepath = p
    try {
      await nvim.command(`source ${p}`)
    } catch (e) {
      await echoErr(nvim, `Vim error from ${name} source: ${e.message}`)
      return
    }
    let valid = await this.checkRemoteSource(name, p)
    if (valid) {
      let source = await this.createRemoteSource(name, opts)
      if (source) this.addSource(name, source)
    }
  }

  private async createRemoteSources():Promise<void> {
    let {nvim} = this
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

  private async checkRemoteSource(name: string, fullpath: string):Promise<boolean> {
    let {nvim} = this
    let fns = ['init', 'complete']
    let valid = true
    for (let fname of fns) {
      let fn = `coc#source#${name}#${fname}`
      let exists = await nvim.call('exists', [`*${fn}`])
      if (exists != 1) {
        valid = false
        let msg =  `Function ${fname} not found for '${name}' source`
        await echoErr(nvim, msg)
      }
    }
    return valid
  }

  private async getOptionalFns(name: string):Promise<string[]> {
    let {nvim} = this
    let fns = ['should_complete', 'refresh', 'get_startcol', 'on_complete']
    let res = []
    for (let fname of fns) {
      let fn = `coc#source#${name}#${fname}`
      let exists = await nvim.call('exists', [`*${fn}`])
      if (exists == 1) {
        res.push(fname)
      }
    }
    return res
  }

  private async createRemoteSource(name:string, opts:Partial<SourceConfig>):Promise<ISource | null> {
    let {nvim} = this
    let fn = `coc#source#${name}#init`
    let config: SourceConfig | null
    let source
    try {
      config = await nvim.call(fn, [])
      config = Object.assign(config, opts, {
        sourceType: SourceType.Remote,
        name,
        optionalFns: await this.getOptionalFns(name)
      })
      source = new VimSource(nvim, config)
    } catch (e) {
      await echoErr(nvim, `Vim error on init from source ${name}: ${e.message}`)
      return null
    }
    return source
  }
}
