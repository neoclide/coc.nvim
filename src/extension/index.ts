'use strict'
import fs from 'fs'
import path from 'path'
import { Event } from 'vscode-languageserver-protocol'
import which from 'which'
import commandManager from '../commands'
import type { OutputChannel } from '../types'
import { concurrent, executable } from '../util'
import { distinct } from '../util/array'
import '../util/extensions'
import { isUrl } from '../util/is'
import window from '../window'
import workspace from '../workspace'
import { IInstaller, Installer } from './installer'
import { API, Extension, ExtensionInfo, ExtensionItem, ExtensionManager, ExtensionState } from './manager'
import { checkExtensionRoot, ExtensionStat, loadExtensionJson } from './stat'
import { InstallBuffer, InstallChannel, InstallUI } from './ui'

const createLogger = require('../util/logger')
const logger = createLogger('extensions-index')

export interface PropertyScheme {
  type: string
  default: any
  description: string
  enum?: string[]
  items?: any
  [key: string]: any
}

const DATA_HOME = process.env.COC_DATA_HOME
const EXTENSIONS_FOLDER = path.join(DATA_HOME, 'extensions')

// global local file native
export class Extensions {
  public readonly manager: ExtensionManager
  public readonly states: ExtensionStat
  public readonly modulesFolder = path.join(EXTENSIONS_FOLDER, 'node_modules')
  private _additionalSchemes: { [key: string]: PropertyScheme } = {}
  constructor() {
    checkExtensionRoot(EXTENSIONS_FOLDER)
    this.states = new ExtensionStat(EXTENSIONS_FOLDER)
    this.manager = new ExtensionManager(this.states, EXTENSIONS_FOLDER)
  }

  public async init(): Promise<void> {
    if (process.env.COC_NO_PLUGINS) return
    let stats = this.globalExtensionStats()
    let runtimepath = await workspace.nvim.eval('join(globpath(&runtimepath, "", 0, 1), ",")') as string
    let localStats = this.runtimeExtensionStats(runtimepath)
    stats = stats.concat(localStats)
    this.manager.registerExtensions(stats)
    await this.manager.loadFileExtensions()
    commandManager.register({
      id: 'extensions.forceUpdateAll',
      execute: async () => {
        let arr = await this.manager.cleanExtensions()
        logger.info(`Force update extensions: ${arr}`)
        await this.installExtensions(arr)
      }
    }, false, 'remove all global extensions and install them')
  }

  public activateExtensions(): void {
    if (process.env.COC_NO_PLUGINS) return
    void this.manager.activateExtensions()
    let names = this.states.filterGlobalExtensions(workspace.env.globalExtensions)
    void this.installExtensions(names)
    // check extensions need watch & install
    let config = workspace.getConfiguration('coc.preferences', null)
    let interval = config.get<string>('extensionUpdateCheck', 'never')
    let silent = config.get<boolean>('silentAutoupdate', true)
    if (this.states.shouldUpdate(interval)) {
      this.outputChannel.appendLine('Start auto update...')
      this.updateExtensions(silent).catch(e => {
        this.outputChannel.appendLine(`Error on updateExtensions ${e}`)
      })
    }
  }

  public get onDidLoadExtension(): Event<Extension<API>> {
    return this.manager.onDidLoadExtension
  }

  public get onDidActiveExtension(): Event<Extension<API>> {
    return this.manager.onDidActiveExtension
  }

  public get onDidUnloadExtension(): Event<string> {
    return this.manager.onDidUnloadExtension
  }

  public get schemes(): { [key: string]: PropertyScheme } {
    return this._additionalSchemes
  }

  private get outputChannel(): OutputChannel {
    return window.createOutputChannel('extensions')
  }

  /**
   * Get all loaded extensions.
   */
  public get all(): Extension<API>[] {
    return this.manager.all
  }

  public has(id: string): boolean {
    return this.manager.has(id)
  }

  public getExtension(id: string): ExtensionItem | undefined {
    return this.manager.getExtension(id)
  }

  /**
   * @deprecated
   */
  public addSchemeProperty(key: string, def: PropertyScheme): void {
    this._additionalSchemes[key] = def
    // workspace.configurations.extendsDefaults({ [key]: def.default }, id)
  }

  /**
   * @public Get state of extension
   */
  public getExtensionState(id: string): ExtensionState {
    return this.manager.getExtensionState(id)
  }

  public isActivated(id: string): boolean {
    let item = this.manager.getExtension(id)
    return item != null && item.extension.isActive
  }

  public async call(id: string, method: string, args: any[]): Promise<any> {
    return await this.manager.call(id, method, args)
  }

  public get npm(): string {
    let npm = workspace.getConfiguration('npm', null).get<string>('binPath', 'npm')
    npm = workspace.expand(npm)
    for (let exe of [npm, 'yarnpkg', 'yarn', 'npm']) {
      if (executable(exe)) return which.sync(exe)
    }
    void window.showErrorMessage(`Can't find npm or yarn in your $PATH`)
    return null
  }

  private createInstallerUI(isUpdate: boolean, silent: boolean): InstallUI {
    return silent ? new InstallChannel(isUpdate, this.outputChannel) : new InstallBuffer(isUpdate)
  }

  public creteInstaller(npm: string, def: string): IInstaller {
    return new Installer(this.modulesFolder, npm, def)
  }

  /**
   * Install extensions, can be called without initialize.
   */
  public async installExtensions(list: string[]): Promise<void> {
    let { npm } = this
    if (!npm || list.length == 0) return
    list = distinct(list)
    let installBuffer = this.createInstallerUI(false, false)
    await Promise.resolve(installBuffer.start(list))
    let fn = async (key: string): Promise<void> => {
      try {
        installBuffer.startProgress(key)
        let installer = this.creteInstaller(npm, key)
        installer.on('message', (msg, isProgress) => {
          installBuffer.addMessage(key, msg, isProgress)
        })
        let result = await installer.install()
        installBuffer.finishProgress(key, true)
        this.states.addExtension(result.name, result.url ? result.url : `>=${result.version}`)
        let ms = key.match(/@[\d.]+$/)
        if (ms != null) this.states.setLocked(result.name, true)
        await this.manager.loadExtension(result.folder)
      } catch (err: any) {
        installBuffer.addMessage(key, err.message)
        installBuffer.finishProgress(key, false)
        void window.showErrorMessage(`Error on install ${key}: ${err}`)
        logger.error(`Error on install ${key}`, err)
      }
    }
    await concurrent(list, fn)
  }

  /**
   * Update global extensions
   */
  public async updateExtensions(silent = false): Promise<void> {
    let { npm } = this
    if (!npm) return
    let stats = this.globalExtensionStats()
    stats = stats.filter(s => {
      if (s.isLocked || s.state === 'disabled') {
        this.outputChannel.appendLine(`Skipped update for ${s.isLocked ? 'locked' : 'disabled'} extension "${s.id}"`)
        return false
      }
      return true
    })
    this.states.setLastUpdate()
    this.cleanModulesFolder()
    let installBuffer = this.createInstallerUI(true, silent)
    await Promise.resolve(installBuffer.start(stats.map(o => o.id)))
    let fn = async (stat: ExtensionInfo): Promise<void> => {
      let { id } = stat
      try {
        installBuffer.startProgress(id)
        let url = stat.exotic ? stat.uri : null
        let installer = this.creteInstaller(npm, id)
        installer.on('message', (msg, isProgress) => {
          installBuffer.addMessage(id, msg, isProgress)
        })
        let directory = await installer.update(url)
        installBuffer.finishProgress(id, true)
        if (directory) await this.manager.loadExtension(directory)
      } catch (err: any) {
        installBuffer.addMessage(id, err.message)
        installBuffer.finishProgress(id, false)
        void window.showErrorMessage(`Error on update ${id}: ${err}`)
        logger.error(`Error on update ${id}`, err)
      }
    }
    await concurrent(stats, fn, silent ? 1 : 3)
  }

  /**
   * Get all extension states
   */
  public async getExtensionStates(): Promise<ExtensionInfo[]> {
    let runtimepath = await workspace.nvim.eval('join(globpath(&runtimepath, "", 0, 1), ",")') as string
    let localStats = this.runtimeExtensionStats(runtimepath)
    let globalStats = this.globalExtensionStats()
    return localStats.concat(globalStats)
  }

  public globalExtensionStats(): ExtensionInfo[] {
    let dependencies = this.states.dependencies
    let lockedExtensions = this.states.lockedExtensions
    let infos: ExtensionInfo[] = []
    Object.entries(dependencies).map(([key, val]) => {
      let root = path.join(this.modulesFolder, key)
      let errors: string[] = []
      let obj = loadExtensionJson(root, workspace.version, errors)
      if (errors.length > 0) {
        this.outputChannel.appendLine(`Error on load ${key} at ${root}: ${errors.join('\n')}`)
        return
      }
      obj.name = key
      infos.push({
        id: key,
        isLocal: false,
        version: obj.version,
        description: obj.description ?? '',
        isLocked: lockedExtensions.includes(key),
        exotic: /^https?:/.test(val),
        uri: toUrl(val),
        root: fs.realpathSync(root),
        state: this.getExtensionState(key),
        packageJSON: Object.freeze(obj)
      })
    })
    return infos
  }

  public runtimeExtensionStats(runtimepath: string): ExtensionInfo[] {
    let lockedExtensions = this.states.lockedExtensions
    let paths = runtimepath.split(',')
    let infos: ExtensionInfo[] = []
    let localIds: Set<string> = new Set()
    paths.map(root => {
      let errors: string[] = []
      let obj = loadExtensionJson(root, workspace.version, errors)
      if (errors.length > 0) return
      let { name } = obj
      if (!name || this.states.hasExtension(name) || localIds.has(name)) return
      this.states.addLocalExtension(name, root)
      localIds.add(name)
      infos.push(({
        id: obj.name,
        isLocal: true,
        isLocked: lockedExtensions.includes(name),
        version: obj.version,
        description: obj.description ?? '',
        exotic: false,
        root,
        state: this.getExtensionState(obj.name),
        packageJSON: Object.freeze(obj)
      }))
    })
    return infos
  }

  /**
   * Remove unnecessary folders in node_modules
   */
  public cleanModulesFolder(): void {
    let globalIds = this.states.globalIds
    let folders = globalIds.map(s => s.replace(/\/.*$/, ''))
    if (!fs.existsSync(this.modulesFolder)) return
    let files = fs.readdirSync(this.modulesFolder)
    for (let file of files) {
      if (folders.includes(file)) continue
      let p = path.join(this.modulesFolder, file)
      let stat = fs.lstatSync(p)
      if (stat.isSymbolicLink()) {
        fs.unlinkSync(p)
      } else if (stat.isDirectory()) {
        fs.rmSync(p, { recursive: true, force: true })
      }
    }
  }

  public dispose(): void {
    this.manager.dispose()
  }
}

export function toUrl(val: string): string {
  return isUrl(val) ? val.replace(/\.git(#master|#main)?$/, '') : ''
}

export default new Extensions()
