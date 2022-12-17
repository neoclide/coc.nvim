import { createLogger } from '../logger'
import { toArray } from '../util/array'
import { readFile, writeJson } from '../util/fs'
import { objectLiteral } from '../util/is'
import { fs, path, semver, promisify } from '../util/node'
import { toObject } from '../util/object'
const logger = createLogger('extension-stat')

interface DataBase {
  extension?: {
    [key: string]: {
      disabled?: boolean
      locked?: boolean
    }
  },
  lastUpdate?: number
}

interface PackageJson {
  disabled?: string[]
  locked?: string[]
  lastUpdate?: number
  dependencies?: {
    [key: string]: string
  }
}

export interface ExtensionJson {
  name: string
  main?: string
  engines: {
    [key: string]: string
  }
  activationEvents?: string[]
  version?: string
  [key: string]: any
}

export enum ExtensionStatus {
  Normal,
  Disabled,
  Locked,
}

const ONE_DAY = 24 * 60 * 60 * 1000

/**
 * Stat for global extensions
 */
export class ExtensionStat {
  private disabled: Set<string> = new Set()
  private locked: Set<string> = new Set()
  private extensions: Set<string> = new Set()
  private localExtensions: Map<string, string> = new Map()
  constructor(private folder: string) {
    try {
      this.migrate()
    } catch (e) {
      logger.error(`Error on update package.json at ${folder}`, e)
    }
  }

  private migrate(): void {
    let curr = loadJson(this.jsonFile) as PackageJson
    let db = path.join(this.folder, 'db.json')
    let changed = false
    if (fs.existsSync(db)) {
      let obj = loadJson(db) as DataBase
      let def = obj.extension ?? {}
      for (let [key, o] of Object.entries(def)) {
        if (o.disabled) this.disabled.add(key)
        if (o.locked) this.locked.add(key)
      }
      curr.disabled = Array.from(this.disabled)
      curr.locked = Array.from(this.locked)
      curr.lastUpdate - obj.lastUpdate
      fs.unlinkSync(db)
      changed = true
    } else {
      this.disabled = new Set(curr.disabled ?? [])
      this.locked = new Set(curr.locked ?? [])
    }
    if (changed) writeJson(this.jsonFile, curr)
    let ids = Object.keys(curr.dependencies ?? {})
    this.extensions = new Set(ids)
  }

  public *activated(): Iterable<string> {
    let { disabled } = this
    for (let key of Object.keys(this.dependencies)) {
      if (!disabled.has(key)) {
        yield key
      }
    }
  }

  public addLocalExtension(name: string, folder: string): void {
    this.localExtensions.set(name, folder)
  }

  public getFolder(name: string): string | undefined {
    if (this.extensions.has(name)) return path.join(this.folder, 'node_modules', name)
    return this.localExtensions.get(name)
  }

  public getExtensionsStat(): Record<string, ExtensionStatus> {
    let res: Record<string, ExtensionStatus> = {}
    for (let id of this.extensions) {
      if (this.disabled.has(id)) {
        res[id] = ExtensionStatus.Disabled
      } else if (this.locked.has(id)) {
        res[id] = ExtensionStatus.Locked
      } else {
        res[id] = ExtensionStatus.Normal
      }
    }
    return res
  }

  public hasExtension(id: string): boolean {
    return this.extensions.has(id)
  }

  public addExtension(id: string, val: string): void {
    let curr = loadJson(this.jsonFile) as PackageJson
    curr.dependencies = curr.dependencies ?? {}
    curr.dependencies[id] = val
    this.extensions.add(id)
    writeJson(this.jsonFile, curr)
  }

  public removeExtension(id: string): void {
    let curr = loadJson(this.jsonFile) as PackageJson
    if (curr.disabled) curr.disabled = curr.disabled.filter(key => key !== id)
    if (curr.locked) curr.locked = curr.locked.filter(key => key !== id)
    curr.dependencies = curr.dependencies ?? {}
    delete curr.dependencies[id]
    this.extensions.delete(id)
    writeJson(this.jsonFile, curr)
  }

  public isDisabled(id: string): boolean {
    return this.disabled.has(id)
  }

  public get lockedExtensions(): string[] {
    return Array.from(this.locked)
  }

  public get disabledExtensions(): string[] {
    return Array.from(this.disabled)
  }

  public get dependencies(): { [key: string]: string } {
    let curr = loadJson(this.jsonFile) as PackageJson
    return curr.dependencies ?? {}
  }

  public setDisable(id: string, disable: boolean): void {
    if (disable) {
      this.disabled.add(id)
    } else {
      this.disabled.delete(id)
    }
    this.update('disabled', Array.from(this.disabled))
  }

  public setLocked(id: string, locked: boolean): void {
    if (locked) {
      this.locked.add(id)
    } else {
      this.locked.delete(id)
    }
    this.update('locked', Array.from(this.disabled))
  }

  public setLastUpdate(): void {
    this.update('lastUpdate', Date.now())
  }

  public shouldUpdate(opt: string): boolean {
    if (opt === 'never') return false
    let interval = toInterval(opt)
    let curr = loadJson(this.jsonFile) as PackageJson
    return curr.lastUpdate == null || (Date.now() - curr.lastUpdate) > interval
  }

  public get globalIds(): ReadonlyArray<string> {
    let curr = loadJson(this.jsonFile) as PackageJson
    return Object.keys(curr.dependencies ?? {})
  }

  /**
   * Filter out global extensions that needs install
   */
  public filterGlobalExtensions(names: string[] | undefined): string[] {
    let disabledExtensions = this.disabledExtensions
    let dependencies = this.dependencies
    let map: Map<string, string> = new Map()
    toArray(names).forEach(def => {
      if (!def || typeof def !== 'string') return
      let name = getExtensionName(def)
      map.set(name, def)
    })
    let currentUrls: string[] = []
    let exists: string[] = []
    for (let [key, val] of Object.entries(dependencies)) {
      if (fs.existsSync(path.join(this.folder, 'node_modules', key, 'package.json'))) {
        exists.push(key)
        if (typeof val === 'string' && /^https?:/.test(val)) {
          currentUrls.push(val)
        }
      }
    }
    for (let name of map.keys()) {
      if (disabledExtensions.includes(name) || this.extensions.has(name)) {
        map.delete(name)
        continue
      }
      if ((/^https?:/.test(name) && currentUrls.some(url => url.startsWith(name))) || exists.includes(name)) {
        map.delete(name)
      }
    }
    return Array.from(map.values())
  }

  private update(key: keyof PackageJson, value: any): void {
    let curr = loadJson(this.jsonFile) as PackageJson
    curr[key] = value
    writeJson(this.jsonFile, curr)
  }

  private get jsonFile(): string {
    return path.join(this.folder, 'package.json')
  }
}

export function toInterval(opt: string): number {
  return opt === 'daily' ? ONE_DAY : ONE_DAY * 7
}

export function validExtensionFolder(folder: string, version: string): boolean {
  let errors: string[] = []
  let res = loadExtensionJson(folder, version, errors)
  return res != null && errors.length == 0
}

function getEntryFile(main: string | undefined): string {
  if (!main) return 'index.js'
  if (!main.endsWith('.js')) return main + '.js'
  return main
}

export async function loadGlobalJsonAsync(folder: string, version: string): Promise<ExtensionJson> {
  let jsonFile = path.join(folder, 'package.json')
  let content = await readFile(jsonFile, 'utf8')
  let packageJSON = JSON.parse(content) as ExtensionJson
  let { engines } = packageJSON
  let main = getEntryFile(packageJSON.main)
  if (!engines || (typeof engines.coc !== 'string' && typeof engines.vscode !== 'string')) throw new Error('Invalid engines field')
  let keys = Object.keys(engines)
  if (keys.includes('coc') && !semver.satisfies(version, engines['coc'].replace(/^\^/, '>='))) {
    throw new Error(`coc.nvim version not match, required ${engines['coc']}`)
  }
  if (!engines.vscode && !fs.existsSync(path.join(folder, main))) {
    throw new Error(`main file ${main} not found, you may need to build the project.`)
  }
  return packageJSON
}

export function loadExtensionJson(folder: string, version: string, errors: string[]): ExtensionJson | undefined {
  let jsonFile = path.join(folder, 'package.json')
  if (!fs.existsSync(jsonFile)) {
    errors.push(`package.json not found in ${folder}`)
    return undefined
  }
  let packageJSON = loadJson(jsonFile) as ExtensionJson
  let { name, engines } = packageJSON
  let main = getEntryFile(packageJSON.main)
  if (!name) errors.push(`can't find name in package.json`)
  if (!engines || !objectLiteral(engines)) {
    errors.push(`invalid engines in ${jsonFile}`)
  }
  if (engines && !engines.vscode && !fs.existsSync(path.join(folder, main))) {
    errors.push(`main file ${main} not found, you may need to build the project.`)
  }
  if (engines) {
    let keys = Object.keys(engines)
    if (!keys.includes('coc') && !keys.includes('vscode')) {
      errors.push(`Engines in package.json doesn't have coc or vscode`)
    }
    if (keys.includes('coc')) {
      let required = engines['coc'].replace(/^\^/, '>=')
      if (!semver.satisfies(version, required)) {
        errors.push(`Please update coc.nvim, ${packageJSON.name} requires coc.nvim ${engines['coc']}`)
      }
    }
  }
  return packageJSON
}

/**
 * Name of extension
 */
export function getExtensionName(def: string): string {
  if (/^https?:/.test(def)) return def
  if (!def.includes('@')) return def
  return def.replace(/@[\d.]+$/, '')
}

export function checkExtensionRoot(root: string): boolean {
  try {
    if (!fs.existsSync(root)) {
      fs.mkdirSync(root, { recursive: true })
    }
    let stat = fs.statSync(root)
    if (!stat.isDirectory()) {
      logger.info(`Trying to delete ${root}`)
      fs.unlinkSync(root)
      fs.mkdirSync(root, { recursive: true })
    }
    let jsonFile = path.join(root, 'package.json')
    if (!fs.existsSync(jsonFile)) {
      fs.writeFileSync(jsonFile, '{"dependencies":{}}', 'utf8')
    }
  } catch (e) {
    console.error(`Unexpected error when check data home ${root}: ${e}`)
    return false
  }
  return true
}

export async function getJsFiles(folder: string): Promise<string[]> {
  if (!fs.existsSync(folder)) return []
  let files = await promisify(fs.readdir)(folder)
  return files.filter(f => f.endsWith('.js'))
}

function loadJson(filepath: string): object {
  try {
    let text = fs.readFileSync(filepath, 'utf8')
    let data = JSON.parse(text)
    return toObject(data)
  } catch (e) {
    logger.error(`Error on parse json file ${filepath}`, e)
    return {}
  }
}
