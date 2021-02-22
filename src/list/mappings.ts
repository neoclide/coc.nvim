import { Neovim } from '@chemzqm/neovim'
import { ListMode } from '../types'
import '../util/extensions'
import window from '../window'
import ListConfiguration, { validKeys } from './configuration'
import { ListManager } from './manager'
const logger = require('../util/logger')('list-mappings')

export default class Mappings {
  private insertMappings: Map<string, () => void | Promise<void>> = new Map()
  private normalMappings: Map<string, () => void | Promise<void>> = new Map()
  private userInsertMappings: Map<string, string> = new Map()
  private userNormalMappings: Map<string, string> = new Map()

  constructor(private manager: ListManager,
    private nvim: Neovim,
    private config: ListConfiguration) {
    let { prompt } = manager

    this.add('insert', '<C-k>', () => {
      prompt.removeTail()
    })
    this.add('insert', '<C-n>', () => {
      manager.session?.history.next()
    })
    this.add('insert', '<C-p>', () => {
      manager.session?.history.previous()
    })
    this.add('insert', '<C-v>', async () => {
      await prompt.paste()
    })
    this.add('insert', '<C-s>', () => manager.switchMatcher())
    this.add('insert', ['<C-m>', '<cr>'], async () => {
      await manager.doAction()
    })
    this.add('insert', ['<tab>', '<C-i>', '\t'], () => manager.chooseAction())
    this.add('insert', '<C-o>', () => {
      manager.toggleMode()
    })
    this.add('insert', '<C-c>', () => {
      manager.stop()
      return
    })
    this.add('insert', '<esc>', () => manager.cancel())
    this.add('insert', '<C-l>', async () => {
      await manager.session?.reloadItems()
    })
    this.add('insert', '<left>', () => {
      prompt.moveLeft()
    })
    this.add('insert', '<right>', () => {
      prompt.moveRight()
    })
    this.add('insert', ['<end>', '<C-e>'], () => {
      prompt.moveToEnd()
    })
    this.add('insert', ['<home>', '<C-a>'], () => {
      prompt.moveToStart()
    })
    this.add('insert', ['<C-h>', '<bs>', '<backspace>'], () => {
      prompt.onBackspace()
    })
    this.add('insert', '<C-w>', () => {
      prompt.removeWord()
    })
    this.add('insert', '<C-u>', () => {
      prompt.removeAhead()
    })
    this.add('insert', '<C-r>', () => prompt.insertRegister())
    this.add('insert', '<C-d>', () => manager.feedkeys('<C-d>', false))
    this.add('insert', '<PageUp>', () => manager.feedkeys('<PageUp>', false))
    this.add('insert', '<PageDown>', () => manager.feedkeys('<PageDown>', false))
    this.add('insert', '<down>', () => manager.normal('j'))
    this.add('insert', '<up>', () => manager.normal('k'))
    this.add('insert', ['<ScrollWheelUp>'], this.doScroll.bind(this, '<ScrollWheelUp>'))
    this.add('insert', ['<ScrollWheelDown>'], this.doScroll.bind(this, '<ScrollWheelDown>'))
    this.add('insert', ['<C-f>'], this.doScroll.bind(this, '<C-f>'))
    this.add('insert', ['<C-b>'], this.doScroll.bind(this, '<C-b>'))

    this.add('normal', '<C-o>', () => {
      // do nothing, avoid buffer switch by accident
    })
    this.add('normal', 't', () => manager.doAction('tabe'))
    this.add('normal', 's', () => manager.doAction('split'))
    this.add('normal', 'd', () => manager.doAction('drop'))
    this.add('normal', ['<cr>', '<C-m>', '\r'], () => manager.doAction())
    this.add('normal', '<C-a>', () => manager.session?.ui.selectAll())
    this.add('normal', ' ', () => manager.session?.ui.toggleSelection())
    this.add('normal', 'p', () => manager.togglePreview())
    this.add('normal', ['<tab>', '\t', '<C-i>'], () => manager.chooseAction())
    this.add('normal', '<C-c>', () => {
      manager.stop()
    })
    this.add('normal', '<esc>', () => manager.cancel())
    this.add('normal', '<C-l>', () => manager.session?.reloadItems())
    this.add('normal', '<C-o>', () => manager.session?.jumpBack())
    this.add('normal', '<C-e>', () => this.scrollPreview('down'))
    this.add('normal', '<C-y>', () => this.scrollPreview('up'))
    this.add('normal', ['i', 'I', 'o', 'O', 'a', 'A'], () => manager.toggleMode())
    this.add('normal', '?', () => manager.session?.showHelp())
    this.add('normal', ':', async () => {
      await manager.cancel(false)
      await nvim.eval('feedkeys(":")')
    })
    this.add('normal', ['<ScrollWheelUp>'], this.doScroll.bind(this, '<ScrollWheelUp>'))
    this.add('normal', ['<ScrollWheelDown>'], this.doScroll.bind(this, '<ScrollWheelDown>'))
    this.createMappings()
    config.on('change', () => {
      this.createMappings()
    })
  }

  private createMappings(): void {
    let insertMappings = this.config.get<any>('insertMappings', {})
    this.userInsertMappings = this.fixUserMappings(insertMappings)
    let normalMappings = this.config.get<any>('normalMappings', {})
    this.userNormalMappings = this.fixUserMappings(normalMappings)
  }

  private fixUserMappings(mappings: { [key: string]: string }): Map<string, string> {
    let res: Map<string, string> = new Map()
    for (let [key, value] of Object.entries(mappings)) {
      if (key.length == 1) {
        res.set(key, value)
      } else if (key.startsWith('<') && key.endsWith('>')) {
        if (key.toLowerCase() == '<space>') {
          res.set(' ', value)
        } else if (key.toLowerCase() == '<backspace>') {
          res.set('<bs>', value)
        } else if (validKeys.includes(key)) {
          res.set(key, value)
        } else {
          let find = false
          for (let i = 0; i < validKeys.length; i++) {
            if (validKeys[i].toLowerCase() == key.toLowerCase()) {
              find = true
              res.set(validKeys[i], value)
              break
            }
          }
          if (!find) window.showMessage(`Invalid list mappings key configuration: "${key}"`, 'warning')
        }
      } else {
        window.showMessage(`Invalid list mappings key configuration: "${key}"`, 'warning')
      }
    }
    return res
  }

  public async doInsertKeymap(key: string): Promise<boolean> {
    let nextKey = this.config.nextKey
    let previousKey = this.config.previousKey
    let { session } = this.manager
    if (!session) return
    if (key == nextKey) {
      session.ui.index = session.ui.index + 1
      return true
    }
    if (key == previousKey) {
      session.ui.index = session.ui.index - 1
      return true
    }
    let expr = this.userInsertMappings.get(key)
    if (expr) {
      await this.evalExpression(expr, 'insert')
      return true
    }
    if (this.insertMappings.has(key)) {
      let fn = this.insertMappings.get(key)
      await Promise.resolve(fn())
      return true
    }
    return false
  }

  public async doNormalKeymap(key: string): Promise<boolean> {
    let expr = this.userNormalMappings.get(key)
    if (expr) {
      await this.evalExpression(expr, 'normal')
      return true
    }
    if (this.normalMappings.has(key)) {
      let fn = this.normalMappings.get(key)
      await Promise.resolve(fn())
      return true
    }
    return false
  }

  private add(mode: ListMode, key: string | string[], fn: () => void | Promise<void>): void {
    let mappings = mode == 'insert' ? this.insertMappings : this.normalMappings
    if (Array.isArray(key)) {
      for (let k of key) {
        mappings.set(k, fn)
      }
    } else {
      mappings.set(key, fn)
    }
  }

  private async onError(msg: string): Promise<void> {
    let { nvim } = this
    await nvim.call('coc#prompt#stop_prompt', ['list'])
    window.showMessage(msg, 'error')
    this.manager.prompt.start()
  }

  private async evalExpression(expr: string, _mode: string): Promise<void> {
    if (typeof expr != 'string' || !expr.includes(':')) {
      await this.onError(`Invalid list mapping expression: ${expr}`)
      return
    }
    let { manager } = this
    let { prompt } = manager
    let [key, action] = expr.split(':', 2)
    if (key == 'do') {
      switch (action.toLowerCase()) {
        case 'switch':
          manager.switchMatcher()
          return
        case 'selectall':
          await manager.session?.ui.selectAll()
          return
        case 'help':
          await manager.session?.showHelp()
          return
        case 'refresh':
          await manager.session?.reloadItems()
          return
        case 'exit':
          await manager.cancel()
          return
        case 'stop':
          manager.stop()
          return
        case 'cancel':
          await manager.cancel(false)
          return
        case 'toggle':
          await manager.session?.ui.toggleSelection()
          return
        case 'jumpback':
          manager.session?.jumpBack()
          return
        case 'previous':
          await manager.normal('k')
          return
        case 'next':
          await manager.normal('j')
          return
        case 'defaultaction':
          await manager.doAction()
          return
        case 'togglemode':
          return manager.toggleMode()
        case 'previewtoggle':
          return manager.togglePreview()
        case 'previewup':
          return this.scrollPreview('up')
        case 'previewdown':
          return this.scrollPreview('down')
        default:
          await this.onError(`'${action}' not supported`)
      }
    } else if (key == 'prompt') {
      switch (action) {
        case 'previous':
          manager.session?.history.previous()
          return
        case 'next':
          manager.session?.history.next()
          return
        case 'start':
          return prompt.moveToStart()
        case 'end':
          return prompt.moveToEnd()
        case 'left':
          return prompt.moveLeft()
        case 'right':
          return prompt.moveRight()
        case 'deleteforward':
          return prompt.onBackspace()
        case 'deletebackward':
          return prompt.removeNext()
        case 'removetail':
          return prompt.removeTail()
        case 'removeahead':
          return prompt.removeAhead()
        case 'insertregister':
          prompt.insertRegister()
          return
        case 'paste':
          await prompt.paste()
          return
        default:
          await this.onError(`prompt '${action}' not supported`)
      }
    } else if (key == 'eval') {
      await prompt.eval(action)
    } else if (key == 'command') {
      await manager.command(action)
    } else if (key == 'action') {
      await manager.doAction(action)
    } else if (key == 'feedkeys') {
      await manager.feedkeys(action)
    } else if (key == 'normal') {
      await manager.normal(action, false)
    } else if (key == 'normal!') {
      await manager.normal(action, true)
    } else if (key == 'call') {
      await manager.call(action)
    } else if (key == 'expr') {
      let name = await manager.call(action)
      if (name) await manager.doAction(name)
    } else {
      await this.onError(`Invalid expression ${expr}`)
    }
  }

  private async doScroll(key: string): Promise<void> {
    await this.manager.feedkeys(key)
  }

  private scrollPreview(dir: 'up' | 'down'): void {
    let { nvim } = this
    nvim.pauseNotification()
    nvim.call('coc#list#scroll_preview', [dir], true)
    nvim.command('redraw', true)
    void nvim.resumeNotification(false, true)
  }
}
