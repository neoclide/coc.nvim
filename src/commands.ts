import {Disposable} from 'vscode-languageserver-protocol'

// command center
export interface Command {
  readonly id: string | string[]

  execute(...args: any[]): void
}

class CommandItem implements Disposable {
  constructor(
    public id:string,
    private impl: (...args: any[]) => void,
    private thisArg: any
  ) {
  }

  public execute(...args: any[]):void {
    let {impl, thisArg} = this
    impl.apply(thisArg, args)
  }

  public dispose():void {
    this.thisArg = null
    this.impl = null
  }
}

export class CommandManager implements Disposable {
  private readonly commands = new Map<string, CommandItem>()

  public dispose():void {
    for (const registration of this.commands.values()) {
      registration.dispose()
    }
    this.commands.clear()
  }

  public executeCommand(title:string, args: any[]):void {
    let cmd = this.commands.get(title)
    if (!cmd) return
    cmd.execute(args)
  }

  public register<T extends Command>(command: T): T {
    for (const id of Array.isArray(command.id) ? command.id : [command.id]) {
      this.registerCommand(id, command.execute, command)
    }
    return command
  }

  private registerCommand(id: string, impl: (...args: any[]) => void, thisArg?: any):void {
    if (this.commands.has(id)) {
      return
    }
    this.commands.set(id, new CommandItem(id, impl, thisArg))
  }
}

export default new CommandManager()
