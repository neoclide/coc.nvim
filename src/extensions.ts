import fs from 'fs'
import path from 'path'
import os from 'os'
import semver from 'semver'
import { Disposable, Emitter, Event } from 'vscode-languageserver-protocol'
import { Extension, ExtensionContext } from './types'
import { disposeAll, wait } from './util'
import { statAsync, readFile } from './util/fs'
import { createExtension } from './util/factory'
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

function extensionRoot(): string {
  if (process.platform === 'win32') {
    return path.join(os.homedir(), 'AppData/Local/coc/extensions')
  }
  return path.join(os.homedir(), '.config/coc/extensions')
}

export class Extensions {
  private list: ExtensionItem[] = []
  private version: string
  private root = extensionRoot()
  public isEmpty = false

  private _onDidLoadExtension = new Emitter<Extension<API>>()
  public readonly onDidLoadExtension: Event<Extension<API>> = this._onDidLoadExtension.event

  public init(): void {
    let { root } = this
    let jsonFile = path.join(root, 'package.json')
    let json = loadJson(jsonFile)
    if (!json || !json.dependencies) {
      this.isEmpty = true
      return
    }
    let { version } = loadJson(path.join(workspace.pluginRoot, 'package.json'))
    this.version = version
    let paths = Object.keys(json.dependencies).map(name => {
      return path.join(root, 'node_modules', name)
    })
    Promise.all(paths.map(folder => {
      return this.loadExtension(folder).catch(e => {
        workspace.showMessage(`Can't load extension from ${folder}: ${e.message}'`, 'error')
      })
    })) // tslint:disable-line
  }

  public async onExtensionInstall(id): Promise<void> {
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

  public hasExtension(id: string): boolean {
    return this.list.find(o => o.id == id) != null
  }

  private async loadExtension(folder: string): Promise<void> {
    let jsonFile = path.join(folder, 'package.json')
    let stat = await statAsync(jsonFile)
    if (!stat || !stat.isFile()) {
      workspace.showMessage(`package.json not found in ${folder}`, 'error')
      return
    }
    let content = await readFile(jsonFile, 'utf8')
    let packageJSON = JSON.parse(content)
    if (this.hasExtension(packageJSON.name)) {
      workspace.showMessage(`deactivate ${packageJSON.name}`)
      this.deactivate(packageJSON.name)
      await wait(200)
    }
    let { engines } = packageJSON
    if (engines && engines.hasOwnProperty('coc')) {
      if (!semver.satisfies(this.version, engines.coc)) {
        workspace.showMessage(`${packageJSON.name} requires ${engines.coc}, current version ${this.version}`, 'error')
        return
      }
      let id = this.createExtension(folder, packageJSON)
      // always activate
      await this.activate(id)
    } else {
      workspace.showMessage(`engine coc not found in package.json of ${folder}`, 'warning')
    }
  }

  public async activate(id): Promise<boolean> {
    let item = this.list.find(o => o.id == id)
    if (!item) return false
    let { extension } = item
    await extension.activate()
    return extension.isActive
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
    if (!fs.existsSync(filename)) {
      workspace.showMessage(`js entry not found for ${root}`, 'error')
      return
    }
    let active = createExtension(filename)
    if (!active) return
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
        exports = await Promise.resolve(active(context))
        return exports as API
      }
    }
    Object.defineProperty(extension, 'id', {
      get: () => {
        return id
      }
    })
    Object.defineProperty(extension, 'packageJSON', {
      get: () => {
        return packageJSON
      }
    })
    Object.defineProperty(extension, 'extensionPath', {
      get: () => {
        return root
      }
    })
    Object.defineProperty(extension, 'isActive', {
      get: () => {
        return isActive
      }
    })
    Object.defineProperty(extension, 'exports', {
      get: () => {
        return exports
      }
    })
    this.list.push({
      id, extension, deactivate: () => {
        isActive = false
        context.subscriptions = []
        disposeAll(subscriptions)
      }
    })
    this._onDidLoadExtension.fire(extension)
    return id
  }
}

export default new Extensions()
