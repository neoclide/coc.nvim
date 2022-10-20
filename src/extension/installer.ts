'use strict'
import { EventEmitter } from 'events'
import fs from 'fs'
import os from 'os'
import path from 'path'
import semver from 'semver'
import { URL } from 'url'
import { v4 as uuid } from 'uuid'
import download, { DownloadOptions } from '../model/download'
import fetch, { FetchOptions } from '../model/fetch'
import { isFalsyOrEmpty } from '../util/array'
import { loadJson } from '../util/fs'
import { findBestHost } from '../util/ping'
import workspace from '../workspace'
import { DependencySession } from './dependency'
const logger = require('../util/logger')('extension-installer')

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

const TAOBAO_REGISTRY = new URL('https://registry.npmmirror.com')
const NPM_REGISTRY = new URL('https://registry.npmjs.org')
const YARN_REGISTRY = new URL('https://registry.yarnpkg.com')
const PINGTIMEOUT = global.__TEST__ ? 50 : 500

/**
 * Find the user configured registry or the best one
 */
export async function registryUrl(home = os.homedir(), registries?: URL[], timeout = PINGTIMEOUT): Promise<URL> {
  let res: URL
  let filepath = path.join(home, '.npmrc')
  try {
    if (fs.existsSync(filepath)) {
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
    }
    if (res) return res
    registries = isFalsyOrEmpty(registries) ? [TAOBAO_REGISTRY, NPM_REGISTRY, YARN_REGISTRY] : registries
    const hosts = registries.map(o => o.hostname)
    let host = await findBestHost(hosts, timeout)
    return host == null ? NPM_REGISTRY : registries[hosts.indexOf(host)]
  } catch (e) {
    logger.debug('Error on get registry', e)
    return NPM_REGISTRY
  }
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
    private dependencySession: DependencySession,
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

  private get root(): string {
    return this.dependencySession.modulesRoot
  }

  public get info() {
    return { name: this.name, version: this.version }
  }

  public async getInfo(): Promise<Info> {
    if (this.url) return await this.getInfoFromUri()
    let registry = this.dependencySession.registry
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
    let info = await this.getInfo()
    logger.info(`Fetched info of ${this.def}`, info)
    let { name, version } = info
    let required = info['engines.coc'] ? info['engines.coc'].replace(/^\^/, '>=') : ''
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

  public async installDependencies(folder: string): Promise<void> {
    let { dependencySession } = this
    let installer = dependencySession.createInstaller(folder, msg => {
      this.log(msg)
    })
    await installer.installDependencies()
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
      await this.installDependencies(downloadFolder)
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
