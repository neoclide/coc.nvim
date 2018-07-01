import {Disposable, Location, Position} from 'vscode-languageserver-protocol'
import {Neovim} from 'neovim'
import * as language from 'vscode-languageserver-protocol'
import workspace from './workspace'
const logger = require('./util/logger')('commands')

// command center
export interface Command {
  readonly id: string | string[]
  execute(...args: any[]): void | Promise<void>
}

class CommandItem implements Disposable {
  constructor(
    public id:string,
    private impl: (...args: any[]) => void,
    private thisArg: any
  ) {
  }

  public execute(args: any[]):void {
    let {impl, thisArg} = this
    impl.apply(thisArg, args || [])
  }

  public dispose():void {
    this.thisArg = null
    this.impl = null
  }
}

export class CommandManager implements Disposable {
  private readonly commands = new Map<string, CommandItem>()

  public init(nvim:Neovim):void {
    this.register({
      id: 'editor.action.triggerSuggest',
      execute: () => {
        setTimeout(() => {
          nvim.call('coc#start').catch(e => {
            logger.error(e.stack)
          })
        }, 30)
      }
    })
    this.register({
      id: 'editor.action.showReferences',
      execute: async (_filepath:string, _position:Position, references:Location[]) => {
        try {
          let show = await nvim.getVar('coc_show_quickfix')
          let items = await Promise.all(references.map(loc => {
            return workspace.getQuickfixItem(loc)
          }))
          await nvim.call('setqflist', [items, 'r', 'Results of references'])
          if (show) await nvim.command('copen')
          await nvim.command('doautocmd User CocQuickfixChange')
        } catch (e) {
          logger.error(e.stack)
        }
      }
    })
  }

  public dispose():void {
    for (const registration of this.commands.values()) {
      registration.dispose()
    }
    this.commands.clear()
  }

  public execute(command: language.Command):void {
    let cmd = this.commands.get(command.command)
    if (!cmd) return
    cmd.execute(command.arguments)
  }

  public register<T extends Command>(command: T): T {
    for (const id of Array.isArray(command.id) ? command.id : [command.id]) {
      this.registerCommand(id, command.execute, command)
    }
    return command
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
  public registerCommand(id: string, impl: (...args: any[]) => void, thisArg?: any):Disposable {
    if (this.commands.has(id)) {
      return
    }
    this.commands.set(id, new CommandItem(id, impl, thisArg))
    return Disposable.create(() => {
      this.commands.delete(id)
    })
  }

 /**
  * Executes the command denoted by the given command identifier.
  *
  * * *Note 1:* When executing an editor command not all types are allowed to
  * be passed as arguments. Allowed are the primitive types `string`, `boolean`,
  * `number`, `undefined`, and `null`, as well as [`Position`](#Position), [`Range`](#Range), [`Uri`](#Uri) and [`Location`](#Location).
  * * *Note 2:* There are no restrictions when executing commands that have been contributed
  * by extensions.
  *
  * @param command Identifier of the command to execute.
  * @param rest Parameters passed to the command function.
  * @return A thenable that resolves to the returned value of the given command. `undefined` when
  * the command handler function doesn't return anything.
  */
  public executeCommand(command: string, ...rest: any[]): Promise<void> {
    let cmd = this.commands.get(command)
    if (!cmd) {
      return
    }
    return Promise.resolve(cmd.execute.apply(cmd, rest))
  }

}

export default new CommandManager()
