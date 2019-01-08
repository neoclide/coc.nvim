import { Neovim } from '@chemzqm/neovim'
import fs from 'fs'
import glob from 'glob'
import JsonDB from 'node-json-db'
import path from 'path'
import semver from 'semver'
import { Disposable, Emitter, Event } from 'vscode-languageserver-protocol'
import Uri from 'vscode-uri'
import events from './events'
import { Extension, ExtensionContext, ExtensionInfo, ExtensionState } from './types'
import { disposeAll, wait } from './util'
import { createExtension } from './util/factory'
import { readFile, statAsync } from './util/fs'
import workspace from './workspace'

const createLogger = require('./util/logger')
const logger = createLogger('extensions')

export type API = { [index: string]: any } | void | null | undefined

export interface ExtensionItem {
  id: string
  extension: Extension<API>
  deactivate: () => void
}

function loadJson(file: string): any {
  try {
    let content = fs.readFileSync(file, 'utf8')
    return JSON.parse(content)
  } catch (e) {
    return null
  }
}

export class Extensions {
  private disposables: Disposable[] = []
  private list: ExtensionItem[] = []
  private root: string
  private interval: string
  private db: JsonDB
  public isEmpty = false

  private _onReady = new Emitter<void>()
  private _onDidLoadExtension = new Emitter<Extension<API>>()
  private _onDidActiveExtension = new Emitter<Extension<API>>()
  private _onDidUnloadExtension = new Emitter<string>()
  public readonly onReady: Event<void> = this._onReady.event
  public readonly onDidLoadExtension: Event<Extension<API>> = this._onDidLoadExtension.event
  public readonly onDidActiveExtension: Event<Extension<API>> = this._onDidActiveExtension.event
  public readonly onDidUnloadExtension: Event<string> = this._onDidUnloadExtension.event

  public async init(nvim: Neovim): Promise<void> {
    let root = this.root = await nvim.call('coc#util#extension_root')
    this.db = new JsonDB(path.join(path.dirname(root), 'db'), true, false)
    let stats = this.globalExtensionStats()
    if (global.hasOwnProperty('__TEST__')) {
      this._onReady.fire()
      return
    }
    await Promise.all(stats.map(state => {
      let folder = state.root
      let id = path.dirname(folder)
      if (this.isDisabled(id)) return null
      return this.loadExtension(folder).catch(e => {
        workspace.showMessage(`Can't load extension from ${folder}: ${e.message}'`, 'error')
      })
    }))
    this._onReady.fire()
    let config = workspace.getConfiguration('coc.preferences')
    let interval = this.interval = config.get<string>('extensionUpdateCheck', 'daily')
    if (interval == 'never') return
    this.onDidActiveExtension(async extension => {
      let { id, packageJSON } = extension
      if (!this.isGlobalExtension(id) || this.isExoticExtension(id)) return
      let update = await this.checkUpdate(id, packageJSON.version)
      if (update) await workspace.nvim.command(`CocInstall ${id}`)
    }, null, this.disposables)
    if (workspace.isVim) this.updateNodeRpc() // tslint:disable-line
  }

  public async updateNodeRpc(): Promise<void> {
    let filepath = await workspace.resolveModule('vim-node-rpc')
    if (filepath) {
      let jsonFile = path.join(filepath, 'package.json')
      let obj = loadJson(jsonFile)
      let update = await this.checkUpdate('vim-node-rpc', obj.version, false)
      if (update) {
        let status = workspace.createStatusBarItem(99, { progress: true })
        status.text = 'Upgrading vim-node-rpc'
        status.show()
        await workspace.runCommand('yarn global add vim-node-rpc', process.cwd(), 30000)
        status.dispose()
      }
    }
  }

  public async checkUpdate(moduleName: string, oldVersion: string, prompt = true): Promise<boolean> {
    let now = new Date()
    let { interval, db } = this
    let day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (interval == 'daily' ? 0 : 7))
    let key = `/extension/${moduleName}/ts`
    let ts = (db as any).exists(key) ? db.getData(key) : null
    if (!ts || Number(ts) < day.getTime()) {
      db.push(key, Date.now())
      try {
        let res = await workspace.runCommand(`yarn info ${moduleName} version --json`)
        let version = JSON.parse(res).data
        if (semver.gt(version, oldVersion)) {
          if (!prompt) return true
          let res = await workspace.showPrompt(`a new version: ${version} of ${moduleName} available, update?`)
          if (res) return true
        }
      } catch (e) {
        logger.error(e.stack)
        // noop
      }
    }
    return false
  }

  public get all(): Extension<API>[] {
    return this.list.map(o => o.extension)
  }

  public get commands(): { [index: string]: string } {
    let res = {}
    for (let item of this.list) {
      let { packageJSON } = item.extension
      if (packageJSON.contributes) {
        let { commands } = packageJSON.contributes
        if (commands && commands.length) {
          for (let cmd of commands) {
            res[cmd.command] = cmd.title
          }
        }
      }
    }
    return res
  }

  public getExtensionState(id: string): ExtensionState {
    let disabled = this.isDisabled(id)
    if (disabled) return 'disabled'
    let item = this.list.find(o => o.id == id)
    if (!item) return 'unknown'
    let { extension } = item
    return extension.isActive ? 'activited' : 'loaded'
  }

  public getExtensionStates(): ExtensionInfo[] {
    let globalStats = this.globalExtensionStats()
    let localStats = this.localExtensionStats()
    return globalStats.concat(localStats)
  }

  public async toggleExtension(id: string): Promise<void> {
    let state = this.getExtensionState(id)
    if (state == null) return
    if (state == 'activited') {
      this.deactivate(id)
    }
    if (state != 'disabled') {
      // unload
      let idx = this.list.findIndex(o => o.id == id)
      this.list.splice(idx, 1)
    }
    let { db } = this
    let key = `/extension/${id}/disabled`
    db.push(key, state == 'disabled' ? false : true)
    if (state == 'disabled') {
      let folder = path.join(this.root, 'node_modules', id)
      this.loadExtension(folder).catch(e => {
        workspace.showMessage(`Can't load extension from ${folder}: ${e.message}'`, 'error')
      })
    }
    await wait(200)
  }

  public async reloadExtension(id: string): Promise<void> {
    this.deactivate(id)
    await wait(200)
    this.activate(id)
  }

  public async uninstallExtension(id: string): Promise<void> {
    if (!this.isGlobalExtension(id)) {
      workspace.showMessage(`Global extension '${id}' not found.`, 'error')
      return
    }
    this.deactivate(id)
    await wait(100)
    try {
      await workspace.runCommand(`yarn remove ${id}`, this.root)
      this._onDidUnloadExtension.fire(id)
      workspace.showMessage(`Extension ${id} removed`)
    } catch (e) {
      workspace.showMessage(`Uninstall failed: ${e.message}`, 'error')
    }
  }

  public isDisabled(id: string): boolean {
    let { db } = this
    let key = `/extension/${id}/disabled`
    return (db as any).exists(key) && db.getData(key) == true
  }

  public async onExtensionInstall(id: string): Promise<void> {
    if (/^\w+:/.test(id)) id = this.packageNameFromUrl(id)
    if (!id || /^-/.test(id)) return
    let item = this.list.find(o => o.id == id)
    if (item) item.deactivate()
    let folder = path.join(this.root, 'node_modules', id)
    let stat = await statAsync(folder)
    if (stat && stat.isDirectory()) {
      let jsonFile = path.join(folder, 'package.json')
      let content = await readFile(jsonFile, 'utf8')
      let packageJSON = JSON.parse(content)
      let { engines } = packageJSON
      if (!engines || (!engines.hasOwnProperty('coc') && !engines.hasOwnProperty('vscode'))) {
        let confirmed = await workspace.showPrompt(`"${id}" is not a valid extension, remove it?`)
        if (confirmed) workspace.nvim.command(`CocUninstall ${id}`, true)
        return
      }
      await this.loadExtension(folder)
    }
  }

  public has(id: string): boolean {
    return this.list.find(o => o.id == id) != null
  }

  public isActivted(id: string): boolean {
    let item = this.list.find(o => o.id == id)
    if (item && item.extension.isActive) {
      return true
    }
    return false
  }

  public async loadExtension(folder: string): Promise<void> {
    let jsonFile = path.join(folder, 'package.json')
    let stat = await statAsync(jsonFile)
    if (!stat || !stat.isFile()) {
      workspace.showMessage(`package.json not found in ${folder}`, 'error')
      return
    }
    let content = await readFile(jsonFile, 'utf8')
    let packageJSON = JSON.parse(content)
    if (this.isActivted(packageJSON.name)) {
      workspace.showMessage(`deactivate ${packageJSON.name}`)
      this.deactivate(packageJSON.name)
      await wait(200)
    }
    let { engines } = packageJSON
    if (engines && engines.hasOwnProperty('coc')) {
      let required = engines.coc.replace(/^\^/, '>=')
      if (!semver.satisfies(workspace.version, required)) {
        workspace.showMessage(`Please update coc.nvim, ${packageJSON.name} requires coc.nvim >= ${engines.coc}`, 'warning')
      }
      this.createExtension(folder, Object.freeze(packageJSON))
    } else if (engines && engines.hasOwnProperty('vscode')) {
      this.createExtension(folder, Object.freeze(packageJSON))
    } else {
      workspace.showMessage(`engine coc & vscode not found in ${jsonFile}`, 'warning')
    }
  }

  private loadJson(): any {
    let { root } = this
    let jsonFile = path.join(root, 'package.json')
    if (!fs.existsSync(jsonFile)) return null
    return loadJson(jsonFile)
  }

  private packageNameFromUrl(url: string): string {
    let json = this.loadJson()
    if (!json || !json.dependencies) return null
    for (let key of Object.keys(json.dependencies)) {
      let val = json.dependencies[key]
      if (val == url) return key
    }
    return null
  }

  private setupActiveEvents(id: string, packageJSON: any): void {
    let { activationEvents } = packageJSON
    if (!activationEvents || activationEvents.indexOf('*') !== -1 || !Array.isArray(activationEvents)) {
      this.activate(id)
      return
    }
    let active = () => {
      disposeAll(disposables)
      this.activate(id)
      active = () => { } // tslint:disable-line
    }
    let disposables: Disposable[] = []
    for (let eventName of activationEvents as string[]) {
      let parts = eventName.split(':')
      let ev = parts[0]
      if (ev == 'onLanguage') {
        if (workspace.filetypes.has(parts[1])) {
          active()
          return
        }
        workspace.onDidOpenTextDocument(document => {
          if (document.languageId == parts[1]) {
            active()
          }
        }, null, disposables)
      } else if (ev == 'onCommand') {
        events.on('Command', command => {
          if (command == parts[1]) {
            active()
            // wait for service ready
            return new Promise(resolve => {
              setTimeout(resolve, 500)
            })
          }
        }, null, disposables)
      } else if (ev == 'workspaceContains') {
        let check = () => {
          glob(parts[1], { cwd: workspace.root }, (err, files) => {
            if (err) return
            if (files && files.length) {
              active()
            }
          })
        }
        check()
        workspace.onDidChangeWorkspaceFolder(check, null, disposables)
      } else if (ev == 'onFileSystem') {
        for (let doc of workspace.documents) {
          let u = Uri.parse(doc.uri)
          if (u.scheme == parts[1]) {
            return active()
          }
        }
        workspace.onDidOpenTextDocument(document => {
          let u = Uri.parse(document.uri)
          if (u.scheme == parts[1]) {
            active()
          }
        }, null, disposables)
      } else {
        workspace.showMessage(`Unsupported event ${eventName} of ${id}`, 'error')
      }
    }
  }

  public activate(id, silent = true): void {
    if (this.isDisabled(id)) {
      if (!silent) workspace.showMessage(`Extension ${id} is disabled!`, 'error')
      return
    }
    let item = this.list.find(o => o.id == id)
    if (!item) {
      workspace.showMessage(`Extension ${id} not found!`, 'error')
      return
    }
    let { extension } = item
    if (extension.isActive) return
    extension.activate().then(() => {
      if (extension.isActive) {
        this._onDidActiveExtension.fire(extension)
      }
    }, _e => {
      // noop
    })
  }

  public deactivate(id): boolean {
    let item = this.list.find(o => o.id == id)
    if (!item) return false
    if (item.extension.isActive && typeof item.deactivate == 'function') {
      item.deactivate()
      return true
    }
    return false
  }

  // for json schema
  public getConfigurations(): { [index: string]: any } {
    let res = {}
    for (let item of this.list) {
      let { extension } = item
      let { packageJSON } = extension
      let { contributes } = packageJSON
      if (!contributes || !contributes.configuration) {
        continue
      }
      let { properties } = contributes.configuration
      if (!properties) {
        continue
      }
      for (let prop of properties) {
        res[prop] = properties[prop]
      }
    }
    return res
  }

  public async call(id: string, method: string, args: any[]): Promise<any> {
    let item = this.list.find(o => o.id == id)
    if (!item) return workspace.showMessage(`extension ${id} not found`, 'error')
    let { extension } = item
    if (!extension.isActive) {
      workspace.showMessage(`extension ${id} not activated`, 'error')
      return
    }
    let { exports } = extension
    if (!exports || !exports.hasOwnProperty(method)) {
      workspace.showMessage(`method ${method} not found on extension ${id}`, 'error')
      return
    }
    return await Promise.resolve(exports[method].apply(null, args))
  }

  private createExtension(root: string, packageJSON: any): string {
    let id = `${packageJSON.name}`
    let isActive = false
    let exports = null
    let filename = path.join(root, packageJSON.main || 'index.js')
    let ext = createExtension(id, filename)
    if (!ext) return
    let subscriptions: Disposable[] = []
    let context: ExtensionContext = {
      subscriptions,
      extensionPath: root,
      asAbsolutePath: relativePath => {
        return path.join(root, relativePath)
      },
      storagePath: path.join(this.root, `${id}-data`),
      logger: createLogger(id)
    }

    let extension: any = {
      activate: async (): Promise<API> => {
        if (isActive) return
        isActive = true
        try {
          exports = await Promise.resolve(ext.activate(context))
        } catch (e) {
          isActive = false
          logger.error(e)
          workspace.showMessage(`Error on active extension ${id}: ${e.message}`, 'error')
        }
        return exports as API
      }
    }
    Object.defineProperties(extension, {
      id: {
        get: () => id
      },
      packageJSON: {
        get: () => packageJSON
      },
      extensionPath: {
        get: () => root
      },
      isActive: {
        get: () => isActive
      },
      exports: {
        get: () => exports
      }
    })

    this.list.push({
      id, extension, deactivate: () => {
        isActive = false
        if (ext.deactivate) {
          Promise.resolve(ext.deactivate()).catch(e => {
            logger.error(`Error on ${id} deactivate: `, e.message)
          })
        }
        context.subscriptions = []
        disposeAll(subscriptions)
      }
    })
    let { contributes } = packageJSON
    if (contributes) {
      let { configuration } = contributes
      if (configuration && configuration.properties) {
        let { properties } = configuration
        let props = {}
        for (let key of Object.keys(properties)) {
          let val = properties[key].default
          if (val != null) props[key] = val
        }
        workspace.configurations.extendsDefaults(props)
      }
    }
    this._onDidLoadExtension.fire(extension)
    this.setupActiveEvents(id, packageJSON)
    return id
  }

  public registerExtension(extension: Extension<API>, deactivate?: () => void): void {
    let { id, packageJSON } = extension
    this.list.push({ id, extension, deactivate })
    let { contributes } = packageJSON
    if (contributes) {
      let { configuration } = contributes
      if (configuration && configuration.properties) {
        let { properties } = configuration
        let props = {}
        for (let key of Object.keys(properties)) {
          let val = properties[key].default
          if (val != null) props[key] = val
        }
        workspace.configurations.extendsDefaults(props)
      }
    }
    this._onDidLoadExtension.fire(extension)
    this.setupActiveEvents(id, packageJSON)
  }

  private globalExtensionStats(): ExtensionInfo[] {
    let { root } = this
    let names = this.globalExtensions
    if (!names.length) return []
    return names.map(name => {
      return {
        id: name,
        root: path.join(root, 'node_modules', name),
        state: this.getExtensionState(name)
      }
    })
  }

  private localExtensionStats(): ExtensionInfo[] {
    let globals = this.globalExtensions
    let res: ExtensionInfo[] = []
    this.list.forEach(item => {
      if (globals.indexOf(item.id) !== -1) return
      let { extensionPath, packageJSON } = item.extension
      res.push({
        id: packageJSON.name,
        root: extensionPath,
        state: this.getExtensionState(item.id)
      })
    })
    return res
  }

  private isGlobalExtension(id: string): boolean {
    return this.globalExtensions.indexOf(id) !== -1
  }

  private isExoticExtension(id: string): boolean {
    let json = this.loadJson()
    if (!json || !json.dependencies) {
      return true
    }
    let { dependencies } = json
    let val = dependencies[id]
    if (!val || /^(https?|git):/.test(val)) {
      return true
    }
    return false
  }

  public get globalExtensions(): string[] {
    let json = this.loadJson()
    if (!json || !json.dependencies) return []
    return Object.keys(json.dependencies)
  }
}

export default new Extensions()
