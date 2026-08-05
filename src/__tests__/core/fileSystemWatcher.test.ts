import bser from 'bser'
import fs from 'fs'
import net from 'net'
import os from 'os'
import path from 'path'
import { Disposable } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import Configurations from '../../configuration/index'
import { FileSystemWatcher, FileSystemWatcherManager } from '../../core/fileSystemWatcher'
import Watchman, { FileChangeItem } from '../../core/watchman'
import WorkspaceFolderController from '../../core/workspaceFolder'
import RelativePattern from '../../model/relativePattern'
import { GlobPattern } from '../../types'
import { disposeAll } from '../../util'
import { remove } from '../../util/fs'
import helper from '../helper'

let server: net.Server
let client: net.Socket
const cwd = path.resolve(__dirname, '../../..')
const sockPath = path.join(os.tmpdir(), `watchman-fake-${crypto.randomUUID()}`)
process.env.WATCHMAN_SOCK = sockPath

let workspaceFolder: WorkspaceFolderController
let watcherManager: FileSystemWatcherManager
let configurations: Configurations
let disposables: Disposable[] = []

function wait(ms: number): Promise<any> {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve(undefined)
    }, ms)
  })
}

function createFileChange(file: string, isNew = true, exists = true): FileChangeItem {
  return {
    size: 1,
    name: file,
    exists,
    new: isNew,
    type: 'f',
    mtime_ms: Date.now()
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
beforeAll(async () => {
  await helper.setup()
})

beforeAll(() => new Promise<void>(done => {
  let userConfigFile = path.join(process.env.COC_VIMCONFIG, 'coc-settings.json')
  configurations = new Configurations(userConfigFile, undefined)
  workspaceFolder = new WorkspaceFolderController(configurations)
  watcherManager = new FileSystemWatcherManager(workspaceFolder, defaultConfig)
  Object.assign(watcherManager, { disabled: false })
  watcherManager.attach(helper.createNullChannel())
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
  it('should stay disabled under test environment even when enable is true', () => {
    let manager = new FileSystemWatcherManager(workspaceFolder, { watchmanPath: null, enable: true, ignoredFolders: [] })
    expect(manager.disabled).toBe(true)
    manager = new FileSystemWatcherManager(workspaceFolder, { watchmanPath: null, enable: false, ignoredFolders: [] })
    expect(manager.disabled).toBe(true)
  })
})

afterAll(async () => {
  await helper.shutdown()
  watcherManager.dispose()
  server.close()
  await remove(sockPath)
})

describe('watchman', () => {
  it('should not throw error when not watching', async () => {
    let client = new Watchman(null)
    disposables.push(client)
    let disposable = client.subscribe('**/*', () => {})
    disposable.dispose()
    client.dispose()
  })

  it('should checkCapability', async () => {
    let client = new Watchman(null)
    let res = await client.checkCapability()
    expect(res).toBe(true)
    capabilities = { relative_root: false }
    res = await client.checkCapability()
    expect(res).toBe(false)
    client.dispose()
  })

  it('should watchProject', async () => {
    let client = new Watchman(null)
    disposables.push(client)
    let res = await client.watchProject(__dirname)
    expect(res).toBe(true)
    client.dispose()
  })

  it('should unsubscribe', async () => {
    let client = new Watchman(null)
    disposables.push(client)
    await client.watchProject(cwd)
    let fn = vi.fn()
    let disposable = client.subscribe(`${cwd}/*`, fn)
    disposable.dispose()
    client.dispose()
  })
})

describe('Watchman#subscribe', () => {

  it('should subscribe file change', async () => {
    let client = new Watchman(null, helper.createNullChannel())
    disposables.push(client)
    await client.watchProject(cwd)
    let called = false
    let disposable = client.subscribe(`${cwd}/*`, () => {
      called = true
    })
    let changes: FileChangeItem[] = [createFileChange(`${cwd}/a`)]
    sendSubscription(client.subscription, cwd, changes)
    await helper.waitValue(() => called, true)
    expect(called).toBe(true)
    disposable.dispose()
    client.dispose()
  })

  it('should subscribe with relative_path', async () => {
    let client = new Watchman(null, helper.createNullChannel())
    watchResponse = { watch: cwd, relative_path: 'foo' }
    await client.watchProject(cwd)
    let fn = vi.fn()
    let disposable = client.subscribe(`${cwd}/*`, fn)
    let changes: FileChangeItem[] = [createFileChange(`${cwd}/a`)]
    sendSubscription(client.subscription, cwd, changes)
    await wait(30)
    expect(fn).toHaveBeenCalled()
    let call = fn.mock.calls[0][0]
    disposable.dispose()
    expect(call.root).toBe(path.join(cwd, 'foo'))
    client.dispose()
  })

  it('should not subscribe invalid response', async () => {
    let c = new Watchman(null, helper.createNullChannel())
    disposables.push(c)
    watchResponse = { watch: cwd, relative_path: 'foo' }
    await c.watchProject(cwd)
    let fn = vi.fn()
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
    expect(fn).toHaveBeenCalledTimes(0)
  })
})

describe('Watchman#createClient', () => {
  it('should not create client when capabilities not match', async () => {
    capabilities = { relative_root: false }
    await expect(Watchman.createClient(null, cwd)).rejects.toThrow(Error)
  })

  it('should not create when watch failed', async () => {
    watchResponse = {}
    await expect(Watchman.createClient(null, cwd)).rejects.toThrow(Error)
  })

  it('should create client', async () => {
    let client = await Watchman.createClient(null, cwd)
    disposables.push(client)
    expect(client).toBeDefined()
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

  beforeAll(async () => {
    workspaceFolder.addWorkspaceFolder(cwd, true)
    await watcherManager.waitClient(cwd)
  })

  it('should use relative pattern #1', async () => {
    let folder = workspaceFolder.workspaceFolders[0]
    expect(folder).toBeDefined()
    let pattern = new RelativePattern(folder, '**/*')
    let watcher = await createWatcher(pattern, false, true, true)
    let fn = vi.fn()
    watcher.onDidCreate(fn)
    let changes: FileChangeItem[] = [createFileChange(`a`)]
    sendSubscription(watcher.subscribe, cwd, changes)
    await helper.waitValue(() => fn.mock.calls.length, 1)
    expect(fn).toHaveBeenCalled()
  })

  it('should use relative pattern #2', async () => {
    let called = false
    let pattern = new RelativePattern(__dirname, '**/*')
    let watcher = await createWatcher(pattern, false, true, true)
    watcher.onDidCreate(() => {
      called = true
    })
    let changes: FileChangeItem[] = [createFileChange(`a`)]
    sendSubscription(watcher.subscribe, cwd, changes)
    await helper.wait(30)
    expect(called).toBe(false)
  })

  it('should use relative pattern #3', async () => {
    let called = false
    let root = path.join(process.cwd(), 'not_exists')
    let pattern = new RelativePattern(root, '**/*')
    let watcher = await createWatcher(pattern, false, true, true)
    watcher.onDidCreate(() => {
      called = true
    })
    await helper.wait(20)
    let changes: FileChangeItem[] = [createFileChange(`a`)]
    sendSubscription(watcher.subscribe, cwd, changes)
    await helper.wait(20)
    expect(called).toBe(false)
  })

  it('should watch for file create', async () => {
    let watcher = await createWatcher('**/*', false, true, true)
    let called = false
    watcher.onDidCreate(() => {
      called = true
    })
    let changes: FileChangeItem[] = [createFileChange(`a`)]
    sendSubscription(watcher.subscribe, cwd, changes)
    await helper.waitValue(() => {
      return called
    }, true)
  })

  it('should watch for file delete', async () => {
    let watcher = await createWatcher('**/*', true, true, false)
    let called = false
    watcher.onDidDelete(() => {
      called = true
    })
    let changes: FileChangeItem[] = [createFileChange(`a`, false, false)]
    sendSubscription(watcher.subscribe, cwd, changes)
    await helper.waitValue(() => {
      return called
    }, true)
  })

  it('should watch for file change', async () => {
    let watcher = await createWatcher('**/*', false, false, false)
    let called = false
    watcher.onDidChange(() => {
      called = true
    })
    let changes: FileChangeItem[] = [createFileChange(`a`, false, true)]
    sendSubscription(watcher.subscribe, cwd, changes)
    await helper.waitValue(() => {
      return called
    }, true)
  })

  it('should watch for file rename', async () => {
    let watcher = await createWatcher('**/*', false, false, false)
    let called = false
    watcher.onDidRename(() => {
      called = true
    })
    await helper.wait(50)
    let changes: FileChangeItem[] = [
      createFileChange(`a`, false, false),
      createFileChange(`b`, true, true),
    ]
    sendSubscription(watcher.subscribe, cwd, changes)
    await helper.waitValue(() => {
      return called
    }, true)
  })

  it('should not watch for events', async () => {
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
    await helper.wait(20)
    expect(called).toBe(false)
  })

  it('should watch for folder rename', async () => {
    let watcher = await createWatcher('**/*')
    let newFiles: string[] = []
    let count = 0
    watcher.onDidRename(e => {
      count++
      newFiles.push(e.newUri.fsPath)
    })
    let changes: FileChangeItem[] = [
      createFileChange(`a/1`, false, false),
      createFileChange(`a/2`, false, false),
      createFileChange(`b/1`, true, true),
      createFileChange(`b/2`, true, true),
    ]
    sendSubscription(watcher.subscribe, cwd, changes)
    await helper.waitValue(() => {
      return count
    }, 2)
  })

  it('should watch for new folder', async () => {
    let watcher = await createWatcher('**/*')
    expect(watcher).toBeDefined()
    workspaceFolder.renameWorkspaceFolder(cwd, __dirname)
    let uri: URI
    watcher.onDidCreate(e => {
      uri = e
    })
    await watcherManager.waitClient(__dirname)
    let changes: FileChangeItem[] = [createFileChange(`a`)]
    sendSubscription(watcher.subscribe, __dirname, changes)
    await helper.waitValue(() => {
      return uri?.fsPath
    }, path.join(__dirname, 'a'))
  })
})

describe('create FileSystemWatcherManager', () => {
  it('should attach to existing workspace folder', async () => {
    let workspaceFolder = new WorkspaceFolderController(configurations)
    workspaceFolder.addWorkspaceFolder(cwd, false)
    let watcherManager = new FileSystemWatcherManager(workspaceFolder, { ...defaultConfig, enable: false })
    watcherManager.disabled = false
    watcherManager.attach(helper.createNullChannel())
    await watcherManager.createClient(cwd)
    await watcherManager.waitClient(cwd)
    watcherManager.dispose()
  })

  it('should get watchman path', async () => {
    let watcherManager = new FileSystemWatcherManager(workspaceFolder, { ...defaultConfig, watchmanPath: 'invalid_command' })
    process.env.WATCHMAN_SOCK = ''
    await expect(() => watcherManager.getWatchmanPath()).rejects.toThrow(Error)
    process.env.WATCHMAN_SOCK = sockPath
  })

  it('should settle concurrent waitClient when create fails', async () => {
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
      expect(results).toEqual([false, false])
    } finally {
      process.env.WATCHMAN_SOCK = sockPath
    }
  })

  it('disposes a client whose creation completes after the folder was removed', async () => {
    let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-watch-race-'))
    let folderControl = new WorkspaceFolderController(configurations)
    folderControl.addWorkspaceFolder(root, false)
    let watcherManager = new FileSystemWatcherManager(folderControl, { ...defaultConfig, enable: true, ignoredFolders: [] })
    watcherManager.disabled = false
    let resolveClient: (c: any) => void = () => {}
    let createSpy = vi.spyOn(Watchman, 'createClient').mockImplementation(() => new Promise(resolve => {
      resolveClient = resolve
    }))
    let fakeClient = { dispose: vi.fn() }
    let created = 0
    watcherManager.onDidCreateClient(() => created++)
    try {
      watcherManager.attach(helper.createNullChannel())
      let pending = watcherManager.createClient(root)
      // Wait until the pending creation has actually reached the stubbed
      // Watchman.createClient call before removing the folder.
      await helper.waitValue(() => createSpy.mock.calls.length, 1)
      folderControl.removeWorkspaceFolder(root)
      resolveClient(fakeClient)
      await pending
      expect(fakeClient.dispose).toHaveBeenCalled()
      expect((watcherManager as any).clientsMap.size).toBe(0)
      expect(created).toBe(0)
    } finally {
      createSpy.mockRestore()
      watcherManager.dispose()
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('disposes a client whose creation completes after manager dispose', async () => {
    let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-watch-race-'))
    let folderControl = new WorkspaceFolderController(configurations)
    folderControl.addWorkspaceFolder(root, false)
    let watcherManager = new FileSystemWatcherManager(folderControl, { ...defaultConfig, enable: true, ignoredFolders: [] })
    watcherManager.disabled = false
    let resolveClient: (c: any) => void = () => {}
    let createSpy = vi.spyOn(Watchman, 'createClient').mockImplementation(() => new Promise(resolve => {
      resolveClient = resolve
    }))
    let fakeClient = { dispose: vi.fn() }
    let created = 0
    watcherManager.onDidCreateClient(() => created++)
    try {
      watcherManager.attach(helper.createNullChannel())
      let pending = watcherManager.createClient(root)
      await helper.waitValue(() => createSpy.mock.calls.length, 1)
      watcherManager.dispose()
      resolveClient(fakeClient)
      await pending
      expect(fakeClient.dispose).toHaveBeenCalled()
      expect((watcherManager as any).clientsMap.size).toBe(0)
      expect(created).toBe(0)
    } finally {
      createSpy.mockRestore()
      watcherManager.dispose()
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('FileSystemWatcher dispose', () => {
  it('releases every event emitter including delete and listen', () => {
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
      expect(w[name]._callbacks).toBeUndefined()
    }
    // simulating underlying changes after dispose must not call anything
    w._onDidCreate.fire(URI.file('/x'))
    w._onDidChange.fire(URI.file('/x'))
    w._onDidDelete.fire(URI.file('/x'))
    w._onDidRename.fire({ oldUri: URI.file('/a'), newUri: URI.file('/b') })
    w._onDidListen.fire()
    expect(calls).toEqual({ create: 0, change: 0, delete: 0, rename: 0, listen: 0 })
  })
})
