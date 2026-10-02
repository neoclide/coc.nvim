import fs from 'fs'
import os from 'os'
import path from 'path'
import { PassThrough } from 'stream'
import type { TestContext } from 'node:test'
import { createProtocolConnection, DidRenameFilesNotification, ExitNotification, FileOperationRegistrationOptions, InitializeRequest, RenameFilesParams, ShutdownRequest } from 'vscode-languageserver-protocol'
import { StreamMessageReader, StreamMessageWriter } from 'vscode-languageserver-protocol/node'
import { URI } from 'vscode-uri'
import { FileSystemWatcher, FileSystemWatcherManager, RenameEvent } from '../../core/fileSystemWatcher'
import NativeWatcher from '../../core/nativeWatcher'
import { FileRenameFeature } from '../../language-client/fileRename'
import { LanguageClient, Middleware } from '../../language-client/index'
import workspace from '../../workspace'
import * as shared from '../sharedUtil'

describe('FileRenameFeature', () => {
  let client: LanguageClient
  let feature: FileRenameFeature
  let watchers: FileSystemWatcher[]
  let pending: Promise<void>[]
  let dir: string

  beforeEach(t => {
    watchers = []
    pending = []
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-rename-'))
    const mock = (t as TestContext).mock
    const createWatcher = workspace.createFileSystemWatcher.bind(workspace)
    mock.method(workspace, 'createFileSystemWatcher', (...args: Parameters<typeof createWatcher>) => {
      const watcher = createWatcher(...args)
      watchers.push(watcher)
      return watcher
    })
  })

  afterEach(async () => {
    await client?.stop()
    client = undefined
    fs.rmSync(dir, { recursive: true, force: true })
    await editorReset()
  })

  async function startClient(t: TestContext, filters: FileOperationRegistrationOptions['filters'] | null = [{ pattern: { glob: '**/*.ts' } }], middleware: Middleware = {}, disabledFeatures: string[] = []): Promise<void> {
    client = new LanguageClient('rename', 'Rename server', async () => {
      const input = new PassThrough()
      const output = new PassThrough()
      const connection = createProtocolConnection(new StreamMessageReader(input), new StreamMessageWriter(output))
      const received: RenameFilesParams[] = []
      connection.onRequest(InitializeRequest.type, () => ({
        capabilities: filters === null ? {} : { workspace: { fileOperations: { didRename: { filters } } } }
      }))
      connection.onNotification(DidRenameFilesNotification.type, params => { received.push(params) })
      connection.onRequest('renames', () => received)
      connection.onRequest(ShutdownRequest.type, () => undefined)
      connection.onNotification(ExitNotification.type, () => connection.dispose())
      connection.listen()
      return { reader: output, writer: input }
    }, { documentSelector: ['*'], middleware, disabledFeatures })
    feature = client['_features'].find(item => item instanceof FileRenameFeature)
    if (feature) {
      const send = feature.send.bind(feature)
      t.mock.method(feature, 'send', event => {
        const promise = send(event)
        pending.push(promise)
        return promise
      })
    }
    await client.start()
  }

  function rename(oldName = 'old.ts', newName = 'new.ts'): RenameEvent {
    return { oldUri: URI.file(path.join(dir, oldName)), newUri: URI.file(path.join(dir, newName)) }
  }

  function fireRename(file: RenameEvent): void {
    watchers.at(-1)['_onDidRename'].fire(file)
  }

  function willRename(file: RenameEvent): void {
    workspace.files['_onWillRenameFiles'].fire({ files: [file], waitUntil: () => {} })
  }

  async function received(): Promise<RenameFilesParams[]> {
    await Promise.all(pending)
    return client.sendRequest('renames')
  }

  function params(file: RenameEvent): RenameFilesParams {
    return { files: [{ oldUri: file.oldUri.toString(), newUri: file.newUri.toString() }] }
  }

  it('should send external renames through filters and middleware', async t => {
    let calls = 0
    await startClient(t, [{ scheme: 'file', pattern: { glob: '**/*.TS', options: { ignoreCase: true } } }], {
      workspace: { didRenameFiles: (event, next) => { calls++; return next(event) } }
    })
    assert.ok(feature instanceof FileRenameFeature)
    assert.strictEqual(watchers.length, 1)
    const file = rename('old.ts', 'new.js')
    fireRename(rename('old.js', 'new.ts'))
    fireRename({ oldUri: URI.parse('untitled:///old.ts'), newUri: file.newUri })
    fireRename(file)
    assert.deepStrictEqual(await received(), [params(file)])
    assert.strictEqual(calls, 1)
  })

  it('should suppress the watcher duplicate of workspace.renameFile', async t => {
    await startClient(t)
    const file = rename()
    fs.writeFileSync(file.oldUri.fsPath, 'text')
    await workspace.renameFile(file.oldUri.fsPath, file.newUri.fsPath)
    await shared.waitValue(async () => (await received()).length, 1)
    fireRename(file)
    assert.deepStrictEqual(await received(), [params(file)])
    // Once consumed, the same pair can represent a later external rename.
    fireRename(file)
    assert.deepStrictEqual(await received(), [params(file), params(file)])
  })

  it('should filter file renames by the destination type', async t => {
    await startClient(t, [{ pattern: { glob: '**/*', matches: 'file' } }])
    const file = rename()
    const folder = rename('old-folder', 'new-folder')
    fs.writeFileSync(file.newUri.fsPath, 'text')
    fs.mkdirSync(folder.newUri.fsPath)
    fireRename(file)
    fireRename(folder)
    assert.deepStrictEqual(await received(), [params(file)])
  })

  it('should filter folder renames with trailing-slash patterns by the destination type', async t => {
    await startClient(t, [{ pattern: { glob: '**/', matches: 'folder' } }])
    const file = rename()
    const folder = rename('old-folder', 'new-folder')
    fs.writeFileSync(file.newUri.fsPath, 'text')
    fs.mkdirSync(folder.newUri.fsPath)
    fireRename(file)
    fireRename(folder)
    assert.deepStrictEqual(await received(), [params(folder)])
  })

  it('should compare both URIs with the last will-rename event', async t => {
    await startClient(t)
    const first = rename()
    const differentTarget = rename('old.ts', 'other.ts')
    const differentSource = rename('other.ts', 'new.ts')
    willRename(first)
    fireRename(differentTarget)
    fireRename(differentSource)
    fireRename(first)
    assert.deepStrictEqual(await received(), [params(differentTarget), params(differentSource)])
  })

  it('should only remember the last will-rename event', async t => {
    await startClient(t)
    const first = rename()
    const second = rename('second.ts', 'target.ts')
    willRename(first)
    willRename(second)
    fireRename(first)
    fireRename(second)
    assert.deepStrictEqual(await received(), [params(first)])
  })

  it('should not watch when didRename is not advertised', async t => {
    await startClient(t, null)
    assert.strictEqual(watchers.length, 0)
  })

  it('should not watch when filters are empty or invalid', async t => {
    await startClient(t, [])
    assert.strictEqual(watchers.length, 0)
    feature.initialize({ workspace: { fileOperations: { didRename: { filters: [{ pattern: { glob: '' } }] } } } })
    assert.strictEqual(watchers.length, 0)
  })

  it('should discard a notification when middleware resumes after disposal', async t => {
    let resume: () => void
    let called = false
    const gate = new Promise<void>(resolve => { resume = resolve })
    await startClient(t, undefined, {
      workspace: {
        didRenameFiles: async (event, next) => {
          called = true
          await gate
          return next(event)
        }
      }
    })
    fireRename(rename())
    await shared.waitValue(() => called, true)
    feature.dispose()
    resume()
    assert.deepStrictEqual(await received(), [])
  })

  it('should release watchers and clear deduplication state when the client restarts', async t => {
    await startClient(t)
    const file = rename()
    willRename(file)
    const watcher = watchers[0]
    await client.stop()
    assert.strictEqual(FileSystemWatcherManager.watchers.has(watcher), false)
    await client.start()
    assert.strictEqual(watchers.length, 2)
    fireRename(file)
    assert.deepStrictEqual(await received(), [params(file)])
  })

  it('should respect disabled file events', async t => {
    await startClient(t, [{ pattern: { glob: '**/*' } }], {}, ['fileEvents'])
    assert.strictEqual(watchers.length, 0)
  })

  it('should report errors from watcher notifications', async t => {
    await startClient(t, undefined, {
      workspace: { didRenameFiles: () => { throw new Error('rename failure') } }
    })
    const error = t.mock.method(client, 'error', () => {})
    fireRename(rename())
    await shared.waitValue(() => error.mock.callCount(), 1)
    assert.match(String(error.mock.calls[0].arguments[1]), /rename failure/)
  })

  it('should notify the server of real external file and directory renames', async t => {
    const file = rename()
    const folder = rename('old-folder', 'new-folder')
    await startClient(t, [{ pattern: { glob: '**/*' } }])
    const native = await NativeWatcher.createClient(dir, shared.createNullChannel())
    const created = new Set<string>()
    const subscription = native.subscribe('**/*', change => {
      for (const file of change.files) {
        if (file.exists && file.new) created.add(file.name)
      }
    }, true)
    try {
      watchers[0].listen(dir, native)
      fs.writeFileSync(file.oldUri.fsPath, 'text')
      fs.mkdirSync(folder.oldUri.fsPath)
      await shared.waitValue(() => created.has('old.ts') && created.has('old-folder'), true)
      fs.renameSync(file.oldUri.fsPath, file.newUri.fsPath)
      await shared.waitValue(async () => (await received()).length, 1)
      fs.renameSync(folder.oldUri.fsPath, folder.newUri.fsPath)
      await shared.waitValue(async () => (await received()).length, 2)
      assert.deepStrictEqual(await received(), [params(file), params(folder)])
    } finally {
      subscription.dispose()
      native.dispose()
    }
  })
})
