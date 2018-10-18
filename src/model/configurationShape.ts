import { Neovim } from '@chemzqm/neovim'
import fs from 'fs'
import { applyEdits, modify } from 'jsonc-parser'
import Uri from 'vscode-uri'
import { ConfigurationShape, ConfigurationTarget, IWorkspace } from '../types'
import { echoErr } from '../util'
const logger = require('../util/logger')('model-ConfigurationShape')

export default class ConfigurationProxy implements ConfigurationShape {

  constructor(private workspace: IWorkspace) {
  }

  private get nvim(): Neovim {
    return this.workspace.nvim
  }

  private async modifyConfiguration(target: ConfigurationTarget, key: string, value?: any): Promise<void> {

    let { nvim } = this
    let file = this.workspace.getConfigFile(target)
    if (!file) return
    let formattingOptions = await this.workspace.getFormatOptions()
    let content = await this.workspace.readFile(Uri.file(file).toString())
    value = value == null ? undefined : value
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
