import NativeWatcher, { getNativeWatcherTarget } from '../../core/nativeWatcher'
import { FileSystemWatcher } from '../../core/fileSystemWatcher'
import RelativePattern from '../../model/relativePattern'
import type { OutputChannel } from '../../types'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createRequire } from 'module'
import { pluginRoot } from '../../util/constants'

interface NativeEvent {
  path: string
  type: 'create' | 'update' | 'delete'
  kind: 'file' | 'directory'
  renameId?: string
}

type NativeCallback = (error: Error | null, events: NativeEvent[]) => void

interface NativeBinding {
  subscribe(root: string, callback: NativeCallback, options: unknown): Promise<void>
  unsubscribe(root: string, callback: NativeCallback, options: unknown): Promise<void>
}

const nodeRequire = createRequire(import.meta.url)

function createRoot(): { root: string, dispose: () => void } {
  let parent = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-unit-'))
  let root = path.join(parent, 'root')
  fs.mkdirSync(root)
  return { root: fs.realpathSync(root), dispose: () => fs.rmSync(parent, { recursive: true, force: true }) }
}

function getBinding(t: { skip(message?: string): void }): NativeBinding | undefined {
  let target = getNativeWatcherTarget()
  if (!target) {
    t.skip('unsupported platform')
    return undefined
  }
  return nodeRequire(path.join(pluginRoot, 'bin', 'watcher', target.filename)) as NativeBinding
}

async function nextTurn(): Promise<void> {
  await new Promise<void>(resolve => setImmediate(resolve))
}

describe('NativeWatcher unit', () => {
  it('keeps native batches separate, including file and directory replacement', async t => {
    let binding = getBinding(t)
    if (!binding) return
    let fixture = createRoot()
    let callback: NativeCallback | undefined
    let client: NativeWatcher | undefined
    t.mock.method(binding, 'subscribe', (_root, fn) => {
      callback = fn
      return Promise.resolve()
    })
    t.mock.method(binding, 'unsubscribe', () => Promise.resolve())
    try {
      client = await NativeWatcher.createClient(fixture.root)
      let changes: string[][] = []
      let disposable = client.subscribe('**/*', change => changes.push(change.files.map(file => `${file.name}:${file.exists}:${file.new}`)))
      callback!(null, [{ path: path.join(fixture.root, 'replace.ts'), type: 'create', kind: 'file' }])
      callback!(null, [{ path: path.join(fixture.root, 'replace.ts'), type: 'update', kind: 'file' }])
      await nextTurn()
      callback!(null, [
        { path: path.join(fixture.root, 'replace.ts'), type: 'delete', kind: 'file' },
        { path: path.join(fixture.root, 'replace.ts'), type: 'create', kind: 'directory' }
      ])
      callback!(null, [
        { path: path.join(fixture.root, 'replace.ts'), type: 'delete', kind: 'directory' },
        { path: path.join(fixture.root, 'replace.ts'), type: 'create', kind: 'file' }
      ])
      await nextTurn()
      assert.deepStrictEqual(changes, [
        ['replace.ts:true:true'],
        ['replace.ts:true:false'],
        ['replace.ts:false:false'],
        ['replace.ts:true:true']
      ])
      callback!(null, [{ path: path.join(fixture.root, 'empty'), type: 'create', kind: 'directory' }])
      await nextTurn()
      assert.strictEqual(changes.length, 4)
      disposable.dispose()
    } finally {
      client?.dispose()
      fixture.dispose()
    }
  })

  it('fires rename only when both native sides match glob and relative patterns', async t => {
    let binding = getBinding(t)
    if (!binding) return
    let fixture = createRoot()
    let callback: NativeCallback | undefined
    let client: NativeWatcher | undefined
    let glob: FileSystemWatcher | undefined
    let relative: FileSystemWatcher | undefined
    t.mock.method(binding, 'subscribe', (_root, fn) => {
      callback = fn
      return Promise.resolve()
    })
    t.mock.method(binding, 'unsubscribe', () => Promise.resolve())
    try {
      client = await NativeWatcher.createClient(fixture.root)
      glob = new FileSystemWatcher('**/*.ts', false, false, false)
      relative = new FileSystemWatcher(new RelativePattern(path.join(fixture.root, 'nested'), '*.ts'), false, false, false)
      let globCreated: string[] = []
      let globDeleted: string[] = []
      let globRenamed: string[] = []
      let relativeCreated: string[] = []
      let relativeDeleted: string[] = []
      let relativeRenamed: string[] = []
      glob.onDidCreate(uri => globCreated.push(uri.fsPath))
      glob.onDidDelete(uri => globDeleted.push(uri.fsPath))
      glob.onDidRename(event => globRenamed.push(`${event.oldUri.fsPath}:${event.newUri.fsPath}`))
      relative.onDidCreate(uri => relativeCreated.push(uri.fsPath))
      relative.onDidDelete(uri => relativeDeleted.push(uri.fsPath))
      relative.onDidRename(event => relativeRenamed.push(`${event.oldUri.fsPath}:${event.newUri.fsPath}`))
      glob.listen(fixture.root, client)
      relative.listen(fixture.root, client)
      callback!(null, [
        { path: path.join(fixture.root, 'old.ts'), type: 'delete', kind: 'file', renameId: 'glob-partial' },
        { path: path.join(fixture.root, 'new.js'), type: 'create', kind: 'file', renameId: 'glob-partial' }
      ])
      await nextTurn()
      assert.deepStrictEqual(globDeleted, [path.join(fixture.root, 'old.ts')])
      assert.deepStrictEqual(globCreated, [])
      assert.deepStrictEqual(globRenamed, [])
      callback!(null, [
        { path: path.join(fixture.root, 'nested', 'old.ts'), type: 'delete', kind: 'file', renameId: 'relative-partial' },
        { path: path.join(fixture.root, 'outside.ts'), type: 'create', kind: 'file', renameId: 'relative-partial' }
      ])
      await nextTurn()
      assert.deepStrictEqual(globDeleted, [path.join(fixture.root, 'old.ts'), path.join(fixture.root, 'nested', 'old.ts')])
      assert.deepStrictEqual(globCreated, [path.join(fixture.root, 'outside.ts')])
      assert.deepStrictEqual(relativeDeleted, [path.join(fixture.root, 'nested', 'old.ts')])
      assert.deepStrictEqual(relativeCreated, [])
      assert.deepStrictEqual(globRenamed, [`${path.join(fixture.root, 'nested', 'old.ts')}:${path.join(fixture.root, 'outside.ts')}`])
      assert.deepStrictEqual(relativeRenamed, [])
      callback!(null, [
        { path: path.join(fixture.root, 'outside.js'), type: 'delete', kind: 'file', renameId: 'relative-entering' },
        { path: path.join(fixture.root, 'nested', 'enter.ts'), type: 'create', kind: 'file', renameId: 'relative-entering' }
      ])
      await nextTurn()
      assert.deepStrictEqual(relativeCreated, [path.join(fixture.root, 'nested', 'enter.ts')])
      assert.deepStrictEqual(relativeRenamed, [])
      callback!(null, [
        { path: path.join(fixture.root, 'old.ts'), type: 'delete', kind: 'file', renameId: 'glob-full' },
        { path: path.join(fixture.root, 'new.ts'), type: 'create', kind: 'file', renameId: 'glob-full' },
        { path: path.join(fixture.root, 'nested', 'before.ts'), type: 'delete', kind: 'file', renameId: 'relative-full' },
        { path: path.join(fixture.root, 'nested', 'after.ts'), type: 'create', kind: 'file', renameId: 'relative-full' }
      ])
      await nextTurn()
      assert.deepStrictEqual(globRenamed, [
        `${path.join(fixture.root, 'nested', 'old.ts')}:${path.join(fixture.root, 'outside.ts')}`,
        `${path.join(fixture.root, 'old.ts')}:${path.join(fixture.root, 'new.ts')}`,
        `${path.join(fixture.root, 'nested', 'before.ts')}:${path.join(fixture.root, 'nested', 'after.ts')}`
      ])
      assert.deepStrictEqual(relativeRenamed, [`${path.join(fixture.root, 'nested', 'before.ts')}:${path.join(fixture.root, 'nested', 'after.ts')}`])
    } finally {
      glob?.dispose()
      relative?.dispose()
      client?.dispose()
      fixture.dispose()
    }
  })

  it('suppresses queued and future callbacks after dispose and unsubscribes once', async t => {
    let binding = getBinding(t)
    if (!binding) return
    let fixture = createRoot()
    let callback: NativeCallback | undefined
    let client: NativeWatcher | undefined
    let unsubscribe = t.mock.method(binding, 'unsubscribe', () => Promise.resolve())
    t.mock.method(binding, 'subscribe', (_root, fn) => {
      callback = fn
      return Promise.resolve()
    })
    try {
      client = await NativeWatcher.createClient(fixture.root)
      let first = 0
      let second = 0
      let firstDisposable = client.subscribe('**/*', () => first++)
      client.subscribe('**/*', () => second++)
      firstDisposable.dispose()
      callback!(null, [{ path: path.join(fixture.root, 'listener.ts'), type: 'create', kind: 'file' }])
      await nextTurn()
      assert.strictEqual(first, 0)
      assert.strictEqual(second, 1)
      callback!(null, [{ path: path.join(fixture.root, 'queued.ts'), type: 'create', kind: 'file' }])
      client.dispose()
      client.dispose()
      callback!(null, [{ path: path.join(fixture.root, 'future.ts'), type: 'create', kind: 'file' }])
      await nextTurn()
      assert.strictEqual(first, 0)
      assert.strictEqual(second, 1)
      assert.strictEqual(unsubscribe.mock.callCount(), 1)
    } finally {
      client?.dispose()
      fixture.dispose()
    }
  })

  it('reports callback and cleanup errors without propagating them', async t => {
    let binding = getBinding(t)
    if (!binding) return
    let fixture = createRoot()
    let callback: NativeCallback | undefined
    let client: NativeWatcher | undefined
    let lines: string[] = []
    t.mock.method(binding, 'subscribe', (_root, fn) => {
      callback = fn
      return Promise.resolve()
    })
    t.mock.method(binding, 'unsubscribe', () => Promise.reject(new Error('unsubscribe failed')))
    try {
      let channel: OutputChannel = {
        name: 'native-watcher-test',
        content: '',
        append: () => {},
        appendLine: line => lines.push(line),
        clear: () => {},
        show: () => {},
        hide: () => {},
        dispose: () => {}
      }
      client = await NativeWatcher.createClient(fixture.root, channel)
      callback!(new Error('callback failed'), [])
      client.dispose()
      await nextTurn()
      assert.ok(lines.some(line => line.includes('Native watcher error: Error: callback failed')))
      assert.ok(lines.some(line => line.includes('Error unsubscribing Native watcher: Error: unsubscribe failed')))
    } finally {
      client?.dispose()
      fixture.dispose()
    }
  })

  it('does not unsubscribe after subscribe rejection or subscribe after realpath failure', async t => {
    let binding = getBinding(t)
    if (!binding) return
    let fixture = createRoot()
    let subscribe = t.mock.method(binding, 'subscribe', () => Promise.reject(new Error('subscribe failed')))
    let unsubscribe = t.mock.method(binding, 'unsubscribe', () => Promise.resolve())
    try {
      await assert.rejects(NativeWatcher.createClient(fixture.root), /subscribe failed/)
      assert.strictEqual(unsubscribe.mock.callCount(), 0)
      let missing = path.join(fixture.root, 'missing')
      await assert.rejects(NativeWatcher.createClient(missing), /ENOENT/)
      assert.strictEqual(subscribe.mock.callCount(), 1)
    } finally {
      fixture.dispose()
    }
  })

  it('does not resolve a root or subscribe when already cancelled', async t => {
    let binding = getBinding(t)
    if (!binding) return
    let fixture = createRoot()
    let realpath = t.mock.method(fs.promises, 'realpath', () => Promise.resolve(fixture.root))
    let subscribe = t.mock.method(binding, 'subscribe', () => Promise.resolve())
    try {
      await assert.rejects(NativeWatcher.createClient(fixture.root, undefined, () => true), /cancelled/)
      assert.strictEqual(realpath.mock.callCount(), 0)
      assert.strictEqual(subscribe.mock.callCount(), 0)
    } finally {
      fixture.dispose()
    }
  })

  it('does not subscribe when cancellation occurs while realpath is pending', async t => {
    let binding = getBinding(t)
    if (!binding) return
    let fixture = createRoot()
    let resolveRealpath: (value: string) => void = () => {}
    let realpathStarted: () => void = () => {}
    let cancelled = false
    let subscribe = t.mock.method(binding, 'subscribe', () => Promise.resolve())
    let unsubscribe = t.mock.method(binding, 'unsubscribe', () => Promise.resolve())
    t.mock.method(fs.promises, 'realpath', () => {
      realpathStarted()
      return new Promise<string>(resolve => { resolveRealpath = resolve })
    })
    try {
      let started = new Promise<void>(resolve => { realpathStarted = resolve })
      let creating = NativeWatcher.createClient(fixture.root, undefined, () => cancelled)
      await started
      cancelled = true
      resolveRealpath(fixture.root)
      await assert.rejects(creating, /cancelled/)
      assert.strictEqual(subscribe.mock.callCount(), 0)
      assert.strictEqual(unsubscribe.mock.callCount(), 0)
    } finally {
      fixture.dispose()
    }
  })
})
