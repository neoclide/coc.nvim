import fs from 'fs'
import glob from 'glob'
import isuri from 'isuri'
import path from 'path'
import semver from 'semver'
import { Disposable, Emitter, Event } from 'vscode-languageserver-protocol'
import Uri from 'vscode-uri'
import events from './events'
import DB from './model/db'
import util from 'util'
import { Extension, ExtensionContext, ExtensionInfo, ExtensionState } from './types'
import { disposeAll, runCommand, wait } from './util'
import { distinct } from './util/array'
import { createExtension } from './util/factory'
import { readFile, statAsync } from './util/fs'
import workspace from './workspace'
import Watchman from './watchman'
import { debounce } from 'debounce'

const createLogger = require('./util/logger')
const logger = createLogger('extensions')

export type API = { [index: string]: any } | void | null | undefined

export interface ExtensionItem {
  id: string
  extension: Extension<API>
  deactivate: () => void
  directory?: string
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
  private list: ExtensionItem[] = []
  private interval: string
  private db: DB
  private _onReady = new Emitter<void>()
  private _onDidLoadExtension = new Emitter<Extension<API>>()
  private _onDidActiveExtension = new Emitter<Extension<API>>()
  private _onDidUnloadExtension = new Emitter<string>()
  public readonly onReady: Event<void> = this._onReady.event
  public readonly onDidLoadExtension: Event<Extension<API>> = this._onDidLoadExtension.event
  public readonly onDidActiveExtension: Event<Extension<API>> = this._onDidActiveExtension.event
  public readonly onDidUnloadExtension: Event<string> = this._onDidUnloadExtension.event

  public get root(): string {
    return workspace.env.extensionRoot
  }

  public async init(): Promise<void> {
    this.db = workspace.createDatabase('db')
    let stats = this.globalExtensionStats()
    if (global.hasOwnProperty('__TEST__')) {
      this._onReady.fire()
      return
    }
    stats = stats.filter(o => o.state != 'disabled')
    await Promise.all(stats.map(stat => {
      let folder = stat.root
      return this.loadExtension(folder).catch(e => {
        workspace.showMessage(`Can't load extension from ${folder}: ${e.message}'`, 'error')
      })
    })).then(() => {
      return this.addExtensions()
    }).then(() => {
      this._onReady.fire()
      let config = workspace.getConfiguration('coc.preferences')
      let interval = this.interval = config.get<string>('extensionUpdateCheck', 'daily')
      if (interval == 'never') return
      this.updateExtensions(stats).catch(e => {
        workspace.showMessage(`Error on update extensions: ${e.message}`, 'error')
      })
    })
    if (workspace.isVim) {
      this.updateNodeRpc().catch(e => {
        workspace.showMessage(`Error on update vim-node-rpc: ${e.message}`, 'error')
      })
    }
  }

  private async updateExtensions(stats: ExtensionInfo[]): Promise<void> {
    let now = new Date()
    let { interval, db } = this
    let day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (interval == 'daily' ? 0 : 7))
    let ts = await db.fetch('lastUpdate')
    if (ts && Number(ts) > day.getTime()) return
    await db.push('lastUpdate', Date.now())
    let versionInfo: { [index: string]: string } = {}
    stats = stats.filter(o => !o.exotic)
    let yarncmd = await workspace.nvim.call('coc#util#yarn_cmd')
    for (let stat of stats) {
      if (stat.exotic) continue
      let file = path.join(stat.root, 'package.json')
      try {
        let content = await readFile(file, 'utf8')
        let obj = JSON.parse(content)
        versionInfo[stat.id] = obj.version
      } catch (e) {
        logger.error(e.stack)
      }
    }
    let outdated: string[] = []
    await Promise.all(Object.keys(versionInfo).map(id => {
      let curr = versionInfo[id]
      return runCommand(`${yarncmd} info ${id} --json`, process.cwd()).then(content => {
        let lines = content.trim().split('\n')
        let json = JSON.parse(lines[lines.length - 1])
        let { version, engines } = json.data
        if (version == curr) return
        let required = engines.coc.replace(/^\^/, '>=')
        if (!semver.satisfies(workspace.version, required)) return
        if (semver.gt(version, curr)) {
          outdated.push(id)
        }
      })
    }))
    if (!outdated.length) return
    let status = workspace.createStatusBarItem(99, { progress: true })
    status.text = `Upgrading ${outdated.join(' ')}`
    status.show()
    await runCommand(`${yarncmd} upgrade ${outdated.join(' ')} --latest --ignore-engines`, this.root)
    status.dispose()
  }

  public async updateNodeRpc(): Promise<void> {
    let now = new Date()
    let day = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    let key = 'lastCheckVimNodeRpc'
    let ts = await this.db.fetch(key)
    if (ts && Number(ts) > day.getTime()) return
    let yarncmd = await workspace.nvim.call('coc#util#yarn_cmd')
    if (!yarncmd) return
    await this.db.push(key, Date.now())
    let filepath = await workspace.nvim.call('coc#rpc#vim_rpc_folder')
    if (filepath) {
      let jsonFile = path.join(filepath, 'package.json')
      let { version } = loadJson(jsonFile)
      let res = await runCommand(`${yarncmd} info vim-node-rpc version --json`, process.cwd(), 30000)
      let newVersion = JSON.parse(res).data
      if (!semver.gt(newVersion, version)) return
    }
    let status = workspace.createStatusBarItem(99, { progress: true })
    status.text = 'Upgrading vim-node-rpc'
    status.show()
    await runCommand(`${yarncmd} global add vim-node-rpc`, process.cwd())
    status.dispose()
    logger.info(`Upgrade vim-node-rpc succeed`)
  }

  public async addExtensions(): Promise<void> {
    let { nvim } = workspace
    let { globalExtensions, localExtensions, watchExtensions } = workspace.env
    let list = globalExtensions
    if (list && list.length) {
      list = distinct(list)
      list = list.filter(name => !this.has(name))
      if (list.length) nvim.command(`CocInstall ${list.join(' ')}`, true)
    }
    if (localExtensions.length) {
      localExtensions = distinct(localExtensions)
      await Promise.all(localExtensions.map(folder => {
        return this.loadExtension(folder).catch(e => {
          workspace.showMessage(`Can't load extension from ${folder}: ${e.message}'`, 'error')
        })
      }))
    }
    // watch for changes
    if (watchExtensions.length) {
      let watchmanPath = workspace.getWatchmanPath()
      if (!watchmanPath || process.env.NODE_ENV == 'test') return
      for (let name of watchExtensions) {
        let directory = await util.promisify(fs.realpath)(path.join(this.root, 'node_modules', name))
        let client = await Watchman.createClient(watchmanPath, directory)
        client.subscribe('**/*.js', debounce(async () => {
          await this.reloadExtension(name)
          workspace.showMessage(`reloaded ${name}`)
        }, 100))
      }
    }
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
    let key = `extension.${id}.disabled`
    await db.push(key, state == 'disabled' ? false : true)
    if (state == 'disabled') {
      let folder = path.join(this.root, 'node_modules', id)
      this.loadExtension(folder).catch(e => {
        workspace.showMessage(`Can't load extension ${id}: ${e.message}'`, 'error')
      })
    }
    await wait(200)
  }

  public async reloadExtension(id: string): Promise<void> {
    let idx = this.list.findIndex(o => o.id == id)
    let directory = idx == -1 ? null : this.list[idx].directory
    this.deactivate(id)
    if (idx != -1) this.list.splice(idx, 1)
    await wait(200)
    if (directory) {
      await this.loadExtension(directory)
    } else {
      this.activate(id)
    }
  }

  public async uninstallExtension(ids: string[]): Promise<void> {
    for (let id of ids) {
      if (!this.isGlobalExtension(id)) {
        workspace.showMessage(`Global extension '${id}' not found.`, 'error')
        return
      }
      this.deactivate(id)
    }
    await wait(100)
    let yarncmd = await workspace.nvim.call('coc#util#yarn_cmd')
    if (!yarncmd) return
    try {
      await workspace.runCommand(`${yarncmd} remove ${ids.join(' ')}`, this.root)
      for (let id of ids) {
        this._onDidUnloadExtension.fire(id)
      }
      workspace.showMessage(`Extensions ${ids.join(' ')} removed`)
    } catch (e) {
      workspace.showMessage(`Uninstall failed: ${e.message}`, 'error')
    }
  }

  public isDisabled(id: string): boolean {
    let { db } = this
    try {
      let { extension } = JSON.parse(fs.readFileSync(db.filepath, 'utf8'))
      if (extension && extension[id]) return extension[id].disabled === true
      return false
    } catch (e) {
      return false
    }
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
    if (!stat || !stat.isFile()) return
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
    let context: ExtensionContext = {
      subscriptions: [],
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
      id,
      extension,
      directory: root,
      deactivate: () => {
        isActive = false
        if (ext.deactivate) {
          Promise.resolve(ext.deactivate()).catch(e => {
            logger.error(`Error on ${id} deactivate: `, e.message)
          })
        }
        disposeAll(context.subscriptions)
        context.subscriptions = []
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
    let json = this.loadJson()
    if (!json || !json.dependencies) return []
    let res: ExtensionInfo[] = []
    for (let key of Object.keys(json.dependencies)) {
      let val = json.dependencies[key]
      res.push({
        id: key,
        exotic: isuri.isValid(val),
        root: path.join(root, 'node_modules', key),
        state: this.getExtensionState(key)
      })
    }
    return res
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
        exotic: false,
        state: this.getExtensionState(item.id)
      })
    })
    return res
  }

  private isGlobalExtension(id: string): boolean {
    return this.globalExtensions.indexOf(id) !== -1
  }

  public get globalExtensions(): string[] {
    let json = this.loadJson()
    if (!json || !json.dependencies) return []
    return Object.keys(json.dependencies)
  }
}

export default new Extensions()
