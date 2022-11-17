'use strict'
import { Neovim } from '@chemzqm/neovim'
import commandManager from '../commands'
import listManager from '../list/manager'
import workspace from '../workspace'

export default class Commands {
  constructor(private nvim: Neovim) {
    for (let item of workspace.env.vimCommands) {
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
