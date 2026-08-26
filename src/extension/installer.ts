'use strict'
import { EventEmitter } from 'events'
import { createLogger } from '../logger'
import download, { DownloadOptions } from '../model/download'
import fetch, { FetchOptions } from '../model/fetch'
import { loadJson } from '../util/fs'
import { child_process, fs, os, path, readline, semver } from '../util/node'
import { toText } from '../util/string'
import workspace from '../workspace'
const logger = createLogger('extension-installer')
const local_dependencies = ['coc.nvim', 'esbuild', 'webpack', '@types/node']

function extensionPath(root: string, name: string | undefined): string {
  // npm package names contain either one path component, or two for a scoped
  // package.  Reject path syntax before using registry-controlled metadata in
  // destructive filesystem operations.
  if (typeof name !== 'string' || !/^(?:@[^/\\]+\/)?[^/\\]+$/.test(name) || name.includes('\0') || name.split('/').some(part => part === '.' || part === '..')) {
    throw new Error(`Invalid extension name: ${name}`)
  }
  let resolvedRoot = path.resolve(root)
  let target = path.resolve(resolvedRoot, name)
  let relative = path.relative(resolvedRoot, target)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Invalid extension name: ${name}`)
  }
  return target
}

export interface Info {
  'dist.tarball'?: string
  'engines.coc'?: string
  version?: string
  name?: string
}

export type Dependencies = Record<string, string>

export interface InstallResult {
  name: string
  folder: string
  updated: boolean
  version: string
  url?: string
}

export function registryUrl(home = os.homedir()): URL {
  let res: URL
  let filepath = path.join(home, '.npmrc')
  if (fs.existsSync(filepath)) {
    try {
      let content = fs.readFileSync(filepath, 'utf8')
      let uri: string
      for (let line of content.split(/\r?\n/)) {
        if (line.startsWith('#')) continue
        let ms = line.match(/^(.*?)=(.*)$/)
        if (ms && ms[1] === 'coc.nvim:registry') {
          uri = ms[2]
        }
      }
      if (uri) res = new URL(uri)
    } catch (e) {
      logger.debug('Error on parse .npmrc:', e)
    }
  }
  return res ?? new URL('https://registry.npmjs.org')
}

export function minReleaseAge(home = os.homedir()): number {
  let filepath = path.join(home, '.npmrc')
  if (!fs.existsSync(filepath)) return 0
  try {
    let content = fs.readFileSync(filepath, 'utf8')
    for (let line of content.split(/\r?\n/)) {
      let ms = line.match(/^\s*min-release-age\s*=\s*([^#;\s]+)/)
      if (!ms) continue
      let days = Number(ms[1])
      return Number.isFinite(days) && days > 0 ? days : 0
    }
  } catch (e) {
    logger.debug('Error on parse .npmrc:', e)
  }
  return 0
}

export function isNpmCommand(exePath: string): boolean {
  let name = path.basename(exePath)
  return name === 'npm' || name === 'npm.CMD'
}

export function isYarn(exePath: string) {
  let name = path.basename(exePath)
  return ['yarn', 'yarn.CMD', 'yarnpkg', 'yarnpkg.CMD'].includes(name)
}

function isPnpm(exePath: string) {
  let name = path.basename(exePath)
  return name === 'pnpm' || name === 'pnpm.CMD'
}

function isSymbolicLink(folder: string): boolean {
  if (fs.existsSync(folder)) {
    let stat = fs.lstatSync(folder)
    if (stat.isSymbolicLink()) {
      return true
    }
  }
  return false
}

export interface IInstaller {
  on(event: 'message', cb: (msg: string, isProgress: boolean) => void): void
  install(): Promise<InstallResult>
  update(url?: string): Promise<string | undefined>
}

export class Installer extends EventEmitter implements IInstaller {
  private name: string
  private url: string
  private version: string
  constructor(
    private root: string,
    private npm: string,
    // could be url or name@version or name
    private def: string
  ) {
    super()
    if (/^https?:/.test(def)) {
      this.url = def
    } else {
      let ms = def.match(/(.+)@([^/]+)$/)
      if (ms) {
        this.name = ms[1]
        this.version = ms[2]
      } else {
        this.name = def
      }
    }
  }

  public get info() {
    return { name: this.name, version: this.version }
  }

  public async getInfo(): Promise<Info> {
    if (this.url) return await this.getInfoFromUri()
    let registry = registryUrl()
    this.log(`Get info from ${registry}`)
    let buffer = await this.fetch(new URL(this.name, registry), { timeout: 10000, buffer: true })
    let res = JSON.parse(buffer.toString())
    let releaseAge = minReleaseAge()
    if (!this.version) {
      this.version = res['dist-tags']['latest']
      if (releaseAge > 0) {
        let cutoff = Date.now() - releaseAge * 24 * 60 * 60 * 1000
        let versions = Object.keys(res.versions ?? {}).filter(version => {
          let published = Date.parse(res.time?.[version])
          return Number.isFinite(published) && published <= cutoff
        })
        this.version = semver.maxSatisfying(versions, '*') ?? undefined
        if (!this.version) throw new Error(`${this.def} has no release older than ${releaseAge} days.`)
      }
    } else if (releaseAge > 0) {
      let published = Date.parse(res.time?.[this.version])
      let cutoff = Date.now() - releaseAge * 24 * 60 * 60 * 1000
      if (!Number.isFinite(published) || published > cutoff) {
        throw new Error(`${this.def} is not older than ${releaseAge} days.`)
      }
    }
    let obj = res['versions'][this.version]
    if (!obj) throw new Error(`${this.def} doesn't exists in ${registry}.`)
    let requiredVersion = obj['engines'] && obj['engines']['coc']
    if (!requiredVersion) throw new Error(`${this.def} is not a valid coc extension, "engines" field with coc property required.`)
    extensionPath(this.root, res.name)
    return {
      'dist.tarball': obj['dist']['tarball'],
      'engines.coc': requiredVersion,
      version: obj['version'],
      name: res.name
    } as Info
  }

  public async getInfoFromUri(): Promise<Info> {
    let { url } = this
    let repository: URL
    try {
      repository = new URL(url)
    } catch (_e) {
      throw new Error(`"${url}" is not supported, coc.nvim support github.com only`)
    }
    if (repository.protocol !== 'https:' || repository.hostname !== 'github.com') {
      throw new Error(`"${url}" is not supported, coc.nvim support github.com only`)
    }
    url = url.replace(/\/$/, '')
    let branch = 'master'
    if (url.includes('@')) {
      // https://github.com/sdras/vue-vscode-snippets@main
      let idx = url.indexOf('@')
      branch = url.substring(idx + 1)
      url = url.substring(0, idx)
    }
    let fileUrl = url.replace('github.com', 'raw.githubusercontent.com') + `/${branch}/package.json`
    this.log(`Get info from ${fileUrl}`)
    let content = await this.fetch(fileUrl, { timeout: 10000 })
    let obj = typeof content == 'string' ? JSON.parse(content) : content
    extensionPath(this.root, obj.name)
    this.name = obj.name
    return {
      'dist.tarball': `${url}/archive/${branch}.tar.gz`,
      'engines.coc': obj['engines'] ? obj['engines']['coc'] : null,
      name: obj.name,
      version: obj.version
    }
  }

  private log(msg: string, isProgress = false): void {
    this.emit('message', msg, isProgress)
  }

  public async install(): Promise<InstallResult> {
    this.log(`Using npm from: ${this.npm}`)
    let info = await this.getInfo()
    logger.info(`Fetched info of ${this.def}`, info)
    let { name, version } = info
    let required = toText(info['engines.coc']).replace(/^\^/, '>=')
    if (required && !semver.satisfies(workspace.version, required)) {
      throw new Error(`${name} ${info.version} requires coc.nvim >= ${required}, please update coc.nvim.`)
    }
    let updated = await this.doInstall(info, new Set())
    return { name, updated, version, url: this.url, folder: extensionPath(this.root, info.name) }
  }

  public async update(url?: string): Promise<string | undefined> {
    if (url) this.url = url
    let version: string | undefined
    if (this.name) {
      let folder = extensionPath(this.root, this.name)
      if (isSymbolicLink(folder)) {
        this.log(`Skipped update for symbol link`)
        return
      }
      let obj = loadJson(path.join(folder, 'package.json')) as any
      version = obj.version
    }
    this.log(`Using npm from: ${this.npm}`)
    let info = await this.getInfo()
    if (version && info.version && semver.gte(version, info.version)) {
      this.log(`Current version ${version} is up to date.`)
      return
    }
    let required = info['engines.coc'] ? info['engines.coc'].replace(/^\^/, '>=') : ''
    if (required && !semver.satisfies(workspace.version, required)) {
      throw new Error(`${info.version} requires coc.nvim ${required}, please update coc.nvim.`)
    }
    let succeed = await this.doInstall(info, new Set())
    if (!succeed) return
    let jsonFile = path.join(this.root, info.name, 'package.json')
    this.log(`Updated to v${info.version}`)
    return path.dirname(jsonFile)
  }

  public getInstallArguments(exePath: string, url: string | undefined): { env: string, args: string[] } {
    let env = 'production'
    let args = ['install', '--ignore-scripts']
    if (url && url.startsWith('https://github.com')) {
      args = ['install']
      env = 'development'
    } else {
      if (isNpmCommand(exePath)) {
        args.push('--no-package-lock')
        args.push('--omit=dev')
        args.push('--legacy-peer-deps')
        args.push('--no-global')
      }
      if (isYarn(exePath)) {
        args.push('--no-lockfile')
        args.push('--production')
        args.push('--ignore-engines')
      }
      if (isPnpm(exePath)) {
        args.push('--no-lockfile')
        args.push('--production')
        args.push('--config.strict-peer-dependencies=false')
      }
    }
    return { env, args }
  }

  private readLines(key: string, stream: NodeJS.ReadableStream): void {
    const rl = readline.createInterface({
      input: stream
    })
    rl.on('line', line => {
      this.log(`${key} ${line}`, true)
    })
  }

  public installDependencies(folder: string, dependencies: string[]): Promise<void> {
    if (dependencies.length == 0) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      let { env, args } = this.getInstallArguments(this.npm, this.url)
      this.log(`Installing dependencies by: ${this.npm} ${args.join(' ')}.`)
      const cmd = process.platform === 'win32' && this.npm.includes(' ') ? `"${this.npm}"` : this.npm
      const child = child_process.spawn(cmd, args, {
        cwd: folder,
        shell: process.platform === 'win32',
        env: { ...process.env, NODE_ENV: env }
      })
      this.readLines('[npm stdout]', child.stdout)
      this.readLines('[npm stderr]', child.stderr)
      child.stderr.setEncoding('utf8')
      child.stdout.setEncoding('utf8')
      child.on('error', reject)
      child.on('exit', code => {
        if (code) {
          reject(new Error(`${this.npm} install exited with ${code}`))
          return
        }
        resolve()
      })
    })
  }

  public async doInstall(info: Info, installing: Set<string> = new Set()): Promise<boolean> {
    let dest = extensionPath(this.root, info.name)
    if (isSymbolicLink(dest)) return false
    if (installing.has(info.name)) {
      this.log(`Skipping dependency: ${info.name} (already installed or in progress)`)
      return false
    }
    installing.add(info.name)

    let downloadFolder = path.join(path.resolve(this.root), `.coc-download-${crypto.randomUUID()}`)
    let url = info['dist.tarball']
    this.log(`Downloading from ${url}`)
    let etagAlgorithm = url.startsWith('https://registry.npmjs.org') ? 'md5' : undefined
    let obj: { dependencies?: Record<string, string>, extensionDependencies?: string[] }
    try {
      await this.download(url, {
        dest: downloadFolder,
        etagAlgorithm,
        extract: 'untar',
        onProgress: p => this.log(`Download progress ${p}%`, true),
      })
      this.log(`Extension download at ${downloadFolder}`)
      obj = loadJson(path.join(downloadFolder, 'package.json'))
      await this.installDependencies(downloadFolder, getDependencies(obj))
      // Install extension dependencies before moving the main extension into
      // place, so a dependency failure cleans up the download and never
      // leaves the main extension half-installed on disk.
      const extensionDependencies = getExtensionDependencies(obj)
      if (extensionDependencies.length > 0) {
        this.log(`Installing extension dependencies: ${extensionDependencies.join(', ')}`)
        for (const dependency of extensionDependencies) {
          const installer = new Installer(this.root, this.npm, dependency)
          installer.on('message', (msg, isProgress) => {
            this.log(msg, isProgress)
          })
          await installer.doInstall(await installer.getInfo(), installing)
        }
      }
    } catch (e) {
      fs.rmSync(downloadFolder, { recursive: true, force: true })
      throw e
    }
    this.log(`Download extension ${info.name}@${info.version} at ${downloadFolder}`)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    if (fs.existsSync(dest)) fs.rmSync(dest, { force: true, recursive: true })
    fs.renameSync(downloadFolder, dest)
    this.log(`Move extension ${info.name}@${info.version} to ${dest}`)

    return true
  }

  public async download(url: string, options: DownloadOptions): Promise<any> {
    return await download(url, options)
  }

  public async fetch(url: string | URL, options: FetchOptions = {}): Promise<any> {
    return await fetch(url, options)
  }
}

export function getDependencies(obj: { dependencies?: { [key: string]: string } }): string[] {
  return Object.keys(obj.dependencies ?? {}).filter(id => !local_dependencies.includes(id))
}

export function getExtensionDependencies(obj: { extensionDependencies?: string[] }): string[] {
  if (obj.extensionDependencies?.length > 0) {
    return [...new Set(obj.extensionDependencies)]
  }
  return []
}
