import { spawn } from 'child_process'
import { debounce } from 'debounce'
import fastDiff from 'fast-diff'
import fs from 'fs'
import glob from 'glob'
import isuri from 'isuri'
import path from 'path'
import semver from 'semver'
import util from 'util'
import { Disposable, Emitter, Event } from 'vscode-languageserver-protocol'
import Uri from 'vscode-uri'
import events from './events'
import DB from './model/db'
import Memos from './model/memos'
import { Extension, ExtensionContext, ExtensionInfo, ExtensionState } from './types'
import { disposeAll, runCommand, wait } from './util'
import { distinct } from './util/array'
import { createExtension, ExtensionExport } from './util/factory'
import { readFile, statAsync } from './util/fs'
import Watchman from './watchman'
import workspace from './workspace'
import { Neovim } from '@chemzqm/neovim'
import './util/extensions'

const createLogger = require('./util/logger')
const logger = createLogger('extensions')
const extensionFolder = global.hasOwnProperty('__TEST__') ? '' : 'node_modules'

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
  public ready = true
  public readonly onDidLoadExtension: Event<Extension<API>> = this._onDidLoadExtension.event
  public readonly onDidActiveExtension: Event<Extension<API>> = this._onDidActiveExtension.event
  public readonly onDidUnloadExtension: Event<string> = this._onDidUnloadExtension.event

  public async init(nvim: Neovim): Promise<void> {
    this.root = await nvim.call('coc#util#extension_root')
    if (!fs.existsSync(this.root)) {
      await nvim.call('coc#util#init_extension_root', this.root)
    }
    if (global.hasOwnProperty('__TEST__')) {
      this.root = path.join(__dirname, './__tests__/extensions')
    }
    let filepath = path.join(this.root, 'db.json')
    let db = this.db = new DB(filepath)
    let data = loadJson(db.filepath) || {}
    let keys = Object.keys(data.extension || {})
    for (let key of keys) {
      if (data.extension[key].disabled == true) {
        this.disabled.add(key)
      }
    }
    if (process.env.COC_NO_PLUGINS) return
    let stats = await this.globalExtensionStats()
    let names = stats.map(info => info.id)
    let localStats = await this.localExtensionStats(names)
    stats = stats.concat(localStats)
    this.memos = new Memos(path.resolve(this.root, '../memos.json'))
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
            await this.loadExtension(p, true)
          }
        }
      }
    })
  }

  public activateExtensions(): void {
    this.activated = true
    for (let item of this.list) {
      let { id, packageJSON } = item.extension
      this.setupActiveEvents(id, packageJSON)
    }
    // check extensions need watch & install
    this.checkExtensions().logError()
    let config = workspace.getConfiguration('coc.preferences')
    let interval = config.get<string>('extensionUpdateCheck', 'daily')
    if (interval != 'never') this.updateExtensions(interval).logError()
  }

  public async updateExtensions(interval: string, force = false): Promise<Disposable | null> {
    let now = new Date()
    let { db } = this
    let day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (interval == 'daily' ? 0 : 7))
    let ts = await db.fetch('lastUpdate')
    if (!force && ts && Number(ts) > day.getTime()) return
    if (global.hasOwnProperty('__TEST__') && !force) return
    let stats = await this.globalExtensionStats()
    await db.push('lastUpdate', Date.now())
    let versionInfo: { [index: string]: string } = {}
    stats = stats.filter(o => !o.exotic)
    let yarncmd = await workspace.nvim.call('coc#util#yarn_cmd')
    for (let stat of stats) {
      if (stat.exotic) continue
      let file = path.join(stat.root, 'package.json')
      let obj = loadJson(file)
      if (obj && obj.version) {
        versionInfo[stat.id] = obj.version
      }
    }
    let outdated: string[] = []
    await Promise.all(Object.keys(versionInfo).map(id => {
      let curr = versionInfo[id]
      return runCommand(`${yarncmd} info ${id} --json`).then(content => {
        let lines = content.trim().split('\n')
        let json = JSON.parse(lines[lines.length - 1])
        let { version, engines } = json.data
        if (version == curr || !engines) return
        if (engines.hasOwnProperty('coc')) {
          let required = engines.coc.replace(/^\^/, '>=')
          if (!semver.satisfies(workspace.version, required)) return
          if (semver.gt(version, curr)) {
            outdated.push(id)
          }
        } else {
          outdated.push(id)
        }
      })
    }))
    if (!outdated.length) return
    let status = workspace.createStatusBarItem(99, { progress: true })
    logger.info(`Upgrading ${outdated.join(' ')}`)
    status.text = `Upgrading ${outdated.join(' ')}`
    status.show()
    if (!global.hasOwnProperty('__TEST__')) {
      await runCommand(`${yarncmd} install`, { cwd: this.root })
    }
    const child = spawn(yarncmd, ['upgrade', ...outdated, '--latest', '--ignore-engines'], {
      cwd: this.root,
      detached: true,
      stdio: 'ignore'
    })
    child.unref()
    child.once('exit', () => {
      status.dispose()
    })
    return Disposable.create(() => {
      child.kill('SIGKILL')
    })
  }

  private async checkExtensions(): Promise<void> {
    let { globalExtensions, watchExtensions } = workspace.env
    if (globalExtensions && globalExtensions.length) {
      this.installExtensions(globalExtensions).catch(_e => {
        // noop
      })
    }
    // watch for changes
    if (watchExtensions && watchExtensions.length) {
      let watchmanPath = workspace.getWatchmanPath()
      if (!watchmanPath) return
      let stats = await this.getExtensionStates()
      for (let name of watchExtensions) {
        let stat = stats.find(s => s.id == name)
        if (stat && stat.state !== 'disabled') {
          let directory = await util.promisify(fs.realpath)(stat.root)
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

  public async installExtensions(list: string[]): Promise<void> {
    if (list && list.length) {
      let db = loadJson(this.db.filepath)
      let extension = db ? db.extension : null
      list = distinct(list)
      list = list.filter(name => {
        if (this.has(name)) return false
        if (/^\w+:/.test(name) && this.packageNameFromUrl(name)) return false
        if (extension && extension[name] && extension[name].disabled == true) return false
        return true
      })
      let cmd = global.hasOwnProperty('__TEST__') ? 'CocInstall -sync' : 'CocInstall'
      if (list.length) await workspace.nvim.command(`${cmd} ${list.join(' ')}`)
    }
  }

  public get all(): Extension<API>[] {
    return this.list.map(o => o.extension)
  }

  public getExtension(id: string): ExtensionItem {
    return this.list.find(o => o.id == id)
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
    return extension.isActive ? 'activated' : 'loaded'
  }

  public async getExtensionStates(): Promise<ExtensionInfo[]> {
    let globalStats = await this.globalExtensionStats()
    let names = globalStats.map(info => info.id)
    let localStats = await this.localExtensionStats(names)
    return globalStats.concat(localStats)
  }

  public async toggleExtension(id: string): Promise<void> {
    let state = this.getExtensionState(id)
    if (state == null) return
    if (state == 'activated') {
      this.deactivate(id)
    }
    let key = `extension.${id}.disabled`
    await this.db.push(key, state == 'disabled' ? false : true)
    if (state != 'disabled') {
      this.disabled.add(id)
      // unload
      let idx = this.list.findIndex(o => o.id == id)
      this.list.splice(idx, 1)
    } else {
      this.disabled.delete(id)
      let folder = path.join(this.root, extensionFolder, id)
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

  public async uninstallExtension(ids: string[]): Promise<void> {
    let status = workspace.createStatusBarItem(99, { progress: true })
    status.text = `Uninstalling ${ids.join(' ')}`
    status.show()
    for (let id of ids) {
      if (!this.isGlobalExtension(id)) {
        workspace.showMessage(`Global extension '${id}' not found.`, 'error')
        return
      }
      this.deactivate(id)
    }
    await wait(30)
    let yarncmd = await workspace.nvim.call('coc#util#yarn_cmd')
    if (!yarncmd) return
    try {
      if (!global.hasOwnProperty('__TEST__')) {
        await workspace.runCommand(`${yarncmd} remove ${ids.join(' ')}`, this.root)
      }
      for (let id of ids) {
        let idx = this.list.findIndex(o => o.id == id)
        if (idx != -1) this.list.splice(idx, 1)
        this._onDidUnloadExtension.fire(id)
      }
      status.dispose()
      workspace.showMessage(`Extensions ${ids.join(' ')} removed`)
    } catch (e) {
      status.dispose()
      workspace.showMessage(`Uninstall failed: ${e.message}`, 'error')
    }
  }

  public isDisabled(id: string): boolean {
    return this.disabled.has(id)
  }

  public async onExtensionInstall(id: string): Promise<void> {
    if (/^\w+:/.test(id)) id = this.packageNameFromUrl(id)
    if (!id || /^-/.test(id)) return
    let item = this.list.find(o => o.id == id)
    if (item) item.deactivate()
    let folder = path.join(this.root, extensionFolder, id)
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

  public isActivted(id: string): boolean {
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
    if (this.isActivted(packageJSON.name)) {
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
      workspace.showMessage(`Error on activate ${extension.id}: ${e.message}`, 'error')
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
          let root = path.join(this.root, extensionFolder, key)
          let jsonFile = path.join(root, 'package.json')
          let stat = await statAsync(jsonFile)
          if (!stat || !stat.isFile()) return resolve(null)
          let content = await readFile(jsonFile, 'utf8')
          let obj = JSON.parse(content)
          let { engines } = obj
          if (!engines || (!engines.hasOwnProperty('coc') && !engines.hasOwnProperty('vscode'))) {
            return resolve(null)
          }
          let version = obj ? obj.version || '' : ''
          let description = obj ? obj.description || '' : ''
          resolve({
            id: key,
            isLocal: false,
            version,
            description,
            exotic: isuri.isValid(val),
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

  private async localExtensionStats(exclude: string[]): Promise<ExtensionInfo[]> {
    let runtimepath = await workspace.nvim.eval('&runtimepath') as string
    let paths = runtimepath.split(',')
    let res: ExtensionInfo[] = await Promise.all(paths.map(root => {
      return new Promise<ExtensionInfo>(async resolve => {
        try {
          let jsonFile = path.join(root, 'package.json')
          let stat = await statAsync(jsonFile)
          if (!stat || !stat.isFile()) return resolve(null)
          let content = await readFile(jsonFile, 'utf8')
          let obj = JSON.parse(content)
          let { engines } = obj
          if (!engines || (!engines.hasOwnProperty('coc') && !engines.hasOwnProperty('vscode'))) {
            return resolve(null)
          }
          if (exclude.indexOf(obj.name) !== -1) {
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

  public packageNameFromUrl(url: string): string {
    let json = this.loadJson()
    if (!json || !json.dependencies) return null
    for (let key of Object.keys(json.dependencies)) {
      let val = json.dependencies[key]
      if (val == url) return key
    }
    return null
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
        let check = (cwd: string) => {
          glob(parts[1], { cwd }, (err, files) => {
            if (err) return
            if (files && files.length) {
              active()
            }
          })
        }
        check(workspace.cwd)
        events.on('DirChanged', check, null, disposables)
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
          workspace.showMessage(`Error on active extension ${id}: ${e}`, 'error')
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
      let { configuration, rootPatterns } = contributes
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
    }
    this._onDidLoadExtension.fire(extension)
    if (this.activated) {
      this.setupActiveEvents(id, packageJSON)
    }
    return id
  }

}

export default new Extensions()
