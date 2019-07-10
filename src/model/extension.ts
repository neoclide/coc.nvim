import { exec, ExecOptions, spawn } from 'child_process'
import fs from 'fs'
import mkdirp from 'mkdirp'
import path from 'path'
import rimraf from 'rimraf'
import mv from 'mv'
import semver from 'semver'
import { promisify } from 'util'
import { runCommand } from '../util'
import workspace from '../workspace'
import download from './download'
import fetch from './fetch'
const logger = require('../util/logger')('model-extension')

export interface Info {
  'dist.tarball'?: string
  'engines.coc'?: string
  version?: string
  name?: string
  error?: {
    code: string
    summary: string
  }
}

async function getData(name: string, field: string): Promise<string> {
  let res = await runCommand(`yarn info ${name} ${field} --json`, { timeout: 60 * 1000 })
  return JSON.parse(res)['data']
}

export default class ExtensionManager {
  private checked = false
  constructor(private root: string) {
  }

  private checkFolder(): void {
    if (this.checked) return
    this.checked = true
    let { root } = this
    mkdirp.sync(root)
    mkdirp.sync(path.join(root, 'node_modules/.cache'))
  }

  private async getInfo(npm: string, name: string): Promise<Info> {
    if (name.startsWith('https:')) return await this.getInfoFromUri(name)
    if (npm.endsWith('yarn')) {
      let obj = { name }
      let keys = ['dist.tarball', 'engines.coc', 'version', 'name']
      let vals = await Promise.all(keys.map(key => {
        return getData(name, key)
      }))
      for (let i = 0; i < keys.length; i++) {
        obj[keys[i]] = vals[i]
      }
      return obj as Info
    }
    let content = await safeRun(`"${npm}" view ${name} dist.tarball engines.coc version name`, { timeout: 60 * 1000 })
    let lines = content.split(/\r?\n/)
    let obj = { name }
    for (let line of lines) {
      let ms = line.match(/^(\S+)\s*=\s*'(.*)'/)
      if (ms) obj[ms[1]] = ms[2]
    }
    return obj as Info
  }

  private async removeFolder(folder: string): Promise<void> {
    if (fs.existsSync(folder)) {
      let stat = await promisify(fs.lstat)(folder)
      if (stat.isSymbolicLink()) {
        await promisify(fs.unlink)(folder)
      } else {
        await promisify(rimraf)(folder, { glob: false })
      }
    }
  }

  private async _install(npm: string, def: string, info: Info, onMessage: (msg: string) => void): Promise<void> {
    let tmpFolder = await promisify(fs.mkdtemp)(path.join(this.root, 'node_modules/.cache', `${info.name}-`))
    let url = info['dist.tarball']
    onMessage(`Downloading from ${url}`)
    await download(url, { dest: tmpFolder })
    let content = await promisify(fs.readFile)(path.join(tmpFolder, 'package.json'), 'utf8')
    let { dependencies } = JSON.parse(content)
    if (dependencies && Object.keys(dependencies).length) {
      onMessage(`Installing dependencies.`)
      let p = new Promise<void>((resolve, reject) => {
        let args = ['install', '--ignore-scripts', '--no-lockfile', '--no-bin-links', '--production']
        const child = spawn(npm, args, { cwd: tmpFolder })
        child.on('error', reject)
        child.on('exit', resolve)
      })
      await p
    }
    let jsonFile = path.join(this.root, 'package.json')
    let obj = JSON.parse(fs.readFileSync(jsonFile, 'utf8'))
    obj.dependencies = obj.dependencies || {}
    if (/^https?:/.test(def)) {
      obj.dependencies[info.name] = def
    } else {
      obj.dependencies[info.name] = '>=' + info.version
    }
    fs.writeFileSync(jsonFile, JSON.stringify(obj, null, 2), { encoding: 'utf8' })
    onMessage(`Moving to new folder.`)
    let folder = path.join(this.root, 'node_modules', info.name)
    await this.removeFolder(folder)
    await promisify(mv)(tmpFolder, folder, { mkdirp: true })
  }

  public async install(npm: string, def: string): Promise<string> {
    this.checkFolder()
    logger.info(`Using npm from: ${npm}`)
    logger.info(`Loading info of ${def}.`)
    let info = await this.getInfo(npm, def)
    if (info.error) {
      let { code, summary } = info.error
      let msg = code == 'E404' ? `module ${def} not exists!` : summary
      throw new Error(msg)
    }
    let { name } = info
    let required = info['engines.coc'] ? info['engines.coc'].replace(/^\^/, '>=') : ''
    if (required && !semver.satisfies(workspace.version, required)) {
      throw new Error(`${name} ${info.version} requires coc.nvim >= ${required}, please update coc.nvim.`)
    }
    await this._install(npm, def, info, msg => {
      logger.info(msg)
    })
    workspace.showMessage(`Installed extension: ${name}`, 'more')
    logger.info(`Installed extension: ${name}`)
    return name
  }

  public async update(npm: string, name: string, uri?: string): Promise<boolean> {
    this.checkFolder()
    let folder = path.join(this.root, 'node_modules', name)
    let stat = await promisify(fs.lstat)(folder)
    if (stat.isSymbolicLink()) {
      logger.info(`skipped update of ${name}`)
      return false
    }
    let version: string
    if (fs.existsSync(path.join(folder, 'package.json'))) {
      let content = await promisify(fs.readFile)(path.join(folder, 'package.json'), 'utf8')
      version = JSON.parse(content).version
    }
    logger.info(`Loading info of ${name}.`)
    let info = await this.getInfo(npm, uri ? uri : name)
    if (info.error) return
    if (version && info.version && semver.gte(version, info.version)) {
      logger.info(`Extension ${name} is up to date.`)
      return false
    }
    let required = info['engines.coc'] ? info['engines.coc'].replace(/^\^/, '>=') : ''
    if (required && !semver.satisfies(workspace.version, required)) {
      throw new Error(`${name} ${info.version} requires coc.nvim >= ${required}, please update coc.nvim.`)
    }
    await this._install(npm, uri ? uri : name, info, msg => { logger.info(msg) })
    workspace.showMessage(`Updated extension: ${name} to ${info.version}`, 'more')
    logger.info(`Update extension: ${name}`)
    return true
  }

  private async getInfoFromUri(uri: string): Promise<Info> {
    if (uri.indexOf('github.com') == -1) return
    uri = uri.replace(/\/$/, '')
    let fileUrl = uri.replace('github.com', 'raw.githubusercontent.com') + '/master/package.json'
    let content = await fetch(fileUrl)
    let obj = typeof content == 'string' ? JSON.parse(content) : content
    return {
      'dist.tarball': `${uri}/archive/master.tar.gz`,
      'engines.coc': obj['engines'] ? obj['engines']['coc'] : undefined,
      name: obj.name,
      version: obj.version
    }
  }
}

function safeRun(cmd: string, opts: ExecOptions = {}, timeout?: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let timer: NodeJS.Timer
    let cp = exec(cmd, opts, (err, stdout, stderr) => {
      if (timer) clearTimeout(timer)
      if (err) return reject(err)
      resolve(stdout)
    })
    cp.on('error', e => {
      if (timer) clearTimeout(timer)
      reject(e)
    })
    if (timeout) {
      timer = setTimeout(() => {
        cp.kill()
        reject(new Error(`timeout after ${timeout}s`))
      }, timeout * 1000)
    }
  })
}
