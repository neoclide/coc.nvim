import { Neovim } from '@chemzqm/neovim'
import commandManager from '../commands'
import events from '../events'
import { Env } from '../types'
import listManager from '../list/manager'
const logger = require('../util/logger')('handler-commands')
const isVim = process.env.VIM_NODE_RPC == '1'

interface CommandItem {
  id: string
  title: string
}

export default class Commands {
  constructor(private nvim: Neovim, private env: Readonly<Env>) {
    for (let item of env.vimCommands) {
      this.addVimCommand(item)
    }
  }

  public addVimCommand(cmd: { id: string; cmd: string; title?: string }): void {
    let id = `vim.${cmd.id}`
    commandManager.registerCommand(id, () => {
      this.nvim.command(cmd.cmd, true)
      if (isVim) this.nvim.command('redraw', true)
    })
    if (cmd.title) commandManager.titles.set(id, cmd.title)
  }

  public getCommandList(): string[] {
    return commandManager.commandList.map(o => o.id)
  }

  public async repeat(): Promise<void> {
    await commandManager.repeatCommand()
  }

  public async runCommand(id?: string, ...args: any[]): Promise<any> {
    if (id) {
      // needed to load onCommand extensions
      await events.fire('Command', [id])
      let res = await commandManager.executeCommand(id, ...args)
      if (args.length == 0) {
        await commandManager.addRecent(id)
      }
      return res
    } else {
      await listManager.start(['commands'])
    }
  }

  public getCommands(): CommandItem[] {
    let list = commandManager.commandList
    let res: CommandItem[] = []
    let { titles } = commandManager
    for (let item of list) {
      res.push({
        id: item.id,
        title: titles.get(item.id) || ''
      })
    }
    return res
  }
}
