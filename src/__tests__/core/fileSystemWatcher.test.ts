import path from 'path'
import helper from '../helper'
import os from 'os'
import bser from 'bser'
import { Disposable } from 'vscode-languageserver-protocol'
import Configurations from '../../configuration/index'
import WorkspaceFolderController from '../../core/workspaceFolder'
import FileSystemWatcher from '../../core/fileSystemWatcher'
import { FileChangeItem } from '../../core/watchman'
import { disposeAll } from '../../util'
import { v1 as uuidv1 } from 'uuid'
import net from 'net'
import { URI } from 'vscode-uri'

let workspaceFolder: WorkspaceFolderController
let configurations: Configurations
let disposables: Disposable[] = []
let watcher: FileSystemWatcher

let server: net.Server
let client: net.Socket
const sockPath = path.join(os.tmpdir(), `watchman-fake-${uuidv1()}`)
const cwd = process.cwd()
process.env.WATCHMAN_SOCK = sockPath

function sendResponse(data: any): void {
  client.write(bser.dumpToBuffer(data))
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

function sendSubscription(uid: string, root: string, files: FileChangeItem[]): void {
  client.write(bser.dumpToBuffer({
    subscription: uid,
    root,
    files
  }))
}

function initFakeWatchmanServer(done: () => void): void {
  // create a mock sever for watchman
  server = net.createServer(c => {
    client = c
    c.on('data', data => {
      let obj = bser.loadFromBuffer(data)
      if (obj[0] == 'watch-project') {
        sendResponse({ watch: obj[1], warning: 'warning' })
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
        sendResponse({ capabilities: res })
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
}

beforeAll(done => {
  let userConfigFile = path.join(process.env.COC_VIMCONFIG, 'coc-settings.json')
  configurations = new Configurations(userConfigFile, {
    $removeConfigurationOption: () => {},
    $updateConfigurationOption: () => {},
    workspaceConfigFile: ''
  })
  workspaceFolder = new WorkspaceFolderController(configurations)
  initFakeWatchmanServer(done)
})

function createWatcher(pattern: string, ignoreCreateEvents = false, ignoreChangeEvents = false, ignoreDeleteEvents = false): FileSystemWatcher {
  return new FileSystemWatcher(
    workspaceFolder,
    '',
    helper.createNullChannel(),
    pattern,
    ignoreCreateEvents,
    ignoreChangeEvents,
    ignoreDeleteEvents
  )
}

afterEach(async () => {
  disposeAll(disposables)
  workspaceFolder.reset()
  if (watcher) {
    watcher.dispose()
    watcher = null
  }
})

describe('fileSystemWatcher', () => {
  it('should create without workspace folders', async () => {
    expect(workspaceFolder.workspaceFolders.length).toBe(0)
    watcher = createWatcher('**/*')
    expect(watcher).toBeDefined()
  })

  it('should create for invalid folder', async () => {
    workspaceFolder.addWorkspaceFolder('', false)
    watcher = createWatcher('**/*')
    expect(watcher).toBeDefined()
    workspaceFolder.addWorkspaceFolder('/a/b', false)
    await helper.wait(30)
  })

  it('should watch for file create', async () => {
    workspaceFolder.addWorkspaceFolder(process.cwd(), false)
    watcher = createWatcher('**/*', false, true, true)
    let uri: URI
    watcher.onDidCreate(e => {
      uri = e
    })
    await helper.wait(50)
    let changes: FileChangeItem[] = [createFileChange(`a`)]
    sendSubscription(watcher.subscribe, cwd, changes)
    await helper.wait(50)
    expect(uri.fsPath).toEqual(path.join(cwd, 'a'))
  })

  it('should watch for file delete', async () => {
    workspaceFolder.addWorkspaceFolder(process.cwd(), false)
    watcher = createWatcher('**/*', true, true, false)
    let uri: URI
    watcher.onDidDelete(e => {
      uri = e
    })
    await helper.wait(50)
    let changes: FileChangeItem[] = [createFileChange(`a`, false, false)]
    sendSubscription(watcher.subscribe, cwd, changes)
    await helper.wait(50)
    expect(uri.fsPath).toEqual(path.join(cwd, 'a'))
  })

  it('should watch for file change', async () => {
    workspaceFolder.addWorkspaceFolder(process.cwd(), false)
    watcher = createWatcher('**/*', false, false, false)
    let uri: URI
    watcher.onDidChange(e => {
      uri = e
    })
    await helper.wait(50)
    let changes: FileChangeItem[] = [createFileChange(`a`, false, true)]
    sendSubscription(watcher.subscribe, cwd, changes)
    await helper.wait(50)
    expect(uri.fsPath).toEqual(path.join(cwd, 'a'))
  })

  it('should watch for file rename', async () => {
    workspaceFolder.addWorkspaceFolder(process.cwd(), false)
    watcher = createWatcher('**/*', false, false, false)
    let uri: URI
    watcher.onDidRename(e => {
      uri = e.newUri
    })
    await helper.wait(50)
    let changes: FileChangeItem[] = [
      createFileChange(`a`, false, false),
      createFileChange(`b`, true, true),
    ]
    sendSubscription(watcher.subscribe, cwd, changes)
    await helper.wait(50)
    expect(uri.fsPath).toEqual(path.join(cwd, 'b'))
  })

  it('should not watch for events', async () => {
    workspaceFolder.addWorkspaceFolder(process.cwd(), false)
    watcher = createWatcher('**/*', true, true, true)
    let called = false
    let onChange = () => {
      called = true
    }
    watcher.onDidCreate(onChange)
    watcher.onDidChange(onChange)
    watcher.onDidDelete(onChange)
    await helper.wait(50)
    let changes: FileChangeItem[] = [
      createFileChange(`a`, false, false),
      createFileChange(`b`, true, true),
      createFileChange(`c`, false, true),
    ]
    sendSubscription(watcher.subscribe, cwd, changes)
    await helper.wait(50)
    expect(called).toBe(false)
  })

  it('should watch for folder rename', async () => {
    workspaceFolder.addWorkspaceFolder(process.cwd(), false)
    watcher = createWatcher('**/*')
    let newFiles: string[] = []
    watcher.onDidRename(e => {
      newFiles.push(e.newUri.fsPath)
    })
    await helper.wait(50)
    let changes: FileChangeItem[] = [
      createFileChange(`a/1`, false, false),
      createFileChange(`a/2`, false, false),
      createFileChange(`b/1`, true, true),
      createFileChange(`b/2`, true, true),
    ]
    sendSubscription(watcher.subscribe, cwd, changes)
    await helper.wait(50)
    expect(newFiles.length).toBe(2)
  })

  it('should watch for new folder', async () => {
    workspaceFolder.addWorkspaceFolder('', false)
    watcher = createWatcher('**/*')
    expect(watcher).toBeDefined()
    await helper.wait(50)
    workspaceFolder.addWorkspaceFolder(process.cwd(), true)
    let uri: URI
    watcher.onDidCreate(e => {
      uri = e
    })
    await helper.wait(50)
    let changes: FileChangeItem[] = [createFileChange(`a`)]
    sendSubscription(watcher.subscribe, cwd, changes)
    await helper.wait(50)
    expect(uri.fsPath).toEqual(path.join(cwd, 'a'))
  })
})
