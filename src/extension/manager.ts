import { URI } from 'vscode-uri'
import { Extensions, IConfigurationNode, IConfigurationRegistry } from '../configuration/registry'
import { ConfigurationScope } from '../configuration/types'
import Watchman from '../core/watchman'
import events from '../events'
import { createLogger } from '../logger'
import Memos from '../model/memos'
import { disposeAll, wait } from '../util'
import { splitArray, toArray } from '../util/array'
import { configHome, dataHome } from '../util/constants'
import { Extensions as ExtensionsInfo, getProperties, IExtensionRegistry, IStringDictionary } from '../util/extensionRegistry'
import { createExtension, ExtensionExport } from '../util/factory'
import { isDirectory, loadJson, remove, statAsync, watchFile } from '../util/fs'
import * as Is from '../util/is'
import type { IJSONSchema } from '../util/jsonSchema'
import { omit } from '../util/lodash'
import { path } from '../util/node'
import { deepClone, deepIterate, isEmpty } from '../util/object'
import { Disposable, Emitter, Event } from '../util/protocol'
import { convertProperties, Registry } from '../util/registry'
import { createTiming } from '../util/timing'
import window from '../window'
import workspace from '../workspace'
import { ExtensionJson, ExtensionStat, getJsFiles, loadExtensionJson, validExtensionFolder } from './stat'

interface ExportExtension {
  readonly name: string
  readonly isActive: boolean
  unload: () => Promise<void>
  /**
   * API returned by activate function
   */
  readonly api: any
  /**
   * The object of module.exports of the extension entry without activate & deactivate function.
   */
  readonly exports: any
}

export type ExtensionState = 'disabled' | 'loaded' | 'activated' | 'unknown'
const logger = createLogger('extensions-manager')

export enum ExtensionType {
  Global,
  Local,
  SingleFile,
  Internal
}

export enum ActivateEvents {
  OnLanguage = 'onLanguage',
  OnFileSystem = 'onFileSystem',
  OnCommand = 'onCommand',
  WorkspaceContains = 'workspaceContains',
}

export interface ExtensionInfo {
  id: string
  version?: string
  description?: string
  root: string
  exotic: boolean
  uri?: string
  state: ExtensionState
  isLocal: boolean
  isLocked: boolean
  packageJSON: Readonly<ExtensionJson>
}

export type ExtensionToLoad = Pick<Readonly<ExtensionInfo>, 'root' | 'packageJSON' | 'isLocal'>

export interface Extension<T> {
  readonly id: string
  readonly extensionPath: string
  readonly isActive: boolean
  readonly packageJSON: ExtensionJson
  readonly exports: T
  readonly module: object
  activate(): Promise<T>
}

export type API = { [index: string]: any } | void | null | undefined

export interface ExtensionItem {
  readonly id: string
  readonly type: ExtensionType
  readonly events: ReadonlyArray<string>
  extension: Extension<API>
  deactivate: () => void | Promise<void>
  filepath?: string
  directory: string
  readonly isLocal: boolean
}

const extensionRegistry = Registry.as<IExtensionRegistry>(ExtensionsInfo.ExtensionContribution)
const memos = new Memos(path.resolve(dataHome, 'memos.json'))
memos.merge(path.resolve(dataHome, '../memos.json'))

const configurationRegistry = Registry.as<IConfigurationRegistry>(Extensions.Configuration)

/**
 * Manage loaded extensions
 */
export class ExtensionManager {
  private activated = false
  private disposables: Disposable[] = []
  public readonly configurationNodes: IConfigurationNode[] = []
  private extensions: Map<string, ExtensionItem> = new Map()
  private _onDidLoadExtension = new Emitter<Extension<API>>()
  private _onDidActiveExtension = new Emitter<Extension<API>>()
  private _onDidUnloadExtension = new Emitter<string>()
  private singleExtensionsRoot = path.join(configHome, 'coc-extensions')
  private modulesFolder: string

  public readonly onDidLoadExtension: Event<Extension<API>> = this._onDidLoadExtension.event
  public readonly onDidActiveExtension: Event<Extension<API>> = this._onDidActiveExtension.event
  public readonly onDidUnloadExtension: Event<string> = this._onDidUnloadExtension.event
  constructor(public readonly states: ExtensionStat, private folder: string) {
    this.modulesFolder = path.join(this.folder, 'node_modules')
  }

  public activateExtensions(): Promise<PromiseSettledResult<void>[]> {
    this.activated = true
    if (process.env.COC_NO_PLUGINS == '1') return
    configurationRegistry.registerConfigurations(this.configurationNodes)
    this.attachEvents()
    let promises: Promise<void>[] = []
    for (let key of this.extensions.keys()) {
      // wait extensions that always activated only
      const { extension } = this.extensions.get(key)
      const activationEvents = extension.packageJSON.activationEvents
      if (!activationEvents || activationEvents.includes('*')) {
        promises.push(void extension.activate())
      } else {
        void this.autoActiavte(key, extension)
      }
    }
    return Promise.allSettled(promises)
  }

  public async loadFileExtensions(): Promise<void> {
    let folder = this.singleExtensionsRoot
    let files = await getJsFiles(folder)
    await Promise.allSettled(files.map(file => {
      return this.loadExtensionFile(path.join(folder, file))
    }))
  }

  public attachEvents(): void {
    workspace.onDidRuntimePathChange(async paths => {
      let folders = paths.filter(p => p && validExtensionFolder(p, workspace.version))
      let outputChannel = window.createOutputChannel('extensions')
      await Promise.allSettled(folders.map(folder => {
        outputChannel.appendLine(`Loading extension from runtimepath: ${folder}`)
        return this.loadExtension(folder)
      }))
    }, null, this.disposables)
    workspace.onDidOpenTextDocument(document => {
      let doc = workspace.getDocument(document.bufnr)
      this.tryActivateExtensions(ActivateEvents.OnLanguage, events => {
        return checkLanguageId(doc, events)
      })
      this.tryActivateExtensions(ActivateEvents.OnFileSystem, events => {
        return checkFileSystem(doc.uri, events)
      })
    }, null, this.disposables)
    events.on('Command', async command => {
      let fired = false
      this.tryActivateExtensions(ActivateEvents.OnCommand, events => {
        let result = checkCommand(command, events)
        if (result) fired = true
        return result
      })
      if (fired) await wait(50)
    }, null, this.disposables)
    workspace.onDidChangeWorkspaceFolders(e => {
      if (e.added.length > 0) {
        this.tryActivateExtensions(ActivateEvents.WorkspaceContains, events => {
          let patterns = toWorkspaceContinsPatterns(events)
          return workspace.checkPatterns(patterns, e.added)
        })
      }
    }, null, this.disposables)
  }

  /**
   * Unload & remove all global extensions, return removed extensions.
   */
  public async cleanExtensions(): Promise<string[]> {
    let { globalIds } = this.states
    await remove(this.modulesFolder)
    return globalIds.filter(id => !this.states.isDisabled(id))
  }

  public tryActivateExtensions(event: string, check: (activationEvents: string[]) => boolean | Promise<boolean>): void {
    for (let item of this.extensions.values()) {
      if (item.extension.isActive) continue
      let events = item.events
      if (!events.includes(event)) continue
      let { extension } = item
      let activationEvents = getActivationEvents(extension.packageJSON)
      void Promise.resolve(check(activationEvents)).then(checked => {
        if (checked) void Promise.resolve(extension.activate())
      })
    }
  }

  private async checkAutoActivate(packageJSON: ExtensionJson): Promise<boolean> {
    let activationEvents = getActivationEvents(packageJSON)
    if (activationEvents.length === 0 || activationEvents.includes('*')) {
      return true
    }
    let patterns: string[] = []
    for (let eventName of activationEvents as string[]) {
      let parts = eventName.split(':')
      let ev = parts[0]
      if (ev === ActivateEvents.OnLanguage) {
        if (workspace.languageIds.has(parts[1]) || workspace.filetypes.has(parts[1])) {
          return true
        }
      } else if (ev === ActivateEvents.WorkspaceContains && parts[1]) {
        patterns.push(parts[1])
      } else if (ev === ActivateEvents.OnFileSystem) {
        for (let doc of workspace.documents) {
          let u = URI.parse(doc.uri)
          if (u.scheme == parts[1]) {
            return true
          }
        }
      }
    }
    if (patterns.length > 0) {
      let res = await workspace.checkPatterns(patterns)
      if (res) return true
    }
    return false
  }

  public has(id: string): boolean {
    return this.extensions.has(id)
  }

  public getExtension(id: string): ExtensionItem | undefined {
    return this.extensions.get(id)
  }

  public get loadedExtensions(): string[] {
    return Array.from(this.extensions.keys())
  }

  public get all(): Extension<API>[] {
    return Array.from(this.extensions.values()).map(o => o.extension)
  }

  /**
   * Activate extension, throw error if disabled or doesn't exist.
   * Returns true if extension successfully activated.
   */
  public async activate(id): Promise<boolean> {
    let item = this.extensions.get(id)
    if (!item) throw new Error(`Extension ${id} not registered!`)
    let { extension } = item
    if (extension.isActive) return true
    await Promise.resolve(extension.activate())
    return extension.isActive === true
  }

  public async deactivate(id): Promise<void> {
    let item = this.extensions.get(id)
    if (!item || !item.extension.isActive) return
    await Promise.resolve(item.deactivate())
  }

  /**
   * Load extension from folder, folder should contains coc extension.
   */
  public async loadExtension(folder: string | string[], noActive = false): Promise<boolean> {
    if (Array.isArray(folder)) {
      let results = await Promise.allSettled(folder.map(f => {
        return this.loadExtension(f, noActive)
      }))
      results.forEach(res => {
        if (res.status === 'rejected') throw new Error(`Error on loadExtension ${res.reason}`)
      })
      return true
    }
    let errors: string[] = []
    let obj = loadExtensionJson(folder, workspace.version, errors)
    if (errors.length > 0) throw new Error(errors[0])
    let { name } = obj
    if (this.states.isDisabled(name)) return false
    // unload if loaded
    await this.unloadExtension(name)
    let isLocal = !this.states.hasExtension(name)
    if (isLocal) this.states.addLocalExtension(name, folder)
    await this.registerExtension(folder, Object.freeze(obj), isLocal ? ExtensionType.Local : ExtensionType.Global, noActive)
    return true
  }

  /**
   * Deactivate & unregist extension
   */
  public async unloadExtension(id: string): Promise<void> {
    let item = this.extensions.get(id)
    if (item) {
      await this.deactivate(id)
      this.extensions.delete(id)
      this._onDidUnloadExtension.fire(id)
    }
  }

  public async reloadExtension(id: string): Promise<void> {
    let item = this.extensions.get(id)
    if (!item || item.type == ExtensionType.Internal) {
      throw new Error(`Extension ${id} not registered`)
    }
    if (item.type == ExtensionType.SingleFile) {
      await this.loadExtensionFile(item.filepath)
    } else {
      await this.loadExtension(item.directory)
    }
  }

  public async call(id: string, method: string, args: any[]): Promise<any> {
    let item = this.extensions.get(id)
    if (!item) throw new Error(`extension ${id} not registered`)
    let { extension } = item
    if (!extension.isActive) {
      await this.activate(id)
    }
    let { exports } = extension
    if (!exports || typeof exports[method] !== 'function') {
      throw new Error(`method ${method} not found on extension ${id}`)
    }
    return await Promise.resolve(exports[method].apply(null, args))
  }

  public registContribution(id: string, packageJSON: any, directory: string, filepath?: string): void {
    let { contributes, activationEvents } = packageJSON
    let { configuration, rootPatterns, commands } = contributes ?? {}
    let definitions: IStringDictionary<IJSONSchema> | undefined
    let props = getProperties(configuration ?? {})
    if (!isEmpty(props)) {
      // /configuration
      let properties = convertProperties(props, ConfigurationScope.WINDOW)
      if (Is.objectLiteral(configuration.definitions)) {
        let prefix = id.replace(/[^\w]/g, '')
        const addPrefix = (obj: object, key: string) => {
          if (key == '$ref') {
            let val = obj[key]
            if (Is.string(val) && val.startsWith('#/definitions/')) {
              obj[key] = val.slice(0, 14) + prefix + '.' + val.slice(14)
            }
          }
        }
        deepIterate(properties, addPrefix)
        definitions = {}
        Object.entries(deepClone(configuration.definitions)).forEach(([key, val]) => {
          if (Is.objectLiteral(val)) {
            definitions[prefix + '.' + key] = val
            deepIterate(val, addPrefix)
          }
        })
      }
      let node: IConfigurationNode = { properties, extensionInfo: { id, displayName: packageJSON.displayName } }
      this.configurationNodes.push(node)
      if (this.activated) {
        let toRemove = []
        let idx = this.configurationNodes.findIndex(o => o.extensionInfo!.id === id)
        if (idx !== -1) {
          toRemove.push(this.configurationNodes[idx])
          this.configurationNodes.splice(idx, 1)
        }
        workspace.configurations.updateConfigurations([node], toRemove)
      }
    }
    extensionRegistry.registerExtension(id, {
      name: id,
      directory,
      filepath,
      commands,
      definitions,
      rootPatterns,
      onCommands: getOnCommandList(activationEvents)
    })
  }

  public getExtensionState(id: string): ExtensionState {
    let disabled = this.states.isDisabled(id)
    if (disabled) return 'disabled'
    let item = this.getExtension(id)
    if (!item) return 'unknown'
    let { extension } = item
    return extension.isActive ? 'activated' : 'loaded'
  }

  public async autoActiavte(id: string, extension: Extension<API>): Promise<void> {
    try {
      let checked = await this.checkAutoActivate(extension.packageJSON)
      if (checked) await Promise.resolve(extension.activate())
    } catch (e) {
      logger.error(`Error on activate ${id}`, e)
    }
  }

  public async loadExtensionFile(filepath: string, noActive = false): Promise<string> {
    let stat = await statAsync(filepath)
    if (!stat || !stat.isFile()) return
    let filename = path.basename(filepath)
    let basename = path.basename(filepath, '.js')
    let name = 'single-' + basename
    let root = path.dirname(filepath)
    let packageJSON = { name, main: filename, engines: { coc: '>=0.0.82' } }
    let confpath = path.join(root, basename + '.json')
    let obj = loadJson(confpath) as any
    for (const attr of ['activationEvents', 'contributes']) {
      packageJSON[attr] = obj[attr]
    }
    await this.unloadExtension(name)
    await this.registerExtension(root, packageJSON, ExtensionType.SingleFile, noActive)
    return name
  }

  public registerExtensions(stats: ExtensionToLoad[]): void {
    for (let stat of stats) {
      try {
        let extensionType = stat.isLocal ? ExtensionType.Local : ExtensionType.Global
        void this.registerExtension(stat.root, stat.packageJSON, extensionType)
      } catch (e) {
        logger.error(`Error on regist extension from ${stat.root}: `, e)
      }
    }
  }

  public async registerExtension(root: string, packageJSON: ExtensionJson, extensionType: ExtensionType, noActive = false): Promise<void> {
    let id = packageJSON.name
    if (this.states.isDisabled(id)) return
    let isActive = false
    let result: Promise<API> | undefined
    let filename = path.join(root, packageJSON.main || 'index.js')
    let extensionPath = extensionType === ExtensionType.SingleFile ? filename : root
    let exports: any
    let ext: ExtensionExport
    let subscriptions: Disposable[] = []
    const timing = createTiming(`activate ${id}`, 5000)
    let extension: Extension<API> = {
      activate: (): Promise<API> => {
        if (result) return result
        result = new Promise(async (resolve, reject) => {
          timing.start()
          try {
            let isEmpty = typeof packageJSON.engines.coc === 'undefined'
            ext = createExtension(id, filename, isEmpty)
            let context = {
              subscriptions,
              extensionPath,
              globalState: memos.createMemento(`${id}|global`),
              workspaceState: memos.createMemento(`${id}|${workspace.rootPath}`),
              asAbsolutePath: relativePath => path.join(root, relativePath),
              storagePath: path.join(this.folder, `${id}-data`),
              logger: createLogger(`extension:${id}`)
            }
            let res = await Promise.resolve(ext.activate(context))
            isActive = true
            exports = res
            this._onDidActiveExtension.fire(extension)
            timing.stop()
            resolve(res)
          } catch (e) {
            logger.error(`Error on active extension ${id}:`, e)
            reject(e)
          }
        })
        return result
      },
      id,
      packageJSON,
      extensionPath,
      get isActive() {
        return isActive
      },
      get module() {
        return ext
      },
      get exports() {
        if (!isActive) throw new Error(`Invalid access to exports, extension "${id}" not activated`)
        return exports
      }
    }
    Object.freeze(extension)
    this.extensions.set(id, {
      id,
      type: extensionType,
      isLocal: extensionType == ExtensionType.Local,
      extension,
      directory: root,
      filepath: filename,
      events: getEvents(packageJSON.activationEvents),
      deactivate: async () => {
        if (!isActive) return
        isActive = false
        result = undefined
        exports = undefined
        disposeAll(subscriptions)
        if (ext && typeof ext.deactivate === 'function') {
          try {
            await Promise.resolve(ext.deactivate())
            ext = undefined
          } catch (e) {
            logger.error(`Error on ${id} deactivate: `, e)
          }
        }
      }
    })
    this.registContribution(id, packageJSON, root, filename)
    this._onDidLoadExtension.fire(extension)
    if (this.activated && !noActive) await this.autoActiavte(id, extension)
  }

  public unregistContribution(id: string): void {
    let idx = this.configurationNodes.findIndex(o => o.extensionInfo!.id === id)
    extensionRegistry.unregistExtension(id)
    if (idx !== -1) {
      let node = this.configurationNodes[idx]
      this.configurationNodes.splice(idx, 1)
      configurationRegistry.deregisterConfigurations([node])
    }
  }

  public async registerInternalExtension(extension: Extension<API>, deactivate?: () => void): Promise<void> {
    let { id, packageJSON } = extension
    this.extensions.set(id, {
      id,
      directory: __dirname,
      type: ExtensionType.Internal,
      events: getEvents(packageJSON.activationEvents),
      extension,
      deactivate,
      isLocal: true
    })
    this.registContribution(id, packageJSON, __dirname)
    this._onDidLoadExtension.fire(extension)
    await this.autoActiavte(id, extension)
  }

  /**
   * Only global extensions can be uninstalled
   */
  public async uninstallExtensions(ids: string[]): Promise<void> {
    let [globals, filtered] = splitArray(ids, id => this.states.hasExtension(id))
    for (let id of globals) {
      await this.unloadExtension(id)
      this.states.removeExtension(id)
      extensionRegistry.unregistExtension(id)
      await remove(path.join(this.modulesFolder, id))
    }
    if (filtered.length > 0) {
      void window.showWarningMessage(`Global extensions ${filtered.join(', ')} not found`)
    }
    if (globals.length > 0) {
      void window.showInformationMessage(`Removed extensions: ${globals.join(' ')}`)
    }
  }

  public async toggleExtension(id: string): Promise<void> {
    let state = this.getExtensionState(id)
    if (state == 'activated') await this.deactivate(id)
    if (state != 'disabled') {
      this.states.setDisable(id, true)
      this.unregistContribution(id)
      await this.unloadExtension(id)
    } else {
      this.states.setDisable(id, false)
      if (id.startsWith('single-')) {
        let filepath = path.join(this.singleExtensionsRoot, `${id.replace(/^single-/, '')}.js`)
        await this.loadExtensionFile(filepath)
      } else {
        let folder = this.states.getFolder(id)
        if (folder) {
          await this.loadExtension(folder)
        } else {
          void window.showWarningMessage(`Extension ${id} not found`)
        }
      }
    }
  }

  public async watchExtension(id: string): Promise<void> {
    let item = this.getExtension(id)
    if (!item) throw new Error(`extension ${id} not found`)
    if (id.startsWith('single-')) {
      void window.showInformationMessage(`watching ${item.filepath}`)
      this.disposables.push(watchFile(item.filepath, async () => {
        await this.loadExtensionFile(item.filepath)
        void window.showInformationMessage(`reloaded ${id}`)
      }, global.__TEST__ === true))
    } else {
      let watchmanPath = workspace.getWatchmanPath()
      if (!watchmanPath) throw new Error('watchman not found')
      let client: Watchman = await Watchman.createClient(watchmanPath, item.directory)
      this.disposables.push(client)
      void window.showInformationMessage(`watching ${item.directory}`)
      await client.subscribe('**/*.js', async () => {
        await this.reloadExtension(id)
        void window.showInformationMessage(`reloaded ${id}`)
      })
    }
  }

  /**
   * load extension in folder or file
   */
  public async load(filepath: string, active: boolean): Promise<ExportExtension> {
    let name: string
    if (isDirectory(filepath)) {
      let obj = loadJson(path.join(filepath, 'package.json')) as any
      name = obj.name
      await this.loadExtension(filepath, true)
    } else {
      name = await this.loadExtensionFile(filepath, true)
    }
    if (!name) throw new Error(`Unable to load extension at ${filepath}`)
    let disabled = this.states.isDisabled(name)
    if (disabled) throw new Error(`extension ${name} is disabled`)
    let item = this.getExtension(name)
    if (active) await item.extension.activate()
    return {
      get isActive() {
        return item.extension.isActive
      },
      get name() {
        return name
      },
      get api() {
        return item.extension.exports
      },
      get exports() {
        let module = item.extension.module ?? {}
        return omit(module, ['activate'])
      },
      unload: () => {
        return this.unloadExtension(name)
      }
    }
  }

  public dispose(): void {
    disposeAll(this.disposables)
  }
}

export function getEvents(activationEvents: string[] | undefined): string[] {
  let res: string[] = []
  for (let ev of toArray(activationEvents)) {
    let [name] = ev.split(':', 2)
    if (name && !res.includes(name)) res.push(name)
  }
  return res
}

export function getOnCommandList(activationEvents: string[] | undefined): string[] {
  let res: string[] = []
  for (let ev of toArray(activationEvents)) {
    let [name, command] = ev.split(':', 2)
    if (name === ActivateEvents.OnCommand && command) res.push(command)
  }
  return res
}

export function checkLanguageId(document: { languageId: string, filetype: string }, activationEvents: string[]): boolean {
  for (let eventName of activationEvents as string[]) {
    let parts = eventName.split(':')
    let ev = parts[0]
    if (ev == ActivateEvents.OnLanguage && (document.languageId == parts[1] || document.filetype == parts[1])) {
      return true
    }
  }
  return false
}

export function checkCommand(command: string, activationEvents: string[]): boolean {
  for (let eventName of activationEvents as string[]) {
    let parts = eventName.split(':')
    let ev = parts[0]
    if (ev == ActivateEvents.OnCommand && command == parts[1]) {
      return true
    }
  }
  return false
}

export function checkFileSystem(uri: string, activationEvents: string[]): boolean {
  let scheme = URI.parse(uri).scheme
  for (let eventName of activationEvents as string[]) {
    let parts = eventName.split(':')
    let ev = parts[0]
    if (ev == ActivateEvents.OnFileSystem && scheme == parts[1]) {
      return true
    }
  }
  return false
}

export function getActivationEvents(json: ExtensionJson): string[] {
  return toArray(json.activationEvents).filter(key => typeof key === 'string' && key.length > 0)
}

/**
 * Convert globl patterns
 */
export function toWorkspaceContinsPatterns(activationEvents: string[]): string[] {
  let patterns: string[] = []
  for (let eventName of activationEvents) {
    let parts = eventName.split(':')
    if (parts[0] == ActivateEvents.WorkspaceContains && parts[1]) {
      patterns.push(parts[1])
    }
  }
  return patterns
}
