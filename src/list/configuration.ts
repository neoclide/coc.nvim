'use strict'
import workspace from '../workspace'
import window from '../window'
import { EventEmitter } from 'events'
import { ConfigurationTarget } from '../configuration/types'

export const validKeys = [
  '<esc>',
  '<space>',
  '<tab>',
  '<s-tab>',
  '<bs>',
  '<right>',
  '<left>',
  '<up>',
  '<down>',
  '<home>',
  '<end>',
  '<cr>',
  '<FocusGained>',
  '<FocusLost>',
  '<ScrollWheelUp>',
  '<ScrollWheelDown>',
  '<LeftMouse>',
  '<LeftDrag>',
  '<LeftRelease>',
  '<2-LeftMouse>',
  '<C-a>',
  '<C-b>',
  '<C-c>',
  '<C-d>',
  '<C-e>',
  '<C-f>',
  '<C-g>',
  '<C-h>',
  '<C-i>',
  '<C-j>',
  '<C-k>',
  '<C-l>',
  '<C-m>',
  '<C-n>',
  '<C-o>',
  '<C-p>',
  '<C-q>',
  '<C-r>',
  '<C-s>',
  '<C-t>',
  '<C-u>',
  '<C-v>',
  '<C-w>',
  '<C-x>',
  '<C-y>',
  '<C-z>',
  '<A-a>',
  '<A-b>',
  '<A-c>',
  '<A-d>',
  '<A-e>',
  '<A-f>',
  '<A-g>',
  '<A-h>',
  '<A-i>',
  '<A-j>',
  '<A-k>',
  '<A-l>',
  '<A-m>',
  '<A-n>',
  '<A-o>',
  '<A-p>',
  '<A-q>',
  '<A-r>',
  '<A-s>',
  '<A-t>',
  '<A-u>',
  '<A-v>',
  '<A-w>',
  '<A-x>',
  '<A-y>',
  '<A-z>',
]

export default class ListConfiguration extends EventEmitter {
  constructor() {
    super()
    workspace.onDidChangeConfiguration(e => {
      if (e.source !== ConfigurationTarget.Default && e.affectsConfiguration('list')) {
        this.emit('change')
      }
    })
  }

  public get floatPreview(): boolean {
    return this.get<boolean>('floatPreview', false)
  }

  public get smartcase(): boolean {
    return this.get<boolean>('smartCase', false)
  }

  public get<T>(key: string, defaultValue?: T): T {
    let configuration = workspace.initialConfiguration
    return configuration.get<T>('list.' + key, defaultValue)
  }

  public get previousKey(): string {
    return this.fixKey(this.get<string>('previousKeymap', '<C-j>'))
  }

  public get nextKey(): string {
    return this.fixKey(this.get<string>('nextKeymap', '<C-k>'))
  }

  public fixKey(key: string): string {
    if (validKeys.includes(key)) return key
    let find = validKeys.find(s => s.toLowerCase() == key.toLowerCase())
    if (find) return find
    void window.showErrorMessage(`Configured key "${key}" not supported.`)
    return null
  }
}
