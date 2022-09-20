import { Neovim } from '@chemzqm/neovim'
import { Emitter, Event, NotificationHandler, WorkDoneProgressBegin, WorkDoneProgressEnd, WorkDoneProgressReport } from 'vscode-languageserver-protocol'
import { ProgressContext, ProgressPart } from '../../language-client/progressPart'
import helper from '../helper'

type ProgressType = WorkDoneProgressBegin | WorkDoneProgressReport | WorkDoneProgressEnd

let nvim: Neovim
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
})

afterEach(async () => {
  await helper.reset()
})

afterAll(async () => {
  await helper.shutdown()
})

describe('ProgressPart', () => {
  function createClient(): ProgressContext & { fire: (ev: ProgressType) => void, token: string | undefined } {
    let _onDidProgress = new Emitter<ProgressType>()
    let onDidProgress: Event<ProgressType> = _onDidProgress.event
    let notificationToken: string | undefined
    return {
      id: 'test',
      get token() {
        return notificationToken
      },
      fire(ev) {
        _onDidProgress.fire(ev)
      },
      onProgress<ProgressType>(_, __, handler: NotificationHandler<ProgressType>) {
        return onDidProgress(ev => {
          handler(ev as any)
        })
      },
      sendNotification(_, params) {
        notificationToken = (params as any).token
      }
    }
  }

  it('should not start if cancelled', async () => {
    let client = createClient()
    let p = new ProgressPart(client, '0c7faec8-e36c-4cde-9815-95635c37d696')
    p.cancel()
    expect(p.begin({ kind: 'begin', title: 'canceleld' })).toBe(false)
  })

  it('should report progress', async () => {
    let client = createClient()
    let p = new ProgressPart(client, '0c7faec8-e36c-4cde-9815-95635c37d696')
    p.begin({ kind: 'begin', title: 'p', percentage: 1, cancellable: true })
    await helper.wait(30)
    p.report({ kind: 'report', message: 'msg', percentage: 10 })
    await helper.wait(10)
    p.report({ kind: 'report', message: 'msg', percentage: 50 })
    await helper.wait(10)
    p.done('finised')
  })

  it('should close notification on cancel', async () => {
    helper.updateConfiguration('notification.statusLineProgress', false)
    let client = createClient()
    let p = new ProgressPart(client, '0c7faec8-e36c-4cde-9815-95635c37d696')
    let started = p.begin({ kind: 'begin', title: 'canceleld' })
    expect(started).toBe(true)
    p.cancel()
    p.cancel()
    let winids = await nvim.call('coc#notify#win_list') as number[]
    await helper.wait(30)
    expect(winids.length).toBe(1)
    let win = nvim.createWindow(winids[0])
    let closing = await win.getVar('closing')
    expect(closing).toBe(1)
  })

  it('should send notification on cancel', async () => {
    helper.updateConfiguration('notification.statusLineProgress', false)
    let client = createClient()
    let token = '0c7faec8-e36c-4cde-9815-95635c37d696'
    let p = new ProgressPart(client, token)
    let started = p.begin({ kind: 'begin', title: 'canceleld', cancellable: true })
    expect(started).toBe(true)
    for (let i = 0; i < 10; i++) {
      await helper.wait(30)
      let winids = await nvim.call('coc#notify#win_list') as number[]
      if (winids.length == 1) break
    }
    await helper.wait(30)
    nvim.call('coc#float#close_all', [], true)
    await helper.waitValue(() => {
      return client.token
    }, token)
  })
})
