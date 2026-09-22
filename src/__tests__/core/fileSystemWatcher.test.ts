import * as shared from '../sharedUtil'
import Configurations from '../../configuration/index'
import { FileChange, FileWatcherClient } from '../../core/fileWatcher'
import { FileSystemWatcher, FileSystemWatcherManager } from '../../core/fileSystemWatcher'
import ParcelWatcher, { createParcelOptions, detectLinuxLibc, getParcelWatcherTarget, normalizeWatcherPath, relativeWatcherPath, watcherPathKey } from '../../core/parcelWatcher'
import Watchman, { FileChangeItem } from '../../core/watchman'
import WorkspaceFolderController from '../../core/workspaceFolder'
import RelativePattern from '../../model/relativePattern'
import { GlobPattern } from '../../types'
import { disposeAll } from '../../util'
import { remove } from '../../util/fs'
import bser from 'bser'
import fs from 'fs'
import net from 'net'
import os from 'os'
import path from 'path'
import { Disposable } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import type ConfigurationsType from '../../configuration/index'
import type WorkspaceFolderControllerType from '../../core/workspaceFolder'


let server: net.Server
let client: net.Socket
const cwd = path.resolve(import.meta.dirname, '../../..')
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

describe('ParcelWatcher', () => {
  it('should normalize native ignore options', () => {
    let root = path.resolve('/workspace')
    let options = createParcelOptions(root, 'inotify', ['/', root, 'node_modules', '**/.git/**'])
    assert.deepStrictEqual(options.ignorePaths, [path.resolve('/workspace/node_modules')])
    assert.strictEqual(options.ignoreGlobs?.length, 1)
    assert.strictEqual(new RegExp(options.ignoreGlobs[0]).test('.git/config'), true)
  })

  it('should normalize platform paths used by the event index', () => {
    assert.strictEqual(normalizeWatcherPath('\\\\?\\C:\\work\\src\\a.ts', 'win32'), 'C:\\work\\src\\a.ts')
    assert.strictEqual(normalizeWatcherPath('\\\\?\\UNC\\server\\share\\a.ts', 'win32'), '\\\\server\\share\\a.ts')
    assert.strictEqual(relativeWatcherPath('\\\\?\\C:\\work', 'C:\\work\\src\\a.ts', 'win32'), 'src/a.ts')
    assert.strictEqual(relativeWatcherPath('C:\\work', '\\\\?\\C:\\work\\src\\a.ts', 'win32'), 'src/a.ts')
    assert.strictEqual(watcherPathKey('C:\\WORK\\A.ts', 'win32'), watcherPathKey('c:\\work\\a.ts', 'win32'))
    assert.strictEqual(watcherPathKey('/tmp/cafe\u0301', 'darwin'), watcherPathKey('/tmp/caf\u00e9', 'darwin'))
  })

  it('should default to glibc only when Linux runtime reporting is unavailable', () => {
    assert.strictEqual(detectLinuxLibc(undefined), 'glibc')
    assert.strictEqual(detectLinuxLibc({ header: {} }), 'musl')
    assert.strictEqual(detectLinuxLibc({ header: { glibcVersionRuntime: '2.39' } }), 'glibc')
  })

  it('should resolve supported desktop targets', () => {
    assert.deepStrictEqual(getParcelWatcherTarget('darwin', 'x64'), { backend: 'fs-events', filename: 'darwin-x64.node' })
    assert.deepStrictEqual(getParcelWatcherTarget('darwin', 'arm64'), { backend: 'fs-events', filename: 'darwin-arm64.node' })
    assert.deepStrictEqual(getParcelWatcherTarget('win32', 'x64'), { backend: 'windows', filename: 'win32-x64.node' })
    assert.deepStrictEqual(getParcelWatcherTarget('win32', 'arm64'), { backend: 'windows', filename: 'win32-arm64.node' })
    assert.deepStrictEqual(getParcelWatcherTarget('linux', 'x64', 'glibc'), { backend: 'inotify', filename: 'linux-x64-glibc.node' })
    assert.deepStrictEqual(getParcelWatcherTarget('linux', 'arm64', 'musl'), { backend: 'inotify', filename: 'linux-arm64-musl.node' })
    assert.deepStrictEqual(getParcelWatcherTarget('linux', 'arm', 'glibc'), { backend: 'inotify', filename: 'linux-arm-glibc.node' })
    assert.deepStrictEqual(getParcelWatcherTarget('freebsd', 'x64'), { backend: 'kqueue', filename: 'freebsd-x64.node' })
    assert.strictEqual(getParcelWatcherTarget('android', 'arm64'), undefined)
    assert.strictEqual(getParcelWatcherTarget('linux', 'ppc64', 'glibc'), undefined)
  })

  it('should emit normalized file events from the bundled native watcher', async t => {
    if (!getParcelWatcherTarget()) return t.skip('unsupported platform')
    let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-parcel-watch-'))
    let client = await ParcelWatcher.createClient(root, shared.createNullChannel())
    let changes: FileChangeItem[] = []
    let disposable = client.subscribe('**/*.txt', change => changes.push(...change.files))
    try {
      fs.writeFileSync(path.join(root, 'created.txt'), 'one')
      await shared.waitValue(() => changes.some(change => change.name === 'created.txt' && change.new), true)
      fs.writeFileSync(path.join(root, 'ignored.js'), 'one')
      await wait(100)
      assert.strictEqual(changes.some(change => change.name === 'ignored.js'), false)
    } finally {
      disposable.dispose()
      client.dispose()
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('should treat atomic replacement of an indexed file as an update', async t => {
    if (!getParcelWatcherTarget()) return t.skip('unsupported platform')
    let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-parcel-replace-'))
    let target = path.join(root, 'target.txt')
    let replacement = path.join(root, '.target.tmp')
    fs.writeFileSync(target, 'old')
    let client = await ParcelWatcher.createClient(root, shared.createNullChannel())
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
    if (!getParcelWatcherTarget()) return t.skip('unsupported platform')
    let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-parcel-ignore-'))
    let client = await ParcelWatcher.createClient(root, shared.createNullChannel(), () => false, ['**/ignored', '**/ignored/**'])
    let changes: FileChangeItem[] = []
    let disposable = client.subscribe('**/*.txt', change => changes.push(...change.files))
    try {
      fs.mkdirSync(path.join(root, 'nested', 'ignored'), { recursive: true })
      fs.mkdirSync(path.join(root, 'visible'))
      fs.writeFileSync(path.join(root, 'nested', 'ignored', 'hidden.txt'), 'hidden')
      fs.writeFileSync(path.join(root, 'visible', 'shown.txt'), 'shown')
      await shared.waitValue(() => changes.some(change => change.name === 'visible/shown.txt'), true)
      await wait(150)
      assert.strictEqual(changes.some(change => change.name === 'nested/ignored/hidden.txt'), false)
    } finally {
      disposable.dispose()
      client.dispose()
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('should emit file events for symbolic links', async t => {
    if (!getParcelWatcherTarget()) return t.skip('unsupported platform')
    let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-parcel-file-link-'))
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
    let client = await ParcelWatcher.createClient(root, shared.createNullChannel())
    let changes: FileChangeItem[] = []
    let disposable = client.subscribe('*.txt', change => changes.push(...change.files))
    try {
      fs.unlinkSync(existing)
      await shared.waitValue(() => changes.some(change => change.name === 'existing.txt' && !change.exists), true)

      changes.length = 0
      createLink(created)
      await shared.waitValue(() => changes.some(change => change.name === 'created.txt' && change.exists && change.new), true)
    } finally {
      disposable.dispose()
      client.dispose()
      fs.rmSync(root, { recursive: true, force: true })
      fs.rmSync(target, { force: true })
    }
  })

  it('should normalize directory create and delete events from the native watcher', async t => {
    if (!getParcelWatcherTarget()) return t.skip('unsupported platform')
    let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-parcel-folders-'))
    let external = `${root}-external`
    fs.mkdirSync(path.join(root, 'deleted', 'nested'), { recursive: true })
    fs.writeFileSync(path.join(root, 'deleted', 'one.txt'), 'one')
    fs.writeFileSync(path.join(root, 'deleted', 'nested', 'two.txt'), 'two')
    let client = await ParcelWatcher.createClient(root, shared.createNullChannel())
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
    if (!getParcelWatcherTarget()) return t.skip('unsupported platform')
    let parent = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-parcel-symlink-'))
    let physicalRoot = path.join(parent, 'project')
    let root = path.join(parent, 'link')
    fs.mkdirSync(path.join(physicalRoot, 'old', 'nested'), { recursive: true })
    fs.writeFileSync(path.join(physicalRoot, 'old', 'one.txt'), 'one')
    fs.writeFileSync(path.join(physicalRoot, 'old', 'nested', 'two.txt'), 'two')
    fs.symlinkSync(physicalRoot, root, process.platform === 'win32' ? 'junction' : 'dir')
    let client = await ParcelWatcher.createClient(root, shared.createNullChannel())
    let watcher = new FileSystemWatcher('**/*.txt', false, false, false)
    let renames: string[] = []
    watcher.onDidRename(event => renames.push(`${event.oldUri.fsPath}->${event.newUri.fsPath}`))
    watcher.listen(root, client)
    try {
      fs.renameSync(path.join(physicalRoot, 'old'), path.join(physicalRoot, 'new'))
      await shared.waitValue(() => renames.length, 2)
      assert.ok(renames.every(rename => rename.includes(`${path.sep}old${path.sep}`) && rename.includes(`${path.sep}new${path.sep}`)))
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
})

describe('fileSystemWatcher', () => {

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
      subscribe: () => Disposable.create(() => {}),
      dispose: () => {}
    }
  }

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

  it('should fall back to Watchman when Parcel watcher creation fails', async t => {
    let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-watch-fallback-'))
    let folderControl = new WorkspaceFolderController(configurations)
    let manager = new FileSystemWatcherManager(folderControl, defaultConfig)
    manager.disabled = false
    let originalSock = process.env.WATCHMAN_SOCK
    process.env.WATCHMAN_SOCK = ''
    let parcel = t.mock.method(ParcelWatcher, 'createClient', () => Promise.reject(new Error('missing binary')))
    let watchman = t.mock.method(Watchman, 'createClient', () => Promise.resolve(createFakeClient(root)))
    t.mock.method(manager, 'getWatchmanPath', () => Promise.resolve('watchman'))
    try {
      let client = await manager.createClient(root)
      assert.notStrictEqual(client, false)
      assert.strictEqual(parcel.mock.callCount(), 1)
      assert.strictEqual(watchman.mock.callCount(), 1)
    } finally {
      manager.dispose()
      process.env.WATCHMAN_SOCK = originalSock
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('should prefer Parcel when WATCHMAN_SOCK is set', async t => {
    let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-watch-parcel-first-'))
    let folderControl = new WorkspaceFolderController(configurations)
    let ignoredFolders = [path.join(root, 'ignored')]
    let manager = new FileSystemWatcherManager(folderControl, { ...defaultConfig, ignoredFolders })
    manager.disabled = false
    let originalSock = process.env.WATCHMAN_SOCK
    process.env.WATCHMAN_SOCK = sockPath
    let parcel = t.mock.method(ParcelWatcher, 'createClient', () => Promise.resolve(createFakeClient(root) as ParcelWatcher))
    let watchman = t.mock.method(Watchman, 'createClient', () => Promise.reject(new Error('should not run')))
    try {
      let client = await manager.createClient(root)
      assert.notStrictEqual(client, false)
      assert.strictEqual(parcel.mock.callCount(), 1)
      assert.deepStrictEqual(parcel.mock.calls[0].arguments[3], ignoredFolders)
      assert.strictEqual(watchman.mock.callCount(), 0)
    } finally {
      manager.dispose()
      process.env.WATCHMAN_SOCK = originalSock
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('should honor an explicit Watchman path without starting Parcel', async t => {
    let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-watch-explicit-'))
    let folderControl = new WorkspaceFolderController(configurations)
    let manager = new FileSystemWatcherManager(folderControl, { ...defaultConfig, watchmanPath: '/custom/watchman' })
    manager.disabled = false
    let originalSock = process.env.WATCHMAN_SOCK
    process.env.WATCHMAN_SOCK = sockPath
    let parcel = t.mock.method(ParcelWatcher, 'createClient', () => Promise.reject(new Error('should not run')))
    let watchman = t.mock.method(Watchman, 'createClient', () => Promise.resolve(createFakeClient(root)))
    try {
      let client = await manager.createClient(root)
      assert.notStrictEqual(client, false)
      assert.strictEqual(parcel.mock.callCount(), 0)
      assert.strictEqual(watchman.mock.callCount(), 1)
      assert.strictEqual(watchman.mock.calls[0].arguments[0], '/custom/watchman')
    } finally {
      manager.dispose()
      process.env.WATCHMAN_SOCK = originalSock
      fs.rmSync(root, { recursive: true, force: true })
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
