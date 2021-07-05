import { Neovim } from '@chemzqm/neovim'
import { CallHierarchyItem, CancellationTokenSource, Location } from 'vscode-languageserver-protocol'
import languages from '../languages'
import { HandlerDelegate } from '../types'
import workspace from '../workspace'

export default class CallHierarchyHandler {
  constructor(private nvim: Neovim, private handler: HandlerDelegate) {
  }

  public async showLocations(method: 'incoming' | 'outgoing'): Promise<boolean> {
    const { doc, position } = await this.handler.getCurrentState()
    this.handler.checkProvier('callHierarchy', doc.textDocument)
    await doc.synchronize()
    const source = new CancellationTokenSource()
    const res = await languages.prepareCallHierarchy(doc.textDocument, position, source.token)
    if (!res || source.token.isCancellationRequested) return false
    const calls: CallHierarchyItem[] = []
    const item = Array.isArray(res) ? res[0] : res
    if (method === 'incoming') {
      const incomings = await languages.provideIncomingCalls(item, source.token)
      for (const call of incomings) {
        calls.push(call.from)
      }
    } else {
      const outgoings = await languages.provideOutgoingCalls(item, source.token)
      if (!outgoings) return
      for (const call of outgoings) {
        calls.push(call.to)
      }
    }
    if (!calls) return false
    // TODO: callHierarchy tree UI?
    const locations: Location[] = []
    for (const call of calls) {
      locations.push({ uri: call.uri, range: call.range })
    }
    await workspace.showLocations(locations)
    return true
  }
}
