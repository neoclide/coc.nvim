'use strict'
import fs from 'fs'
import { applyEdits, modify } from 'jsonc-parser'
import path from 'path'
import { promisify } from 'util'
import { WorkspaceFolder } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
const logger = require('../util/logger')('configuration-shape')

interface IFolderController {
  root?: string
  getWorkspaceFolder?: (resource: string) => WorkspaceFolder
}
export interface IConfigurationShape {
  root?: string
  /**
   * Resolve possible workspace config from resource.
   */
  getWorkspaceFolder?(resource?: string): URI | undefined
  modifyConfiguration(fsPath: string, key: string, value?: any): Promise<void>
}

export default class ConfigurationProxy implements IConfigurationShape {

  constructor(private resolver: IFolderController, private _test = global.__TEST__) {
  }

  public get root(): string | undefined {
    return this.resolver.root
  }

  public async modifyConfiguration(fsPath: string, key: string, value?: any): Promise<void> {
    if (this._test) return
    logger.info(`modify configuration file: ${fsPath}`, key, value)
    let dir = path.dirname(fsPath)
    let formattingOptions = { tabSize: 2, insertSpaces: true }
    if (!fs.existsSync(dir)) await promisify(fs.mkdir)(dir, { recursive: true })
    let content = await promisify(fs.readFile)(fsPath, { encoding: 'utf8', flag: 'a+' })
    content = content || '{}'
    let edits = modify(content, [key], value, { formattingOptions })
    content = applyEdits(content, edits)
    await promisify(fs.writeFile)(fsPath, content, 'utf8')
  }

  public getWorkspaceFolder(resource: string): URI | undefined {
    if (typeof this.resolver.getWorkspaceFolder === 'function') {
      let workspaceFolder = this.resolver.getWorkspaceFolder(resource)
      if (workspaceFolder) return URI.parse(workspaceFolder.uri)
    }
    return undefined
  }
}
