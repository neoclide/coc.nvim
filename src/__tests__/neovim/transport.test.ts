import Transport from '../../neovim/transport/base'
import Connection from '../../neovim/transport/connection'
import Request from '../../neovim/transport/request'
import { nullLogger } from '../../neovim/utils/logger'

class TestTransport extends Transport {
  public attach(): void { }
  public detach(): void { }
  public send(): void { }
  public vimCommand(): void { }
  public vimRequest(): Promise<any> {
    return Promise.resolve(null)
  }
  public request(): void { }
  public notify(method: string, args: any[]): void {
    if (this.pauseLevel !== 0) {
      let arr = this.paused.get(this.pauseLevel)
      if (arr) arr.push([method, args])
    }
  }
  protected createResponse(): { send: (resp: any, isError?: boolean) => void } {
    return { send: () => { } }
  }
}

function fakeStream(): any {
  return { on: () => { }, once: () => { }, write: () => { } }
}

describe('Request', () => {
  let connection: Connection
  let cb: ReturnType<typeof vi.fn>
  let client: any
  let request: Request

  beforeEach(() => {
    connection = new Connection(fakeStream(), fakeStream())
    cb = vi.fn()
    request = new Request(connection, cb, 1)
    client = {
      createWindow: (o: any) => ({ type: 'window', id: o }),
      createBuffer: (o: any) => ({ type: 'buffer', id: o }),
      createTabpage: (o: any) => ({ type: 'tabpage', id: o }),
    }
  })

  it('should map array results of list methods', () => {
    request.request('nvim_list_wins')
    request.callback(client, null, [1, 2])
    expect(cb).toHaveBeenCalledWith(null, [{ type: 'window', id: 1 }, { type: 'window', id: 2 }])
    request.request('nvim_list_bufs')
    request.callback(client, null, [3])
    expect(cb).toHaveBeenCalledWith(null, [{ type: 'buffer', id: 3 }])
    request.request('nvim_list_tabpages')
    request.callback(client, null, [4])
    expect(cb).toHaveBeenCalledWith(null, [{ type: 'tabpage', id: 4 }])
  })

  it('should not throw on null or non-array results of list methods', () => {
    request.request('nvim_list_wins')
    request.callback(client, null, null)
    expect(cb).toHaveBeenCalledWith(null, [])
    request.request('nvim_list_bufs')
    request.callback(client, null, 'unexpected')
    expect(cb).toHaveBeenCalledWith(null, [])
    request.request('nvim_list_tabpages')
    request.callback(client, null, { unexpected: true })
    expect(cb).toHaveBeenCalledWith(null, [])
  })

  it('should strip nvim_ prefix only when present', () => {
    let spy = vi.spyOn(connection, 'call').mockImplementation(() => { })
    request.request('nvim_list_wins', [1])
    expect(spy).toHaveBeenCalledWith(expect.any(String), ['list_wins', [1]], 1)
    request.request('vim', [2])
    expect(spy).toHaveBeenCalledWith(expect.any(String), ['vim', [2]], 1)
  })
})

describe('Transport.resumeNotification', () => {
  let transport: TestTransport

  beforeEach(() => {
    transport = new TestTransport(nullLogger, false)
  })

  it('should return null for notify when nothing is paused', () => {
    expect(transport.resumeNotification(true)).toBeNull()
  })

  it('should return a promise for notify when notifications are paused', async () => {
    transport.pauseNotification()
    transport.notify('nvim_command', ['redraw'])
    let res = transport.resumeNotification(true)
    expect(res).not.toBeNull()
    await expect(res).resolves.toBeUndefined()
  })

  it('should resolve atomic result when notifying without paused notifications', async () => {
    await expect(transport.resumeNotification()).resolves.toEqual([[], null])
  })
})
