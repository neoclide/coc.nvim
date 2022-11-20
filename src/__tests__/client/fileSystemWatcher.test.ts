import path from 'path'
import { DidChangeWatchedFilesNotification, DocumentSelector, Emitter, Event, FileChangeType } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import { LanguageClient, LanguageClientOptions, Middleware, ServerOptions, TransportKind } from '../../language-client/index'
import { IFileSystemWatcher } from '../../types'
import helper from '../helper'

function createClient(fileEvents: IFileSystemWatcher | IFileSystemWatcher[] | undefined, middleware: Middleware = {}): LanguageClient {
  const serverModule = path.join(__dirname, './server/fileWatchServer.js')
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

beforeAll(async () => {
  await helper.setup()
})

afterAll(async () => {
  await helper.shutdown()
})

describe('FileSystemWatcherFeature', () => {
  it('should hook file events from client configuration', async () => {
    let client: LanguageClient
    let watcher = new CustomWatcher()
    let called = false
    let changes: FileChangeType[] = []
    client = createClient([watcher], {
      workspace: {
        didChangeWatchedFile: async (event, next): Promise<void> => {
          called = true
          changes.push(event.type)
          return next(event)
        }
      }
    })
    let received: any[]
    client.onNotification('filesChange', params => {
      received = params.changes
    })
    await client.start()
    expect(called).toBe(false)
    let uri = URI.file(__filename)
    watcher.fireCreate(uri)
    expect(called).toBe(true)
    watcher.fireChange(uri)
    watcher.fireDelete(uri)
    expect(changes).toEqual([1, 2, 3])
    await helper.waitValue(() => {
      return received?.length
    }, 1)
    await client.stop()
    expect(received[0]).toEqual({
      uri: uri.toString(),
      type: 3
    })
  })

  it('should work with single watcher', async () => {
    let client: LanguageClient
    let watcher = new CustomWatcher()
    client = createClient(watcher, {})
    let received: any[]
    client.onNotification('filesChange', params => {
      received = params.changes
    })
    await client.start()
    let uri = URI.file(__filename)
    watcher.fireCreate(uri)
    await helper.waitValue(() => {
      return received?.length
    }, 1)
    await client.stop()
  })

  it('should support dynamic registration', async () => {
    let client: LanguageClient
    client = createClient(undefined)
    await client.start()
    await helper.waitValue(async () => {
      let feature = client.getFeature(DidChangeWatchedFilesNotification.method)
      if (feature) await (feature as any)._notifyFileEvent()
      return feature != undefined
    }, true)
    await helper.waitValue(async () => {
      let feature = client.getFeature(DidChangeWatchedFilesNotification.method)
      let state = feature.getState()
      return (state as any).registrations
    }, true)
    await client.sendNotification('unwatch')
    await helper.waitValue(() => {
      let feature = client.getFeature(DidChangeWatchedFilesNotification.method)
      let state = feature.getState()
      return (state as any)?.registrations
    }, false)
    await client.stop()
  })
})
