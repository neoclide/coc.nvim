import { Neovim } from '@chemzqm/neovim'
import os from 'os'
import path from 'path'
import { v4 as uuid } from 'uuid'
import { CancellationToken, DocumentDiagnosticRequest, Position, TextEdit } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { URI } from 'vscode-uri'
import * as lsclient from '../../language-client'
import { BackgroundScheduler, DocumentPullStateTracker, PullState } from '../../language-client/diagnostic'
import workspace from '../../workspace'
import helper from '../helper'

function getId(uri: string): number {
  let ms = uri.match(/\d+$/)
  return ms ? Number(ms[0]) : undefined
}

function createDocument(id: number, version = 1): TextDocument {
  let uri = `file:///${id}`
  return TextDocument.create(uri, '', version, '')
}

function createUri(id: number): URI {
  return URI.file(id.toString())
}

describe('BackgroundScheduler', () => {
  it('should schedule documents by add', async () => {
    let uris: string[] = []
    let s = new BackgroundScheduler({
      pull(document) {
        uris.push(document.uri)
      }
    })
    s.add(createDocument(1))
    s.add(createDocument(1))
    s.add(createDocument(2))
    s.add(createDocument(3))
    await helper.waitValue(() => {
      return uris.length
    }, 3)
    let ids = uris.map(u => getId(u))
    expect(ids).toEqual([1, 2, 3])
  })

  it('should schedule documents by remove', async () => {
    let uris: string[] = []
    let s = new BackgroundScheduler({
      pull(document) {
        uris.push(document.uri)
      }
    })
    s.add(createDocument(1))
    s.add(createDocument(2))
    s.remove(createDocument(2))
    s.add(createDocument(3))
    s.remove(createDocument(3))
    s.remove(createDocument(1))
    await helper.waitValue(() => {
      return uris.length
    }, 3)
    let ids = uris.map(u => getId(u))
    expect(ids).toEqual([2, 3, 1])
    s.dispose()
  })
})

describe('DocumentPullStateTracker', () => {
  it('should track document', async () => {
    let tracker = new DocumentPullStateTracker()
    let state = tracker.track(PullState.document, createDocument(1))
    let other = tracker.track(PullState.document, createDocument(1))
    expect(state).toBe(other)
    tracker.track(PullState.workspace, createDocument(3))
    let id = 'dcf06d3b-79f6-4a5e-bc8d-d3334f7b4cad'
    tracker.update(PullState.document, createDocument(1, 2), id)
    tracker.update(PullState.document, createDocument(2, 2), 'f758ae47-c94e-406e-ba41-0f3bb2fe4fc7')
    let curr = tracker.getResultId(PullState.document, createDocument(1, 2))
    expect(curr).toBe(id)
    expect(tracker.getResultId(PullState.workspace, createDocument(1, 2))).toBeUndefined()
    tracker.unTrack(PullState.document, createDocument(2, 2))
    expect(tracker.trackingDocuments()).toEqual(['file:///1'])
    tracker.update(PullState.workspace, createDocument(3, 2), 'fcb905e2-8edb-4239-9150-198c8175ed4a')
    tracker.update(PullState.workspace, createDocument(1, 2), 'fe96d175-c19f-4705-bff1-101bf83b2953')
    expect(tracker.tracks(PullState.workspace, createDocument(3, 1))).toBe(true)
    expect(tracker.tracks(PullState.document, createDocument(4, 1))).toBe(false)
    let res = tracker.getAllResultIds()
    expect(res.length).toBe(2)
  })

  it('should track URI', async () => {
    let tracker = new DocumentPullStateTracker()
    let state = tracker.track(PullState.document, createUri(1), undefined)
    let other = tracker.track(PullState.document, createUri(1), undefined)
    expect(state).toBe(other)
    tracker.track(PullState.workspace, createUri(3), undefined)
    let id = 'dcf06d3b-79f6-4a5e-bc8d-d3334f7b4cad'
    tracker.update(PullState.document, createUri(1), undefined, id)
    tracker.update(PullState.document, createUri(2), undefined, 'f758ae47-c94e-406e-ba41-0f3bb2fe4fc7')
    let curr = tracker.getResultId(PullState.document, createUri(1))
    expect(curr).toBe(id)
    tracker.unTrack(PullState.document, createUri(2))
    expect(tracker.trackingDocuments()).toEqual(['file:///1'])
    tracker.update(PullState.workspace, createUri(3), undefined, undefined)
    tracker.update(PullState.workspace, createUri(1), undefined, 'fe96d175-c19f-4705-bff1-101bf83b2953')
    expect(tracker.tracks(PullState.workspace, createUri(3))).toBe(true)
    expect(tracker.tracks(PullState.document, createUri(4))).toBe(false)
    let res = tracker.getAllResultIds()
    expect(res.length).toBe(1)
  })
})

describe('DiagnosticFeature', () => {
  let nvim: Neovim
  beforeAll(async () => {
    await helper.setup()
    nvim = workspace.nvim
  })

  afterAll(async () => {
    await helper.shutdown()
  })

  afterEach(async () => {
    await helper.reset()
  })

  async function createServer(interFileDependencies: boolean, workspaceDiagnostics = false, middleware: lsclient.Middleware = {}, fun?: (opt: lsclient.LanguageClientOptions) => void) {
    let clientOptions: lsclient.LanguageClientOptions = {
      documentSelector: [{ language: '*' }],
      middleware,
      initializationOptions: {
        interFileDependencies: interFileDependencies == true,
        workspaceDiagnostics
      }
    }
    if (fun) fun(clientOptions)
    let serverModule = path.join(__dirname, './server/diagnosticServer.js')
    let serverOptions: lsclient.ServerOptions = {
      module: serverModule,
      transport: lsclient.TransportKind.ipc
    }
    let client = new lsclient.LanguageClient('html', 'Test Language Server', serverOptions, clientOptions)
    await client.start()
    return client
  }

  function getUri(s: number | string): string {
    let fsPath = path.join(os.tmpdir(), s.toString())
    return URI.file(fsPath).toString()
  }

  it('should work when change visible editor', async () => {
    let doc = await workspace.loadFile(getUri(1), 'edit')
    await workspace.loadFile(getUri(3), 'tabe')
    let client = await createServer(true)
    await helper.wait(30)
    await workspace.loadFile(getUri(2), 'edit')
    await helper.wait(30)
    await workspace.loadFile(getUri(3), 'tabe')
    await helper.wait(30)
    let feature = client.getFeature(DocumentDiagnosticRequest.method)
    expect(feature).toBeDefined()
    let provider = feature.getProvider(doc.textDocument)
    let res = provider.knows(PullState.document, doc.textDocument)
    expect(res).toBe(false)
    await client.stop()
  })

  it('should filter by document selector', async () => {
    let client = await createServer(true, false, {}, opt => {
      opt.documentSelector = [{ language: 'vim' }]
    })
    let doc = await workspace.loadFile(getUri(1), 'edit')
    await helper.wait(10)
    let feature = client.getFeature(DocumentDiagnosticRequest.method)
    let provider = feature.getProvider(TextDocument.create('file:///1', 'vim', 1, ''))
    let res = provider.knows(PullState.document, doc.textDocument)
    expect(res).toBe(false)
    await client.stop()
  })

  it('should filter by ignore', async () => {
    let client = await createServer(true, false, {}, opt => {
      opt.diagnosticPullOptions = {
        ignored: ['**/*.ts']
      }
    })
    let doc = await workspace.loadFile(getUri('a.ts'), 'edit')
    await helper.wait(10)
    let feature = client.getFeature(DocumentDiagnosticRequest.method)
    let provider = feature.getProvider(doc.textDocument)
    let res = provider.knows(PullState.document, doc.textDocument)
    expect(res).toBe(false)
    await client.stop()
  })

  it('should not throw on request error', async () => {
    let client = await createServer(true)
    await workspace.loadFile(getUri('error'), 'edit')
    await workspace.loadFile(getUri('cancel'), 'tabe')
    await workspace.loadFile(getUri('retrigger'), 'tabe')
    await helper.wait(10)
    await nvim.command('normal! 2gt')
    await workspace.loadFile(getUri('unchanged'), 'edit')
    await helper.wait(20)
    await client.stop()
  })

  it('should pull diagnostic on change', async () => {
    let doc = await workspace.loadFile(getUri('change'), 'edit')
    let client = await createServer(true, false, {}, opt => {
      opt.diagnosticPullOptions = {
        onChange: true,
        filter: doc => {
          return doc.uri.endsWith('filtered')
        }
      }
    })
    let feature = client.getFeature(DocumentDiagnosticRequest.method)
    let provider = feature.getProvider(doc.textDocument)
    await helper.waitValue(() => {
      return provider.knows(PullState.document, doc.textDocument)
    }, true)
    await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'foo')])
    await helper.waitValue(async () => {
      return await client.sendRequest('getChangeCount')
    }, 2)
    await nvim.call('setline', [1, 'foo'])
    let d = await workspace.loadFile(getUri('filtered'), 'tabe')
    await d.applyEdits([TextEdit.insert(Position.create(0, 0), 'foo')])
    await helper.wait(30)
    await nvim.command(`bd! ${doc.bufnr}`)
    await client.stop()
  })

  it('should pull diagnostic on save', async () => {
    let doc = await workspace.loadFile(getUri(uuid() + 'filtered'), 'edit')
    await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'foo')])
    doc = await workspace.loadFile(getUri(uuid() + 'save'), 'tabe')
    let client = await createServer(true, false, {}, opt => {
      opt.diagnosticPullOptions = {
        onSave: true,
        filter: doc => {
          return doc.uri.endsWith('filtered')
        }
      }
    })
    let feature = client.getFeature(DocumentDiagnosticRequest.method)
    let provider = feature.getProvider(doc.textDocument)
    await helper.waitValue(() => {
      return provider.knows(PullState.document, doc.textDocument)
    }, true)
    await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'foo')])
    await nvim.command('wa')
    await helper.wait(10)
    await client.stop()
  })

  it('should use provideDiagnostics middleware', async () => {
    let called = false
    let callHandle = false
    let client = await createServer(true, false, {
      provideDiagnostics: (doc, id, token, next) => {
        called = true
        return next(doc, id, token)
      },
      handleDiagnostics: (uri, diagnostics, next) => {
        callHandle = true
        return next(uri, diagnostics)
      }
    })
    let feature = client.getFeature(DocumentDiagnosticRequest.method)
    expect(feature).toBeDefined()
    let textDocument = TextDocument.create(getUri('empty'), 'e', 1, '')
    let provider = feature.getProvider(textDocument)
    let res = await provider.diagnostics.provideDiagnostics(textDocument, '', CancellationToken.None)
    expect(called).toBe(true)
    expect(res).toEqual({ kind: 'full', items: [] })
    await helper.waitValue(() => {
      return callHandle
    }, true)
    await client.stop()
  })

  it('should use provideWorkspaceDiagnostics middleware', async () => {
    let called = false
    let client = await createServer(false, true, {
      provideWorkspaceDiagnostics: (resultIds, token, resultReporter, next) => {
        called = true
        return next(resultIds, token, resultReporter)
      }
    })
    expect(called).toBe(true)
    await helper.waitValue(async () => {
      let count = await client.sendRequest('getWorkspceCount')
      return count > 1
    }, true)
    await client.stop()
  })

  it('should receive partial result', async () => {
    let client = await createServer(false, true, {}, opt => {
      opt.diagnosticPullOptions = {
        workspace: false
      }
    })
    let feature = client.getFeature(DocumentDiagnosticRequest.method)
    let textDocument = TextDocument.create(getUri('empty'), 'e', 1, '')
    let provider = feature.getProvider(textDocument)
    let n = 0
    await provider.diagnostics.provideWorkspaceDiagnostics([{ uri: 'uri', value: '1' }], CancellationToken.None, chunk => {
      n++
    })
    expect(n).toBe(4)
    await client.stop()
  })

  it('should fire refresh event', async () => {
    let client = await createServer(true, false, {})
    let feature = client.getFeature(DocumentDiagnosticRequest.method)
    let textDocument = TextDocument.create(getUri('1'), 'e', 1, '')
    let provider = feature.getProvider(textDocument)
    let called = false
    provider.onDidChangeDiagnosticsEmitter.event(() => {
      called = true
    })
    await client.sendNotification('fireRefresh')
    await helper.waitValue(() => {
      return called
    }, true)
    await client.stop()
  })
})
