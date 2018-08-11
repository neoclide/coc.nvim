import { ConfigurationShape, ConfigurationTarget } from '../types'
import { FormattingOptions } from 'vscode-languageserver-protocol'
import { modify, applyEdits } from 'jsonc-parser'
import fs from 'fs'
const logger = require('../util/logger')('model-ConfigurationShape')

export default class ConfigurationProxy implements ConfigurationShape {
  private userContent: string
  private workspaceContent: string
  private formattingOptions: FormattingOptions

  constructor(
    private userFile: string,
    private workspaceFile: string | null) {
    this.userContent = fs.existsSync(userFile) ? fs.readFileSync(userFile, 'utf8') : ''
    this.workspaceContent = fs.existsSync(workspaceFile) ? fs.readFileSync(workspaceFile, 'utf8')  : ''

    this.formattingOptions = { tabSize: 2, insertSpaces: true }
  }

  private modifyConfiguration(target: ConfigurationTarget, key: string, value?: any): void {
    let content = target == ConfigurationTarget.Workspace ? this.workspaceContent : this.userContent
    let file = target == ConfigurationTarget.Workspace ? this.workspaceFile : this.userFile
    let { formattingOptions } = this
    let edits = modify(content, [key], value, { formattingOptions })
    content = applyEdits(content, edits)
    fs.writeFileSync(file, content, 'utf8')
    if (target == ConfigurationTarget.Workspace) {
      this.workspaceContent = content
    } else {
      this.userContent = content
    }
    return
  }

  public $updateConfigurationOption(target: ConfigurationTarget, key: string, value: any): void {
    this.modifyConfiguration(target, key, value)
  }

  public $removeConfigurationOption(target: ConfigurationTarget, key: string): void {
    this.modifyConfiguration(target, key)
  }
}
