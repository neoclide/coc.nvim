import path from 'path'
import { executable, runCommand } from '../util'
import { statAsync } from '../util/fs'
import { memorize } from '../util/decorator'
const logger = require('../util/logger')('model-resolver')

export default class Resolver {

  @memorize
  private get nodeFolder(): Promise<string> {
    if (!executable('npm')) return Promise.resolve('')
    return runCommand('npm --loglevel silent root -g', {}, 3000).then(root => {
      return root.trim()
    })
  }

  @memorize
  private get yarnFolder(): Promise<string> {
    if (!executable('yarnpkg')) return Promise.resolve('')
    return runCommand('yarnpkg global dir', {}, 3000).then(root => {
      return path.join(root.trim(), 'node_modules')
    })
  }

  public async resolveModule(mod: string): Promise<string> {
    let nodeFolder = await this.nodeFolder
    let yarnFolder = await this.yarnFolder
    if (yarnFolder) {
      let s = await statAsync(path.join(yarnFolder, mod, 'package.json'))
      if (s && s.isFile()) return path.join(yarnFolder, mod)
    }
    if (nodeFolder) {
      let s = await statAsync(path.join(nodeFolder, mod, 'package.json'))
      if (s && s.isFile()) return path.join(nodeFolder, mod)
    }
    return null
  }
}
