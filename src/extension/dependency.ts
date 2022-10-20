import { createHash } from 'crypto'
import fs, { createReadStream } from 'fs'
import path from 'path'
import semver from 'semver'
import tar from 'tar'
import { URL } from 'url'
import { CancellationTokenSource } from 'vscode-languageserver-protocol'
import download from '../model/download'
import fetch, { FetchOptions } from '../model/fetch'
import { concurrent } from '../util'
import { loadJson, writeJson } from '../util/fs'
import { objectLiteral } from '../util/is'
import { Mutex } from '../util/mutex'
const logger = require('../util/logger')('extension-dependency')

export interface Dependencies { [key: string]: string }

// The information we cares about
export interface VersionInfo {
  name: string
  version: string
  dependencies?: Dependencies
  dist: {
    integrity: string // starts with sha512-, base64 string
    shasum: string // sha1 hash, hex string
    tarball: string // download url
  }
}

interface ModuleInfo {
  name: string
  latest?: string
  versions: {
    [version: string]: VersionInfo
  }
}

export interface DependencyItem {
  name: string
  version: string
  resolved: string // download url
  shasum: string
  integrity: string
  satisfiedVersions: string[]
  dependencies?: {
    [key: string]: string
  }
}

const NPM_REGISTRY = new URL('https://registry.npmjs.org')
const YARN_REGISTRY = new URL('https://registry.yarnpkg.com')
const TAOBAO_REGISTRY = new URL('https://registry.npmmirror.com')
const DEV_DEPENDENCIES = ['coc.nvim', 'webpack', 'esbuild']
const INFO_TIMEOUT = global.__TEST__ ? 100 : 10000
const DOWNLOAD_TIMEOUT = global.__TEST__ ? 500 : 3 * 60 * 1000

function toFilename(item: DependencyItem): string {
  return `${item.name}.${item.version}.tgz`
}

export function findItem(name: string, requirement: string, items: ReadonlyArray<DependencyItem>): DependencyItem {
  let item = items.find(o => o.name === name && o.satisfiedVersions.includes(requirement))
  if (!item) throw new Error(`item not found for: ${name} ${requirement}`)
  return item
}

export function getRegistries(registry: URL): URL[] {
  let urls: URL[] = [registry]
  if (registry.host !== NPM_REGISTRY.host) urls.push(NPM_REGISTRY)
  if (registry.host !== YARN_REGISTRY.host) urls.push(YARN_REGISTRY)
  return urls
}

export function validVersionInfo(info: any): info is VersionInfo {
  if (!info) return false
  if (typeof info.name !== 'string' || typeof info.version !== 'string' || !info.dist) return false
  let { tarball, integrity, shasum } = info.dist
  if (typeof tarball !== 'string' || typeof integrity !== 'string' || typeof shasum !== 'string') return false
  return true
}

export function getModuleInfo(text: string): ModuleInfo {
  let obj
  try {
    obj = JSON.parse(text) as any
  } catch (e) {
    throw new Error(`Invalid JSON data, ${e}`)
  }
  if (typeof obj.name !== 'string' || !objectLiteral(obj.versions)) throw new Error(`Invalid JSON data, name or versions not found`)
  return {
    name: obj.name,
    latest: obj['dist-tags']?.latest,
    versions: obj.versions
  } as ModuleInfo
}

export function shouldRetry(error: any): boolean {
  let message = error.message
  if (typeof message !== 'string') return false
  if (message.includes('timeout') ||
    message.includes('Invalid JSON') ||
    message.includes('Bad shasum') ||
    message.includes('ECONNRESET')) return true
  return false
}

export function readDependencies(directory: string): { [key: string]: string } {
  let jsonfile = path.join(directory, 'package.json')
  let obj = loadJson(jsonfile) as any
  let dependencies = obj.dependencies as { [key: string]: string }
  for (let key of Object.keys(dependencies ?? {})) {
    if (DEV_DEPENDENCIES.includes(key) || key.startsWith('@types/')) delete dependencies[key]
  }
  return dependencies
}

export function getVersion(requirement: string, versions: string[], latest?: string): string | undefined {
  if (latest && semver.satisfies(latest, requirement)) return latest
  let sorted = semver.rsort(versions.filter(v => semver.valid(v, { includePrerelease: false })))
  for (let v of sorted) {
    if (semver.satisfies(v, requirement)) return v
  }
}

export async function untar(dest: string, tarfile: string, strip = 1): Promise<void> {
  if (!fs.existsSync(tarfile)) throw new Error(`${tarfile} not exists`)
  fs.rmSync(dest, { recursive: true, force: true })
  fs.mkdirSync(dest, { recursive: true })
  await new Promise<void>((resolve, reject) => {
    const input = createReadStream(tarfile)
    input.on('error', reject)
    let stream = tar.x({ strip, C: dest })
    input.pipe(stream)
    stream.on('error', reject)
    stream.on('finish', () => {
      resolve()
    })
  })
}

export async function checkFileSha1(filepath: string, shasum: string): Promise<boolean> {
  const hash = createHash('sha1')
  if (!fs.existsSync(filepath)) return Promise.resolve(false)
  return new Promise(resolve => {
    const input = createReadStream(filepath)
    input.on('error', e => {
      resolve(false)
    })
    input.on('readable', () => {
      // Only one element is going to be produced by the hash stream.
      const data = input.read()
      if (data)
        hash.update(data)
      else {
        resolve(hash.digest('hex') == shasum)
      }
    })
  })
}

const mutex = new Mutex()

export class DependenciesInstaller {
  public resolvedInfos: Map<string, ModuleInfo> = new Map()
  private tokenSource: CancellationTokenSource = new CancellationTokenSource()
  constructor(
    private registry: URL,
    public readonly modulesRoot: string,
    private onMessage: (msg: string) => void
  ) {
  }

  private get dest(): string {
    return path.join(this.modulesRoot, '.cache')
  }

  public async installDependencies(directory: string): Promise<void> {
    let dependencies = readDependencies(directory)
    // no need to install
    if (!dependencies || Object.keys(dependencies).length == 0) {
      this.onMessage(`No dependencies`)
      return
    }
    this.onMessage('Waiting for install dependencies.')
    // TODO reuse resolved.json
    await mutex.use(async () => {
      this.onMessage('Resolving dependencies.')
      await this.fetchInfos(dependencies)
      this.onMessage('Linking dependencies.')
      // create DependencyItems
      let items: DependencyItem[] = []
      this.linkDependencies(dependencies, items)
      let filepath = path.join(directory, 'resolved.json')
      writeJson(filepath, items)
      this.onMessage('Downloading dependencies.')
      await this.downloadItems(items)
      this.onMessage('Extract modules.')
      await this.extractDependencies(items, dependencies, directory)
      this.onMessage('Done')
    })
  }

  public async extractDependencies(items: DependencyItem[], dependencies: Dependencies, directory: string): Promise<void> {
    items.sort((a, b) => b.satisfiedVersions.length - a.satisfiedVersions.length)
    let rootPackages: Set<string> = new Set()
    let rootItems: DependencyItem[] = []
    const addToRoot = (item: DependencyItem) => {
      if (!rootPackages.has(item.name)) {
        rootPackages.add(item.name)
        rootItems.push(item)
      }
    }
    // Top level dependencies
    for (let [key, requirement] of Object.entries(dependencies)) {
      let item = findItem(key, requirement, items)
      addToRoot(item)
    }
    items.forEach(item => {
      addToRoot(item)
    })
    rootPackages.clear()
    for (let item of rootItems) {
      let filename = toFilename(item)
      let tarfile = path.join(this.dest, filename)
      let dest = path.join(directory, 'node_modules', item.name)
      await untar(dest, tarfile)
    }
    for (let item of rootItems) {
      let folder = path.join(directory, 'node_modules', item.name)
      await this.extractFor(item, items, rootItems, folder)
    }
  }

  /**
   * Recursive extract dependencies for item in folder
   */
  public async extractFor(item: DependencyItem, items: ReadonlyArray<DependencyItem>, rootItems: ReadonlyArray<DependencyItem>, folder: string): Promise<void> {
    // Deps to install, name to item
    let deps: Map<string, DependencyItem> = new Map()
    for (let [name, requirement] of Object.entries(item.dependencies ?? {})) {
      let idx = rootItems.findIndex(o => o.name == name && o.satisfiedVersions.includes(requirement))
      if (idx == -1) deps.set(name, findItem(name, requirement, items))
    }
    if (deps.size === 0) return
    let newRoot: DependencyItem[] = []
    await Promise.all(Array.from(deps.values()).map(item => {
      let tarfile = path.join(this.dest, toFilename(item))
      let dest = path.join(folder, 'node_modules', item.name)
      newRoot.push(item)
      return untar(dest, tarfile)
    }))
    newRoot.push(...rootItems)
    for (let item of deps.values()) {
      let dest = path.join(folder, 'node_modules', item.name)
      await this.extractFor(item, items, newRoot, dest)
    }
  }

  public linkDependencies(dependencies: Dependencies | undefined, items: DependencyItem[]): void {
    if (!dependencies) return
    for (let [name, requirement] of Object.entries(dependencies)) {
      let versionInfo = this.resolveVersion(name, requirement)
      let item = items.find(o => o.name === name && o.version === versionInfo.version)
      if (item) {
        if (!item.satisfiedVersions.includes(requirement)) item.satisfiedVersions.push(requirement)
      } else {
        let { dist, version } = versionInfo
        items.push({
          name,
          version,
          resolved: dist.tarball,
          shasum: dist.shasum,
          integrity: dist.integrity,
          satisfiedVersions: [requirement],
          dependencies: versionInfo.dependencies
        })
        this.linkDependencies(versionInfo.dependencies, items)
      }
    }
  }

  public resolveVersion(name: string, requirement: string): VersionInfo {
    let info = this.resolvedInfos.get(name)
    if (info) {
      let version = getVersion(requirement, Object.keys(info.versions), info.latest)
      if (version) {
        let versionInfo = info.versions[version]
        if (validVersionInfo(versionInfo)) return versionInfo
      }
    }
    throw new Error(`No valid version found for "${name}" ${requirement}`)
  }

  /**
   * Recursive fetch
   */
  public async fetchInfos(dependencies: Dependencies | undefined): Promise<void> {
    let keys = Object.keys(dependencies ?? {})
    if (keys.length === 0) return
    await Promise.all(keys.map(key => {
      if (this.resolvedInfos.has(key)) return Promise.resolve()
      return this.loadInfo(this.registry, key, INFO_TIMEOUT).then(info => {
        this.resolvedInfos.set(key, info)
      })
    }))
    for (let key of keys) {
      let versionInfo = this.resolveVersion(key, dependencies[key])
      await this.fetchInfos(versionInfo.dependencies)
    }
  }

  /**
   * Concurrent download necessary dependencies
   */
  public async downloadItems(items: DependencyItem[], retry = 3): Promise<Map<string, string>> {
    let res: Map<string, string> = new Map()
    let total = items.length
    let finished = 0
    let err: unknown
    await concurrent(items, async item => {
      try {
        let filename = toFilename(item)
        let filepath = path.join(this.dest, filename)
        let checked = await checkFileSha1(filepath, item.shasum)
        let onFinish = () => {
          res.set(filename, filepath)
          finished++
          this.onMessage(`Downloaded ${filename} ${finished}/${total}`)
        }
        if (checked) {
          onFinish()
        } else {
          // 5min timeout
          await this.download(new URL(item.resolved), filename, item.shasum, retry, DOWNLOAD_TIMEOUT)
          onFinish()
        }
      } catch (e) {
        err = e
      }
    }, 3)
    if (finished !== total) throw new Error(err ? err.toString() : 'unknown error')
    return res
  }

  public async fetch(url: string | URL, options: FetchOptions, retry = 1): Promise<any> {
    for (let i = 0; i < retry; i++) {
      try {
        return await fetch(url, options, this.tokenSource.token)
      } catch (e) {
        if (i == retry - 1 || !shouldRetry(e)) {
          throw e
        } else {
          this.onMessage(`Network issue, retry fetch for ${url}`)
        }
      }
    }
  }

  // Try different registries
  public async loadInfo(registry: URL, name: string, timeout = 100): Promise<ModuleInfo> {
    let info: ModuleInfo
    for (let url of getRegistries(registry)) {
      try {
        let buffer = await this.fetch(new URL(name, url), { timeout, buffer: true }) as Buffer
        info = getModuleInfo(buffer.toString())
        return info
      } catch (e) {
        this.onMessage(`Error on fetch ${url.hostname}/${name}: ${e}`)
      }
    }
    throw new Error(`Unable to fetch info for "${name}"`)
  }

  public async download(url: string | URL, filename: string, shasum: string, retry = 1, timeout?: number): Promise<string> {
    for (let i = 0; i < retry; i++) {
      try {
        let fullpath = path.join(this.dest, filename)
        await download(url, {
          dest: this.dest,
          filename,
          extract: false,
          timeout
        }, this.tokenSource.token)
        if (shasum) {
          let checked = await checkFileSha1(fullpath, shasum)
          if (!checked) throw new Error(`Bad shasum for ${filename}`)
        }
        return fullpath
      } catch (e) {
        if (i == retry - 1 || !shouldRetry(e)) {
          throw e
        } else {
          this.onMessage(`Network issue, retry download for ${url}`)
        }
      }
    }
  }

  public cancel(): void {
    this.tokenSource.cancel()
    this.tokenSource = new CancellationTokenSource()
  }
}
