import { Neovim } from '@chemzqm/neovim'
import fs from 'fs'
import { applyEdits, modify } from 'jsonc-parser'
import path from 'path'
import { FormattingOptions } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import { ConfigurationShape, ConfigurationTarget, IWorkspace } from '../types'
import { CONFIG_FILE_NAME } from '../util'
const logger = require('../util/logger')('configuration-shape')

export default class ConfigurationProxy implements ConfigurationShape {

  constructor(private workspace: IWorkspace) {
  }

  private get nvim(): Neovim {
    return this.workspace.nvim
  }

  private async modifyConfiguration(target: ConfigurationTarget, key: string, value?: any): Promise<void> {
    let { nvim, workspace } = this
    let file = workspace.getConfigFile(target)
    if (!file) return
    let formattingOptions: FormattingOptions = { tabSize: 2, insertSpaces: true }
    let content = fs.readFileSync(file, 'utf8')
    value = value == null ? undefined : value
    let edits = modify(content, [key], value, { formattingOptions })
    content = applyEdits(content, edits)
    fs.writeFileSync(file, content, 'utf8')
    let doc = workspace.getDocument(URI.file(file).toString())
    if (doc) nvim.command('checktime', true)
    return
  }

  public get workspaceConfigFile(): string {
    let folder = path.join(this.workspace.root, '.vim')
    return path.join(folder, CONFIG_FILE_NAME)
  }

  public $updateConfigurationOption(target: ConfigurationTarget, key: string, value: any): void {
    this.modifyConfiguration(target, key, value).logError()
  }

  public $removeConfigurationOption(target: ConfigurationTarget, key: string): void {
    this.modifyConfiguration(target, key).logError()
  }
}
