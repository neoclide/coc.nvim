'use strict'
import { Neovim } from '@chemzqm/neovim'
import { Command as VCommand } from 'vscode-languageserver-types'
import events from './events'
import { createLogger } from './logger'
import Mru from './model/mru'
import { toArray } from './util/array'
import { Extensions as ExtensionsInfo, IExtensionRegistry } from './util/extensionRegistry'
import { Disposable } from './util/protocol'
import { Registry } from './util/registry'
import { toText } from './util/string'
const logger = createLogger('commands')

// command center
export interface Command {
  readonly id: string | string[]
  execute(...args: any[]): void | Promise<any>
}

class CommandItem implements Disposable, Command {
  constructor(
    public id: string,
    private impl: (...args: any[]) => void,
    private thisArg: any,
    public internal: boolean
  ) {
  }

  public execute(...args: any[]): void | Promise<any> {
    let { impl, thisArg } = this
    return impl.apply(thisArg, toArray(args))
  }

  public dispose(): void {
    this.thisArg = null
    this.impl = null
  }
}

const extensionRegistry = Registry.as<IExtensionRegistry>(ExtensionsInfo.ExtensionContribution)

class CommandManager implements Disposable {
  private readonly commands = new Map<string, CommandItem>()
  public titles = new Map<string, string>()
  private mru = new Mru('commands')
  public nvim: Neovim

  public get commandList(): { id: string, title: string }[] {
    let res: { id: string, title: string }[] = []
    for (let item of this.commands.values()) {
      if (!item.internal) {
        let { id } = item
        let title = this.titles.get(id) ?? extensionRegistry.getCommandTitle(id)
        res.push({ id, title: toText(title) })
      }
    }
    return res
  }

  public dispose(): void {
    for (const registration of this.commands.values()) {
      registration.dispose()
    }
    this.commands.clear()
  }

  public execute(command: VCommand): Promise<any> {
    return this.executeCommand(command.command, ...(command.arguments ?? []))
  }

  public register<T extends Command>(command: T, internal: boolean, description?: string): T {
    for (const id of Array.isArray(command.id) ? command.id : [command.id]) {
      this.registerCommand(id, command.execute, command, internal)
      if (description) this.titles.set(id, description)
    }
    return command
  }

  public has(id: string): boolean {
    return this.commands.has(id)
  }

  public unregister(id: string): void {
    let item = this.commands.get(id)
    if (!item) return
    item.dispose()
    this.commands.delete(id)
  }

  /**
   * Registers a command that can be invoked via a keyboard shortcut,
   * a menu item, an action, or directly.
   *
   * Registering a command with an existing command identifier twice
   * will cause an error.
   *
   * @param command A unique identifier for the command.
   * @param impl A command handler function.
   * @param thisArg The `this` context used when invoking the handler function.
   * @return Disposable which unregisters this command on disposal.
   */
  public registerCommand<T>(id: string, impl: (...args: any[]) => T | Promise<T>, thisArg?: any, internal = false): Disposable {
    if (id.startsWith("_")) internal = true
    if (this.commands.has(id)) logger.warn(`Command ${id} already registered`)
    this.commands.set(id, new CommandItem(id, impl, thisArg, internal))
    return Disposable.create(() => {
      this.commands.delete(id)
    })
  }

  /**
   * Executes the command denoted by the given command identifier.
   *
   * * *Note 1:* When executing an editor command not all types are allowed to
   * be passed as arguments. Allowed are the primitive types `string`, `boolean`,
   * `number`, `undefined`, and `null`, as well as [`Position`](#Position), [`Range`](#Range), [`URI`](#URI) and [`Location`](#Location).
   * * *Note 2:* There are no restrictions when executing commands that have been contributed
   * by extensions.
   *
   * @param command Identifier of the command to execute.
   * @param rest Parameters passed to the command function.
   * @return A promise that resolves to the returned value of the given command. `undefined` when
   * the command handler function doesn't return anything.
   */
  public executeCommand<T>(command: string, ...rest: any[]): Promise<T> {
    let cmd = this.commands.get(command)
    if (!cmd) throw new Error(`Command: ${command} not found`)
    return Promise.resolve(cmd.execute.apply(cmd, rest))
  }

  /**
   * Used for user invoked command.
   */
  public async fireCommand(id: string, ...args: any[]): Promise<unknown> {
    // needed to load onCommand extensions
    await events.fire('Command', [id])
    let start = Date.now()
    let res = await this.executeCommand(id, ...args)
    if (args.length == 0) {
      await this.addRecent(id, events.lastChangeTs > start)
    }
    return res
  }

  public async addRecent(cmd: string, repeat: boolean): Promise<void> {
    await this.mru.add(cmd)
    if (repeat) this.nvim.command(`silent! call repeat#set("\\<Plug>(coc-command-repeat)", -1)`, true)
  }

  public async repeatCommand(): Promise<void> {
    let mruList = await this.mru.load()
    let first = mruList[0]
    if (first) {
      await this.executeCommand(first)
      await this.nvim.command(`silent! call repeat#set("\\<Plug>(coc-command-repeat)", -1)`)
    }
  }
}

export default new CommandManager()
