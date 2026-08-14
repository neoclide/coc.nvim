'use strict'
import {
  createProtocolConnection,
  DidChangeTextDocumentNotification,
  DidCloseTextDocumentNotification,
  DidOpenTextDocumentNotification,
  DidSaveTextDocumentNotification,
  ExitNotification,
  InitializeParams,
  InitializeRequest,
  InitializeResult,
  LSPErrorCodes,
  Position,
  RegistrationRequest,
  ResponseError,
  ShutdownRequest,
  TextDocumentSyncKind,
  TextEdit,
  UnregistrationRequest,
  WillSaveTextDocumentNotification,
  WillSaveTextDocumentWaitUntilRequest,
} from 'vscode-languageserver-protocol'
import { StreamMessageReader, StreamMessageWriter } from 'vscode-languageserver-protocol/node'
import { TextDocument } from 'vscode-languageserver-textdocument'

/**
 * In-process twin of testDocuments.js built on createProtocolConnection, so
 * text-synchronization tests skip a child-process spawn and LSP handshake per
 * test (a real vscode-languageserver/node process cannot run inside the editor
 * worker). It replicates the document lifecycle events and dynamic
 * registration surface over injected streams.
 */
export function createInProcessTestDocumentsServer(input: NodeJS.ReadableStream, output: NodeJS.WritableStream): void {
  const connection = createProtocolConnection(
    new StreamMessageReader(input),
    new StreamMessageWriter(output)
  )
  let options: { none?: boolean } = {}
  let lastOpenEvent: any
  let lastCloseEvent: any
  let lastChangeEvent: any
  let lastWillSave: any
  let lastDidSave: any
  const documents = new Map<string, TextDocument>()
  const registrations: { id: string; method: string }[] = []
  let seq = 0

  connection.onRequest(InitializeRequest.type, (params: InitializeParams): InitializeResult => {
    options = (params.initializationOptions ?? {}) as { none?: boolean }
    return {
      capabilities: {
        textDocumentSync: {
          openClose: true,
          change: TextDocumentSyncKind.Full,
          willSave: true,
          willSaveWaitUntil: true,
          save: true
        }
      }
    }
  })

  connection.onRequest(ShutdownRequest.type, () => undefined)
  connection.onNotification(ExitNotification.type, () => connection.dispose())

  connection.onNotification(DidOpenTextDocumentNotification.type, (params: any) => {
    let td = params.textDocument
    lastOpenEvent = { uri: td.uri, version: td.version, languageId: td.languageId }
    // Mirror vscode-languageserver's TextDocuments, which fires its content
    // change handler for the opened document as well.
    lastChangeEvent = { uri: td.uri, text: td.text }
    documents.set(td.uri, TextDocument.create(td.uri, td.languageId, td.version, td.text))
  })

  connection.onNotification(DidCloseTextDocumentNotification.type, (params: any) => {
    lastCloseEvent = { uri: params.textDocument.uri }
    documents.delete(params.textDocument.uri)
  })

  connection.onNotification(DidChangeTextDocumentNotification.type, (params: any) => {
    let td = params.textDocument
    let doc = documents.get(td.uri) ?? TextDocument.create(td.uri, '', 0, '')
    let updated = TextDocument.update(doc, params.contentChanges, td.version)
    documents.set(td.uri, updated)
    lastChangeEvent = { uri: td.uri, text: updated.getText() }
  })

  connection.onNotification(WillSaveTextDocumentNotification.type, (params: any) => {
    lastWillSave = { uri: params.textDocument.uri }
  })

  connection.onRequest(WillSaveTextDocumentWaitUntilRequest.type as any, (params: any): any => {
    let uri = params.textDocument.uri
    if (uri.endsWith('error.vim')) return new ResponseError(LSPErrorCodes.ContentModified, 'content changed')
    if (!uri.endsWith('foo.vim')) return []
    return [TextEdit.insert(Position.create(0, 0), 'abc')]
  })

  connection.onNotification(DidSaveTextDocumentNotification.type, (params: any) => {
    lastDidSave = { uri: params.textDocument.uri }
  })

  connection.onRequest('getLastOpen', () => lastOpenEvent)
  connection.onRequest('getLastClose', () => lastCloseEvent)
  connection.onRequest('getLastChange', () => lastChangeEvent)
  connection.onRequest('getLastWillSave', () => lastWillSave)
  connection.onRequest('getLastDidSave', () => lastDidSave)

  connection.onNotification('registerDocumentSync', () => {
    let opt = { documentSelector: [{ language: 'vim' }] }
    let items = [
      { method: DidOpenTextDocumentNotification.method, registerOptions: opt },
      { method: DidCloseTextDocumentNotification.method, registerOptions: opt },
      {
        method: DidChangeTextDocumentNotification.method,
        registerOptions: Object.assign({
          syncKind: options.none === true ? TextDocumentSyncKind.None : TextDocumentSyncKind.Incremental
        }, opt)
      },
      { method: WillSaveTextDocumentNotification.method, registerOptions: opt },
      { method: WillSaveTextDocumentWaitUntilRequest.method, registerOptions: opt }
    ]
    for (let item of items) {
      let id = 'r' + (++seq)
      registrations.push({ id, method: item.method })
      void connection.sendRequest(RegistrationRequest.type, {
        registrations: [{ id, method: item.method, registerOptions: item.registerOptions }]
      }).catch(() => {})
    }
  })

  connection.onNotification('unregisterDocumentSync', () => {
    let unregisterations = registrations.map(r => ({ id: r.id, method: r.method }))
    registrations.length = 0
    void connection.sendRequest(UnregistrationRequest.type, { unregisterations }).catch(() => {})
  })

  connection.listen()
}
