import { Disposable, TextEdit } from 'vscode-languageserver-protocol'
import { IWorkspace, TextDocumentWillSaveEvent } from '../types'
import { wait } from '../util'
import window from '../window'
const logger = require('../util/logger')('willSaveHandler')

export type Callback = (event: TextDocumentWillSaveEvent) => void
export type PromiseCallback = (event: TextDocumentWillSaveEvent) => Promise<void>

export default class WillSaveUntilHandler {
  private callbacks: PromiseCallback[] = []

  constructor(private workspace: IWorkspace) {
  }

  public addCallback(callback: Callback, thisArg: any, clientId: string): Disposable {
    let fn = (event: TextDocumentWillSaveEvent): Promise<void> => {
      let { workspace } = this
      let ev: TextDocumentWillSaveEvent = Object.assign({}, event)
      return new Promise(resolve => {
        let called = false
        ev.waitUntil = (thenable): void => {
          called = true
          let { document } = ev
          let timer = setTimeout(() => {
            window.showMessage(`${clientId} will save operation timeout after 0.5s`, 'warning')
            resolve(null)
          }, 500)
          Promise.resolve(thenable).then((edits: TextEdit[]) => {
            clearTimeout(timer)
            let doc = workspace.getDocument(document.uri)
            if (doc && edits && TextEdit.is(edits[0])) {
              doc.applyEdits(edits).then(() => {
                // make sure server received ChangedText
                setTimeout(resolve, 50)
              }, e => {
                logger.error(e)
                window.showMessage(`${clientId} error on applyEdits ${e.message}`, 'error')
                resolve()
              })
            } else {
              resolve()
            }
          }, e => {
            clearTimeout(timer)
            logger.error(`${clientId} error on willSaveUntil ${e.message}`, 'error')
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

  public get hasCallback(): boolean {
    let { callbacks } = this
    return callbacks.length > 0
  }

  public async handeWillSaveUntil(event: TextDocumentWillSaveEvent): Promise<void> {
    let { callbacks, workspace } = this
    let { document } = event
    if (!callbacks.length) return
    let doc = workspace.getDocument(document.uri)
    if (!doc) return
    let now = Date.now()
    await doc.patchChange()
    await wait(60)
    for (let fn of callbacks) {
      event.document = doc.textDocument
      try {
        await fn(event)
      } catch (e) {
        logger.error(e)
      }
    }
    logger.info(`Will save cost: ${Date.now() - now}`)
  }
}
