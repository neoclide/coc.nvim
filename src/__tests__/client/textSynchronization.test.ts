import { Neovim } from '@chemzqm/neovim'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { DidChangeTextDocumentNotification, DidCloseTextDocumentNotification, DidOpenTextDocumentNotification, DocumentSelector, Position, Range, TextDocumentSaveReason, TextEdit, WillSaveTextDocumentNotification } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { URI } from 'vscode-uri'
import { LanguageClient, LanguageClientOptions, Middleware, ServerOptions, TransportKind } from '../../language-client/index'
import { TextDocumentContentChange } from '../../types'
import { remove } from '../../util/fs'
import workspace from '../../workspace'
import helper from '../helper'

function createClient(documentSelector: DocumentSelector | undefined | null, middleware: Middleware = {}, opts: any = {}): LanguageClient {
  const serverModule = path.join(__dirname, './server/testDocuments.js')
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: { module: serverModule, transport: TransportKind.ipc, options: { execArgv: ['--nolazy', '--inspect=6014'] } }
  }
  if (documentSelector === undefined) documentSelector = [{ scheme: 'file' }]
  const clientOptions: LanguageClientOptions = {
    documentSelector,
    synchronize: {},
    initializationOptions: opts,
    middleware
  };
  (clientOptions as ({ $testMode?: boolean })).$testMode = true

  const result = new LanguageClient('test', 'Test Language Server', serverOptions, clientOptions)
  return result
}

let nvim: Neovim
beforeAll(async () => {
  await helper.setup()
  nvim = workspace.nvim
})

afterAll(async () => {
  await helper.shutdown()
})

describe('TextDocumentSynchronization', () => {
  describe('DidOpenTextDocumentFeature', () => {
    it('should register with empty documentSelector', async () => {
      let client = createClient(undefined)
      await client.start()
      let feature = client.getFeature(DidOpenTextDocumentNotification.method)
      feature.register({ id: uuidv4(), registerOptions: { documentSelector: null } })
      let res = await client.sendRequest('getLastOpen')
      expect(res).toBe(null)
      await client.stop()
    })

    it('should send event on document create', async () => {
      let client = createClient([{ language: 'vim' }])
      await client.start()
      let uri = URI.file(path.join(os.tmpdir(), 't.vim'))
      let doc = await workspace.loadFile(uri.toString())
      expect(doc.languageId).toBe('vim')
      let res = await client.sendRequest('getLastOpen') as any
      expect(res.uri).toBe(doc.uri)
      expect(res.version).toBe(doc.version)
      await client.stop()
    })

    it('should work with middleware', async () => {
      let called = false
      let client = createClient([{ language: 'vim' }], {
        didOpen: (doc, next) => {
          called = true
          return next(doc)
        }
      })
      await client.start()
      let uri = URI.file(path.join(os.tmpdir(), 't.js'))
      let doc = await workspace.loadFile(uri.toString())
      expect(doc.languageId).toBe('javascript')
      let feature = client.getFeature(DidOpenTextDocumentNotification.method)
      feature.register({ id: uuidv4(), registerOptions: { documentSelector: [{ language: 'javascript' }] } })
      let res = await client.sendRequest('getLastOpen') as any
      expect(res.uri).toBe(doc.uri)
      expect(called).toBe(true)
      await client.stop()
    })
  })

  describe('DidCloseTextDocumentFeature', () => {
    it('should send close event', async () => {
      let uri = URI.file(path.join(os.tmpdir(), 't.vim'))
      let doc = await workspace.loadFile(uri.toString())
      let client = createClient([{ language: 'vim' }])
      await client.start()
      await workspace.nvim.command(`bd! ${doc.bufnr}`)
      await helper.wait(30)
      let res = await client.sendRequest('getLastClose') as any
      expect(res.uri).toBe(doc.uri)
      await client.stop()
    })

    it('should unregister document selector', async () => {
      let called = false
      let client = createClient([{ language: 'javascript' }], {
        didClose: (e, next) => {
          called = true
          return next(e)
        }
      })
      await client.start()
      let openFeature = client.getFeature(DidOpenTextDocumentNotification.method)
      let id = uuidv4()
      let options = { id, registerOptions: { documentSelector: [{ language: 'vim' }] } }
      openFeature.register(options)
      let feature = client.getFeature(DidCloseTextDocumentNotification.method)
      feature.register(options)
      let uri = URI.file(path.join(os.tmpdir(), 't.vim'))
      let doc = await workspace.loadFile(uri.toString())
      await helper.wait(30)
      feature.unregister(id)
      feature.unregister('unknown')
      await helper.wait(30)
      let res = await client.sendRequest('getLastClose') as any
      expect(res.uri).toBe(doc.uri)
      expect(called).toBe(true)
      await client.stop()
    })
  })

  describe('DidChangeTextDocumentFeature', () => {
    it('should send full change event ', async () => {
      let called = false
      let client = createClient([{ language: 'vim' }], {
        didChange: (e, next) => {
          called = true
          return next(e)
        }
      })
      await client.start()
      let uri = URI.file(path.join(os.tmpdir(), 'x.vim'))
      let doc = await workspace.loadFile(uri.toString())
      await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'bar')])
      await client.forceDocumentSync()
      let res = await client.sendRequest('getLastChange') as any
      expect(res.text).toBe('bar\n')
      expect(called).toBe(true)
      await client.stop()
    })

    it('should send incremental change event', async () => {
      let client = createClient([{ scheme: 'lsptest' }])
      await client.start()
      await client.sendNotification('registerDocumentSync')
      await helper.waitValue(() => {
        let feature = client.getFeature(DidChangeTextDocumentNotification.method)
        return feature !== undefined
      }, true)
      let feature = client.getFeature(DidChangeTextDocumentNotification.method)
      let called = false
      feature.onNotificationSent(() => {
        called = true
      })
      let doc = await helper.createDocument(`${uuidv4()}.vim`)
      await nvim.call('setline', [1, 'foo'])
      await doc.synchronize()
      await client.forceDocumentSync()
      await nvim.call('setline', [1, 'bar'])
      await doc.synchronize()
      await helper.waitValue(() => {
        return called
      }, true)
      let res = await client.sendRequest('getLastChange') as any
      expect(res.uri).toBe(doc.uri)
      expect(res.text).toBe('bar\n')
      let provider = feature.getProvider(doc.textDocument)
      expect(provider).toBeDefined()
      await provider.send({ contentChanges: [], textDocument: { uri: doc.uri, version: doc.version }, bufnr: doc.bufnr, original: '', originalLines: [] })
      await client.sendNotification('unregisterDocumentSync')
      await client.stop()
    })

    it('should not send change event when syncKind is none', async () => {
      let client = createClient([{ scheme: 'lsptest' }], {}, { none: true })
      await client.start()
      await client.sendNotification('registerDocumentSync')
      await nvim.command('edit x.vim')
      let doc = await workspace.document

      let feature = client.getFeature(DidChangeTextDocumentNotification.method)
      await helper.waitValue(() => {
        return feature.getProvider(doc.textDocument) != null
      }, true)
      let provider = feature.getProvider(doc.textDocument)
      let changes: TextDocumentContentChange[] = [{
        range: Range.create(0, 0, 0, 0),
        text: 'foo'
      }]
      await provider.send({ contentChanges: changes, textDocument: { uri: doc.uri, version: doc.version }, bufnr: doc.bufnr } as any)
      let res = await client.sendRequest('getLastChange') as any
      expect(res.text).toBe('\n')
      await client.stop()
    })
  })

  describe('WillSaveFeature', () => {
    it('should will save event', async () => {
      let called = false
      let client = createClient([{ language: 'vim' }], {
        willSave: (e, next) => {
          called = true
          return next(e)
        }
      })
      await client.start()
      let fsPath = path.join(os.tmpdir(), `${uuidv4()}.vim`)
      let uri = URI.file(fsPath)
      await workspace.openResource(uri.toString())
      let doc = await workspace.document
      await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'bar')])
      let feature = client.getFeature(WillSaveTextDocumentNotification.method)
      let provider = feature.getProvider(doc.textDocument)
      expect(provider).toBeDefined()
      await provider.send({ document: doc.textDocument, reason: TextDocumentSaveReason.Manual, waitUntil: () => {} })
      let res = await client.sendRequest('getLastWillSave') as any
      expect(res.uri).toBe(doc.uri)
      await client.stop()
      expect(called).toBe(true)
      if (fs.existsSync(fsPath)) {
        fs.unlinkSync(fsPath)
      }
    })
  })

  describe('WillSaveWaitUntilFeature', () => {
    it('should send will save until request', async () => {
      let client = createClient([{ scheme: 'lsptest' }])
      await client.start()
      await client.sendNotification('registerDocumentSync')
      let fsPath = path.join(os.tmpdir(), `${uuidv4()}-foo.vim`)
      let uri = URI.file(fsPath)
      await workspace.openResource(uri.toString())
      let doc = await workspace.document
      await helper.waitValue(() => {
        let feature = client.getFeature(WillSaveTextDocumentNotification.method)
        return feature.getProvider(doc.textDocument) != null
      }, true)
      await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'x')])
      nvim.command('w', true)
      await helper.waitValue(() => {
        return doc.getDocumentContent()
      }, 'abcx\n')
      await client.sendNotification('unregisterDocumentSync')
      await client.stop()
      await remove(fsPath)
    })

    it('should not throw on response error', async () => {
      let called = false
      let client = createClient([], {
        willSaveWaitUntil: (event, next) => {
          called = true
          return next(event)
        }
      })
      await client.start()
      await client.sendNotification('registerDocumentSync')
      let fsPath = path.join(os.tmpdir(), `${uuidv4()}-error.vim`)
      let uri = URI.file(fsPath)
      await helper.waitValue(() => {
        let feature = client.getFeature(DidOpenTextDocumentNotification.method)
        let provider = feature.getProvider(TextDocument.create(uri.toString(), 'vim', 1, ''))
        return provider != null
      }, true)
      await workspace.openResource(uri.toString())
      let doc = await workspace.document
      await doc.synchronize()
      nvim.command('w', true)
      await helper.waitValue(() => {
        return called
      }, true)
      await client.stop()
    })

    it('should unregister event handler', async () => {
      let client = createClient(null)
      await client.start()
      await client.sendNotification('registerDocumentSync')
      await helper.waitValue(() => {
        let feature = client.getFeature(DidOpenTextDocumentNotification.method)
        let provider = feature.getProvider(TextDocument.create('file:///f.vim', 'vim', 1, ''))
        return provider != null
      }, true)
      await client.sendNotification('unregisterDocumentSync')
      await helper.waitValue(() => {
        let feature = client.getFeature(DidOpenTextDocumentNotification.method)
        let provider = feature.getProvider(TextDocument.create('file:///f.vim', 'vim', 1, ''))
        return provider == null
      }, true)
      await client.stop()
    })
  })

  describe('DidSaveTextDocumentFeature', () => {
    it('should send did save notification', async () => {
      let called = false
      let client = createClient([{ language: 'vim' }], {
        didSave: (e, next) => {
          called = true
          return next(e)
        }
      })
      await client.start()
      let fsPath = path.join(os.tmpdir(), `${uuidv4()}.vim`)
      let uri = URI.file(fsPath)
      await workspace.openResource(uri.toString())
      let doc = await workspace.document
      await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'bar')])
      nvim.command('w', true)
      await helper.waitValue(() => {
        return called
      }, true)
      let res = await client.sendRequest('getLastWillSave') as any
      expect(res.uri).toBe(doc.uri)
      await client.stop()
      fs.unlinkSync(fsPath)
    })
  })
})
