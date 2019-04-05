import { Neovim } from '@chemzqm/neovim'
import { ListManager } from './manager'
import { WorkspaceConfiguration, ListMode } from '../types'
import workspace from '../workspace'
const logger = require('../util/logger')('list-mappings')

const validKeys = [
  '<esc>',
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

export default class Mappings {
  private insertMappings: Map<string, () => void | Promise<void>> = new Map()
  private normalMappings: Map<string, () => void | Promise<void>> = new Map()
  private userInsertMappings: Map<string, string> = new Map()
  private userNormalMappings: Map<string, string> = new Map()

  constructor(private manager: ListManager,
    private nvim: Neovim,
    private config: WorkspaceConfiguration) {
    let nextKey = config.get<string>('nextKeymap', '<C-j>')
    let previousKey = config.get<string>('previousKeymap', '<C-k>')
    let { prompt } = manager

    this.add('insert', ' ', () => {
      return prompt.insertCharacter(' ')
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
    this.add('insert', ['<tab>', '<C-i>', '\t'], () => {
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
    this.add('insert', ['<ScrollWheelUp>'], this.doScroll.bind(this, '<ScrollWheelUp>'))
    this.add('insert', ['<ScrollWheelDown>'], this.doScroll.bind(this, '<ScrollWheelDown>'))
    this.add('insert', ['<C-f>'], this.doScroll.bind(this, '<C-f>'))
    this.add('insert', ['<C-b>'], this.doScroll.bind(this, '<C-b>'))

    // not allowed
    this.add('normal', '<C-o>', () => {
      return
    })
    this.add('normal', 't', () => {
      manager.doAction('tabe').catch(e => {
        logger.error(e)
      })
    })
    this.add('normal', 's', () => {
      manager.doAction('split').catch(e => {
        logger.error(e)
      })
    })
    this.add('normal', 'd', () => {
      manager.doAction('drop').catch(e => {
        logger.error(e)
      })
    })
    this.add('normal', ['<cr>', '<C-m>', '\r'], () => {
      manager.doAction().catch(e => {
        logger.error(e)
      })
    })
    this.add('normal', '<C-a>', () => {
      manager.ui.selectAll().catch(e => {
        logger.error(e)
      })
    })
    this.add('normal', ' ', () => {
      manager.ui.toggleSelection().catch(e => {
        logger.error(e)
      })
    })
    this.add('normal', 'p', () => {
      manager.togglePreview().catch(e => {
        logger.error(e)
      })
    })
    this.add('normal', ['<tab>', '\t', '<C-i>'], () => {
      manager.chooseAction().catch(e => {
        logger.error(e)
      })
    })
    this.add('normal', '<C-c>', () => {
      manager.stop()
    })
    this.add('normal', '<esc>', () => {
      manager.cancel().catch(e => {
        logger.error(e)
      })
    })
    this.add('normal', '<C-l>', () => {
      manager.worker.loadItems(true).catch(e => {
        logger.error(`Error or reload items:`, e)
      })
    })
    this.add('normal', ['i', 'I', 'o', 'O', 'a', 'A'], () => {
      manager.toggleMode()
    })
    this.add('normal', '?', async () => {
      await manager.showHelp()
    })
    this.add('normal', ':', async () => {
      await manager.cancel(false)
      await nvim.eval('feedkeys(":")')
    })
    this.add('normal', ['<ScrollWheelUp>'], this.doScroll.bind(this, '<ScrollWheelUp>'))
    this.add('normal', ['<ScrollWheelDown>'], this.doScroll.bind(this, '<ScrollWheelDown>'))
    let insertMappings = this.manager.getConfig<any>('insertMappings', {})
    this.userInsertMappings = this.fixUserMappings(insertMappings)
    let normalMappings = this.manager.getConfig<any>('normalMappings', {})
    this.userNormalMappings = this.fixUserMappings(normalMappings)
    workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('list')) {
        let config = workspace.getConfiguration('list')
        let insertMappings = config.get<any>('insertMappings', {})
        this.userInsertMappings = this.fixUserMappings(insertMappings)
        let normalMappings = config.get<any>('normalMappings', {})
        this.userNormalMappings = this.fixUserMappings(normalMappings)
      }
    })
  }

  private fixUserMappings(mappings: { [key: string]: string }): Map<string, string> {
    let res: Map<string, string> = new Map()
    for (let [key, value] of Object.entries(mappings)) {
      if (key.length == 1) {
        res.set(key, value)
      } else if (key.startsWith('<') && key.endsWith('>')) {
        if (validKeys.indexOf(key) != -1) {
          res.set(key, value)
        } else {
          let find = false
          // tslint:disable-next-line: prefer-for-of
          for (let i = 0; i < validKeys.length; i++) {
            if (validKeys[i].toLowerCase() == key.toLowerCase()) {
              find = true
              res.set(validKeys[i], value)
              break
            }
          }
          if (!find) workspace.showMessage(`Invalid mappings key: ${key}`, 'error')
        }
      } else {
        // tslint:disable-next-line: no-console
        workspace.showMessage(`Invalid mappings key: ${key}`, 'error')
      }
    }
    return res
  }

  public async doInsertKeymap(key: string): Promise<boolean> {
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
        case 'selectall':
          await manager.ui.selectAll()
          return
        case 'help':
          await manager.showHelp()
          return
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
    await this.manager.feedkeys(key)
  }
}
