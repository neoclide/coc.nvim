'use strict'
import fs from 'fs'
import path from 'path'
import { URL } from 'url'
import { CancellationTokenSource, Disposable, Event } from 'vscode-languageserver-protocol'
import commandManager from '../commands'
import events from '../events'
import type { OutputChannel } from '../types'
import { concurrent, disposeAll } from '../util'
import { distinct } from '../util/array'
import { isCancellationError } from '../util/errors'
import '../util/extensions'
import { isUrl } from '../util/is'
import window from '../window'
import workspace from '../workspace'
import { DependencySession } from './dependency'
import { IInstaller, Installer, registryUrl } from './installer'
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
  private disposables: Disposable[] = []
  constructor() {
    checkExtensionRoot(EXTENSIONS_FOLDER)
    this.states = new ExtensionStat(EXTENSIONS_FOLDER)
    this.manager = new ExtensionManager(this.states, EXTENSIONS_FOLDER)
    events.on('VimLeavePre', () => {
      this.cancelInstallers()
    })
  }

  public cancelInstallers() {
    disposeAll(this.disposables)
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
   * @deprecated Used by old version coc-json.
   */
  public get schemes(): { [key: string]: PropertyScheme } {
    return {}
  }

  /**
   * @deprecated Used by old version coc-json.
   */
  public addSchemeProperty(key: string, def: PropertyScheme): void {
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

  private createInstallerUI(isUpdate: boolean, silent: boolean, disposables: Disposable[]): InstallUI {
    return silent ? new InstallChannel(isUpdate, this.outputChannel) : new InstallBuffer(isUpdate, async () => {
      if (disposables.length > 0) {
        disposeAll(disposables)
        void window.showWarningMessage(`Extension install process canceled`)
      }
    })
  }

  public createInstaller(registry: URL, def: string): IInstaller {
    return new Installer(new DependencySession(registry, this.modulesFolder), def)
  }

  /**
   * Install extensions, can be called without initialize.
   */
  public async installExtensions(list: string[]): Promise<void> {
    if (list.length == 0) return
    this.cancelInstallers()
    list = distinct(list)
    let disposables: Disposable[] = this.disposables = []
    let installBuffer = this.createInstallerUI(false, false, disposables)
    let tokenSource = new CancellationTokenSource()
    let installers: Map<string, IInstaller> = new Map()
    installBuffer.onDidCancel(key => {
      let item = installers.get(key)
      if (item) item.dispose()
    })
    disposables.push(Disposable.create(() => {
      tokenSource.cancel()
      for (let item of installers.values()) {
        item.dispose()
      }
    }))
    await Promise.resolve(installBuffer.start(list))
    let registry = await registryUrl()
    let fn = async (key: string): Promise<void> => {
      let installer: IInstaller
      try {
        installBuffer.startProgress(key)
        installer = this.createInstaller(registry, key)
        installers.set(key, installer)
        installer.on('message', (msg, isProgress) => {
          installBuffer.addMessage(key, msg, isProgress)
        })
        logger.debug('install:', key)
        let result = await installer.install()
        installBuffer.finishProgress(key, true)
        this.states.addExtension(result.name, result.url ? result.url : `>=${result.version}`)
        let ms = key.match(/@[\d.]+$/)
        if (ms != null) this.states.setLocked(result.name, true)
        await this.manager.loadExtension(result.folder)
      } catch (err: any) {
        this.onInstallError(key, installBuffer, err)
      }
    }
    await concurrent(list, fn, 3, tokenSource.token)
    let len = disposables.length
    disposables.splice(0, len)
  }

  /**
   * Update global extensions
   */
  public async updateExtensions(silent = false): Promise<void> {
    this.cancelInstallers()
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
    let registry = await registryUrl()
    let disposables: Disposable[] = this.disposables = []
    let installers: Map<string, IInstaller> = new Map()
    let installBuffer = this.createInstallerUI(true, silent, disposables)
    let tokenSource = new CancellationTokenSource()
    disposables.push(Disposable.create(() => {
      tokenSource.cancel()
      for (let item of installers.values()) {
        item.dispose()
      }
    }))
    installBuffer.onDidCancel(key => {
      let item = installers.get(key)
      if (item) item.dispose()
    })
    await Promise.resolve(installBuffer.start(stats.map(o => o.id)))
    let fn = async (stat: ExtensionInfo): Promise<void> => {
      let { id } = stat
      let installer: IInstaller
      try {
        installBuffer.startProgress(id)
        let url = stat.exotic ? stat.uri : null
        installer = this.createInstaller(registry, id)
        installers.set(id, installer)
        installer.on('message', (msg, isProgress) => {
          installBuffer.addMessage(id, msg, isProgress)
        })
        let directory = await installer.update(url)
        installBuffer.finishProgress(id, true)
        if (directory) await this.manager.loadExtension(directory)
      } catch (err: any) {
        this.onInstallError(id, installBuffer, err)
      }
    }
    await concurrent(stats, fn, silent ? 1 : 3, tokenSource.token)
    disposables.splice(0, disposables.length)
  }

  private onInstallError(id: string, installBuffer: InstallUI, err: Error): void {
    installBuffer.addMessage(id, err.message)
    installBuffer.finishProgress(id, false)
    if (!isCancellationError(err)) {
      void window.showErrorMessage(`Error on install ${id}: ${err}`)
      logger.error(`Error on update ${id}`, err)
    }
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
      if (folders.includes(file) || file === '.cache') continue
      let p = path.join(this.modulesFolder, file)
      fs.rmSync(p, { recursive: true, force: true })
    }
  }

  public dispose(): void {
    this.cancelInstallers()
    this.manager.dispose()
  }
}

export function toUrl(val: string): string {
  return isUrl(val) ? val.replace(/\.git(#master|#main)?$/, '') : ''
}

export default new Extensions()
