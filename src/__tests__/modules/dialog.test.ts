import { Neovim } from '@chemzqm/neovim'
import events from '../../events'
import { Dialog, DialogButton } from '../../model/dialog'
import ProgressNotification from '../../model/progress'
import Notification from '../../model/notification'
import helper from '../helper'

let nvim: Neovim

beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  await helper.reset()
})

describe('Dialog module', () => {
  it('should show dialog', async () => {
    let dialog = new Dialog(nvim, { content: '你好' })
    expect(await dialog.winid).toBeNull()
    await dialog.show({})
    let winid = await dialog.winid
    let win = nvim.createWindow(winid)
    let width = await win.width
    expect(width).toBe(4)
    await nvim.call('coc#float#close', [winid])
  })

  it('should invoke callback with index -1', async () => {
    let callback = jest.fn()
    let dialog = new Dialog(nvim, { content: '你好', callback, highlights: [] })
    await dialog.show({})
    let winid = await dialog.winid
    await nvim.call('coc#float#close', [winid])
    await helper.wait(50)
    expect(callback).toHaveBeenCalledWith(-1)
  })

  it('should invoke callback on click', async () => {
    let callback = jest.fn()
    let buttons: DialogButton[] = [{
      index: 0,
      text: 'yes'
    }, {
      index: 1,
      text: 'no'
    }]
    let dialog = new Dialog(nvim, { content: '你好', buttons, callback })
    await dialog.show({})
    let winid = await dialog.winid
    let btnwin = await nvim.call('coc#float#get_related', [winid, 'buttons'])
    await nvim.call('win_gotoid', [btnwin])
    await nvim.call('cursor', [2, 1])
    await nvim.call('coc#float#nvim_float_click', [])
    await helper.wait(20)
    expect(callback).toHaveBeenCalledWith(0)
  })
})

describe('Notification', () => {
  it('should invoke callback', async () => {
    let n = new Notification(nvim, { content: 'foo\nbar' })
    await n.show({})
    await events.fire('FloatBtnClick', [n.bufnr, 1])
    n.dispose()
    let called = false
    n = new Notification(nvim, {
      content: 'foo\nbar',
      buttons: [{ index: 1, text: 'text' }],
      callback: () => {
        called = true
      }
    })
    await events.fire('FloatBtnClick', [n.bufnr, 0])
    expect(called).toBe(true)
  })
})

describe('ProgressNotification', () => {
  it('should cancel on window close', async () => {
    let n = new ProgressNotification(nvim, {
      cancellable: true,
      task: (_progress, token) => {
        return new Promise(resolve => {
          token.onCancellationRequested(() => {
            resolve(undefined)
          })
        })
      }
    })
    await n.show({})
    let p = new Promise(resolve => {
      n.onDidFinish(e => {
        resolve(e)
      })
    })
    await nvim.call('coc#float#close_all', [])
    let res = await p
    expect(res).toBeUndefined()
  })

  it('should not fire event when disposed', async () => {
    let fn = async (success: boolean) => {
      let n = new ProgressNotification(nvim, {
        cancellable: true,
        task: () => {
          return new Promise((resolve, reject) => {
            if (success) {
              setTimeout(resolve, 20)
            } else {
              setTimeout(() => {
                reject(new Error('timeout'))
              }, 20)
            }
          })
        }
      })
      let times = 0
      n.onDidFinish(() => {
        times++
      })
      await n.show({})
      n.dispose()
      await helper.wait(20)
      expect(times).toBe(0)
    }
    await fn(true)
    await fn(false)
  })
})
