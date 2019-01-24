import { Neovim } from '@chemzqm/neovim'
import { ListManager } from './manager'
import { WorkspaceConfiguration, ListMode } from '../types'
import workspace from '../workspace'
const logger = require('../util/logger')('list-mappings')

export default class Mappings {
  private insertMappings: Map<string, () => void | Promise<void>> = new Map()
  private normalMappings: Map<string, () => void | Promise<void>> = new Map()

  constructor(private manager: ListManager,
    private nvim: Neovim,
    private config: WorkspaceConfiguration) {
    let nextKey = config.get<string>('nextKeymap', '<C-j>')
    let previousKey = config.get<string>('previousKeymap', '<C-k>')
    let { prompt } = manager

    this.add('insert', ' ', () => {
      return manager.ui.toggleSelection()
    })
    this.add('insert', '<C-k>', () => {
      return prompt.removeTail()
    })
    this.add('insert', '<C-n>', () => {
      return manager.history.next()
    })
    this.add('insert', '<C-p>', () => {
      return manager.history.previous()
    })
    this.add('insert', ['<C-m>', '<cr>'], () => {
      return manager.doAction()
    })
    this.add('insert', ['<C-i>', '\t'], () => {
      return manager.chooseAction()
    })
    this.add('insert', '<C-o>', () => {
      return manager.toggleMode()
    })
    this.add('insert', '<C-c>', async () => {
      manager.stop()
      manager.prompt.start()
      return
    })
    this.add('insert', '<esc>', () => {
      return manager.cancel()
    })
    this.add('insert', '<C-l>', () => {
      return manager.worker.loadItems(true)
    })
    this.add('insert', '<left>', () => {
      return prompt.moveLeft()
    })
    this.add('insert', '<right>', () => {
      return prompt.moveRight()
    })
    this.add('insert', ['<end>', '<C-e>'], () => {
      return prompt.moveToEnd()
    })
    this.add('insert', ['<home>', '<C-a>'], () => {
      return prompt.moveToStart()
    })
    this.add('insert', ['<C-h>', '<bs>'], () => {
      return prompt.onBackspace()
    })
    this.add('insert', '<C-w>', () => {
      return prompt.removeWord()
    })
    this.add('insert', '<C-u>', () => {
      return prompt.removeAhead()
    })
    this.add('insert', ['<down>', nextKey], () => {
      return manager.normal('j')
    })
    this.add('insert', ['<up>', previousKey], () => {
      return manager.normal('k')
    })
    this.add('insert', ['<ScrollWheelUp>'], this.onScroll.bind(this, '<ScrollWheelUp>'))
    this.add('insert', ['<ScrollWheelDown>'], this.onScroll.bind(this, '<ScrollWheelDown>'))
    this.add('insert', ['<C-f>'], this.doScroll.bind(this, '<C-f>'))
    this.add('insert', ['<C-b>'], this.doScroll.bind(this, '<C-b>'))

    // not allowed
    this.add('normal', '<C-o>', () => {
      return
    })
    this.add('normal', ['<cr>', '<C-m>'], () => {
      return manager.doAction()
    })
    this.add('normal', ' ', () => {
      return manager.ui.toggleSelection()
    })
    this.add('normal', 'p', () => {
      return manager.togglePreview()
    })
    this.add('normal', ['\t', '<C-i>'], () => {
      return manager.chooseAction()
    })
    this.add('normal', '<C-c>', () => {
      return manager.stop()
    })
    this.add('normal', '<esc>', () => {
      return manager.cancel()
    })
    this.add('normal', '<C-l>', () => {
      return manager.worker.loadItems(true)
    })
    this.add('normal', ['i', 'I', 'o', 'O', 'a', 'A'], () => {
      return manager.toggleMode()
    })
    this.add('normal', ':', async () => {
      await manager.cancel(false)
      await nvim.eval('feedkeys(":")')
      return
    })
    this.add('normal', ['<ScrollWheelUp>'], this.onScroll.bind(this, '<ScrollWheelUp>'))
    this.add('normal', ['<ScrollWheelDown>'], this.onScroll.bind(this, '<ScrollWheelDown>'))
    this.add('normal', ['<C-f>'], this.doScroll.bind(this, '<C-f>'))
    this.add('normal', ['<C-b>'], this.doScroll.bind(this, '<C-b>'))
  }

  public async doInsertKeymap(key: string): Promise<boolean> {
    let insertMappings = this.manager.getConfig<any>('insertMappings', {})
    let expr = insertMappings[key]
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
    let normalMappings = this.manager.getConfig<any>('normalMappings', {})
    let expr = normalMappings[key]
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
    await nvim.call('coc#list#stop_prompt', [])
    workspace.showMessage(msg, 'error')
    this.manager.prompt.start()
  }

  private async evalExpression(expr: string, _mode: string): Promise<void> {
    if (typeof expr != 'string' || expr.indexOf(':') == -1) {
      await this.onError(`Invalid expression ${expr}`)
      return
    }
    let { manager } = this
    let { prompt } = manager
    let [key, action] = expr.split(':', 2)
    if (key == 'do') {
      switch (action) {
        case 'refresh':
          await manager.worker.loadItems()
          return
        case 'exit':
          await manager.cancel(true)
          return
        case 'stop':
          manager.stop()
          return
        case 'cancel':
          await manager.cancel(false)
          return
        case 'toggle':
          await manager.ui.toggleSelection()
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
        default:
          await this.onError(`'${action}' not supported`)
      }
    } else if (key == 'prompt') {
      switch (action) {
        case 'previous':
          manager.history.previous()
          return
        case 'next':
          manager.history.next()
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
        default:
          await this.onError(`prompt '${action}' not supported`)
      }
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
    let { nvim, manager } = this
    let winid = manager.ui.window.id
    let winnr = await nvim.call('coc#util#has_preview')
    if (winnr) {
      await nvim.call('coc#list#stop_prompt', [])
      await nvim.command(`${winnr}wincmd w`)
      await nvim.command(`call eval('feedkeys("\\${key}")')`)
      await nvim.call('win_gotoid', winid)
      this.manager.prompt.start()
    } else {
      await manager.feedkeys(key)
    }
  }

  private async onScroll(key: string): Promise<void> {
    let { manager } = this
    await manager.feedkeys(key)
  }
}
