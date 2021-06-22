import { EventEmitter } from 'events'
import { spawn } from 'child_process'
import { parse, ParseError } from 'jsonc-parser'
import readline from 'readline'
import fs from 'fs-extra'
import os from 'os'
import path from 'path'
import rc from 'rc'
import semver from 'semver'
import workspace from '../workspace'
import download from './download'
import fetch from './fetch'
import { statAsync } from '../util/fs'
const logger = require('../util/logger')('model-installer')

export interface Info {
  'dist.tarball'?: string
  'engines.coc'?: string
  version?: string
  name?: string
}

function registryUrl(scope = 'coc.nvim'): string {
  const result = rc('npm', { registry: 'https://registry.npmjs.org/' })
  const registry = result[`${scope}:registry`] || result.config_registry || result.registry as string
  return registry.endsWith('/') ? registry : registry + '/'
}

export class Installer extends EventEmitter {
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
    if (!fs.existsSync(root)) fs.mkdirpSync(root)
    if (/^https?:/.test(def)) {
      this.url = def
    } else {
      if (def.startsWith('@')) {
        // @author/package
        const idx = def.indexOf('@', 1)
        if (idx > 1) {
          // @author/package@1.0.0
          this.name = def.substring(0, idx)
          this.version = def.substring(idx + 1)
        } else {
          this.name = def
        }
      } else {
        if (def.includes('@')) {
          // name@1.0.0
          let [name, version] = def.split('@', 2)
          this.name = name
          this.version = version
        } else {
          this.name = def
        }
      }
    }
  }

  public get info() {
    return { name: this.name, version: this.version }
  }

  public async install(): Promise<string> {
    this.log(`Using npm from: ${this.npm}`)
    let info = await this.getInfo()
    logger.info(`Fetched info of ${this.def}`, info)
    let { name } = info
    let required = info['engines.coc'] ? info['engines.coc'].replace(/^\^/, '>=') : ''
    if (required && !semver.satisfies(workspace.version, required)) {
      throw new Error(`${name} ${info.version} requires coc.nvim >= ${required}, please update coc.nvim.`)
    }
    await this.doInstall(info)
    return name
  }

  public async update(url?: string): Promise<string> {
    this.url = url
    let folder = path.join(this.root, this.name)
    let stat = await fs.lstat(folder)
    if (stat.isSymbolicLink()) {
      this.log(`Skipped update for symbol link`)
      return
    }
    let version: string
    if (fs.existsSync(path.join(folder, 'package.json'))) {
      let content = await fs.readFile(path.join(folder, 'package.json'), 'utf8')
      version = JSON.parse(content).version
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
    await this.doInstall(info)
    let jsonFile = path.join(this.root, info.name, 'package.json')
    if (fs.existsSync(jsonFile)) {
      this.log(`Updated to v${info.version}`)
      return path.dirname(jsonFile)
    } else {
      throw new Error(`Package.json not found: ${jsonFile}`)
    }
  }

  private async doInstall(info: Info): Promise<void> {
    let folder = path.join(this.root, info.name)
    if (fs.existsSync(folder)) {
      let stat = fs.statSync(folder)
      if (!stat.isDirectory()) {
        this.log(`${folder} is not directory skipped install`)
        return
      }
    }
    let tmpFolder = await fs.mkdtemp(path.join(os.tmpdir(), `${info.name.replace('/', '-')}-`))
    let url = info['dist.tarball']
    this.log(`Downloading from ${url}`)
    await download(url, { dest: tmpFolder, onProgress: p => this.log(`Download progress ${p}%`, true), extract: 'untar' })
    this.log(`Extension download at ${tmpFolder}`)
    let content = await fs.readFile(path.join(tmpFolder, 'package.json'), 'utf8')
    let { dependencies } = JSON.parse(content)
    if (dependencies && Object.keys(dependencies).length) {
      let p = new Promise<void>((resolve, reject) => {
        let args = ['install', '--ignore-scripts', '--no-lockfile', '--production']
        if (url.startsWith('https://github.com')) {
          args = ['install']
        }
        if ((this.npm.endsWith('npm') || this.npm.endsWith('npm.CMD')) && !this.npm.endsWith('pnpm')) {
          args.push('--legacy-peer-deps')
        }
        if (this.npm.endsWith('yarn')) {
          args.push('--ignore-engines')
        }
        this.log(`Installing dependencies by: ${this.npm} ${args.join(' ')}.`)
        const child = spawn(this.npm, args, {
          cwd: tmpFolder,
        })
        const rl = readline.createInterface({
          input: child.stdout
        })
        rl.on('line', line => {
          this.log(`[npm] ${line}`, true)
        })
        child.stderr.setEncoding('utf8')
        child.stdout.setEncoding('utf8')
        child.on('error', reject)
        let err = ''
        child.stderr.on('data', data => {
          err += data
        })
        child.on('exit', code => {
          if (code) {
            if (err) this.log(err)
            reject(new Error(`${this.npm} install exited with ${code}`))
            return
          }
          resolve()
        })
      })
      await p
    }
    let jsonFile = path.resolve(this.root, global.hasOwnProperty('__TEST__') ? '' : '..', 'package.json')
    let errors: ParseError[] = []
    let obj = parse(fs.readFileSync(jsonFile, 'utf8'), errors, { allowTrailingComma: true })
    if (errors && errors.length > 0) {
      throw new Error(`Error on load ${jsonFile}`)
    }
    obj.dependencies = obj.dependencies || {}
    if (this.url) {
      obj.dependencies[info.name] = this.url
    } else {
      obj.dependencies[info.name] = '>=' + info.version
    }
    const sortedObj = { dependencies: {} }
    Object.keys(obj.dependencies).sort().forEach(k => {
      sortedObj.dependencies[k] = obj.dependencies[k]
    })
    let stat = await statAsync(folder)
    if (stat) {
      if (stat.isDirectory()) {
        fs.removeSync(folder)
      } else {
        fs.unlinkSync(folder)
      }
    }
    await fs.move(tmpFolder, folder, { overwrite: true })
    await fs.writeFile(jsonFile, JSON.stringify(sortedObj, null, 2), { encoding: 'utf8' })
    this.log(`Update package.json at ${jsonFile}`)
    this.log(`Installed extension ${this.name}@${info.version} at ${folder}`)
  }

  private async getInfo(): Promise<Info> {
    if (this.url) return await this.getInfoFromUri()
    let registry = registryUrl()
    this.log(`Get info from ${registry}`)
    let buffer = await fetch(registry + this.name, { timeout: 10000, buffer: true })
    let res = JSON.parse(buffer.toString())
    if (!this.version) this.version = res['dist-tags']['latest']
    let obj = res['versions'][this.version]
    if (!obj) throw new Error(`${this.def} doesn't exists in ${registry}.`)
    let requiredVersion = obj['engines'] && obj['engines']['coc']
    if (!requiredVersion) {
      throw new Error(`${this.def} is not valid coc extension, "engines" field with coc property required.`)
    }
    return {
      'dist.tarball': obj['dist']['tarball'],
      'engines.coc': requiredVersion,
      version: obj['version'],
      name: res.name
    } as Info
  }

  private async getInfoFromUri(): Promise<Info> {
    let { url } = this
    if (!url.includes('github.com')) {
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
    let content = await fetch(fileUrl, { timeout: 10000 })
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
    logger.info(msg)
    this.emit('message', msg, isProgress)
  }
}

export function createInstallerFactory(npm: string, root: string): (def: string) => Installer {
  return (def): Installer => new Installer(root, npm, def)
}
