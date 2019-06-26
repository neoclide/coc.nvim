import {spawn} from 'child_process'
import {runCommand} from '../util'
import {promisify} from 'util'
import tar from 'tar'
import got from 'got'
import tunnel from 'tunnel'
import fs from 'fs'
import path from 'path'
import rimraf from 'rimraf'
import workspace from '../workspace'
import semver from 'semver'
import {StatusBarItem} from '../types'
const logger = require('../util/logger')('model-extension')

export interface Info {
  'dist.tarball': string
  'engines.coc': string
  version: string
}

export default class ExtensionManager {
  private proxy: string
  constructor(private root: string) {
    this.proxy = workspace.getConfiguration('http').get<string>('proxy', '')
  }

  private get statusItem(): StatusBarItem {
    return workspace.createStatusBarItem(0, {progress: true})
  }

  private async getInfo(npm: string, name: string): Promise<Info> {
    let res = await runCommand(`${npm} view ${name} dist.tarball engines.coc version --json`, {timeout: 60 * 1000})
    return JSON.parse(res)
  }

  private async _install(npm: string, name: string, info: Info, onMessage: (msg: string) => void): Promise<void> {
    let {proxy} = this
    let folder = path.join(this.root, 'node_modules', name)
    if (fs.existsSync(folder)) {
      await promisify(rimraf)(`${folder}/*`)
    } else {
      await promisify(fs.mkdir)(folder, {recursive: true})
    }
    let url = info['dist.tarball']
    onMessage(`Downloading ${url.match(/[^/]*$/)[0]}`)
    let options: any = {encoding: null}
    if (proxy) {
      let parts = proxy.split(':', 2)
      options.agent = tunnel.httpsOverHttp({
        proxy: {
          headers: {},
          host: parts[0],
          port: Number(parts[1])
        }
      })
    }
    let p = new Promise((resolve, reject) => {
      let stream = got.stream(url, options).on('downloadProgress', progress => {
        let p = (progress.percent * 100).toFixed(0)
        onMessage(`${p}% downloaded.`)
      })
      stream.on('error', err => {
        reject(new Error(`Download error: ${err}`))
      })
      stream.pipe(tar.x({strip: 1, C: folder}))
      stream.on('end', () => {
        setTimeout(resolve, 50)
      })
    })
    await p
    let file = path.join(folder, 'package.json')
    let content = await promisify(fs.readFile)(file, 'utf8')
    let {dependencies} = JSON.parse(content)
    if (dependencies && Object.keys(dependencies).length) {
      onMessage(`Installing dependencies.`)
      let p = new Promise((resolve, reject) => {
        const child = spawn(npm, ['install', '--ignore-scripts', '--no-lockfile', '--no-bin-links', '--production'], {
          cwd: folder
        })
        child.on('error', reject)
        child.once('exit', resolve)
      })
      await p
    }
    let jsonFile = path.join(this.root, 'package.json')
    let obj = JSON.parse(fs.readFileSync(jsonFile, 'utf8'))
    obj.dependencies = obj.dependencies || {}
    obj.dependencies[name] = '>=' + info.version
    fs.writeFileSync(jsonFile, JSON.stringify(obj, null, 2), {encoding: 'utf8'})
  }

  public async install(npm: string, name: string): Promise<boolean> {
    let {statusItem} = this
    try {
      logger.info(`Using npm from: ${npm}`)
      statusItem.text = `Loading info of ${name}.`
      statusItem.show()
      let info = await this.getInfo(npm, name)
      let required = info['engines.coc'] ? info['engines.coc'].replace(/^\^/, '>=') : ''
      if (required && !semver.satisfies(workspace.version, required)) {
        throw new Error(`${name} ${info.version} requires coc.nvim >= ${required}, please update coc.nvim.`)
      }
      await this._install(npm, name, info, msg => {
        statusItem.text = msg
      })
      statusItem.dispose()
      workspace.showMessage(`Installed extension: ${name}`, 'more')
      logger.info(`Installed extension: ${name}`)
      return true
    } catch (e) {
      statusItem.dispose()
      logger.error(e)
      workspace.showMessage(`Install ${name} error: ${e.message}`, 'error')
      return false
    }
  }

  public async update(npm: string, name: string): Promise<boolean> {
    let folder = path.join(this.root, 'node_modules', name)
    let {statusItem} = this
    try {
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
      statusItem.text = `Loading info of ${name}.`
      statusItem.show()
      let info = await this.getInfo(npm, name)
      if (version && info.version && semver.gte(version, info.version)) {
        logger.info(`Extension ${name} is up to date.`)
        statusItem.dispose()
        return false
      }
      let required = info['engines.coc'] ? info['engines.coc'].replace(/^\^/, '>=') : ''
      if (required && !semver.satisfies(workspace.version, required)) {
        throw new Error(`${name} ${info.version} requires coc.nvim >= ${required}, please update coc.nvim.`)
      }
      await this._install(npm, name, info, msg => {
        statusItem.text = msg
      })
      statusItem.dispose()
      workspace.showMessage(`Update extension: ${name}`, 'more')
      logger.info(`Update extension: ${name}`)
      return true
    } catch (e) {
      statusItem.dispose()
      logger.error(e)
      workspace.showMessage(`Update ${name} error: ${e.message}`, 'error')
      return false
    }
  }
}
