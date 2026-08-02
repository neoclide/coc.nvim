import { Neovim } from '../../neovim'
import helper from '../helper'

let nvim: Neovim

beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
})

afterAll(async () => {
  await helper.shutdown()
})

describe('rpc client', () => {
  it('should report live channel as running', async () => {
    // The E475 handling checks is_running before resetting the client, a
    // live channel must never be reported as dead.
    expect(await nvim.call('coc#client#is_running', ['coc'])).toBe(1)
  })

  it('should reset client when channel is gone on E475', async () => {
    // rpcnotify on a nonexistent channel raises E475, which must still be
    // treated as connection loss for a dead channel.
    await nvim.command(`
      let g:fake = coc#client#create('fake', [])
      let g:fake['running'] = 1
      let g:fake['chan_id'] = 99999
      call g:fake['notify']('testMethod', [])
    `)
    expect(await nvim.call('eval', ["coc#client#get_client('fake')['running']"])).toBe(0)
  })
})
