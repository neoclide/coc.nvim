import { Neovim } from '@chemzqm/neovim'
import { Disposable, TextEdit } from 'vscode-languageserver-protocol'
import { IWorkspace, TextDocumentWillSaveEvent } from '../types'
import { echoErr } from '../util'
const logger = require('../util/logger')('willSaveHandler')

export type Callback = (event: TextDocumentWillSaveEvent) => void
export type PromiseCallback = (event: TextDocumentWillSaveEvent) => Promise<void>

export default class WillSaveUntilHandler {
  private callbacks: PromiseCallback[] = []

  constructor(private workspace: IWorkspace) {
  }

  private get nvim(): Neovim {
    return this.workspace.nvim
  }

  public addCallback(callback: Callback, thisArg: any, clientId: string): Disposable {
    let { nvim } = this
    let fn = (event: TextDocumentWillSaveEvent): Promise<void> => {
      let ev: TextDocumentWillSaveEvent = Object.assign({}, event)
      return new Promise(resolve => {
        let called = false
        ev.waitUntil = (thenable): void => {
          called = true
          let { document } = ev
          let timer = setTimeout(() => {
            echoErr(nvim, `${clientId} will save operation timeout after 0.5s`)
            resolve(null)
          }, 500)
          Promise.resolve(thenable).then((edits: TextEdit[]) => {
            clearTimeout(timer)
            let doc = this.workspace.getDocument(document.uri)
            if (doc && edits && TextEdit.is(edits[0])) {
              doc.applyEdits(nvim, edits).then(() => {
                // make sure server received ChangedText
                setTimeout(resolve, 100)
              }, e => {
                echoErr(nvim, `${clientId} error on applyEdits ${e.message}`)
                resolve()
              })
            } else {
              resolve()
            }
          }, e => {
            clearTimeout(timer)
            echoErr(nvim, `${clientId} error on willSaveUntil ${e.message}`)
            resolve()
          })
        }
        callback.call(thisArg, ev)
        if (!called) {
          resolve()
        }
      })
    }
    this.callbacks.push(fn)
    return Disposable.create(() => {
      let idx = this.callbacks.indexOf(fn)
      if (idx != -1) {
        this.callbacks.splice(idx, 1)
      }
    })
  }

  public async handeWillSaveUntil(event: TextDocumentWillSaveEvent): Promise<void> {
    let { callbacks, workspace } = this
    let { document } = event
    for (let fn of callbacks) {
      let doc = workspace.getDocument(document.uri)
      event.document = doc.textDocument
      try {
        await fn(event)
      } catch (e) {
        logger.error(e)
      }
    }
  }
}
