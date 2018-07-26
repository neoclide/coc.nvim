import { ConfigurationShape, ConfigurationTarget } from '../types'
import { modify, JSONPath, applyEdits } from 'jsonc-parser'
import fs from 'fs'
import {writeFile} from '../util/fs'

export default class ConfigurationProxy implements ConfigurationShape {
  private userContent: string
  private workspaceContent: string

  constructor(
    private userFile: string,
    private workspaceFile?: string) {
    Object.defineProperty(this, 'userContent', {
      get: () => {
        if (!fs.existsSync(userFile)) {
          return {}
        }
        return fs.readFileSync(userFile, 'utf8')
      }
    })
    if (workspaceFile) {
      Object.defineProperty(this, 'workspaceContent', {
        get: () => {
          return fs.readFileSync(workspaceFile, 'utf8')
        }
      })
    }
  }

  private modifyConfiguration(target: ConfigurationTarget, key: string, value?: any): Promise<void> {
    let path: JSONPath = key.split('.')
    let content = target == ConfigurationTarget.Workspace ? this.workspaceContent : this.userContent
    let file = target == ConfigurationTarget.Workspace ? this.workspaceFile : this.userFile
    let edits = modify(content, path, value, {formattingOptions: {}})
    content = applyEdits(content, edits)
    return writeFile(file, content)
  }

  public $updateConfigurationOption(target: ConfigurationTarget, key: string, value: any): Promise<void> {
    return this.modifyConfiguration(target, key, value)
  }

  public $removeConfigurationOption(target: ConfigurationTarget, key: string): Promise<void> {
    return this.modifyConfiguration(target, key)
  }
}
