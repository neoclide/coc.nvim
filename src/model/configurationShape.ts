import { ConfigurationShape, ConfigurationTarget, IWorkspace } from '../types'
import { FormattingOptions } from 'vscode-languageserver-protocol'
import { modify, applyEdits } from 'jsonc-parser'
import fs from 'fs'
import { echoErr } from '../util'
import { Neovim } from '@chemzqm/neovim'
import Uri from 'vscode-uri'
const logger = require('../util/logger')('model-ConfigurationShape')

export default class ConfigurationProxy implements ConfigurationShape {
  private formattingOptions: FormattingOptions

  constructor(private workspace: IWorkspace) {
    this.formattingOptions = { tabSize: 2, insertSpaces: true }
  }

  private get nvim():Neovim {
    return this.workspace.nvim
  }

  private getConfigFile(target: ConfigurationTarget):string | null {
    let {configFiles} = this.workspace
    if (target == ConfigurationTarget.Workspace) {
      return configFiles[1]
    }
    return configFiles[2]
  }

  private async modifyConfiguration(target: ConfigurationTarget, key: string, value?: any): Promise<void> {
    let {nvim} = this
    let file = this.getConfigFile(target)
    let content = ''
    if (file) content = await this.workspace.readFile(Uri.file(file).toString())
    let { formattingOptions } = this

    let edits = modify(content, [key], value, { formattingOptions })
    content = applyEdits(content, edits)
    fs.writeFileSync(file, content, 'utf8')
    nvim.command('checktime', true)
    return
  }

  public $updateConfigurationOption(target: ConfigurationTarget, key: string, value: any): void {
    this.modifyConfiguration(target, key, value).catch(e => {
      echoErr(this.nvim, e.message)
    })
  }

  public $removeConfigurationOption(target: ConfigurationTarget, key: string): void {
    this.modifyConfiguration(target, key).catch(e => {
      echoErr(this.nvim, e.message)
    })
  }
}
