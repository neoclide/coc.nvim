// import watchman from 'fb-watchman'
import { Neovim } from '@chemzqm/neovim'
import net from 'net'
import fs from 'fs'
import bser from 'bser'
import Watchman, { FileChangeItem } from '../../watchman'
import helper from '../helper'
import BufferChannel from '../../model/outputChannel'

let server: net.Server
let client: net.Socket
const sockPath = '/tmp/watchman-fake'
process.env.WATCHMAN_SOCK = sockPath

let nvim: Neovim
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
})

afterAll(async () => {
  await helper.shutdown()
})

function wait(ms: number): Promise<any> {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve(undefined)
    }, ms)
  })
}

function sendResponse(data: any): void {
  client.write(bser.dumpToBuffer(data))
}

function createFileChange(file: string, exists = true): FileChangeItem {
  return {
    size: 1,
    name: file,
    exists,
    new: false,
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

beforeAll(done => {
  // create a mock sever for watchman
  server = net.createServer(c => {
    client = c
    c.on('data', data => {
      let obj = bser.loadFromBuffer(data)
      if (obj[0] == 'watch-project') {
        sendResponse({ watch: obj[1] })
      } else if (obj[0] == 'unsubscribe') {
        sendResponse({ path: obj[1] })
      } else if (obj[0] == 'clock') {
        sendResponse({ clock: 'clock' })
      } else if (obj[0] == 'version') {
        let { optional, required } = obj[1]
        let res = {}
        for (let key of Object.keys(optional)) {
          res[key] = true
        }
        for (let key of Object.keys(required)) {
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
})

afterAll(() => {
  client.unref()
  server.close()
  if (fs.existsSync(sockPath)) {
    fs.unlinkSync(sockPath)
  }
})

describe('watchman', () => {
  it('should checkCapability', async () => {
    let client = new Watchman(null)
    let res = await client.checkCapability()
    expect(res).toBe(true)
    client.dispose()
  })

  it('should watchProject', async () => {
    let client = new Watchman(null)
    let res = await client.watchProject(__dirname)
    expect(res).toBe(true)
    client.dispose()
  })

  it('should subscribe', async () => {
    let client = new Watchman(null, new BufferChannel('watchman', nvim))
    let cwd = process.cwd()
    await client.watchProject(cwd)
    let fn = jest.fn()
    let disposable = await client.subscribe(`${cwd}/*`, fn)
    let changes: FileChangeItem[] = [createFileChange(`${cwd}/a`)]
    sendSubscription((global as any).subscribe, cwd, changes)
    await wait(100)
    expect(fn).toBeCalled()
    let call = fn.mock.calls[0][0]
    disposable.dispose()
    expect(call.root).toBe(cwd)
    client.dispose()
  })

  it('should unsubscribe', async () => {
    let client = new Watchman(null)
    await client.watchProject(process.cwd())
    let fn = jest.fn()
    let disposable = await client.subscribe(`${process.cwd()}/*`, fn)
    disposable.dispose()
    client.dispose()
  })
})

describe('Watchman#createClient', () => {
  it('should create client', async () => {
    let client = await Watchman.createClient(null, process.cwd())
    expect(client).toBeDefined()
    client.dispose()
  })

  it('should resue client for same root', async () => {
    let client = await Watchman.createClient(null, process.cwd())
    expect(client).toBeDefined()
    let other = await Watchman.createClient(null, process.cwd())
    expect(client).toBe(other)
    client.dispose()
  })

  it('should not create client for root', async () => {
    let client = await Watchman.createClient(null, '/')
    expect(client).toBeNull()
  })
})
