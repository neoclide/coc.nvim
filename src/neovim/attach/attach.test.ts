import * as cp from 'child_process'
import * as which from 'which'
import { Neovim } from '../api'
import { attach } from './attach'
// import { pack, Packr, addExtension } from 'msgpackr'

try {
  which.sync('nvim')
} catch (e) {
  // eslint-disable-next-line no-console
  console.error(
    'A Neovim installation is required to run the tests',
    '(see https://github.com/neovim/neovim/wiki/Installing)'
  )
  process.exit(1)
}

describe('Nvim Promise API', () => {
  let proc
  let nvim: Neovim
  let requests
  let notifications

  beforeAll(async () => {
    try {
      proc = cp.spawn(
        'nvim',
        ['-u', 'NONE', '-N', '--embed', '-c', 'set noswapfile'],
        {
          cwd: __dirname,
        }
      )

      nvim = attach({ proc })
      nvim.on('request', (method, args, resp) => {
        requests.push({ method, args })
        resp.send(`received ${method}(${args})`)
      })
      nvim.on('notification', (method, args) => {
        notifications.push({ method, args })
      })

    } catch (err) {
      // eslint-disable-next-line no-console
      console.log(err)
    }
  })

  afterAll(async () => {
    await nvim.quit()
    if (proc && typeof proc.disconnect === 'function') {
      proc.disconnect()
    }
  })

  beforeEach(() => {
    requests = []
    notifications = []
  })

  // it('can pack data', async () => {
  //   addExtension({
  //     Class: Buffer,
  //     type: 0,
  //     write(instance) {
  //       console.log(33)
  //       return instance.id
  //     },
  //     read(data) {
  //       return new Buffer({
  //         transport: undefined,
  //         client: undefined,
  //         data,
  //       })
  //     }
  //   })
  //   let packer = new Packr({
  //     useRecords: false,
  //     encodeUndefinedAsNil: false,
  //     moreTypes: false
  //   })
  //   let b = new Buffer({ data: 3 })
  //   let buf = packer.encode([b])
  //   console.log(buf)
  // })

  it('can send requests and receive response', async () => {
    const result = await nvim.eval('{"k1": "v1", "k2": 2}')
    expect(result).toEqual({ k1: 'v1', k2: 2 })
  })

  it('can receive requests and send responses', async () => {
    const res = await nvim.eval('rpcrequest(1, "request", 1, 2, 3)')
    expect(res).toEqual('received request(1,2,3)')
    expect(requests).toEqual([{ method: 'request', args: [1, 2, 3] }])
    expect(notifications).toEqual([])
  })

  it('can receive notifications', async () => {
    const res = await nvim.eval('rpcnotify(1, "notify", 1, 2, 3)')
    expect(res).toEqual(1)
    expect(requests).toEqual([])
    return new Promise(resolve =>
      setImmediate(() => {
        expect(notifications).toEqual([{ method: 'notify', args: [1, 2, 3] }])
        resolve(undefined)
      })
    )
  })

  it('can deal with custom types', async () => {
    await nvim.command('vsp')
    await nvim.command('vsp')
    await nvim.command('vsp')
    const windows = await nvim.windows

    expect(windows.length).toEqual(4)

    await nvim.setWindow(windows[2])
    const win = await nvim.window

    expect(win.equals(windows[0])).toBe(false)
    expect(win.equals(windows[2])).toBe(true)

    const buf = await nvim.buffer

    const lines = await buf.getLines({ start: 0, end: -1, strictIndexing: false })
    expect(lines).toEqual([])

    await buf.setLines(['line1', 'line2'], { start: 0, end: 1 })
    const newLines = await buf.getLines({ start: 0, end: -1, strictIndexing: false })
    expect(newLines).toEqual(['line1', 'line2'])
  })

  it('emits "disconnect" after quit', async done => {
    const disconnectMock = jest.fn()
    nvim.on('disconnect', disconnectMock)
    await nvim.quit()

    proc.on('close', () => {
      expect(disconnectMock.mock.calls.length).toBe(1)
      done()
    })

    // Event doesn't actually emit when we quit nvim, but when the child process is killed
    if (typeof proc.disconnect === 'function') {
      proc.disconnect()
    }
  })
})
