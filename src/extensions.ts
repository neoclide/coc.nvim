import { debounce } from 'debounce'
import fastDiff from 'fast-diff'
import os from 'os'
import fs from 'fs'
import isuri from 'isuri'
import path from 'path'
import rimraf from 'rimraf'
import semver from 'semver'
import { promisify } from 'util'
import { Disposable, Emitter, Event } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import which from 'which'
import commandManager from './commands'
import events from './events'
import DB from './model/db'
import ExtensionManager from './model/extension'
import Memos from './model/memos'
import { Extension, ExtensionContext, ExtensionInfo, ExtensionState } from './types'
import { disposeAll, concurrent, wait } from './util'
import mkdirp from 'mkdirp'
import { distinct } from './util/array'
import './util/extensions'
import { createExtension, ExtensionExport } from './util/factory'
import { inDirectory, readdirAsync, readFile, realpathAsync, statAsync } from './util/fs'
import Watchman from './watchman'
import workspace from './workspace'

const createLogger = require('./util/logger')
const logger = createLogger('extensions')

export type API = { [index: string]: any } | void | null | undefined

export interface PropertyScheme {
  type: string
  default: any
  description: string
  enum?: string[]
  items?: any
  [key: string]: any
}

export interface ExtensionItem {
  id: string
  extension: Extension<API>
  deactivate: () => void
  directory?: string
  isLocal: boolean
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
  private disabled: Set<string> = new Set()
  private db: DB
  private memos: Memos
  private root: string
  private _onDidLoadExtension = new Emitter<Extension<API>>()
  private _onDidActiveExtension = new Emitter<Extension<API>>()
  private _onDidUnloadExtension = new Emitter<string>()
  private _additionalSchemes: { [key: string]: PropertyScheme } = {}
  private activated = false
  private manager: ExtensionManager
  public ready = true
  public readonly onDidLoadExtension: Event<Extension<API>> = this._onDidLoadExtension.event
  public readonly onDidActiveExtension: Event<Extension<API>> = this._onDidActiveExtension.event
  public readonly onDidUnloadExtension: Event<string> = this._onDidUnloadExtension.event

  public async init(): Promise<void> {
    if (global.hasOwnProperty('__TEST__')) {
      this.root = path.join(__dirname, './__tests__/extensions')
      this.manager = new ExtensionManager(this.root)
      let filepath = path.join(this.root, 'db.json')
      this.db = new DB(filepath)
    } else {
      await this.initializeRoot()
    }
    let data = loadJson(this.db.filepath) || {}
    let keys = Object.keys(data.extension || {})
    for (let key of keys) {
      if (data.extension[key].disabled == true) {
        this.disabled.add(key)
      }
    }
    if (process.env.COC_NO_PLUGINS) return
    let stats = await this.globalExtensionStats()
    let localStats = await this.localExtensionStats(stats)
    stats = stats.concat(localStats)
    this.memos = new Memos(path.resolve(this.root, '../memos.json'))
    await this.loadFileExtensions()
    await Promise.all(stats.map(stat => {
      return this.loadExtension(stat.root, stat.isLocal).catch(e => {
        workspace.showMessage(`Can't load extension from ${stat.root}: ${e.message}'`, 'error')
      })
    }))
    // watch for new local extension
    workspace.watchOption('runtimepath', async (oldValue, newValue) => {
      let result = fastDiff(oldValue, newValue)
      for (let [changeType, value] of result) {
        if (changeType == 1) {
          let paths = value.replace(/,$/, '').split(',')
          for (let p of paths) {
            if (p) await this.loadExtension(p, true)
          }
        }
      }
    })
    commandManager.register({
      id: 'extensions.forceUpdateAll',
      execute: async () => {
        await this.cleanExtensions()
        await this.installExtensions([])
      }
    })
  }

  public async activateExtensions(): Promise<void> {
    this.activated = true
    if (global.hasOwnProperty('__TEST__')) return
    for (let item of this.list) {
      let { id, packageJSON } = item.extension
      this.setupActiveEvents(id, packageJSON)
    }
    // check extensions need watch & install
    this.checkExtensions().logError()
    let config = workspace.getConfiguration('coc.preferences')
    let interval = config.get<string>('extensionUpdateCheck', 'daily')
    if (interval != 'never') {
      let now = new Date()
      let day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (interval == 'daily' ? 0 : 7))
      let ts = this.db.fetch('lastUpdate')
      if (ts && Number(ts) > day.getTime()) return
      this.updateExtensions().logError()
    }
  }

  public async updateExtensions(): Promise<Disposable | null> {
    if (!this.root) await this.initializeRoot()
    if (!this.npm) return
    let lockedList = await this.getLockedList()
    let stats = await this.globalExtensionStats()
    stats = stats.filter(o => !this.disabled.has(o.id) && !lockedList.includes(o.id))
    let names = stats.map(o => o.id)
    let statusItem = workspace.createStatusBarItem(0, { progress: true })
    statusItem.text = `Updating extensions.`
    statusItem.show()
    this.db.push('lastUpdate', Date.now())
    await concurrent(names.map(name => {
      let o = stats.find(o => o.id == name)
      return (): Promise<void> => {
        return this.manager.update(this.npm, name, o.exotic ? o.uri : undefined).then(updated => {
          if (updated) this.reloadExtension(name).logError()
        }, err => {
          workspace.showMessage(`Error on update ${name}: ${err}`)
        })
      }
    }), 5)
    workspace.showMessage('Update completed', 'more')
    statusItem.dispose()
  }

  private async checkExtensions(): Promise<void> {
    let { globalExtensions, watchExtensions } = workspace.env
    if (globalExtensions && globalExtensions.length) {
      let names = globalExtensions.filter(name => !this.isDisabled(name))
      let folder = path.join(this.root, 'node_modules')
      if (fs.existsSync(folder)) {
        let files = await promisify(fs.readdir)(folder)
        names = names.filter(s => files.indexOf(s) == -1)
      }
      let json = this.loadJson()
      if (json && json.dependencies) {
        let vals = Object.values(json.dependencies) as string[]
        names = names.filter(s => vals.findIndex(val => val.indexOf(s) !== -1) == -1)
      }
      this.installExtensions(names).logError()
    }
    // watch for changes
    if (watchExtensions && watchExtensions.length) {
      let watchmanPath = workspace.getWatchmanPath()
      if (!watchmanPath) return
      let stats = await this.getExtensionStates()
      for (let name of watchExtensions) {
        let stat = stats.find(s => s.id == name)
        if (stat && stat.state !== 'disabled') {
          let directory = await promisify(fs.realpath)(stat.root)
          let client = await Watchman.createClient(watchmanPath, directory)
          client.subscribe('**/*.js', debounce(async () => {
            await this.reloadExtension(name)
            workspace.showMessage(`reloaded ${name}`)
          }, 100)).catch(_e => {
            // noop
          })
        }
      }
    }
  }

  /**
   * Install extensions, can be called without initialize.
   */
  public async installExtensions(list: string[] = []): Promise<void> {
    let { npm } = this
    if (!npm) return
    if (!this.root) await this.initializeRoot()
    let missing = this.getMissingExtensions()
    if (missing.length) list.push(...missing)
    if (!list.length) return
    list = distinct(list)
    let statusItem = workspace.createStatusBarItem(0, { progress: true })
    statusItem.show()
    statusItem.text = `Installing ${list.join(' ')}`
    await Promise.all(list.map(def => {
      return this.manager.install(npm, def).then(name => {
        if (name) this.onExtensionInstall(name).logError()
      }, err => {
        workspace.showMessage(`Error on install ${def}: ${err}`)
      })
    }))
    statusItem.dispose()
  }

  /**
   * Get list of extensions in package.json that not installed
   */
  public getMissingExtensions(): string[] {
    let json = this.loadJson() || { dependencies: {} }
    let ids: string[] = []
    for (let key of Object.keys(json.dependencies)) {
      let folder = path.join(this.root, 'node_modules', key)
      if (!fs.existsSync(folder)) {
        let val = json.dependencies[key]
        if (val.startsWith('http')) {
          ids.push(val)
        } else {
          ids.push(key)
        }
      }
    }
    return ids
  }

  private get npm(): string {
    let npm = workspace.getConfiguration('npm').get<string>('binPath', 'npm')
    if (npm.startsWith('~')) {
      npm = os.homedir() + npm.slice(1)
    }
    for (let exe of [npm, 'yarnpkg', 'yarn', 'npm']) {
      try {
        let res = which.sync(exe)
        return res
      } catch (e) {
        continue
      }
    }
    workspace.showMessage(`Can't find npm or yarn in your $PATH`, 'error')
    return null
  }

  /**
   * Get all loaded extensions.
   */
  public get all(): Extension<API>[] {
    return this.list.map(o => o.extension)
  }

  public getExtension(id: string): ExtensionItem {
    return this.list.find(o => o.id == id)
  }

  public getExtensionState(id: string): ExtensionState {
    let disabled = this.isDisabled(id)
    if (disabled) return 'disabled'
    let item = this.list.find(o => o.id == id)
    if (!item) return 'unknown'
    let { extension } = item
    return extension.isActive ? 'activated' : 'loaded'
  }

  public async getExtensionStates(): Promise<ExtensionInfo[]> {
    let globalStats = await this.globalExtensionStats()
    let localStats = await this.localExtensionStats(globalStats)
    return globalStats.concat(localStats)
  }

  public async getLockedList(): Promise<string[]> {
    let obj = await this.db.fetch('extension')
    obj = obj || {}
    return Object.keys(obj).filter(id => {
      return obj[id].locked === true
    })
  }

  public async toggleLock(id: string): Promise<void> {
    let key = `extension.${id}.locked`
    let locked = await this.db.fetch(key)
    if (locked) {
      this.db.delete(key)
    } else {
      this.db.push(key, true)
    }
  }

  public async toggleExtension(id: string): Promise<void> {
    let state = this.getExtensionState(id)
    if (state == null) return
    if (state == 'activated') {
      this.deactivate(id)
    }
    let key = `extension.${id}.disabled`
    this.db.push(key, state == 'disabled' ? false : true)
    if (state != 'disabled') {
      this.disabled.add(id)
      // unload
      let idx = this.list.findIndex(o => o.id == id)
      this.list.splice(idx, 1)
    } else {
      this.disabled.delete(id)
      let p = global.hasOwnProperty('__TEST__') ? '' : 'node_modules'
      let folder = path.join(this.root, p, id)
      try {
        await this.loadExtension(folder)
      } catch (e) {
        workspace.showMessage(`Can't load extension ${id}: ${e.message}'`, 'error')
      }
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

  /**
   * Remove all installed extensions
   */
  public async cleanExtensions(): Promise<void> {
    let dir = path.join(this.root, 'node_modules')
    if (!fs.existsSync(dir)) return
    let names = fs.readdirSync(dir)
    for (let name of names) {
      let file = path.join(dir, name)
      let stat = await promisify(fs.lstat)(file)
      if (stat.isSymbolicLink()) continue
      await promisify(rimraf)(file, { glob: false })
    }
  }

  public async uninstallExtension(ids: string[]): Promise<void> {
    if (!ids.length) return
    let status = workspace.createStatusBarItem(99, { progress: true })
    try {
      status.text = `Uninstalling ${ids.join(' ')}`
      status.show()
      let removed: string[] = []
      for (let id of ids) {
        if (!this.isGlobalExtension(id)) {
          workspace.showMessage(`Global extension '${id}' not found.`, 'error')
          continue
        }
        this.deactivate(id)
        removed.push(id)
      }
      for (let id of removed) {
        let idx = this.list.findIndex(o => o.id == id)
        if (idx != -1) {
          this.list.splice(idx, 1)
          this._onDidUnloadExtension.fire(id)
        }
      }
      let json = this.loadJson() || { dependencies: {} }
      for (let id of removed) {
        delete json.dependencies[id]
        let folder = path.join(this.root, 'node_modules', id)
        if (fs.existsSync(folder)) {
          await promisify(rimraf)(`${folder}`, { glob: false })
        }
      }
      let jsonFile = path.join(this.root, 'package.json')
      status.dispose()
      const sortedObj = { dependencies: {} }
      Object.keys(json.dependencies).sort().forEach(k => {
          sortedObj.dependencies[k] = json.dependencies[k]
      })
      fs.writeFileSync(jsonFile, JSON.stringify(sortedObj, null, 2), { encoding: 'utf8' })
      workspace.showMessage(`Removed: ${ids.join(' ')}`)
    } catch (e) {
      status.dispose()
      workspace.showMessage(`Uninstall failed: ${e.message}`, 'error')
    }
  }

  public isDisabled(id: string): boolean {
    return this.disabled.has(id)
  }

  private async onExtensionInstall(id: string): Promise<void> {
    if (!id) return
    let item = this.list.find(o => o.id == id)
    if (item) item.deactivate()
    let folder = path.join(this.root, 'node_modules', id)
    let stat = await statAsync(folder)
    if (stat && stat.isDirectory()) {
      let jsonFile = path.join(folder, 'package.json')
      let content = await readFile(jsonFile, 'utf8')
      let packageJSON = JSON.parse(content)
      let { engines } = packageJSON
      if (!engines || (!engines.hasOwnProperty('coc') && !engines.hasOwnProperty('vscode'))) return
      await this.loadExtension(folder)
    }
  }

  public has(id: string): boolean {
    return this.list.find(o => o.id == id) != null
  }

  public isActivated(id: string): boolean {
    let item = this.list.find(o => o.id == id)
    if (item && item.extension.isActive) {
      return true
    }
    return false
  }

  public async loadExtension(folder: string, isLocal = false): Promise<void> {
    let jsonFile = path.join(folder, 'package.json')
    let stat = await statAsync(jsonFile)
    if (!stat || !stat.isFile()) return
    let content = await readFile(jsonFile, 'utf8')
    let packageJSON = JSON.parse(content)
    if (this.isDisabled(packageJSON.name)) return
    if (this.isActivated(packageJSON.name)) {
      workspace.showMessage(`deactivate ${packageJSON.name}`)
      this.deactivate(packageJSON.name)
      await wait(200)
    }
    let { engines } = packageJSON
    if (engines && engines.hasOwnProperty('coc')) {
      let required = engines.coc.replace(/^\^/, '>=')
      if (!semver.satisfies(workspace.version, required)) {
        workspace.showMessage(`Please update coc.nvim, ${packageJSON.name} requires coc.nvim ${engines.coc}`, 'warning')
      }
      this.createExtension(folder, Object.freeze(packageJSON), isLocal)
    } else if (engines && engines.hasOwnProperty('vscode')) {
      this.createExtension(folder, Object.freeze(packageJSON), isLocal)
    } else {
      logger.info(`engine coc & vscode not found in ${jsonFile}`)
    }
  }

  private async loadFileExtensions(): Promise<void> {
    if (!process.env.COC_VIMCONFIG) return
    let folder = path.join(process.env.COC_VIMCONFIG, 'coc-extensions')
    if (!fs.existsSync(folder)) return
    let files = await readdirAsync(folder)
    files = files.filter(f => f.endsWith('.js'))
    for (let file of files) {
      this.loadExtensionFile(path.join(folder, file))
    }
  }

  /**
   * Load single javascript file as extension.
   */
  public loadExtensionFile(filepath: string): void {
    let filename = path.basename(filepath)
    let name = path.basename(filepath, 'js')
    if (this.isDisabled(name)) return
    let root = path.dirname(filepath)
    let packageJSON = {
      name,
      main: filename,
    }
    this.createExtension(root, packageJSON)
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
    }, e => {
      workspace.showMessage(`Error on activate ${extension.id}: ${e.stack}`, 'error')
      logger.error(`Error on activate extension ${extension.id}:`, e)
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

  public getExtensionApi(id: string): API | null {
    let item = this.list.find(o => o.id == id)
    if (!item) return null
    let { extension } = item
    return extension.isActive ? extension.exports : null
  }

  public registerExtension(extension: Extension<API>, deactivate?: () => void): void {
    let { id, packageJSON } = extension
    this.list.push({ id, extension, deactivate, isLocal: true })
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

  public get globalExtensions(): string[] {
    let json = this.loadJson()
    if (!json || !json.dependencies) return []
    return Object.keys(json.dependencies)
  }

  private async globalExtensionStats(): Promise<ExtensionInfo[]> {
    let json = this.loadJson()
    if (!json || !json.dependencies) return []
    let res: ExtensionInfo[] = await Promise.all(Object.keys(json.dependencies).map(key => {
      return new Promise<ExtensionInfo>(async resolve => {
        try {
          let val = json.dependencies[key]
          let root = path.join(this.root, 'node_modules', key)
          let jsonFile = path.join(root, 'package.json')
          let stat = await statAsync(jsonFile)
          if (!stat || !stat.isFile()) return resolve(null)
          let content = await readFile(jsonFile, 'utf8')
          root = await realpathAsync(root)
          let obj = JSON.parse(content)
          let { engines } = obj
          if (!engines || (!engines.hasOwnProperty('coc') && !engines.hasOwnProperty('vscode'))) {
            return resolve(null)
          }
          let version = obj ? obj.version || '' : ''
          let description = obj ? obj.description || '' : ''
          let uri = isuri.isValid(val) ? val : null
          resolve({
            id: key,
            isLocal: false,
            version,
            description,
            exotic: /^https?:/.test(val),
            uri,
            root,
            state: this.getExtensionState(key)
          })
        } catch (e) {
          logger.error(e)
          resolve(null)
        }
      })
    }))
    return res.filter(info => info != null)
  }

  private async localExtensionStats(exclude: ExtensionInfo[]): Promise<ExtensionInfo[]> {
    let runtimepath = await workspace.nvim.eval('&runtimepath') as string
    let included = exclude.map(o => o.root)
    let names = exclude.map(o => o.id)
    let paths = runtimepath.split(',')
    let res: ExtensionInfo[] = await Promise.all(paths.map(root => {
      return new Promise<ExtensionInfo>(async resolve => {
        try {
          if (included.includes(root)) {
            return resolve(null)
          }
          let jsonFile = path.join(root, 'package.json')
          let stat = await statAsync(jsonFile)
          if (!stat || !stat.isFile()) return resolve(null)
          let content = await readFile(jsonFile, 'utf8')
          let obj = JSON.parse(content)
          let { engines } = obj
          if (!engines || (!engines.hasOwnProperty('coc') && !engines.hasOwnProperty('vscode'))) {
            return resolve(null)
          }
          if (names.indexOf(obj.name) !== -1) {
            workspace.showMessage(`Skipped extension  "${root}", please remove "${obj.name}" from your vim's plugin manager.`, 'warning')
            return resolve(null)
          }
          let version = obj ? obj.version || '' : ''
          let description = obj ? obj.description || '' : ''
          resolve({
            id: obj.name,
            isLocal: true,
            version,
            description,
            exotic: false,
            root,
            state: this.getExtensionState(obj.name)
          })
        } catch (e) {
          logger.error(e)
          resolve(null)
        }
      })
    }))
    return res.filter(info => info != null)
  }

  private isGlobalExtension(id: string): boolean {
    return this.globalExtensions.indexOf(id) !== -1
  }

  private loadJson(): any {
    let { root } = this
    let jsonFile = path.join(root, 'package.json')
    if (!fs.existsSync(jsonFile)) return null
    return loadJson(jsonFile)
  }

  public get schemes(): { [key: string]: PropertyScheme } {
    return this._additionalSchemes
  }

  public addSchemeProperty(key: string, def: PropertyScheme): void {
    this._additionalSchemes[key] = def
    workspace.configurations.extendsDefaults({ [key]: def.default })
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
          let folders = workspace.workspaceFolders.map(o => URI.parse(o.uri).fsPath)
          for (let folder of folders) {
            if (inDirectory(folder, parts[1].split(/\s+/))) {
              active()
              break
            }
          }
        }
        check()
        workspace.onDidChangeWorkspaceFolders(check, null, disposables)
      } else if (ev == 'onFileSystem') {
        for (let doc of workspace.documents) {
          let u = URI.parse(doc.uri)
          if (u.scheme == parts[1]) {
            return active()
          }
        }
        workspace.onDidOpenTextDocument(document => {
          let u = URI.parse(document.uri)
          if (u.scheme == parts[1]) {
            active()
          }
        }, null, disposables)
      } else {
        workspace.showMessage(`Unsupported event ${eventName} of ${id}`, 'error')
      }
    }
  }

  private createExtension(root: string, packageJSON: any, isLocal = false): string {
    let id = `${packageJSON.name}`
    let isActive = false
    let exports = null
    let filename = path.join(root, packageJSON.main || 'index.js')
    let ext: ExtensionExport
    let subscriptions: Disposable[] = []
    let extension: any = {
      activate: async (): Promise<API> => {
        if (isActive) return
        let context: ExtensionContext = {
          subscriptions,
          extensionPath: root,
          globalState: this.memos.createMemento(`${id}|global`),
          workspaceState: this.memos.createMemento(`${id}|${workspace.rootPath}`),
          asAbsolutePath: relativePath => {
            return path.join(root, relativePath)
          },
          storagePath: path.join(this.root, `${id}-data`),
          logger: createLogger(id)
        }
        isActive = true
        if (!ext) {
          try {
            ext = createExtension(id, filename)
          } catch (e) {
            workspace.showMessage(`Error on load extension ${id} from ${filename}: ${e}`, 'error')
            logger.error(e)
            return
          }
        }
        try {
          exports = await Promise.resolve(ext.activate(context))
        } catch (e) {
          isActive = false
          workspace.showMessage(`Error on active extension ${id}: ${e.stack}`, 'error')
          logger.error(e)
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
      isLocal,
      extension,
      directory: root,
      deactivate: () => {
        isActive = false
        if (ext && ext.deactivate) {
          Promise.resolve(ext.deactivate()).catch(e => {
            logger.error(`Error on ${id} deactivate: `, e.message)
          })
        }
        disposeAll(subscriptions)
        subscriptions = []
      }
    })
    let { contributes } = packageJSON
    if (contributes) {
      let { configuration, rootPatterns, commands } = contributes
      if (configuration && configuration.properties) {
        let { properties } = configuration
        let props = {}
        for (let key of Object.keys(properties)) {
          let val = properties[key].default
          if (val != null) props[key] = val
        }
        workspace.configurations.extendsDefaults(props)
      }
      if (rootPatterns && rootPatterns.length) {
        for (let item of rootPatterns) {
          workspace.addRootPatterns(item.filetype, item.patterns)
        }
      }
      if (commands && commands.length) {
        for (let cmd of commands) {
          commandManager.titles.set(cmd.command, cmd.title)
        }
      }
    }
    this._onDidLoadExtension.fire(extension)
    if (this.activated) {
      this.setupActiveEvents(id, packageJSON)
    }
    return id
  }

  private async initializeRoot(): Promise<void> {
    let root = this.root = await workspace.nvim.call('coc#util#extension_root')
    if (!fs.existsSync(root)) {
      mkdirp.sync(root)
    }
    let jsonFile = path.join(root, 'package.json')
    if (!fs.existsSync(jsonFile)) {
      fs.writeFileSync(jsonFile, '{"dependencies":{}}', 'utf8')
    }
    if (!this.db) {
      let filepath = path.join(root, 'db.json')
      this.db = new DB(filepath)
    }
    this.manager = new ExtensionManager(root)
  }
}

export default new Extensions()
