'use strict'
import { EventEmitter } from 'events'
import { URL } from 'url'
import { v4 as uuid } from 'uuid'
import { createLogger } from '../logger'
import download, { DownloadOptions } from '../model/download'
import fetch, { FetchOptions } from '../model/fetch'
import { loadJson } from '../util/fs'
import { child_process, fs, os, path, readline, semver } from '../util/node'
import { toText } from '../util/string'
import workspace from '../workspace'
const logger = createLogger('extension-installer')
const local_dependencies = ['coc.nvim', 'esbuild', 'webpack', '@types/node']

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
    if (!this.version) this.version = res['dist-tags']['latest']
    let obj = res['versions'][this.version]
    if (!obj) throw new Error(`${this.def} doesn't exists in ${registry}.`)
    let requiredVersion = obj['engines'] && obj['engines']['coc']
    if (!requiredVersion) throw new Error(`${this.def} is not a valid coc extension, "engines" field with coc property required.`)
    return {
      'dist.tarball': obj['dist']['tarball'],
      'engines.coc': requiredVersion,
      version: obj['version'],
      name: res.name
    } as Info
  }

  public async getInfoFromUri(): Promise<Info> {
    let { url } = this
    if (!url.startsWith('https://github.com')) {
      throw new Error(`"${url}" is not supported, coc.nvim support github.com only`)
    }
    url = url.replace(/\/$/, '')
    let branch = 'master'
    if (url.includes('@')) {
      // https://github.com/sdras/vue-vscode-snippets@main
      let idx = url.indexOf('@')
      branch = url.substr(idx + 1)
      url = url.substring(0, idx)
    }
    let fileUrl = url.replace('github.com', 'raw.githubusercontent.com') + `/${branch}/package.json`
    this.log(`Get info from ${fileUrl}`)
    let content = await this.fetch(fileUrl, { timeout: 10000 })
    let obj = typeof content == 'string' ? JSON.parse(content) : content
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
    let updated = await this.doInstall(info)
    return { name, updated, version, url: this.url, folder: path.join(this.root, info.name) }
  }

  public async update(url?: string): Promise<string | undefined> {
    if (url) this.url = url
    let version: string | undefined
    if (this.name) {
      let folder = path.join(this.root, this.name)
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
    let succeed = await this.doInstall(info)
    if (!succeed) return
    let jsonFile = path.join(this.root, info.name, 'package.json')
    this.log(`Updated to v${info.version}`)
    return path.dirname(jsonFile)
  }

  public getInstallArguments(exePath: string, url: string | undefined): string[] {
    let args = ['install', '--ignore-scripts', '--no-lockfile']
    if (url && url.startsWith('https://github.com')) {
      args = ['install']
    }
    if (isNpmCommand(exePath)) {
      args.push('--omit=dev')
      args.push('--legacy-peer-deps')
      args.push('--no-global')
    }
    if (isYarn(exePath)) {
      args.push('--production')
      args.push('--ignore-engines')
    }
    if (isPnpm(exePath)) {
      args.push('--production')
      args.push('--config.strict-peer-dependencies=false')
    }
    return args
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
      let args = this.getInstallArguments(this.npm, this.url)
      this.log(`Installing dependencies by: ${this.npm} ${args.join(' ')}.`)
      const child = child_process.spawn(this.npm, args, {
        cwd: folder,
        env: Object.assign(process.env, { NODE_ENV: 'production' })
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

  public async doInstall(info: Info): Promise<boolean> {
    let dest = path.join(this.root, info.name)
    if (isSymbolicLink(dest)) return false
    let key = info.name.replace(/\//g, '_')
    let downloadFolder = path.join(this.root, `${key}-${uuid()}`)
    let url = info['dist.tarball']
    this.log(`Downloading from ${url}`)
    let etagAlgorithm = url.startsWith('https://registry.npmjs.org') ? 'md5' : undefined
    try {
      await this.download(url, {
        dest: downloadFolder,
        etagAlgorithm,
        extract: 'untar',
        onProgress: p => this.log(`Download progress ${p}%`, true),
      })
      this.log(`Extension download at ${downloadFolder}`)
      let obj = loadJson(path.join(downloadFolder, 'package.json')) as any
      await this.installDependencies(downloadFolder, getDependencies(obj))
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
