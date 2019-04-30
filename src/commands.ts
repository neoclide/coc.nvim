import { Neovim } from '@chemzqm/neovim'
import * as language from 'vscode-languageserver-protocol'
import { Disposable, Location, Position, TextEdit, CodeAction } from 'vscode-languageserver-protocol'
import { wait } from './util'
import workspace from './workspace'
import Plugin from './plugin'
import snipetsManager from './snippets/manager'
import URI from 'vscode-uri'
const logger = require('./util/logger')('commands')

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
    public internal = false
  ) {
  }

  public execute(...args: any[]): void | Promise<any> {
    let { impl, thisArg } = this
    return impl.apply(thisArg, args || [])
  }

  public dispose(): void {
    this.thisArg = null
    this.impl = null
  }
}

export class CommandManager implements Disposable {
  private readonly commands = new Map<string, CommandItem>()

  public init(nvim: Neovim, plugin: Plugin): void {
    this.register({
      id: 'vscode.open',
      execute: async (url: string | URI) => {
        nvim.call('coc#util#open_url', url.toString(), true)
      }
    }, true)
    this.register({
      id: 'workbench.action.reloadWindow',
      execute: () => {
        nvim.command('CocRestart', true)
      }
    }, true)
    this.register({
      id: 'editor.action.insertSnippet',
      execute: async (edit: TextEdit) => {
        let doc = workspace.getDocument(workspace.bufnr)
        if (!doc) return
        await nvim.call('coc#_cancel', [])
        if (doc.dirty) doc.forceSync()
        await snipetsManager.insertSnippet(edit.newText, true, edit.range)
      }
    }, true)
    this.register({
      id: 'editor.action.doCodeAction',
      execute: async (action: CodeAction) => {
        await plugin.cocAction('doCodeAction', action)
      }
    }, true)
    this.register({
      id: 'editor.action.triggerSuggest',
      execute: async () => {
        await wait(100)
        nvim.call('coc#start', [], true)
      }
    }, true)
    this.register({
      id: 'editor.action.triggerParameterHints',
      execute: async () => {
        await wait(60)
        await plugin.cocAction('showSignatureHelp')
      }
    }, true)
    this.register({
      id: 'editor.action.restart',
      execute: async () => {
        await wait(30)
        nvim.command('CocRestart', true)
      }
    }, true)
    this.register({
      id: 'editor.action.showReferences',
      execute: async (_filepath: string, _position: Position, references: Location[]) => {
        await workspace.showLocations(references)
      }
    }, true)
    this.register({
      id: 'editor.action.rename',
      execute: async (uri: string, position: Position) => {
        await workspace.jumpTo(uri, position)
        await plugin.cocAction('rename')
      }
    }, true)
    this.register({
      id: 'editor.action.format',
      execute: async () => {
        await plugin.cocAction('format')
      }
    }, true)
    this.register({
      id: 'workspace.diffDocument',
      execute: async () => {
        let document = await workspace.document
        if (!document) return
        let lines = document.content.split('\n')
        await nvim.call('coc#util#diff_content', [lines])
      }
    }, true)
    this.register({
      id: 'workspace.clearWatchman',
      execute: async () => {
        await workspace.runCommand('watchman watch-del-all')
      }
    })
    this.register({
      id: 'workspace.workspaceFolders',
      execute: async () => {
        let folders = workspace.workspaceFolders
        let lines = folders.map(folder => URI.parse(folder.uri).fsPath)
        await workspace.echoLines(lines)
      }
    })
    this.register({
      id: 'workspace.renameCurrentFile',
      execute: async () => {
        await workspace.renameCurrent()
      }
    })
    this.register({
      id: 'workspace.showOutput',
      execute: async (name?: string) => {
        if (name) {
          workspace.showOutputChannel(name)
        } else {
          let names = workspace.channelNames
          if (names.length == 0) return
          if (names.length == 1) {
            workspace.showOutputChannel(names[0])
          } else {
            let idx = await workspace.showQuickpick(names)
            if (idx == -1) return
            let name = names[idx]
            workspace.showOutputChannel(name)
          }
        }
      }
    })
  }

  public get commandList(): CommandItem[] {
    let res: CommandItem[] = []
    for (let item of this.commands.values()) {
      if (!item.internal) res.push(item)
    }
    return res
  }

  public dispose(): void {
    for (const registration of this.commands.values()) {
      registration.dispose()
    }
    this.commands.clear()
  }

  public execute(command: language.Command): void {
    let args = [command.command]
    let arr = command.arguments
    if (arr) args.push(...arr)
    this.executeCommand.apply(this, args)
  }

  public register<T extends Command>(command: T, internal = false): T {
    for (const id of Array.isArray(command.id) ? command.id : [command.id]) {
      this.registerCommand(id, command.execute, command, internal)
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
  public registerCommand(id: string, impl: (...args: any[]) => void, thisArg?: any, internal = false): Disposable {
    if (/^_/.test(id)) internal = true
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
   * `number`, `undefined`, and `null`, as well as [`Position`](#Position), [`Range`](#Range), [`Uri`](#Uri) and [`Location`](#Location).
   * * *Note 2:* There are no restrictions when executing commands that have been contributed
   * by extensions.
   *
   * @param command Identifier of the command to execute.
   * @param rest Parameters passed to the command function.
   * @return A promise that resolves to the returned value of the given command. `undefined` when
   * the command handler function doesn't return anything.
   */
  public executeCommand(command: string, ...rest: any[]): Promise<any> {
    let cmd = this.commands.get(command)
    if (!cmd) {
      workspace.showMessage(`Command: ${command} not found`, 'error')
      return
    }
    return Promise.resolve(cmd.execute.apply(cmd, rest)).catch(e => {
      workspace.showMessage(`Command error: ${e.message}`, 'error')
      logger.error(e.stack)
    })
  }
}

export default new CommandManager()
