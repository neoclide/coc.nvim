import events from '../events'
import { Disposable, disposeAll } from '../util'
import { Emitter, Event } from '../util/protocol'

let tab_global_id = 3000
function generateTabId(): number {
  return tab_global_id++
}

export class Tabs {
  private tabIds: number[] = []
  private readonly _onDidTabClose = new Emitter<number>()
  public readonly onDidTabClose: Event<number> = this._onDidTabClose.event
  private disposables: Disposable[] = []
  constructor() {
    events.on('TabNew', (nr: number) => {
      this.tabIds.splice(nr - 1, 0, generateTabId())
    }, null, this.disposables)
    events.on('TabClosed', (nr: number) => {
      let id = this.tabIds[nr - 1]
      this.tabIds.splice(nr - 1, 1)
      if (id) this._onDidTabClose.fire(id)
    }, null, this.disposables)
  }

  public init(tabCount): void {
    for (let i = 1; i <= tabCount; i++) {
      this.tabIds.push(generateTabId())
    }
  }

  public getTabNumber(id: number): number | undefined {
    if (!this.tabIds.includes(id)) return undefined
    return this.tabIds.indexOf(id) + 1
  }

  public getTabId(nr: number): number | undefined {
    return this.tabIds[nr - 1]
  }

  public dispose(): void {
    disposeAll(this.disposables)
  }
}
