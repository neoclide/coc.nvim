import { TextDocumentWillSaveEvent } from '../types'
import Document from './document'
import { Disposable, TextEdit } from 'vscode-languageserver-protocol'
import { BaseLanguageClient } from '../language-client/main'
import { Neovim } from '@chemzqm/neovim'
const logger = require('../util/logger')('willSaveHandler')

export type Callback = (event: TextDocumentWillSaveEvent) => void
export type PromiseCallback = (event: TextDocumentWillSaveEvent) => Promise<void>

export default class WillSaveUntilHandler {
  private callbacks: PromiseCallback[] = []

  constructor(
    private nvim:Neovim,
    private getDocument:(uri:string) => Document) {
  }

  public addCallback(callback: Callback, thisArg: any, client: BaseLanguageClient): Disposable {
    let {nvim} = this
    let fn = (event: TextDocumentWillSaveEvent): Promise<void> => {
      let ev: TextDocumentWillSaveEvent = Object.assign({}, event)
      return new Promise(resolve => {
        let called = false
        let timer = setTimeout(() => {
          // tslint:disable-next-line:no-console
          console.error(`${client.id} timeout after 500ms`)
          resolve(null)
        }, 500)
        ev.waitUntil = (thenable): void => {
          called = true
          let { document } = ev
          Promise.resolve(thenable).then((edits: TextEdit[]) => {
            clearTimeout(timer)
            if (edits && edits.length && TextEdit.is(edits[0])) {
              let doc = this.getDocument(document.uri)
              if (doc) {
                doc.applyEdits(nvim, edits).then(() => {
                  resolve(null)
                }, e => {
                  // tslint:disable-next-line:no-console
                  console.error(`${client.id} error on applyEdits ${e.message}`)
                  resolve(null)
                })
              }
            } else {
              resolve(null)
            }
          }, e => {
            clearTimeout(timer)
            // tslint:disable-next-line:no-console
            console.error(`${client.id} error on willSaveUntil ${e.message}`)
            resolve(null)
          })
        }
        callback.call(thisArg, ev)
        if (!called) {
          clearTimeout(timer)
          resolve(null)
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
    let { callbacks } = this
    let {document} = event
    for (let fn of callbacks) {
      let doc = this.getDocument(document.uri)
      event.document = doc.textDocument
      await fn(event)
    }
  }
}
