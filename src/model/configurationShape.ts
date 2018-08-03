import { ConfigurationShape, ConfigurationTarget } from '../types'
import { FormattingOptions } from 'vscode-languageserver-protocol'
import { modify, applyEdits } from 'jsonc-parser'
import { writeFile } from '../util/fs'
import { Neovim } from '@chemzqm/neovim'
import fs from 'fs'
const logger = require('../util/logger')('model-ConfigurationShape')

export default class ConfigurationProxy implements ConfigurationShape {
  private userContent: string
  private workspaceContent: string
  private formattingOptions: FormattingOptions

  constructor(
    private nvim:Neovim,
    private userFile: string,
    private workspaceFile: string | null) {
    Object.defineProperty(this, 'userContent', {
      get: () => {
        if (!fs.existsSync(userFile)) {
          return ''
        }
        return fs.readFileSync(userFile, 'utf8')
      }
    })
    if (workspaceFile) {
      Object.defineProperty(this, 'workspaceContent', {
        get: () => {
          if (!fs.existsSync(workspaceFile)) {
            return ''
          }
          return fs.readFileSync(workspaceFile, 'utf8')
        }
      })
    }
    this.loadFormatOptions().catch(() => {
      // noop
    })
  }

  private async loadFormatOptions():Promise<void> {
    let {nvim} = this
    let tabSize = await nvim.getOption('tabstop')
    let insertSpaces = (await nvim.getOption('expandtab')) == 1
    this.formattingOptions = { tabSize: tabSize as number, insertSpaces }
  }

  private modifyConfiguration(target: ConfigurationTarget, key: string, value?: any): void {
    let content = target == ConfigurationTarget.Workspace ? this.workspaceContent : this.userContent
    let file = target == ConfigurationTarget.Workspace ? this.workspaceFile : this.userFile
    let { formattingOptions } = this
    let edits = modify(content, [key], value, { formattingOptions })
    content = applyEdits(content, edits)
    fs.writeFileSync(file, content, 'utf8')
    return
  }

  public $updateConfigurationOption(target: ConfigurationTarget, key: string, value: any): void {
    this.modifyConfiguration(target, key, value)
  }

  public $removeConfigurationOption(target: ConfigurationTarget, key: string): void {
    this.modifyConfiguration(target, key)
  }
}
