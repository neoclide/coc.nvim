import { Neovim } from '@chemzqm/neovim'
import fs from 'fs'
import glob from 'glob'
import JsonDB from 'node-json-db'
import path from 'path'
import semver from 'semver'
import { Disposable, Emitter, Event } from 'vscode-languageserver-protocol'
import Uri from 'vscode-uri'
import events from './events'
import { Extension, ExtensionInfo, ExtensionState, ExtensionContext } from './types'
import { disposeAll, wait } from './util'
import { createExtension } from './util/factory'
import { readFile, statAsync } from './util/fs'
import workspace from './workspace'

const createLogger = require('./util/logger')
const logger = createLogger('extensions')

export type API = { [index: string]: any } | null | undefined

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
  private version: string
  private root: string
  private db: JsonDB
  public isEmpty = false

  private _onDidLoadExtension = new Emitter<Extension<API>>()
  private _onDidActiveExtension = new Emitter<Extension<API>>()
  public readonly onDidLoadExtension: Event<Extension<API>> = this._onDidLoadExtension.event
  public readonly onDidActiveExtension: Event<Extension<API>> = this._onDidActiveExtension.event

  public async init(nvim: Neovim): Promise<void> {
    let root = this.root = await nvim.call('coc#util#extension_root')
    let db = this.db = new JsonDB(path.join(path.dirname(root), 'db'), true, false)
    let { version } = loadJson(path.join(workspace.pluginRoot, 'package.json'))
    this.version = version
    let stats = this.globalExtensionStats()
    Promise.all(stats.map(state => {
      let folder = state.root
      let id = path.dirname(folder)
      if (this.isDisabled(id)) return
      return this.loadExtension(folder).catch(e => {
        workspace.showMessage(`Can't load extension from ${folder}: ${e.message}'`, 'error')
      })
    })) // tslint:disable-line
    let now = new Date()
    let today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    this.onDidActiveExtension(async extension => {
      if (global.hasOwnProperty('__TEST__')) return
      let { id, packageJSON } = extension
      if (!this.isGlobalExtension(id) || this.isExoticExtension(id)) return
      let key = `/extension/${id}/ts`
      let ts = (db as any).exists(key) ? db.getData(key) : null
      if (!ts || Number(ts) < today.getTime()) {
        db.push(key, Date.now())
        try {
          let res = await workspace.runCommand(`yarn info ${id} version --json`)
          let version = JSON.parse(res).data
          if (semver.gt(version, packageJSON.version)) {
            let res = await workspace.showPrompt(`a new version: ${version} of ${id} available, update?`)
            if (res) {
              await workspace.nvim.command(`CocInstall ${id}`)
            }
          }
        } catch (e) {
          logger.error(e.stack)
          // noop
        }
      }
    }, null, this.disposables)
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
    if (!this.isGlobalExtension(id)) {
      workspace.showMessage(`toggle state of local extension ${id} not supported`, 'error')
      return
    }
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
      workspace.showMessage(`${id} not global extension, uninstall not supported.`, 'error')
      return
    }
    this.deactivate(id)
    await wait(200)
    await workspace.runCommand(`yarn remove ${id}`, this.root)
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
    if (item) {
      item.deactivate()
    }
    let folder = path.join(this.root, 'node_modules', id)
    let stat = await statAsync(folder)
    if (stat && stat.isDirectory()) {
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
      if (!semver.satisfies(this.version, required)) {
        workspace.showMessage(`${packageJSON.name} requires ${engines.coc}, current version ${this.version}`, 'error')
        return
      }
      this.createExtension(folder, Object.freeze(packageJSON))
    } else if (engines && engines.hasOwnProperty('vscode')) {
      this.createExtension(folder, Object.freeze(packageJSON))
    } else {
      workspace.showMessage(`engine coc & vscode not found in ${jsonFile}`, 'error')
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
        events.on('FileType', filetype => {
          if (filetype === parts[1]) active()
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
            if (err) {
              workspace.showMessage(`glob error: ${err.message}`, 'error')
              return
            }
            if (files && files.length) {
              disposeAll(disposables)
              this.activate(id)
            }
          })
        }
        check()
        events.on('DirChanged', check, this, disposables)
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
            disposeAll(disposables)
            this.activate(id)
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
    if (item.extension.isActive) {
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
    if (!item) {
      workspace.showMessage(`extension ${id} not found`, 'error')
      return
    }
    let { extension } = item
    if (!extension.isActive) {
      workspace.showMessage(`extension ${id} not actived`, 'error')
      return
    }
    let { exports } = extension
    if (!exports.hasOwnProperty(method)) {
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
          workspace.showMessage(`Error on active extension ${id}: `, e.message)
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
        for (let key of Object.keys(properties)) {
          let val = properties[key].default
          if (val !== undefined) {
            (workspace as any)._configurations.updateDefaults(key, val)
          }
        }
      }
    }
    this._onDidLoadExtension.fire(extension)
    this.setupActiveEvents(id, packageJSON)
    return id
  }

  private globalExtensionStats(): ExtensionInfo[] {
    let { root } = this
    let json = this.loadJson()
    if (!json || !json.dependencies) {
      return []
    }
    return Object.keys(json.dependencies).map(name => {
      return {
        id: name,
        root: path.join(root, 'node_modules', name),
        state: this.getExtensionState(name)
      }
    })
  }

  private localExtensionStats(): ExtensionInfo[] {
    let { root } = this
    let res: ExtensionInfo[] = []
    this.list.forEach(item => {
      let p = item.extension.extensionPath
      if (!p.startsWith(root)) {
        let jsonFile = path.join(p, 'package.json')
        let json = loadJson(jsonFile)
        res.push({
          id: json.name,
          root: p,
          state: this.getExtensionState(json.name)
        })
      }
    })
    return res
  }

  private isGlobalExtension(id: string): boolean {
    let json = this.loadJson()
    if (!json || !json.dependencies) {
      return false
    }
    return json.dependencies.hasOwnProperty(id)
  }

  private isExoticExtension(id: string): boolean {
    let json = this.loadJson()
    if (!json || !json.dependencies) {
      return true
    }
    let { dependencies } = json
    let val = dependencies[id]
    if (!val || /^\w+:/.test(val)) {
      return true
    }
    return false
  }
}

export default new Extensions()
