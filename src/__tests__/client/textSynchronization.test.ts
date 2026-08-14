import * as shared from '../sharedUtil'
import { Neovim } from '@chemzqm/neovim'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { PassThrough } from 'stream'
import { DidChangeTextDocumentNotification, DidCloseTextDocumentNotification, DidOpenTextDocumentNotification, DidOpenTextDocumentParams, DocumentSelector, Position, Range, TextDocumentSaveReason, TextDocumentSyncKind, TextEdit, WillSaveTextDocumentNotification, WillSaveTextDocumentWaitUntilRequest } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { URI } from 'vscode-uri'
import { LanguageClient, LanguageClientOptions, Middleware, ServerOptions } from '../../language-client/index'
import Document from '../../model/document'
import { TextDocumentContentChange } from '../../types'
import { remove } from '../../util/fs'
import workspace from '../../workspace'
import { createInProcessTestDocumentsServer } from './server/inProcessTestDocumentsServer'

/**
 * Starts the testDocuments server in-process over a duplex stream pair
 * instead of forking a child process (see inProcessTestDocumentsServer.ts).
 */
function inProcessServer(): ServerOptions {
  return async () => {
    let serverInput = new PassThrough()
    let serverOutput = new PassThrough()
    createInProcessTestDocumentsServer(serverInput, serverOutput)
    return { reader: serverOutput, writer: serverInput }
  }
}

function createClient(documentSelector: DocumentSelector | undefined | null | LanguageClientOptions, middleware: Middleware = {}, opts: any = {}): LanguageClient {
  const serverOptions: ServerOptions = inProcessServer()
  if (documentSelector === undefined) documentSelector = [{ scheme: 'file' }]
  const clientOptions: LanguageClientOptions = {
    documentSelector: Array.isArray(documentSelector) ? documentSelector : undefined,
    synchronize: {},
    initializationOptions: opts,
    middleware
  };
  (clientOptions as ({ $testMode?: boolean })).$testMode = true
  if (documentSelector && !Array.isArray(documentSelector)) Object.assign(clientOptions, documentSelector)

  const result = new LanguageClient('test', 'Test Language Server', serverOptions, clientOptions)
  return result
}

let nvim: Neovim
before(async () => {
  nvim = workspace.nvim
})

async function loadBuffer(filepath: string): Promise<Document> {
  let nr = await nvim.call('bufadd', [filepath]) as number
  let doc = workspace.getDocument(nr)
  if (doc) return doc
  let resolveDocument: (document: Document) => void
  let opened = new Promise<Document>(resolve => {
    resolveDocument = resolve
  })
  let disposable = workspace.onDidOpenTextDocument(textDocument => {
    let document = workspace.getDocument(textDocument.uri)
    if (document?.bufnr === nr) resolveDocument(document)
  })
  try {
    await nvim.call('bufload', [nr])
    return workspace.getDocument(nr) ?? await opened
  } finally {
    disposable.dispose()
  }
}

afterEach(editorReset)

describe('TextDocumentSynchronization', () => {
  describe('DidOpenTextDocumentFeature', () => {
    it('should register with empty documentSelector', async t => {
      let client = createClient(undefined)
      await client.start()
      let feature = client.getFeature(DidOpenTextDocumentNotification.method)
      feature.register({ id: crypto.randomUUID(), registerOptions: { documentSelector: null } })
      let res = await client.sendRequest('getLastOpen')
      assert.strictEqual(res, null)
      let docs = feature.openDocuments
      assert.notStrictEqual(docs, undefined)
      await client.stop()
    })

    it('should send event on document create', async t => {
      let client = createClient([{ language: 'vim' }])
      await client.start()
      let uri = URI.file(path.join(os.tmpdir(), 't.vim'))
      let doc = await workspace.loadFile(uri.toString())
      assert.strictEqual(doc.languageId, 'vim')
      let res = await client.sendRequest('getLastOpen') as any
      assert.strictEqual(res.uri, doc.uri)
      assert.strictEqual(res.version, doc.version)
      await client.stop()
    })

    it('should use languageIdMap for languageId on open', async t => {
      let client = createClient({
        documentSelector: [{ language: 'vim' }],
        languageIdMap: { 't.vim': 'myvim', [path.join(os.tmpdir(), 'full.vim')]: 'fullvim' }
      })
      let sent: DidOpenTextDocumentParams | undefined
      let spy = t.mock.method(client, 'sendNotification', (_type, params) => {
        sent = params as DidOpenTextDocumentParams
        return Promise.resolve()
      })
      let feature = client.getFeature(DidOpenTextDocumentNotification.method)
      feature.register({ id: crypto.randomUUID(), registerOptions: { documentSelector: [{ language: 'vim' }] } })
      let sendOpen = async (filepath: string): Promise<[TextDocument, DidOpenTextDocumentParams]> => {
        sent = undefined
        let doc = TextDocument.create(URI.file(filepath).toString(), 'vim', 1, '')
        let provider = feature.getProvider(doc)
        assert.notStrictEqual(provider, undefined)
        await provider.send(doc)
        assert.notStrictEqual(sent, undefined)
        return [doc, sent]
      }
      try {
        let [doc, params] = await sendOpen(path.join(os.tmpdir(), 't.vim'))
        assert.strictEqual(doc.languageId, 'vim')
        assert.strictEqual(params.textDocument.uri, doc.uri)
        assert.strictEqual(params.textDocument.languageId, 'myvim')
        // full path key
        let [fullDoc, fullParams] = await sendOpen(path.join(os.tmpdir(), 'full.vim'))
        assert.strictEqual(fullParams.textDocument.uri, fullDoc.uri)
        assert.strictEqual(fullParams.textDocument.languageId, 'fullvim')
        // unmatched file keeps original languageId
        let [otherDoc, otherParams] = await sendOpen(path.join(os.tmpdir(), 'other.vim'))
        assert.strictEqual(otherParams.textDocument.uri, otherDoc.uri)
        assert.strictEqual(otherParams.textDocument.languageId, 'vim')
      } finally {
        feature.dispose()
      }
    })

    it('should work with middleware', async t => {
      let called = false
      let throwError = false
      let client = createClient({
        documentSelector: [{ language: 'vim' }],
        textSynchronization: {}
      }, {
        didOpen: (doc, next) => {
          called = true
          if (throwError) throw new Error('myerror')
          return next(doc)
        }
      })
      await client.start()
      let uri = URI.file(path.join(os.tmpdir(), 't.js'))
      let doc = await workspace.loadFile(uri.toString())
      assert.strictEqual(doc.languageId, 'javascript')
      let feature = client.getFeature(DidOpenTextDocumentNotification.method)
      feature.register({ id: crypto.randomUUID(), registerOptions: { documentSelector: [{ language: 'javascript' }] } })
      let res = await client.sendRequest('getLastOpen') as any
      assert.strictEqual(res.uri, doc.uri)
      assert.strictEqual(called, true)
      throwError = true
      uri = URI.file(path.join(os.tmpdir(), 'a.js'))
      await workspace.loadFile(uri.toString())
      await client.stop()
    })

    it('should delayOpenNotifications', async t => {
      let uri = URI.file(path.join(os.tmpdir(), 'x.vim'))
      await workspace.loadFile(uri.toString())
      let loaded: Set<string> = new Set()
      let openResolvers = new Map<string, () => void>()
      let waitForOpen = (filepath: string): Promise<void> => {
        return new Promise(resolve => {
          openResolvers.set(filepath, resolve)
        })
      }
      let throwError = false
      let client = createClient({
        documentSelector: [{ language: 'vim' }],
        textSynchronization: { delayOpenNotifications: true }
      }, {
        didOpen: (data, next) => {
          let filepath = URI.parse(data.uri).fsPath
          loaded.add(filepath)
          openResolvers.get(filepath)?.()
          openResolvers.delete(filepath)
          if (throwError) return Promise.reject(new Error('my error'))
          return next(data)
        }
      })
      await client.start()
      let feature = client.getFeature(DidOpenTextDocumentNotification.method) as any
      let filepath = path.join(os.tmpdir(), 't.vim')
      let doc = await loadBuffer(filepath)
      assert.strictEqual(loaded.has(filepath), false)
      let opened = waitForOpen(filepath)
      await nvim.command(`b ${doc.bufnr}`)
      await opened
      await nvim.command(`bwipeout`)
      filepath = path.join(os.tmpdir(), 'p.vim')
      doc = await loadBuffer(filepath)
      await feature.sendPendingOpenNotifications(doc.uri)
      assert.strictEqual(loaded.has(filepath), false)
      await feature.callback(doc.textDocument)
      await feature.callback(TextDocument.create('untitled:///1', 'tex', 1, ''))
      await feature.sendPendingOpenNotifications()
      assert.strictEqual(loaded.has(filepath), true)
      throwError = true
      feature._pendingOpenNotifications.set(doc.uri, doc.textDocument)
      opened = waitForOpen(filepath)
      await nvim.command(`b ${doc.bufnr}`)
      await opened
      await client.stop()
    })
  })

  describe('DidCloseTextDocumentFeature', () => {
    it('should send close event', async t => {
      let uri = URI.file(path.join(os.tmpdir(), 'close.vim'))
      let doc = await workspace.loadFile(uri.toString())
      let client = createClient([{ language: 'vim' }])
      await client.start()
      await workspace.nvim.command(`bd! ${doc.bufnr}`)
      await shared.waitValue(async () => {
        let res = await client.sendRequest('getLastClose') as any
        return res != null && res.uri === doc.uri
      }, true)
      let res = await client.sendRequest('getLastClose') as any
      assert.strictEqual(res.uri, doc.uri)
      await client.stop()
    })

    it('should unregister document selector', async t => {
      let called = false
      let client = createClient([{ language: 'javascript' }], {
        didClose: (e, next) => {
          called = true
          return next(e)
        }
      })
      await client.start()
      let openFeature = client.getFeature(DidOpenTextDocumentNotification.method)
      let id = crypto.randomUUID()
      let options = { id, registerOptions: { documentSelector: [{ language: 'vim' }] } }
      openFeature.register(options)
      let feature = client.getFeature(DidCloseTextDocumentNotification.method)
      feature.register(options)
      let uri = URI.file(path.join(os.tmpdir(), 'close.vim'))
      await workspace.loadFile(uri.toString())
      await shared.wait(20)
      feature.unregister('unknown')
      let spy = t.mock.method(client, 'sendNotification', () => Promise.reject(new Error('myerror')))
      feature.unregister(id)
      let res = await client.sendRequest('getLastClose') as any
      assert.strictEqual(res, null)
      assert.strictEqual(called, true)
      await client.stop()
    })
  })

  describe('DidChangeTextDocumentFeature', () => {
    it('should send full change event', async t => {
      let called = false
      let throwError = false
      let client = createClient([{ language: 'vim' }], {
        didChange: (e, next) => {
          called = true
          if (throwError) return Promise.reject(new Error('myerror'))
          return next(e)
        }
      })
      await client.start()
      let uri = URI.file(path.join(os.tmpdir(), 'x.vim'))
      let doc = await workspace.loadFile(uri.toString())
      await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'bar')])
      let res = await client.sendRequest('getLastChange') as any
      assert.strictEqual(res.text, 'bar\n')
      assert.strictEqual(called, true)
      throwError = true
      await doc.applyEdits([TextEdit.replace(Range.create(0, 0, 0, 3), '')])
      await client.stop()
    })

    it('should send incremental change event', async t => {
      let client = createClient([{ scheme: 'lsptest' }])
      assert.strictEqual(client.isSynced('untitled:///1'), false)
      await client.start()
      await client.sendNotification('registerDocumentSync')
      let feature = client.getFeature(DidChangeTextDocumentNotification.method)
      feature.register({ registerOptions: {} } as any)
      let textDocument = TextDocument.create('untitled:///1', 'x', 1, '')
      assert.strictEqual(feature.getProvider(textDocument), undefined)
      let called = false
      feature.onNotificationSent(() => {
        called = true
      })
      let doc = await shared.createDocument(`${crypto.randomUUID()}.vim`)
      await shared.waitValue(() => {
        return client.isSynced(doc.uri)
      }, true)
      await nvim.call('setline', [1, 'bar'])
      await doc.patchChange()
      await shared.waitValue(() => {
        return called
      }, true)
      let res = await client.sendRequest('getLastChange') as any
      assert.strictEqual(res.uri, doc.uri)
      assert.strictEqual(res.text, 'bar\n')
      let provider = feature.getProvider(doc.textDocument)
      assert.notStrictEqual(provider, undefined)
      await provider.send({
        contentChanges: [],
        textDocument: { uri: doc.uri, version: doc.version },
        bufnr: doc.bufnr,
        original: '',
        document: doc.textDocument,
        originalLines: []
      })
      await client.sendNotification('unregisterDocumentSync')
      await client.stop()
    })

    it('should keep notification emitters working after dispose', async t => {
      let client = createClient([{ scheme: 'lsptest' }])
      await client.start()
      await client.sendNotification('registerDocumentSync')
      let feature = client.getFeature(DidChangeTextDocumentNotification.method) as any
      let oldEmitter = feature._onNotificationSent
      feature.register({ registerOptions: {} } as any)
      let called = 0
      let resolveChange: () => void
      let changeSent = new Promise<void>(resolve => {
        resolveChange = resolve
      })
      feature.onNotificationSent(() => {
        called++
        resolveChange()
      })
      let doc = await shared.createDocument(`${crypto.randomUUID()}.vim`)
      await shared.waitValue(() => {
        return client.isSynced(doc.uri)
      }, true)
      await nvim.call('setline', [1, 'bar'])
      await doc.patchChange()
      await changeSent
      // Simulate a client restart: dispose then re-register, as the built-in
      // features are reused across restarts.
      feature.dispose()
      // The built-in feature instances are reused across client restarts, so
      // dispose must re-create the emitters like the base feature does.
      assert.notStrictEqual(feature._onNotificationSent, oldEmitter)
      feature.register({
        id: crypto.randomUUID(),
        registerOptions: { documentSelector: [{ language: 'vim' }], syncKind: TextDocumentSyncKind.Incremental }
      } as any)
      let resolveRestart: () => void
      let restartSent = new Promise<void>(resolve => {
        resolveRestart = resolve
      })
      feature.onNotificationSent(() => {
        called++
        resolveRestart()
      })
      await nvim.call('setline', [1, 'baz'])
      await doc.patchChange()
      await restartSent
      await client.sendNotification('unregisterDocumentSync')
      await client.stop()
    })

    it('should not send change event when syncKind is none', async t => {
      let client = createClient([{ scheme: 'lsptest' }], {}, { none: true })
      await client.start()
      await client.sendNotification('registerDocumentSync')
      await nvim.command('edit x.vim')
      let doc = await workspace.document

      let feature = client.getFeature(DidChangeTextDocumentNotification.method)
      await shared.waitValue(() => {
        return feature.getProvider(doc.textDocument) != null
      }, true)
      let provider = feature.getProvider(doc.textDocument)
      let changes: TextDocumentContentChange[] = [{
        range: Range.create(0, 0, 0, 0),
        text: 'foo'
      }]
      await provider.send({
        contentChanges: changes,
        document: TextDocument.create(doc.uri, doc.languageId, 2, ''),
        textDocument: { uri: doc.uri, version: doc.version },
        bufnr: doc.bufnr
      } as any)
      let res = await client.sendRequest('getLastChange') as any
      assert.strictEqual(res.text, '\n')
      await client.stop()
    })
  })

  describe('WillSaveFeature', () => {
    it('should will save event', async t => {
      let called = false
      let client = createClient([{ language: 'vim' }], {
        willSave: (e, next) => {
          called = true
          return next(e)
        }
      })
      await client.start()
      let fsPath = path.join(os.tmpdir(), `${crypto.randomUUID()}.vim`)
      let uri = URI.file(fsPath)
      await workspace.openResource(uri.toString())
      let doc = await workspace.document
      await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'bar')])
      let feature = client.getFeature(WillSaveTextDocumentNotification.method)
      let provider = feature.getProvider(doc.textDocument)
      assert.notStrictEqual(provider, undefined)
      await provider.send({ document: doc.textDocument, bufnr: doc.bufnr, reason: TextDocumentSaveReason.Manual, waitUntil: () => {} })
      let res = await client.sendRequest('getLastWillSave') as any
      assert.strictEqual(res.uri, doc.uri)
      await client.stop()
      assert.strictEqual(called, true)
      if (fs.existsSync(fsPath)) {
        fs.unlinkSync(fsPath)
      }
    })
  })

  describe('WillSaveWaitUntilFeature', () => {
    it('should send will save until request', async t => {
      let client = createClient([{ scheme: 'lsptest' }])
      await client.start()
      await client.sendNotification('registerDocumentSync')
      let fsPath = path.join(os.tmpdir(), `${crypto.randomUUID()}-foo.vim`)
      let uri = URI.file(fsPath)
      await workspace.openResource(uri.toString())
      let doc = await workspace.document
      let feature = client.getFeature(WillSaveTextDocumentNotification.method)
      feature.register({ registerOptions: {} } as any)
      await shared.waitValue(() => {
        return feature.getProvider(doc.textDocument) != null
      }, true)
      let waitFeature = client.getFeature(WillSaveTextDocumentWaitUntilRequest.method)
      waitFeature.register({ registerOptions: {} } as any)
      await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'x')])
      nvim.command('w', true)
      await shared.waitValue(() => {
        return doc.getDocumentContent()
      }, 'abcx\n')
      await client.sendNotification('unregisterDocumentSync')
      await client.stop()
      await remove(fsPath)
    })

    it('should not throw on response error', async t => {
      let called = false
      let resolveCalled: () => void
      let p = new Promise<void>(resolve => {
        resolveCalled = resolve
      })
      let client = createClient([], {
        willSaveWaitUntil: (event, next) => {
          called = true
          resolveCalled()
          return next(event)
        }
      })
      await client.start()
      await client.sendNotification('registerDocumentSync')
      let fsPath = path.join(os.tmpdir(), `${crypto.randomUUID()}-error.vim`)
      let uri = URI.file(fsPath)
      await shared.waitValue(() => {
        let feature = client.getFeature(DidOpenTextDocumentNotification.method)
        let provider = feature.getProvider(TextDocument.create(uri.toString(), 'vim', 1, ''))
        return provider != null
      }, true)
      await workspace.openResource(uri.toString())
      let doc = await workspace.document
      await doc.synchronize()
      nvim.command('w', true)
      await p
      await client.stop()
    })

    it('should unregister event handler', async t => {
      let client = createClient(null)
      await client.start()
      await client.sendNotification('registerDocumentSync')
      await shared.waitValue(() => {
        let feature = client.getFeature(DidOpenTextDocumentNotification.method)
        let provider = feature.getProvider(TextDocument.create('file:///f.vim', 'vim', 1, ''))
        return provider != null
      }, true)
      await client.sendNotification('unregisterDocumentSync')
      await shared.waitValue(() => {
        let feature = client.getFeature(DidOpenTextDocumentNotification.method)
        let provider = feature.getProvider(TextDocument.create('file:///f.vim', 'vim', 1, ''))
        return provider == null
      }, true)
      await client.stop()
    })
  })

  describe('DidSaveTextDocumentFeature', () => {
    it('should send did save notification', async t => {
      let called = false
      let client = createClient([{ language: 'vim' }], {
        didSave: (e, next) => {
          called = true
          return next(e)
        }
      })
      await client.start()
      let fsPath = path.join(os.tmpdir(), `${crypto.randomUUID()}.vim`)
      let uri = URI.file(fsPath)
      await workspace.openResource(uri.toString())
      let doc = await workspace.document
      await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'bar')])
      nvim.command('w', true)
      await shared.waitValue(() => {
        return called
      }, true)
      let res = await client.sendRequest('getLastWillSave') as any
      assert.strictEqual(res.uri, doc.uri)
      await client.stop()
      fs.unlinkSync(fsPath)
    })
  })
})
