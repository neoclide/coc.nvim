'use strict'
import { Neovim } from '@chemzqm/neovim'
import commandManager from '../commands'
import listManager from '../list/manager'
import { Env } from '../types'
const logger = require('../util/logger')('handler-commands')

export default class Commands {
  constructor(private nvim: Neovim, env: Readonly<Env>) {
    for (let item of env.vimCommands) {
      this.addVimCommand(item)
    }
  }

  public addVimCommand(cmd: { id: string; cmd: string; title?: string }): void {
    let id = `vim.${cmd.id}`
    commandManager.registerCommand(id, () => {
      this.nvim.command(cmd.cmd, true)
      this.nvim.redrawVim()
    })
    if (cmd.title) commandManager.titles.set(id, cmd.title)
  }

  public getCommandList(): string[] {
    return commandManager.commandList.map(o => o.id)
  }

  public async repeat(): Promise<void> {
    await commandManager.repeatCommand()
  }

  public async runCommand(id?: string, ...args: any[]): Promise<unknown> {
    if (id) return await commandManager.fireCommand(id, ...args)
    await listManager.start(['commands'])
  }
}
