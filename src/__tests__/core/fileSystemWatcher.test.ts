import * as shared from '../sharedUtil'
import Configurations from '../../configuration/index'
import { FileChange, FileWatcherClient } from '../../core/fileWatcher'
import { FileSystemWatcher, FileSystemWatcherManager } from '../../core/fileSystemWatcher'
import NativeWatcher, { createNativeOptions, detectLinuxLibc, getNativeWatcherTarget, normalizeWatcherPath, relativeWatcherPath } from '../../core/nativeWatcher'
import Watchman, { FileChangeItem } from '../../core/watchman'
import WorkspaceFolderController from '../../core/workspaceFolder'
import RelativePattern from '../../model/relativePattern'
import { GlobPattern } from '../../types'
import { disposeAll } from '../../util'
import { pluginRoot } from '../../util/constants'
import { remove } from '../../util/fs'
import bser from 'bser'
import fs from 'fs'
import { createRequire } from 'module'
import net from 'net'
import os from 'os'
import path from 'path'
import { promisify } from 'util'
import { Disposable } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import type ConfigurationsType from '../../configuration/index'
import type WorkspaceFolderControllerType from '../../core/workspaceFolder'
import { child_process } from '../../util/node'
import window from '../../window'


let server: net.Server
let client: net.Socket
const cwd = path.resolve(import.meta.dirname, '../../..')
const nodeRequire = createRequire(import.meta.url)
const sockPath = path.join(os.tmpdir(), `watchman-fake-${crypto.randomUUID()}`)
process.env.WATCHMAN_SOCK = sockPath

let workspaceFolder: WorkspaceFolderControllerType
let watcherManager: FileSystemWatcherManager
let configurations: ConfigurationsType
let disposables: Disposable[] = []

function wait(ms: number): Promise<any> {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve(undefined)
    }, ms)
  })
}

function createFileChange(file: string, isNew = true, exists = true, mtime = Date.now()): FileChangeItem {
  return {
    size: 1,
    name: file,
    exists,
    new: isNew,
    type: 'f',
    mtime_ms: mtime
  }
}

function sendResponse(data: any): void {
  client.write(bser.dumpToBuffer(data))
}

function sendSubscription(uid: string, root: string, files: FileChangeItem[]): void {
  client.write(bser.dumpToBuffer({
    subscription: uid,
    root,
    files
  }))
}

let capabilities: any
let watchResponse: any
let defaultConfig = { watchmanPath: null, enable: true, ignoredFolders: [] }

before(() => new Promise<void>(done => {
  let userConfigFile = path.join(process.env.COC_VIMCONFIG, 'coc-settings.json')
  configurations = new Configurations(userConfigFile, undefined)
  workspaceFolder = new WorkspaceFolderController(configurations)
  watcherManager = new FileSystemWatcherManager(workspaceFolder, { ...defaultConfig, watchmanPath: 'watchman' })
  Object.assign(watcherManager, { disabled: false })
  watcherManager.attach(shared.createNullChannel())
  // create a mock sever for watchman
  server = net.createServer(c => {
    client = c
    c.on('data', data => {
      let obj = bser.loadFromBuffer(data)
      if (obj[0] == 'watch-project') {
        sendResponse(watchResponse || { watch: obj[1], warning: 'warning' })
      } else if (obj[0] == 'unsubscribe') {
        sendResponse({ path: obj[1] })
      } else if (obj[0] == 'clock') {
        sendResponse({ clock: 'clock' })
      } else if (obj[0] == 'version') {
        let { optional, required } = obj[1]
        let res = {}
        for (let key of optional) {
          res[key] = true
        }
        for (let key of required) {
          res[key] = true
        }
        sendResponse({ capabilities: capabilities || res })
      } else if (obj[0] == 'subscribe') {
        sendResponse({ subscribe: obj[2] })
      } else {
        sendResponse({})
      }
    })
  })
  server.on('error', err => {
    throw err
  })
  server.listen(sockPath, () => {
    done()
  })
  server.unref()
}))

afterEach(async () => {
  disposeAll(disposables)
  capabilities = undefined
  watchResponse = undefined
})

describe('FileSystemWatcherManager.disabled', () => {
  it('should stay disabled under test environment even when enable is true', t => {
    let manager = new FileSystemWatcherManager(workspaceFolder, { watchmanPath: null, enable: true, ignoredFolders: [] })
    assert.strictEqual(manager.disabled, true)
    manager = new FileSystemWatcherManager(workspaceFolder, { watchmanPath: null, enable: false, ignoredFolders: [] })
    assert.strictEqual(manager.disabled, true)
  })
})

after(async () => {
  watcherManager.dispose()
  server.close()
  await remove(sockPath)
})

describe('watchman', () => {
  it('uses a supplied socket when WATCHMAN_SOCK is unset', async () => {
    let previous = process.env.WATCHMAN_SOCK
    delete process.env.WATCHMAN_SOCK
    let client = new Watchman('unused', shared.createNullChannel(), sockPath)
    try {
      assert.strictEqual(await client.checkCapability(), true)
      assert.strictEqual(process.env.WATCHMAN_SOCK, undefined)
    } finally {
      client.dispose()
      if (previous == null) delete process.env.WATCHMAN_SOCK
      else process.env.WATCHMAN_SOCK = previous
    }
  })

  it('uses a supplied socket without changing WATCHMAN_SOCK', async () => {
    let previous = process.env.WATCHMAN_SOCK
    let otherSocket = path.join(os.tmpdir(), `watchman-other-${crypto.randomUUID()}`)
    process.env.WATCHMAN_SOCK = otherSocket
    let channel = shared.createNullChannel()
    let client = new Watchman('unused', channel, sockPath)
    try {
      assert.strictEqual(await client.checkCapability(), true)
      assert.strictEqual(await client.watchProject(cwd), true)
      assert.strictEqual(client.root, cwd)
      assert.strictEqual(process.env.WATCHMAN_SOCK, otherSocket)
    } finally {
      client.dispose()
      if (previous == null) delete process.env.WATCHMAN_SOCK
      else process.env.WATCHMAN_SOCK = previous
    }
  })

  it('should not throw error when not watching', async t => {
    let client = new Watchman(null)
    disposables.push(client)
    let disposable = client.subscribe('**/*', () => {})
    disposable.dispose()
    client.dispose()
  })

  it('should checkCapability', async t => {
    let client = new Watchman(null)
    let res = await client.checkCapability()
    assert.strictEqual(res, true)
    capabilities = { relative_root: false }
    res = await client.checkCapability()
    assert.strictEqual(res, false)
    client.dispose()
  })

  it('should watchProject', async t => {
    let client = new Watchman(null)
    disposables.push(client)
    let res = await client.watchProject(import.meta.dirname)
    assert.strictEqual(res, true)
    client.dispose()
  })

  it('should unsubscribe', async t => {
    let client = new Watchman(null)
    disposables.push(client)
    await client.watchProject(cwd)
    let fn = t.mock.fn()
    let disposable = client.subscribe(`${cwd}/*`, fn)
    disposable.dispose()
    client.dispose()
  })
})

describe('Watchman#subscribe', () => {

  it('should subscribe file change', async t => {
    let client = new Watchman(null, shared.createNullChannel())
    disposables.push(client)
    await client.watchProject(cwd)
    let called = false
    let disposable = client.subscribe(`${cwd}/*`, () => {
      called = true
    })
    let changes: FileChangeItem[] = [createFileChange(`${cwd}/a`)]
    sendSubscription(client.subscription, cwd, changes)
    await shared.waitValue(() => called, true)
    assert.strictEqual(called, true)
    disposable.dispose()
    client.dispose()
  })

  it('should subscribe with relative_path', async t => {
    let client = new Watchman(null, shared.createNullChannel())
    watchResponse = { watch: cwd, relative_path: 'foo' }
    await client.watchProject(cwd)
    let fn = t.mock.fn()
    let disposable = client.subscribe(`${cwd}/*`, fn)
    let changes: FileChangeItem[] = [createFileChange(`${cwd}/a`)]
    sendSubscription(client.subscription, cwd, changes)
    await wait(30)
    assert.ok(fn.mock.callCount() > 0)
    let call = fn.mock.calls[0].arguments[0]
    disposable.dispose()
    assert.strictEqual(call.root, path.join(cwd, 'foo'))
    client.dispose()
  })

  it('should not subscribe invalid response', async t => {
    let c = new Watchman(null, shared.createNullChannel())
    disposables.push(c)
    watchResponse = { watch: cwd, relative_path: 'foo' }
    await c.watchProject(cwd)
    let fn = t.mock.fn()
    c.subscribe(`${cwd}/*`, fn)
    let changes: FileChangeItem[] = [createFileChange(`${cwd}/a`)]
    sendSubscription('uuid', cwd, changes)
    await wait(20)
    sendSubscription(c.subscription, cwd, [])
    await wait(20)
    client.write(bser.dumpToBuffer({
      subscription: c.subscription,
      root: cwd
    }))
    await wait(20)
    assert.strictEqual(fn.mock.callCount(), 0)
  })
})

describe('Watchman#createClient', () => {
  it('discovers and uses a quiet Watchman socket', async t => {
    let calls: Array<{ file: string, args: readonly string[], options: { windowsHide?: boolean } }> = []
    let fakeExecFile = (() => { throw new Error('unexpected direct execFile call') }) as unknown as typeof child_process.execFile
    Object.assign(fakeExecFile, {
      [promisify.custom]: async (file: string, args: readonly string[], options: { windowsHide?: boolean }) => {
        calls.push({ file, args, options })
        return { stdout: JSON.stringify({ sockname: sockPath }), stderr: 'socket discovery warning' }
      }
    })
    t.mock.property(child_process, 'execFile', fakeExecFile)
    let previous = process.env.WATCHMAN_SOCK
    let lines: string[] = []
    let channel = { ...shared.createNullChannel(), appendLine: line => lines.push(line) }
    let output = t.mock.method(console, 'error', () => {})
    delete process.env.WATCHMAN_SOCK
    try {
      let client = await Watchman.createClient('watchman', cwd, channel)
      client.dispose()
      assert.deepStrictEqual(calls, [{ file: 'watchman', args: ['--no-pretty', 'get-sockname'], options: { windowsHide: true, encoding: 'utf8' } }])
      assert.ok(lines.some(line => line.includes('socket discovery warning')))
      assert.ok(lines.some(line => line.includes(sockPath)))
      assert.strictEqual(process.env.WATCHMAN_SOCK, undefined)
      assert.strictEqual(output.mock.callCount(), 0)
    } finally {
      if (previous == null) delete process.env.WATCHMAN_SOCK
      else process.env.WATCHMAN_SOCK = previous
    }
  })

  it('rejects malformed Watchman socket discovery responses', async t => {
    let stdout = ''
    let fakeExecFile = (() => { throw new Error('unexpected direct execFile call') }) as unknown as typeof child_process.execFile
    Object.assign(fakeExecFile, { [promisify.custom]: async () => ({ stdout, stderr: '' }) })
    t.mock.property(child_process, 'execFile', fakeExecFile)
    let previous = process.env.WATCHMAN_SOCK
    delete process.env.WATCHMAN_SOCK
    try {
      for (let value of ['not json', 'null', '{}', '{"sockname":""}', '{"sockname":1}']) {
        let lines: string[] = []
        stdout = value
        await assert.rejects(Watchman.createClient('watchman', cwd, { ...shared.createNullChannel(), appendLine: line => lines.push(line) }))
        assert.ok(lines.some(line => line.includes('Watchman get-sockname failed')))
        assert.strictEqual(process.env.WATCHMAN_SOCK, undefined)
      }
    } finally {
      if (previous == null) delete process.env.WATCHMAN_SOCK
      else process.env.WATCHMAN_SOCK = previous
    }
  })

  it('should not create client when capabilities not match', async t => {
    capabilities = { relative_root: false }
    await assert.rejects(Watchman.createClient(null, cwd), Error)
  })

  it('should not create when watch failed', async t => {
    watchResponse = {}
    await assert.rejects(Watchman.createClient(null, cwd), Error)
  })

  it('should create client', async t => {
    let client = await Watchman.createClient(null, cwd)
    disposables.push(client)
    assert.notStrictEqual(client, undefined)
  })
})

describe('NativeWatcher', () => {
  it('keeps native events under normalized platform roots', () => {
    assert.strictEqual(normalizeWatcherPath('\\\\?\\C:\\work\\src\\a.ts', 'win32'), 'C:\\work\\src\\a.ts')
    assert.strictEqual(normalizeWatcherPath('\\\\?\\UNC\\server\\share\\a.ts', 'win32'), '\\\\server\\share\\a.ts')
    assert.strictEqual(relativeWatcherPath('\\\\?\\C:\\work', 'C:\\work\\src\\a.ts', 'win32'), 'src/a.ts')
    assert.strictEqual(relativeWatcherPath('C:\\work', '\\\\?\\C:\\work\\src\\a.ts', 'win32'), 'src/a.ts')
    assert.strictEqual(relativeWatcherPath('/tmp/cafe\u0301', '/tmp/caf\u00e9/a.ts', 'darwin'), 'a.ts')
  })

  it('should normalize native ignore options', () => {
    let root = path.resolve('/workspace')
    let options = createNativeOptions(root, root, ['/', root, 'node_modules', '**/.git/**'])
    assert.deepStrictEqual(options.ignorePaths, [path.resolve('/workspace/node_modules')])
    assert.strictEqual(options.ignoreGlobs?.length, 1)
    assert.strictEqual(new RegExp(options.ignoreGlobs[0]).test('.git/config'), true)
  })

  it('maps logical and canonical ignored paths to the native root', () => {
    let canonicalRoot = path.resolve('/physical/project')
    let logicalRoot = path.resolve('/links/project')
    let options = createNativeOptions(canonicalRoot, logicalRoot, [
      path.join(logicalRoot, 'logical-ignore'),
      path.join(canonicalRoot, 'canonical-ignore')
    ])
    assert.deepStrictEqual(options.ignorePaths, [
      path.join(canonicalRoot, 'logical-ignore'),
      path.join(canonicalRoot, 'canonical-ignore')
    ])
    options = createNativeOptions('/project', '/project/link', ['/project/link/cache'])
    assert.deepStrictEqual(options.ignorePaths, ['/project/cache'])
  })

  it('delivers callbacks received before subscribe resolves', async t => {
    let target = getNativeWatcherTarget()
    if (!target) return t.skip('unsupported platform')
    let parent = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-startup-'))
    let createdRoot = path.join(parent, 'project')
    fs.mkdirSync(createdRoot)
    let physicalRoot = fs.realpathSync(createdRoot)
    let binding = nodeRequire(path.join(pluginRoot, 'bin', 'watcher', target.filename)) as {
      subscribe: (root: string, callback: (error: Error | null, events: Array<{ path: string, type: 'create', kind: 'file' }>) => void, options: unknown) => Promise<void>
      unsubscribe: (root: string, callback: unknown, options: unknown) => Promise<void>
    }
    let started: () => void = () => {}
    let resolveSubscribe: () => void = () => {}
    let unsubscribeCalls = 0
    t.mock.method(binding, 'subscribe', (root, callback) => {
      started()
      callback(null, [{ path: path.join(root, 'early.txt'), type: 'create', kind: 'file' }])
      return new Promise<void>(resolve => { resolveSubscribe = resolve })
    })
    t.mock.method(binding, 'unsubscribe', () => {
      unsubscribeCalls++
      return Promise.resolve()
    })
    try {
      let startedPromise = new Promise<void>(resolve => { started = resolve })
      let creating = NativeWatcher.createClient(physicalRoot, shared.createNullChannel())
      await startedPromise
      await new Promise<void>(resolve => setImmediate(resolve))
      resolveSubscribe()
      let client = await creating
      let changes: FileChangeItem[] = []
      let disposable = client.subscribe('**/*', change => changes.push(...change.files))
      await shared.waitValue(() => changes.some(item => item.name === 'early.txt'), true)
      disposable.dispose()
      client.dispose()
      await shared.waitValue(() => unsubscribeCalls, 1)
    } finally {
      fs.rmSync(parent, { recursive: true, force: true })
    }
  })

  it('unsubscribes a deferred native subscribe when creation is cancelled', async t => {
    let target = getNativeWatcherTarget()
    if (!target) return t.skip('unsupported platform')
    let parent = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-cancel-'))
    let project = path.join(parent, 'project')
    let link = path.join(parent, 'link')
    fs.mkdirSync(project)
    try {
      fs.symlinkSync(project, link, process.platform === 'win32' ? 'junction' : 'dir')
    } catch (_e) {
      fs.rmSync(parent, { recursive: true, force: true })
      return t.skip('symbolic links unavailable')
    }
    let canonicalRoot = fs.realpathSync(project)
    let binding = nodeRequire(path.join(pluginRoot, 'bin', 'watcher', target.filename)) as {
      subscribe: (root: string, callback: unknown, options: unknown) => Promise<void>
      unsubscribe: (root: string, callback: unknown, options: unknown) => Promise<void>
    }
    let started: () => void = () => {}
    let resolveSubscribe: () => void = () => {}
    let unsubscribeStarted: () => void = () => {}
    let resolveUnsubscribe: () => void = () => {}
    let subscribeArgs: unknown[] = []
    t.mock.method(binding, 'subscribe', (...args) => {
      subscribeArgs = args
      started()
      return new Promise<void>(resolve => { resolveSubscribe = resolve })
    })
    let unsubscribe = t.mock.method(binding, 'unsubscribe', () => {
      unsubscribeStarted()
      return new Promise<void>(resolve => { resolveUnsubscribe = resolve })
    })
    let cancelled = false
    try {
      let startedPromise = new Promise<void>(resolve => { started = resolve })
      let unsubscribeStartedPromise = new Promise<void>(resolve => { unsubscribeStarted = resolve })
      let creating = NativeWatcher.createClient(link, shared.createNullChannel(), () => cancelled)
      let settled = false
      void creating.then(() => { settled = true }, () => { settled = true })
      await startedPromise
      cancelled = true
      resolveSubscribe()
      await unsubscribeStartedPromise
      await new Promise<void>(resolve => setImmediate(resolve))
      assert.strictEqual(settled, false)
      assert.strictEqual(unsubscribe.mock.callCount(), 1)
      let unsubscribeArgs = unsubscribe.mock.calls[0].arguments
      assert.strictEqual(unsubscribeArgs[0], canonicalRoot)
      assert.strictEqual(unsubscribeArgs[1], subscribeArgs[1])
      assert.strictEqual(unsubscribeArgs[2], subscribeArgs[2])
      resolveUnsubscribe()
      await assert.rejects(creating, /cancelled/)
    } finally {
      fs.rmSync(parent, { recursive: true, force: true })
    }
  })

  it('should default to glibc only when Linux runtime reporting is unavailable', () => {
    assert.strictEqual(detectLinuxLibc(undefined), 'glibc')
    assert.strictEqual(detectLinuxLibc({ header: {} }), 'musl')
    assert.strictEqual(detectLinuxLibc({ header: { glibcVersionRuntime: '2.39' } }), 'glibc')
  })

  it('should resolve supported desktop targets', () => {
    assert.deepStrictEqual(getNativeWatcherTarget('darwin', 'x64'), { filename: 'darwin-x64.node' })
    assert.deepStrictEqual(getNativeWatcherTarget('darwin', 'arm64'), { filename: 'darwin-arm64.node' })
    assert.deepStrictEqual(getNativeWatcherTarget('win32', 'x64'), { filename: 'win32-x64.node' })
    assert.deepStrictEqual(getNativeWatcherTarget('win32', 'arm64'), { filename: 'win32-arm64.node' })
    assert.deepStrictEqual(getNativeWatcherTarget('linux', 'x64', 'glibc'), { filename: 'linux-x64-glibc.node' })
    assert.deepStrictEqual(getNativeWatcherTarget('linux', 'arm64', 'musl'), { filename: 'linux-arm64-musl.node' })
    assert.strictEqual(getNativeWatcherTarget('linux', 'arm', 'glibc'), undefined)
    assert.strictEqual(getNativeWatcherTarget('freebsd', 'x64'), undefined)
    assert.strictEqual(getNativeWatcherTarget('android', 'arm64'), undefined)
    assert.strictEqual(getNativeWatcherTarget('linux', 'ppc64', 'glibc'), undefined)
  })

  it('should emit normalized file events from the bundled native watcher', async t => {
    if (!getNativeWatcherTarget()) return t.skip('unsupported platform')
    let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-watch-'))
    let client = await NativeWatcher.createClient(root, shared.createNullChannel())
    let watcher = new FileSystemWatcher('**/*.txt', false, false, false)
    let creates: string[] = []
    let updates: string[] = []
    let deletes: string[] = []
    watcher.onDidCreate(uri => creates.push(uri.fsPath))
    watcher.onDidChange(uri => updates.push(uri.fsPath))
    watcher.onDidDelete(uri => deletes.push(uri.fsPath))
    watcher.listen(root, client)
    try {
      fs.writeFileSync(path.join(root, 'created.txt'), 'one')
      await shared.waitValue(() => creates.length, 1)
      fs.appendFileSync(path.join(root, 'created.txt'), 'two')
      await shared.waitValue(() => updates.length, 1)
      fs.unlinkSync(path.join(root, 'created.txt'))
      await shared.waitValue(() => deletes.length, 1)
      assert.deepStrictEqual(creates, [path.join(root, 'created.txt')])
      assert.deepStrictEqual(updates, [path.join(root, 'created.txt')])
      assert.deepStrictEqual(deletes, [path.join(root, 'created.txt')])
      fs.writeFileSync(path.join(root, 'ignored.js'), 'one')
      fs.writeFileSync(path.join(root, 'barrier.txt'), 'one')
      await shared.waitValue(() => creates.includes(path.join(root, 'barrier.txt')), true)
      assert.strictEqual(creates.includes(path.join(root, 'ignored.js')), false)
    } finally {
      watcher.dispose()
      client.dispose()
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('should treat atomic replacement of an indexed file as an update', async t => {
    if (!getNativeWatcherTarget()) return t.skip('unsupported platform')
    let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-replace-'))
    let target = path.join(root, 'target.txt')
    let replacement = path.join(root, '.target.tmp')
    fs.writeFileSync(target, 'old')
    let client = await NativeWatcher.createClient(root, shared.createNullChannel())
    let changes: FileChangeItem[] = []
    let disposable = client.subscribe('**/*.txt', change => changes.push(...change.files))
    try {
      fs.writeFileSync(replacement, 'new')
      fs.renameSync(replacement, target)
      await shared.waitValue(() => changes.some(change => change.name === 'target.txt'), true)
      let change = changes.find(change => change.name === 'target.txt')
      assert.strictEqual(change?.exists, true)
      assert.strictEqual(change?.new, false)
    } finally {
      disposable.dispose()
      client.dispose()
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('should apply ignored folders in the bundled native watcher', async t => {
    if (!getNativeWatcherTarget()) return t.skip('unsupported platform')
    let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-ignore-'))
    let ignored = path.join(root, 'nested', 'path-ignored')
    let globIgnored = path.join(root, 'glob-ignored')
    let client = await NativeWatcher.createClient(root, shared.createNullChannel(), () => false, [ignored, '**/ignored', '**/ignored/**', path.join(globIgnored, '**')])
    let changes: FileChangeItem[] = []
    let disposable = client.subscribe('**/*.txt', change => changes.push(...change.files))
    try {
      fs.mkdirSync(path.join(root, 'nested', 'ignored'), { recursive: true })
      fs.mkdirSync(ignored, { recursive: true })
      fs.mkdirSync(globIgnored)
      fs.mkdirSync(path.join(root, 'visible'))
      fs.writeFileSync(path.join(root, 'nested', 'ignored', 'hidden.txt'), 'hidden')
      fs.writeFileSync(path.join(ignored, 'path-hidden.txt'), 'hidden')
      fs.writeFileSync(path.join(globIgnored, 'glob-hidden.txt'), 'hidden')
      fs.writeFileSync(path.join(root, 'visible', 'shown.txt'), 'shown')
      await shared.waitValue(() => changes.some(change => change.name === 'visible/shown.txt'), true)
      fs.writeFileSync(path.join(root, 'visible', 'barrier.txt'), 'barrier')
      await shared.waitValue(() => changes.some(change => change.name === 'visible/barrier.txt'), true)
      assert.strictEqual(changes.some(change => change.name === 'nested/ignored/hidden.txt'), false)
      assert.strictEqual(changes.some(change => change.name === 'nested/path-ignored/path-hidden.txt'), false)
      assert.strictEqual(changes.some(change => change.name === 'glob-ignored/glob-hidden.txt'), false)
    } finally {
      disposable.dispose()
      client.dispose()
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('should skip symbolic link entries', async t => {
    if (!getNativeWatcherTarget()) return t.skip('unsupported platform')
    let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-file-link-'))
    let target = `${root}-target.txt`
    let existing = path.join(root, 'existing.txt')
    let created = path.join(root, 'created.txt')
    let createLink = (link: string): void => {
      if (process.platform === 'win32') fs.symlinkSync(target, link, 'file')
      else fs.symlinkSync(target, link)
    }
    fs.writeFileSync(target, 'one')
    try {
      createLink(existing)
    } catch (_e) {
      fs.rmSync(root, { recursive: true, force: true })
      fs.rmSync(target, { force: true })
      return t.skip('symbolic links unavailable')
    }
    let client = await NativeWatcher.createClient(root, shared.createNullChannel())
    let changes: FileChangeItem[] = []
    let disposable = client.subscribe('*.txt', change => changes.push(...change.files))
    try {
      fs.unlinkSync(existing)
      createLink(created)
      fs.writeFileSync(path.join(root, 'visible.txt'), 'barrier')
      await shared.waitValue(() => changes.some(change => change.name === 'visible.txt'), true)
      assert.strictEqual(changes.some(change => change.name === 'existing.txt' || change.name === 'created.txt'), false)
    } finally {
      disposable.dispose()
      client.dispose()
      fs.rmSync(root, { recursive: true, force: true })
      fs.rmSync(target, { force: true })
    }
  })

  it('should normalize directory create and delete events from the native watcher', async t => {
    if (!getNativeWatcherTarget()) return t.skip('unsupported platform')
    let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-folders-'))
    let external = `${root}-external`
    fs.mkdirSync(path.join(root, 'deleted', 'nested'), { recursive: true })
    fs.writeFileSync(path.join(root, 'deleted', 'one.txt'), 'one')
    fs.writeFileSync(path.join(root, 'deleted', 'nested', 'two.txt'), 'two')
    let client = await NativeWatcher.createClient(root, shared.createNullChannel())
    let changes: FileChangeItem[] = []
    let disposable = client.subscribe('**/*', change => changes.push(...change.files))
    try {
      fs.rmSync(path.join(root, 'deleted'), { recursive: true })
      await shared.waitValue(() => changes.filter(change => !change.exists).length, 2)
      assert.deepStrictEqual(changes.filter(change => !change.exists).map(change => change.name).sort(), [
        'deleted/nested/two.txt',
        'deleted/one.txt'
      ])

      changes.length = 0
      fs.mkdirSync(path.join(external, 'nested'), { recursive: true })
      fs.writeFileSync(path.join(external, 'one.txt'), 'one')
      fs.writeFileSync(path.join(external, 'nested', 'two.txt'), 'two')
      fs.renameSync(external, path.join(root, 'imported'))
      await shared.waitValue(() => changes.filter(change => change.exists).length, 2)
      assert.deepStrictEqual(changes.filter(change => change.exists).map(change => change.name).sort(), [
        'imported/nested/two.txt',
        'imported/one.txt'
      ])

      changes.length = 0
      fs.mkdirSync(path.join(root, 'empty'))
      await wait(300)
      fs.rmSync(path.join(root, 'empty'), { recursive: true })
      fs.mkdirSync(path.join(root, 'unrelated'))
      fs.writeFileSync(path.join(root, 'unrelated', 'new.txt'), 'new')
      await shared.waitValue(() => changes.some(change => change.name === 'unrelated/new.txt'), true)
      await wait(150)
      assert.strictEqual(changes.some(change => change.name === 'empty/new.txt'), false)
    } finally {
      disposable.dispose()
      client.dispose()
      fs.rmSync(root, { recursive: true, force: true })
      fs.rmSync(external, { recursive: true, force: true })
    }
  })

  it('should normalize directory rename through a symlink root', async t => {
    if (!getNativeWatcherTarget()) return t.skip('unsupported platform')
    let parent = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-symlink-'))
    let physicalRoot = path.join(parent, 'project')
    let root = path.join(parent, 'link')
    fs.mkdirSync(path.join(physicalRoot, 'old', 'nested'), { recursive: true })
    fs.writeFileSync(path.join(physicalRoot, 'old', 'one.txt'), 'one')
    fs.writeFileSync(path.join(physicalRoot, 'old', 'nested', 'two.txt'), 'two')
    fs.symlinkSync(physicalRoot, root, process.platform === 'win32' ? 'junction' : 'dir')
    let client = await NativeWatcher.createClient(root, shared.createNullChannel())
    let watcher = new FileSystemWatcher('**/*.txt', false, false, false)
    let renames: string[] = []
    let changes: string[] = []
    let ready = false
    watcher.onDidRename(event => renames.push(`${event.oldUri.fsPath}->${event.newUri.fsPath}`))
    watcher.onDidChange(uri => changes.push(uri.fsPath))
    client.subscribe('barrier', () => { ready = true })
    watcher.listen(root, client)
    try {
      // Flush startup events so they cannot coalesce with the rename.
      fs.writeFileSync(path.join(physicalRoot, 'barrier'), 'ready')
      await shared.waitValue(() => ready, true)
      fs.renameSync(path.join(physicalRoot, 'old'), path.join(physicalRoot, 'new'))
      await shared.waitValue(() => renames.length, 2)
      assert.deepStrictEqual(renames.sort(), [
        `${path.join(root, 'old', 'nested', 'two.txt')}->${path.join(root, 'new', 'nested', 'two.txt')}`,
        `${path.join(root, 'old', 'one.txt')}->${path.join(root, 'new', 'one.txt')}`
      ].sort())
      changes.length = 0
      fs.appendFileSync(path.join(physicalRoot, 'new', 'one.txt'), 'changed')
      await shared.waitValue(() => changes, [path.join(root, 'new', 'one.txt')])
    } finally {
      watcher.dispose()
      client.dispose()
      fs.rmSync(parent, { recursive: true, force: true })
    }
  })

  it('should infer directory rename from normalized file events', () => {
    let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-directory-rename-'))
    let listener: ((change: FileChange) => void) | undefined
    let client: FileWatcherClient = {
      root,
      subscription: 'fake',
      supportsRenameId: false,
      subscribe: (_pattern, callback) => {
        listener = callback
        return Disposable.create(() => {})
      },
      dispose: () => {}
    }
    let watcher = new FileSystemWatcher('**/*.txt', false, false, false)
    let renames: string[] = []
    let creates: string[] = []
    let deletes: string[] = []
    watcher.onDidRename(event => renames.push(`${event.oldUri.fsPath}->${event.newUri.fsPath}`))
    watcher.onDidCreate(uri => creates.push(uri.fsPath))
    watcher.onDidDelete(uri => deletes.push(uri.fsPath))
    watcher.listen(root, client)
    try {
      listener!({
        root,
        subscription: 'fake',
        files: [
          { name: 'old-folder/one.txt', exists: false, new: false, type: 'f', size: 3, mtime_ms: 1 },
          { name: 'new-folder/one.txt', exists: true, new: true, type: 'f', size: 3, mtime_ms: 1 },
          { name: 'old-folder/two.txt', exists: false, new: false, type: 'f', size: 3, mtime_ms: 2 },
          { name: 'new-folder/two.txt', exists: true, new: true, type: 'f', size: 3, mtime_ms: 2 }
        ]
      })
      assert.strictEqual(renames.length, 2)
      assert.strictEqual(creates.length, 2)
      assert.strictEqual(deletes.length, 2)
    } finally {
      watcher.dispose()
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('uses native rename ids without inferring renames from metadata', () => {
    let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-rename-id-'))
    let listener: ((change: FileChange) => void) | undefined
    let client: FileWatcherClient = {
      root,
      subscription: 'fake',
      supportsRenameId: true,
      subscribe: (_pattern, callback) => {
        listener = callback
        return Disposable.create(() => {})
      },
      dispose: () => {}
    }
    let watcher = new FileSystemWatcher('**/*.txt', false, false, false)
    let renames: string[] = []
    watcher.onDidRename(event => renames.push(`${event.oldUri.fsPath}->${event.newUri.fsPath}`))
    watcher.listen(root, client)
    try {
      listener!({
        root,
        files: [
          { name: 'old.txt', exists: false, new: false, type: 'f', renameId: 'one' },
          { name: 'unrelated.txt', exists: true, new: true, type: 'f', renameId: 'two' },
          { name: 'new.txt', exists: true, new: true, type: 'f', renameId: 'one' }
        ]
      })
      assert.deepStrictEqual(renames, [`${path.join(root, 'old.txt')}->${path.join(root, 'new.txt')}`])
      for (let files of [
        [createFileChange('deleted.txt', false, false, 1), createFileChange('created.txt', true, true, 1)],
        [
          { ...createFileChange('deleted.txt', false, false, 1), renameId: 'old' },
          { ...createFileChange('created.txt', true, true, 1), renameId: 'new' }
        ],
        [
          createFileChange('old-folder/one.txt', false, false, 1),
          createFileChange('new-folder/one.txt', true, true, 1),
          createFileChange('old-folder/two.txt', false, false, 2),
          createFileChange('new-folder/two.txt', true, true, 2)
        ]
      ]) {
        listener!({ root, files })
        assert.deepStrictEqual(renames, [`${path.join(root, 'old.txt')}->${path.join(root, 'new.txt')}`])
      }
    } finally {
      watcher.dispose()
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

})

describe('fileSystemWatcher', () => {

  it('does not subscribe a RelativePattern outside the client root', () => {
    let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-watch-pattern-root-'))
    let outside = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-watch-pattern-outside-'))
    let subscriptions = 0
    let client: FileWatcherClient = {
      root,
      subscription: 'fake',
      supportsRenameId: false,
      subscribe: () => {
        subscriptions++
        return Disposable.create(() => {})
      },
      dispose: () => {}
    }
    let watcher = new FileSystemWatcher(new RelativePattern(outside, '**/*.ts'), false, false, false)
    let listened = 0
    watcher.onDidListen(() => listened++)
    try {
      watcher.listen(root, client)
      assert.strictEqual(subscriptions, 0)
      assert.strictEqual(listened, 0)
    } finally {
      watcher.dispose()
      fs.rmSync(root, { recursive: true, force: true })
      fs.rmSync(outside, { recursive: true, force: true })
    }
  })

  async function createWatcher(pattern: GlobPattern, ignoreCreateEvents = false, ignoreChangeEvents = false, ignoreDeleteEvents = false): Promise<FileSystemWatcher> {
    let watcher = watcherManager.createFileSystemWatcher(
      pattern,
      ignoreCreateEvents,
      ignoreChangeEvents,
      ignoreDeleteEvents
    )
    disposables.push(watcher)
    return watcher
  }

  before(async () => {
    workspaceFolder.addWorkspaceFolder(cwd, true)
    await watcherManager.waitClient(cwd)
  })

  it('should use relative pattern #1', async t => {
    let folder = workspaceFolder.workspaceFolders[0]
    assert.notStrictEqual(folder, undefined)
    let pattern = new RelativePattern(folder, '**/*')
    let watcher = await createWatcher(pattern, false, true, true)
    let fn = t.mock.fn()
    watcher.onDidCreate(fn)
    let changes: FileChangeItem[] = [createFileChange(`a`)]
    sendSubscription(watcher.subscribe, cwd, changes)
    await shared.waitValue(() => fn.mock.calls.length, 1)
    assert.ok(fn.mock.callCount() > 0)
  })

  it('should match relative pattern from nested base path', async t => {
    let pattern = new RelativePattern(path.join(cwd, 'src'), '*.ts')
    let watcher = await createWatcher(pattern, false, true, true)
    let fn = t.mock.fn()
    watcher.onDidCreate(fn)
    let changes: FileChangeItem[] = [
      createFileChange('index.ts'),
      createFileChange('src/index.ts'),
      createFileChange('src/nested/index.ts')
    ]
    sendSubscription(watcher.subscribe, cwd, changes)
    await shared.waitValue(() => fn.mock.calls.length, 1)
    assert.strictEqual(fn.mock.calls[0].arguments[0].fsPath, path.join(cwd, 'src/index.ts'))
  })

  it('should use relative pattern #2', async t => {
    let called = false
    let pattern = new RelativePattern(import.meta.dirname, '**/*')
    let watcher = await createWatcher(pattern, false, true, true)
    watcher.onDidCreate(() => {
      called = true
    })
    let changes: FileChangeItem[] = [createFileChange(`a`)]
    sendSubscription(watcher.subscribe, cwd, changes)
    await shared.wait(30)
    assert.strictEqual(called, false)
  })

  it('should use relative pattern #3', async t => {
    let called = false
    let root = path.join(process.cwd(), 'not_exists')
    let pattern = new RelativePattern(root, '**/*')
    let watcher = await createWatcher(pattern, false, true, true)
    watcher.onDidCreate(() => {
      called = true
    })
    await shared.wait(20)
    let changes: FileChangeItem[] = [createFileChange(`a`)]
    sendSubscription(watcher.subscribe, cwd, changes)
    await shared.wait(20)
    assert.strictEqual(called, false)
  })

  it('should watch for file create', async t => {
    let watcher = await createWatcher('**/*', false, true, true)
    let called = false
    watcher.onDidCreate(() => {
      called = true
    })
    let changes: FileChangeItem[] = [createFileChange(`a`)]
    sendSubscription(watcher.subscribe, cwd, changes)
    await shared.waitValue(() => {
      return called
    }, true)
  })

  it('should watch for file delete', async t => {
    let watcher = await createWatcher('**/*', true, true, false)
    let called = false
    watcher.onDidDelete(() => {
      called = true
    })
    let changes: FileChangeItem[] = [createFileChange(`a`, false, false)]
    sendSubscription(watcher.subscribe, cwd, changes)
    await shared.waitValue(() => {
      return called
    }, true)
  })

  it('should watch for file change', async t => {
    let watcher = await createWatcher('**/*', false, false, false)
    let called = false
    watcher.onDidChange(() => {
      called = true
    })
    let changes: FileChangeItem[] = [createFileChange(`a`, false, true)]
    sendSubscription(watcher.subscribe, cwd, changes)
    await shared.waitValue(() => {
      return called
    }, true)
  })

  it('should watch for file rename', async t => {
    let watcher = await createWatcher('**/*', false, false, false)
    let called = false
    watcher.onDidRename(() => {
      called = true
    })
    await shared.wait(50)
    let changes: FileChangeItem[] = [
      createFileChange(`a`, false, false, 1),
      createFileChange(`b`, true, true, 1),
    ]
    sendSubscription(watcher.subscribe, cwd, changes)
    await shared.waitValue(() => {
      return called
    }, true)
  })

  it('should not infer file rename without matching metadata', async t => {
    let watcher = await createWatcher('**/*', false, false, false)
    let called = false
    watcher.onDidRename(() => {
      called = true
    })
    sendSubscription(watcher.subscribe, cwd, [
      { name: 'deleted', exists: false, new: false, type: 'f' },
      createFileChange('created', true, true, 1),
    ])
    await wait(20)
    assert.strictEqual(called, false)
  })

  it('should not watch for events', async t => {
    let watcher = await createWatcher('**/*', true, true, true)
    let called = false
    let onChange = () => { called = true }
    watcher.onDidCreate(onChange)
    watcher.onDidChange(onChange)
    watcher.onDidDelete(onChange)
    let changes: FileChangeItem[] = [
      createFileChange(`a`, false, false),
      createFileChange(`b`, true, true),
      createFileChange(`c`, false, true),
    ]
    sendSubscription(watcher.subscribe, cwd, changes)
    await shared.wait(20)
    assert.strictEqual(called, false)
  })

  it('should watch for folder rename', async t => {
    let watcher = await createWatcher('**/*')
    let newFiles: string[] = []
    let count = 0
    watcher.onDidRename(e => {
      count++
      newFiles.push(e.newUri.fsPath)
    })
    let changes: FileChangeItem[] = [
      // Pair a/1 with b/1 and a/2 with b/2 via distinct mtimes so rename
      // detection is deterministic instead of racing the millisecond clock.
      createFileChange(`a/1`, false, false, 1),
      createFileChange(`a/2`, false, false, 2),
      createFileChange(`b/1`, true, true, 1),
      createFileChange(`b/2`, true, true, 2),
    ]
    sendSubscription(watcher.subscribe, cwd, changes)
    await shared.waitValue(() => {
      return count
    }, 2)
  })

  it('should watch for new folder', async t => {
    let watcher = await createWatcher('**/*')
    assert.notStrictEqual(watcher, undefined)
    workspaceFolder.renameWorkspaceFolder(cwd, import.meta.dirname)
    let uri: URI
    watcher.onDidCreate(e => {
      uri = e
    })
    await watcherManager.waitClient(import.meta.dirname)
    let changes: FileChangeItem[] = [createFileChange(`a`)]
    sendSubscription(watcher.subscribe, import.meta.dirname, changes)
    await shared.waitValue(() => {
      return uri?.fsPath
    }, path.join(import.meta.dirname, 'a'))
  })
})

describe('create FileSystemWatcherManager', () => {
  function createFakeClient(root: string): FileWatcherClient {
    return {
      root,
      subscription: 'fake',
      supportsRenameId: false,
      subscribe: () => Disposable.create(() => {}),
      dispose: () => {}
    }
  }

  it('does not start a backend when disposed, disabled, or root-ignored', async t => {
    let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-watch-no-start-'))
    let native = t.mock.method(NativeWatcher, 'createClient', () => Promise.reject(new Error('should not run')))
    let watchman = t.mock.method(Watchman, 'createClient', () => Promise.reject(new Error('should not run')))
    let disposed: FileSystemWatcherManager | undefined
    let disabled: FileSystemWatcherManager | undefined
    let ignored: FileSystemWatcherManager | undefined
    try {
      disposed = new FileSystemWatcherManager(new WorkspaceFolderController(configurations), defaultConfig)
      disposed.disabled = false
      disposed.dispose()
      assert.strictEqual(await disposed.createClient(root, true), false)
      disabled = new FileSystemWatcherManager(new WorkspaceFolderController(configurations), defaultConfig)
      assert.strictEqual(await disabled.createClient(root), undefined)
      ignored = new FileSystemWatcherManager(new WorkspaceFolderController(configurations), { ...defaultConfig, ignoredFolders: [root] })
      ignored.disabled = false
      assert.strictEqual(await ignored.createClient(root), undefined)
      assert.strictEqual(native.mock.callCount(), 0)
      assert.strictEqual(watchman.mock.callCount(), 0)
    } finally {
      disposed?.dispose()
      disabled?.dispose()
      ignored?.dispose()
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('should attach to existing workspace folder', async t => {
    let workspaceFolder = new WorkspaceFolderController(configurations)
    workspaceFolder.addWorkspaceFolder(cwd, false)
    let watcherManager = new FileSystemWatcherManager(workspaceFolder, { ...defaultConfig, enable: false, watchmanPath: 'watchman' })
    watcherManager.disabled = false
    watcherManager.attach(shared.createNullChannel())
    await watcherManager.createClient(cwd)
    await watcherManager.waitClient(cwd)
    watcherManager.dispose()
  })

  it('should get watchman path', async t => {
    let watcherManager = new FileSystemWatcherManager(workspaceFolder, { ...defaultConfig, watchmanPath: 'invalid_command' })
    process.env.WATCHMAN_SOCK = ''
    await assert.rejects(() => watcherManager.getWatchmanPath(), Error)
    process.env.WATCHMAN_SOCK = sockPath
  })

  it('should settle concurrent waitClient when create fails', async t => {
    let watcherManager = new FileSystemWatcherManager(workspaceFolder, { ...defaultConfig, watchmanPath: 'invalid_command' })
    Object.assign(watcherManager, { disabled: false })
    process.env.WATCHMAN_SOCK = ''
    t.mock.method(NativeWatcher, 'createClient', () => Promise.reject(new Error('missing binary')))
    try {
      let p1 = watcherManager.createClient(cwd)
      let p2 = watcherManager.createClient(cwd)
      let results = await Promise.race([
        Promise.all([p1, p2]),
        wait(1000).then(() => {
          throw new Error('waitClient did not settle after failed create')
        })
      ])
      assert.deepStrictEqual(results, [false, false])
    } finally {
      process.env.WATCHMAN_SOCK = sockPath
    }
  })

  it('should fall back to Watchman when native watcher creation fails', async t => {
    let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-watch-fallback-'))
    let folderControl = new WorkspaceFolderController(configurations)
    let manager = new FileSystemWatcherManager(folderControl, defaultConfig)
    manager.disabled = false
    let originalSock = process.env.WATCHMAN_SOCK
    process.env.WATCHMAN_SOCK = ''
    let native = t.mock.method(NativeWatcher, 'createClient', () => Promise.reject(new Error('missing binary')))
    let watchman = t.mock.method(Watchman, 'createClient', () => Promise.resolve(createFakeClient(root)))
    t.mock.method(manager, 'getWatchmanPath', () => Promise.resolve('watchman'))
    try {
      let client = await manager.createClient(root)
      assert.notStrictEqual(client, false)
      assert.strictEqual(native.mock.callCount(), 1)
      assert.strictEqual(watchman.mock.callCount(), 1)
    } finally {
      manager.dispose()
      process.env.WATCHMAN_SOCK = originalSock
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('should prefer native watcher when Watchman is not configured', async t => {
    let originalSock = process.env.WATCHMAN_SOCK
    process.env.WATCHMAN_SOCK = sockPath
    let currentRoot = ''
    let native = t.mock.method(NativeWatcher, 'createClient', () => Promise.resolve(createFakeClient(currentRoot) as NativeWatcher))
    let watchman = t.mock.method(Watchman, 'createClient', () => Promise.reject(new Error('should not run')))
    try {
      for (let watchmanPath of [null, undefined, ''] as const) {
        let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-watch-native-first-'))
        currentRoot = root
        let ignoredFolders = [path.join(root, 'ignored')]
        let manager = new FileSystemWatcherManager(new WorkspaceFolderController(configurations), { ...defaultConfig, watchmanPath, ignoredFolders })
        manager.disabled = false
        let nativeCalls = native.mock.callCount()
        try {
          let client = await manager.createClient(root)
          assert.notStrictEqual(client, false)
          assert.strictEqual(native.mock.callCount(), nativeCalls + 1)
          assert.deepStrictEqual(native.mock.calls.at(-1)?.arguments[3], ignoredFolders)
          assert.strictEqual(watchman.mock.callCount(), 0)
        } finally {
          manager.dispose()
          fs.rmSync(root, { recursive: true, force: true })
        }
      }
    } finally {
      process.env.WATCHMAN_SOCK = originalSock
    }
  })

  it('should fall back to native watcher after an explicit Watchman failure', async t => {
    let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-watch-explicit-'))
    let folderControl = new WorkspaceFolderController(configurations)
    let manager = new FileSystemWatcherManager(folderControl, { ...defaultConfig, watchmanPath: '/custom/watchman' })
    manager.disabled = false
    let originalSock = process.env.WATCHMAN_SOCK
    process.env.WATCHMAN_SOCK = sockPath
    let native = t.mock.method(NativeWatcher, 'createClient', () => Promise.resolve(createFakeClient(root) as NativeWatcher))
    let watchman = t.mock.method(Watchman, 'createClient', () => Promise.reject(new Error('not available')))
    try {
      let client = await manager.createClient(root)
      assert.notStrictEqual(client, false)
      assert.strictEqual(native.mock.callCount(), 1)
      assert.strictEqual(watchman.mock.callCount(), 1)
      assert.strictEqual(watchman.mock.calls[0].arguments[0], '/custom/watchman')
    } finally {
      manager.dispose()
      process.env.WATCHMAN_SOCK = originalSock
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('uses an explicit Watchman success without creating native watcher', async t => {
    let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-watch-explicit-success-'))
    let manager = new FileSystemWatcherManager(new WorkspaceFolderController(configurations), { ...defaultConfig, watchmanPath: '/custom/watchman' })
    manager.disabled = false
    let watchman = t.mock.method(Watchman, 'createClient', () => Promise.resolve(createFakeClient(root)))
    let native = t.mock.method(NativeWatcher, 'createClient', () => Promise.reject(new Error('should not run')))
    try {
      assert.notStrictEqual(await manager.createClient(root), false)
      assert.strictEqual(watchman.mock.callCount(), 1)
      assert.strictEqual(native.mock.callCount(), 0)
    } finally {
      manager.dispose()
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('falls back to native when explicit Watchman path resolution fails', async t => {
    let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-watch-missing-executable-'))
    let manager = new FileSystemWatcherManager(new WorkspaceFolderController(configurations), { ...defaultConfig, watchmanPath: path.join(root, 'missing-watchman') })
    manager.disabled = false
    let lines: string[] = []
    manager.attach({ ...shared.createNullChannel(), appendLine: line => lines.push(line) })
    let originalSock = process.env.WATCHMAN_SOCK
    delete process.env.WATCHMAN_SOCK
    let native = t.mock.method(NativeWatcher, 'createClient', () => Promise.resolve(createFakeClient(root) as NativeWatcher))
    let watchman = t.mock.method(Watchman, 'createClient', () => Promise.reject(new Error('should not run')))
    try {
      assert.notStrictEqual(await manager.createClient(root), false)
      assert.strictEqual(watchman.mock.callCount(), 0)
      assert.strictEqual(native.mock.callCount(), 1)
      assert.ok(lines.some(line => line.includes('Unable to use watchman watcher')))
      assert.ok(lines.some(line => line.includes('Using native watcher')))
    } finally {
      manager.dispose()
      if (originalSock == null) delete process.env.WATCHMAN_SOCK
      else process.env.WATCHMAN_SOCK = originalSock
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('falls back after a Watchman socket connection error', async t => {
    let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-watch-socket-fallback-'))
    let manager = new FileSystemWatcherManager(new WorkspaceFolderController(configurations), { ...defaultConfig, watchmanPath: 'watchman' })
    manager.disabled = false
    let originalSock = process.env.WATCHMAN_SOCK
    let missingSock = path.join(os.tmpdir(), `watchman-missing-${crypto.randomUUID()}`)
    let native = t.mock.method(NativeWatcher, 'createClient', () => Promise.resolve(createFakeClient(root) as NativeWatcher))
    process.env.WATCHMAN_SOCK = missingSock
    try {
      let client = await manager.createClient(root)
      assert.notStrictEqual(client, false)
      assert.strictEqual(native.mock.callCount(), 1)
    } finally {
      manager.dispose()
      process.env.WATCHMAN_SOCK = originalSock
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('falls back to native after a Watchman command error', async t => {
    let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-watch-command-fallback-'))
    let manager = new FileSystemWatcherManager(new WorkspaceFolderController(configurations), { ...defaultConfig, watchmanPath: 'watchman' })
    manager.disabled = false
    let lines: string[] = []
    manager.attach({ ...shared.createNullChannel(), appendLine: line => lines.push(line) })
    let nativeClient = createFakeClient(root) as NativeWatcher
    let native = t.mock.method(NativeWatcher, 'createClient', () => Promise.resolve(nativeClient))
    let originalSock = process.env.WATCHMAN_SOCK
    process.env.WATCHMAN_SOCK = sockPath
    watchResponse = { error: 'watch-project failed' }
    try {
      assert.strictEqual(await manager.createClient(root), nativeClient)
      assert.strictEqual(native.mock.callCount(), 1)
      assert.ok(lines.some(line => line.includes('Unable to use watchman watcher')))
      assert.ok(lines.some(line => line.includes('watch-project failed')))
      assert.ok(lines.some(line => line.includes('Using native watcher')))
      await shared.waitValue(() => client.destroyed, true)
    } finally {
      watchResponse = undefined
      manager.dispose()
      if (originalSock == null) delete process.env.WATCHMAN_SOCK
      else process.env.WATCHMAN_SOCK = originalSock
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('keeps a failed Watchman executable quiet before native fallback', async t => {
    let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-watch-cli-fallback-'))
    let manager = new FileSystemWatcherManager(new WorkspaceFolderController(configurations), { ...defaultConfig, watchmanPath: process.execPath })
    manager.disabled = false
    let originalSock = process.env.WATCHMAN_SOCK
    let lines: string[] = []
    manager.attach({ ...shared.createNullChannel(), appendLine: line => lines.push(line) })
    let native = t.mock.method(NativeWatcher, 'createClient', () => Promise.resolve(createFakeClient(root) as NativeWatcher))
    let output = t.mock.method(console, 'error', () => {})
    process.env.WATCHMAN_SOCK = ''
    try {
      let client = await manager.createClient(root)
      assert.notStrictEqual(client, false)
      assert.strictEqual(native.mock.callCount(), 1)
      assert.strictEqual(output.mock.callCount(), 0)
      assert.ok(lines.some(line => line.includes('Unable to use watchman watcher')))
    } finally {
      manager.dispose()
      process.env.WATCHMAN_SOCK = originalSock
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('tries each backend once and reports unavailable backends', async t => {
    let calls: string[] = []
    t.mock.method(NativeWatcher, 'createClient', () => {
      calls.push('native')
      return Promise.reject(new Error('native failed'))
    })
    t.mock.method(Watchman, 'createClient', () => {
      calls.push('watchman')
      return Promise.reject(new Error('watchman failed'))
    })
    for (let [watchmanPath, expected] of [[null, ['native', 'watchman']], ['watchman', ['watchman', 'native']]] as const) {
      let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-watch-both-fail-'))
      let manager = new FileSystemWatcherManager(new WorkspaceFolderController(configurations), { ...defaultConfig, watchmanPath })
      manager.disabled = false
      let lines: string[] = []
      manager.attach({ ...shared.createNullChannel(), appendLine: line => lines.push(line) })
      t.mock.method(manager, 'getWatchmanPath', () => Promise.resolve('watchman'))
      calls.length = 0
      try {
        assert.strictEqual(await manager.createClient(root), false)
        assert.deepStrictEqual(calls, expected)
        assert.ok(lines.some(line => line.includes('No file watcher backend available')))
      } finally {
        manager.dispose()
        fs.rmSync(root, { recursive: true, force: true })
      }
    }
  })

  it('quietly falls back after rejecting an old Linux glibc native watcher', async t => {
    let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-watch-old-glibc-'))
    let watchman = t.mock.method(Watchman, 'createClient', () => Promise.reject(new Error('watchman failed')))
    t.mock.property(process, 'platform', 'linux')
    t.mock.property(process, 'arch', 'x64')
    t.mock.method(process.report, 'getReport', () => ({ header: { glibcVersionRuntime: '2.27' } }))
    let output = t.mock.method(console, 'error', () => {})
    let showError = t.mock.method(window, 'showErrorMessage', () => Promise.resolve(undefined))
    try {
      for (let watchmanPath of [null, 'watchman'] as const) {
        let manager = new FileSystemWatcherManager(new WorkspaceFolderController(configurations), { ...defaultConfig, watchmanPath })
        let lines: string[] = []
        manager.disabled = false
        manager.attach({ ...shared.createNullChannel(), appendLine: line => lines.push(line) })
        t.mock.method(manager, 'getWatchmanPath', () => Promise.resolve('watchman'))
        let calls = watchman.mock.callCount()
        try {
          assert.strictEqual(await manager.createClient(root), false)
          assert.strictEqual(watchman.mock.callCount(), calls + 1)
          assert.ok(lines.some(line => line.includes('detected 2.27')))
          assert.ok(lines.some(line => line.includes('glibc 2.28 or later')))
          let attempts = lines.filter(line => line.startsWith('Trying '))
          let nativeAttempt = `Trying native watcher for ${root}`
          let watchmanAttempt = `Trying watchman watcher for ${root}`
          assert.deepStrictEqual(attempts, watchmanPath ? [watchmanAttempt, nativeAttempt] : [nativeAttempt, watchmanAttempt])
          assert.strictEqual(output.mock.callCount(), 0)
          assert.strictEqual(showError.mock.callCount(), 0)
        } finally {
          manager.dispose()
        }
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('uses Watchman once after old glibc rejects the default native backend', async t => {
    let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-watch-old-glibc-success-'))
    let fallback = createFakeClient(root)
    let manager = new FileSystemWatcherManager(new WorkspaceFolderController(configurations), defaultConfig)
    let lines: string[] = []
    manager.disabled = false
    manager.attach({ ...shared.createNullChannel(), appendLine: line => lines.push(line) })
    t.mock.property(process, 'platform', 'linux')
    t.mock.property(process, 'arch', 'x64')
    t.mock.method(process.report, 'getReport', () => ({ header: { glibcVersionRuntime: '2.27' } }))
    let watchman = t.mock.method(Watchman, 'createClient', () => Promise.resolve(fallback))
    try {
      assert.strictEqual(await manager.createClient(root), fallback)
      assert.strictEqual(watchman.mock.callCount(), 1)
      assert.deepStrictEqual(lines.filter(line => line.startsWith('Trying ')), [
        `Trying native watcher for ${root}`,
        `Trying watchman watcher for ${root}`
      ])
    } finally {
      manager.dispose()
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('quietly falls back when loading a supported glibc native binary fails', async t => {
    let target = getNativeWatcherTarget('linux', 'x64', 'glibc')
    assert.ok(target)
    let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-watch-dlopen-fallback-'))
    let filepath = path.join(pluginRoot, 'bin', 'watcher', target.filename)
    let resolved = nodeRequire.resolve(filepath)
    let cached = nodeRequire.cache[resolved]
    delete nodeRequire.cache[resolved]
    let manager = new FileSystemWatcherManager(new WorkspaceFolderController(configurations), defaultConfig)
    let lines: string[] = []
    let fallback = createFakeClient(root)
    manager.disabled = false
    manager.attach({ ...shared.createNullChannel(), appendLine: line => lines.push(line) })
    t.mock.property(process, 'platform', 'linux')
    t.mock.property(process, 'arch', 'x64')
    t.mock.method(process.report, 'getReport', () => ({ header: { glibcVersionRuntime: '2.28' } }))
    let dlopen = t.mock.method(process, 'dlopen', () => { throw new Error('GLIBC_2.30 not found') })
    let watchman = t.mock.method(Watchman, 'createClient', () => Promise.resolve(fallback))
    let output = t.mock.method(console, 'error', () => {})
    let showError = t.mock.method(window, 'showErrorMessage', () => Promise.resolve(undefined))
    try {
      assert.strictEqual(await manager.createClient(root), fallback)
      assert.strictEqual(dlopen.mock.callCount(), 1)
      assert.strictEqual(watchman.mock.callCount(), 1)
      assert.ok(lines.some(line => line.includes('GLIBC_2.30 not found')))
      assert.strictEqual(output.mock.callCount(), 0)
      assert.strictEqual(showError.mock.callCount(), 0)
    } finally {
      manager.dispose()
      if (cached) nodeRequire.cache[resolved] = cached
      else delete nodeRequire.cache[resolved]
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('shares a concurrent native creation', async t => {
    let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-watch-shared-native-'))
    let manager = new FileSystemWatcherManager(new WorkspaceFolderController(configurations), defaultConfig)
    manager.disabled = false
    let resolveClient: (client: FileWatcherClient) => void = () => {}
    let native = t.mock.method(NativeWatcher, 'createClient', () => new Promise<FileWatcherClient>(resolve => { resolveClient = resolve }) as Promise<NativeWatcher>)
    let client = createFakeClient(root)
    try {
      let first = manager.createClient(root)
      let second = manager.createClient(root)
      await shared.waitValue(() => native.mock.callCount(), 1)
      resolveClient(client)
      assert.strictEqual(await first, client)
      assert.strictEqual(await second, client)
    } finally {
      manager.dispose()
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('waitClient shares only the matching root creation', async t => {
    let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-watch-wait-root-'))
    let otherRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-watch-wait-other-'))
    let manager = new FileSystemWatcherManager(new WorkspaceFolderController(configurations), defaultConfig)
    manager.disabled = false
    let resolveRoot: (client: FileWatcherClient) => void = () => {}
    let rootClient = createFakeClient(root)
    let otherClient = createFakeClient(otherRoot)
    let native = t.mock.method(NativeWatcher, 'createClient', filepath => {
      if (filepath === root) return new Promise<FileWatcherClient>(resolve => { resolveRoot = resolve }) as Promise<NativeWatcher>
      return Promise.resolve(otherClient as NativeWatcher)
    })
    try {
      let waiting = manager.waitClient(root)
      let settled = false
      void waiting.then(() => { settled = true })
      assert.strictEqual(await manager.createClient(otherRoot), otherClient)
      await new Promise<void>(resolve => setImmediate(resolve))
      assert.strictEqual(settled, false)
      let creating = manager.createClient(root)
      let pendingWait = manager.waitClient(root)
      await shared.waitValue(() => native.mock.callCount(), 2)
      resolveRoot(rootClient)
      assert.strictEqual(await creating, rootClient)
      assert.strictEqual(await waiting, rootClient)
      assert.strictEqual(await pendingWait, rootClient)
    } finally {
      manager.dispose()
      fs.rmSync(root, { recursive: true, force: true })
      fs.rmSync(otherRoot, { recursive: true, force: true })
    }
  })

  it('cancels while getWatchmanPath is pending', async t => {
    for (let removeFolder of [false, true]) {
      let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-watch-path-cancel-'))
      let folders = new WorkspaceFolderController(configurations)
      if (removeFolder) folders.addWorkspaceFolder(root, false)
      let manager = new FileSystemWatcherManager(folders, { ...defaultConfig, watchmanPath: 'watchman' })
      manager.disabled = false
      let resolvePath: (value: string) => void = () => {}
      let lookup = t.mock.method(manager, 'getWatchmanPath', () => new Promise<string>(resolve => { resolvePath = resolve }))
      let native = t.mock.method(NativeWatcher, 'createClient', () => Promise.reject(new Error('should not run')))
      let watchman = t.mock.method(Watchman, 'createClient', () => Promise.reject(new Error('should not run')))
      let created = 0
      manager.onDidCreateClient(() => created++)
      try {
        if (removeFolder) manager.attach(shared.createNullChannel())
        let creating = manager.createClient(root)
        await shared.waitValue(() => lookup.mock.callCount(), 1)
        if (removeFolder) folders.removeWorkspaceFolder(root)
        else manager.dispose()
        resolvePath('watchman')
        assert.strictEqual(await creating, false)
        assert.strictEqual(native.mock.callCount(), 0)
        assert.strictEqual(watchman.mock.callCount(), 0)
        assert.strictEqual(created, 0)
      } finally {
        manager.dispose()
        fs.rmSync(root, { recursive: true, force: true })
      }
    }
  })

  it('does not start fallback after cancellation of either first backend', async t => {
    for (let watchmanPath of [null, 'watchman'] as const) {
      let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-watch-cancel-fallback-'))
      let manager = new FileSystemWatcherManager(new WorkspaceFolderController(configurations), { ...defaultConfig, watchmanPath })
      manager.disabled = false
      let first = watchmanPath ? 'watchman' : 'native'
      let calls: string[] = []
      let rejectFirst: (error: Error) => void = () => {}
      let native = t.mock.method(NativeWatcher, 'createClient', () => {
        calls.push('native')
        return first === 'native'
          ? new Promise<NativeWatcher>((_resolve, reject) => { rejectFirst = reject })
          : Promise.reject(new Error('fallback started'))
      })
      let watchman = t.mock.method(Watchman, 'createClient', () => {
        calls.push('watchman')
        return first === 'watchman'
          ? new Promise<FileWatcherClient>((_resolve, reject) => { rejectFirst = reject })
          : Promise.reject(new Error('fallback started'))
      })
      t.mock.method(manager, 'getWatchmanPath', () => Promise.resolve('watchman'))
      try {
        let pending = manager.createClient(root)
        await shared.waitValue(() => calls.length, 1)
        manager.dispose()
        rejectFirst(new Error('first backend failed'))
        assert.strictEqual(await pending, false)
        assert.deepStrictEqual(calls, [first])
        assert.strictEqual(native.mock.callCount() + watchman.mock.callCount(), 1)
      } finally {
        manager.dispose()
        fs.rmSync(root, { recursive: true, force: true })
      }
    }
  })

  it('disposes a client whose creation completes after the folder was removed', async t => {
    let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-watch-race-'))
    let folderControl = new WorkspaceFolderController(configurations)
    folderControl.addWorkspaceFolder(root, false)
    let watcherManager = new FileSystemWatcherManager(folderControl, { ...defaultConfig, enable: true, ignoredFolders: [], watchmanPath: 'watchman' })
    watcherManager.disabled = false
    let resolveClient: (c: any) => void = () => {}
    let createSpy = t.mock.method(Watchman, 'createClient', () => new Promise(resolve => {
      resolveClient = resolve
    }))
    let fakeClient = { dispose: t.mock.fn() }
    let created = 0
    watcherManager.onDidCreateClient(() => created++)
    watcherManager.attach(shared.createNullChannel())
    let pending = watcherManager.createClient(root)
    // Wait until the pending creation has actually reached the stubbed
    // Watchman.createClient call before removing the folder.
    await shared.waitValue(() => createSpy.mock.calls.length, 1)
    folderControl.removeWorkspaceFolder(root)
    resolveClient(fakeClient)
    await pending
    assert.ok(fakeClient.dispose.mock.callCount() > 0)
    assert.strictEqual((watcherManager as any).clientsMap.size, 0)
    assert.strictEqual(created, 0)
    watcherManager.dispose()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('disposes a client whose creation completes after manager dispose', async t => {
    let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-watch-race-'))
    let folderControl = new WorkspaceFolderController(configurations)
    folderControl.addWorkspaceFolder(root, false)
    let watcherManager = new FileSystemWatcherManager(folderControl, { ...defaultConfig, enable: true, ignoredFolders: [], watchmanPath: 'watchman' })
    watcherManager.disabled = false
    let resolveClient: (c: any) => void = () => {}
    let createSpy = t.mock.method(Watchman, 'createClient', () => new Promise(resolve => {
      resolveClient = resolve
    }))
    let fakeClient = { dispose: t.mock.fn() }
    let created = 0
    watcherManager.onDidCreateClient(() => created++)
    watcherManager.attach(shared.createNullChannel())
    let pending = watcherManager.createClient(root)
    await shared.waitValue(() => createSpy.mock.calls.length, 1)
    watcherManager.dispose()
    resolveClient(fakeClient)
    await pending
    assert.ok(fakeClient.dispose.mock.callCount() > 0)
    assert.strictEqual((watcherManager as any).clientsMap.size, 0)
    assert.strictEqual(created, 0)
    watcherManager.dispose()
    fs.rmSync(root, { recursive: true, force: true })
  })
})

describe('FileSystemWatcher dispose', () => {
  it('releases every event emitter including delete and listen', t => {
    let watcher = new FileSystemWatcher('**/*', false, false, false)
    let calls: Record<string, number> = { create: 0, change: 0, delete: 0, rename: 0, listen: 0 }
    watcher.onDidCreate(() => calls.create++)
    watcher.onDidChange(() => calls.change++)
    watcher.onDidDelete(() => calls.delete++)
    watcher.onDidRename(() => calls.rename++)
    watcher.onDidListen(() => calls.listen++)
    let w = watcher as any
    watcher.dispose()
    for (let name of ['_onDidCreate', '_onDidChange', '_onDidDelete', '_onDidRename', '_onDidListen']) {
      assert.strictEqual(w[name]._callbacks, undefined)
    }
    // simulating underlying changes after dispose must not call anything
    w._onDidCreate.fire(URI.file('/x'))
    w._onDidChange.fire(URI.file('/x'))
    w._onDidDelete.fire(URI.file('/x'))
    w._onDidRename.fire({ oldUri: URI.file('/a'), newUri: URI.file('/b') })
    w._onDidListen.fire()
    assert.deepStrictEqual(calls, { create: 0, change: 0, delete: 0, rename: 0, listen: 0 })
  })
})
