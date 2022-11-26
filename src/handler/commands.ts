'use strict'
import { Neovim } from '@chemzqm/neovim'
import commandManager from '../commands'
import listManager from '../list/manager'
import workspace from '../workspace'
import * as Is from '../util/is'

function validCommand(command: any): boolean {
  return command && Is.string(command.id) && Is.string(command.cmd) && command.id.length > 0 && command.cmd.length > 0
}

export default class Commands {
  constructor(private nvim: Neovim) {
    for (let item of workspace.env.vimCommands) {
      this.addVimCommand(item)
    }
  }

  public addVimCommand(cmd: { id: string; cmd: string; title?: string }): void {
    if (!validCommand(cmd)) return
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
