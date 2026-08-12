import * as shared from '../sharedUtil'
import path from 'path'
import { DidChangeWatchedFilesNotification, DocumentSelector, Emitter, Event, FileChangeType } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import { asRelativePattern } from '../../language-client/fileSystemWatcher'
import { LanguageClient, LanguageClientOptions, Middleware, ServerOptions, TransportKind } from '../../language-client/index'
import { IFileSystemWatcher } from '../../types'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'


function createClient(fileEvents: IFileSystemWatcher | IFileSystemWatcher[] | undefined, middleware: Middleware = {}): LanguageClient {
  const serverModule = path.join(import.meta.dirname, './server/fileWatchServer.js')
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: { module: serverModule, transport: TransportKind.ipc, options: { execArgv: ['--nolazy', '--inspect=6014'] } }
  }

  const documentSelector: DocumentSelector = [{ scheme: 'file' }]
  const clientOptions: LanguageClientOptions = {
    documentSelector,
    synchronize: { fileEvents },
    initializationOptions: {},
    middleware
  };
  (clientOptions as ({ $testMode?: boolean })).$testMode = true

  const result = new LanguageClient('test', 'Test Language Server', serverOptions, clientOptions)
  return result
}

class CustomWatcher implements IFileSystemWatcher {
  public ignoreCreateEvents = false
  public ignoreChangeEvents = false
  public ignoreDeleteEvents = false
  private readonly _onDidCreate = new Emitter<URI>()
  public readonly onDidCreate: Event<URI> = this._onDidCreate.event
  private readonly _onDidChange = new Emitter<URI>()
  public readonly onDidChange: Event<URI> = this._onDidChange.event
  private readonly _onDidDelete = new Emitter<URI>()
  public readonly onDidDelete: Event<URI> = this._onDidDelete.event
  constructor() {
  }

  public fireCreate(uri: URI): void {
    this._onDidCreate.fire(uri)
  }

  public fireChange(uri: URI): void {
    this._onDidChange.fire(uri)
  }

  public fireDelete(uri: URI): void {
    this._onDidDelete.fire(uri)
  }

  public dispose() {
  }
}


describe('FileSystemWatcherFeature', () => {
  it('should hook file events from client configuration', async t => {
    let res = asRelativePattern({ baseUri: { name: 'name', uri: '/tmp' }, pattern: '**' })
    assert.strictEqual(res.baseUri.fsPath, '/tmp')
    let client: LanguageClient
    let watcher = new CustomWatcher()
    let called = false
    let changes: FileChangeType[] = []
    client = createClient([watcher], {
      workspace: {
        didChangeWatchedFile: async (event, next): Promise<void> => {
          called = true
          if (event) {
            changes.push(event.type)
          }
          return next(event)
        }
      }
    })
    let received: any[]
    client.onNotification('filesChange', params => {
      received = params.changes
    })
    await client.start()
    assert.strictEqual(called, false)
    client.notifyFileEvent(undefined)
    await shared.wait(20)
    let uri = URI.file(import.meta.filename)
    watcher.fireCreate(uri)
    assert.strictEqual(called, true)
    watcher.fireChange(uri)
    watcher.fireDelete(uri)
    assert.deepStrictEqual(changes, [1, 2, 3])
    await shared.waitValue(() => {
      return received?.length
    }, 3)
    await client.stop()
    assert.deepStrictEqual(received[2], {
      uri: uri.toString(),
      type: 3
    })
  })

  it('should work with single watcher', async t => {
    let client: LanguageClient
    let watcher = new CustomWatcher()
    client = createClient(watcher, {})
    let received: any[]
    client.onNotification('filesChange', params => {
      received = params.changes
    })
    await client.start()
    let uri = URI.file(import.meta.filename)
    watcher.fireCreate(uri)
    await shared.waitValue(() => {
      return received?.length
    }, 1)
    let called = false
    let spy = t.mock.method(client, 'sendNotification', () => {
      called = true
      return Promise.reject(new Error('myerror'))
    })
    watcher.fireChange(uri)
    await shared.waitValue(() => called, true)
    await client.stop()
  })

  it('should support dynamic registration', async t => {
    let client: LanguageClient
    client = createClient(undefined)
    await client.start()
    await shared.waitValue(async () => {
      let feature = client.getFeature(DidChangeWatchedFilesNotification.method)
      if (feature) await (feature as any)._notifyFileEvent()
      return feature != undefined
    }, true)
    await shared.waitValue(async () => {
      let feature = client.getFeature(DidChangeWatchedFilesNotification.method)
      let state = feature.getState()
      return (state as any).registrations
    }, true)
    await client.sendNotification('unwatch')
    await shared.waitValue(() => {
      let feature = client.getFeature(DidChangeWatchedFilesNotification.method)
      let state = feature.getState()
      return (state as any)?.registrations
    }, false)
    await client.stop()
  })
})
