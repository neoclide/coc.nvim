import { Neovim } from '../../neovim'
import Floating from '../../completion/floating'
import { getInsertWord, prefixWord } from '../../completion/pum'
import sources from '../../completion/sources'
import { CompleteResult, ExtendedCompleteItem, ISource, SourceType } from '../../completion/types'
import { FloatConfig } from '../../types'
import workspace from '../../workspace'
import helper from '../helper'

let nvim: Neovim
let source: ISource
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  source = {
    name: 'float',
    priority: 10,
    enable: true,
    sourceType: SourceType.Native,
    doComplete: (): Promise<CompleteResult<ExtendedCompleteItem>> => Promise.resolve({
      items: [{
        word: 'foo',
        info: 'Lorem ipsum dolor sit amet, consectetur adipisicing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.'
      }, {
        word: 'foot',
        info: 'foot'
      }, {
        word: 'football',
      }]
    })
  }
  sources.addSource(source)
})

afterAll(async () => {
  sources.removeSource(source)
  await helper.shutdown()
})

afterEach(async () => {
  await helper.reset()
})

/**
 * The pum detail float is created/updated asynchronously by the JS side
 * after a MenuPopupChanged notification, so a test that queries the float
 * state right after an input races that pipeline. Poll until the float with
 * the given kind actually exists.
 */
async function waitFloat(kind: string): Promise<void> {
  for (let i = 0; i < 50; i++) {
    await helper.wait(20)
    let win = await helper.getFloat(kind)
    if (win) return
  }
  throw new Error(`float ${kind} timeout after 1s`)
}

/**
 * Mock the nvim side of the pum detail float: record the payloads sent to
 * `coc#dialog#create_pum_float` and the number of `coc#pum#close_detail`
 * calls, and forward everything else to the real nvim. This removes the
 * window creation/teardown timing from the tests that only assert on the
 * content sent to the float.
 */
function mockFloatCalls() {
  let nvimClient = workspace.nvim
  let original: any = nvimClient.call.bind(nvimClient)
  let createCalls: any[][] = []
  let closeCalls = 0
  let spy = vi.spyOn(nvimClient, 'call').mockImplementation(((method: string, args: any, isNotify?: boolean): Promise<any> => {
    if (method == 'coc#dialog#create_pum_float') {
      createCalls.push(args ?? [])
      return Promise.resolve(0)
    }
    if (method == 'coc#pum#close_detail') {
      closeCalls++
      return Promise.resolve()
    }
    return original(method, args, isNotify)
  }) as any)
  return {
    createCalls,
    get closeCalls(): number {
      return closeCalls
    },
    restore: (): void => {
      spy.mockRestore()
    }
  }
}

describe('completion float', () => {
  it('should prefix word', () => {
    expect(prefixWord('foo', 0, '', 0)).toBe('foo')
    expect(prefixWord('foo', 1, '$foo', 0)).toBe('$foo')
  })

  it('should get insert word', () => {
    expect(getInsertWord('word', [], 0)).toBe('word')
    expect(getInsertWord('word\nbar', [10], 2)).toBe('word')
  })

  it('should cancel float window', async () => {
    await helper.edit()
    await nvim.setLine('f')
    await nvim.input('A')
    nvim.call('coc#start', { source: 'float' }, true)
    await helper.waitPopup()
    // Wait for the float creation triggered by the pum to finish before
    // confirming, otherwise a late creation could land after the close.
    await waitFloat('pumdetail')
    await helper.confirmCompletion(0)
    await helper.waitFor('coc#float#has_float', [], 0)
  })

  it('should adjust float window position', async () => {
    await helper.edit()
    await nvim.setLine(' '.repeat(70))
    await nvim.input('Af')
    await helper.visible('foo', 'float')
    await waitFloat('pumdetail')
    let floatWin = await helper.getFloat('pumdetail')
    let config = await floatWin.getConfig()
    expect(config.col + config.width).toBeLessThan(180)
  })

  it('should redraw float window on item change', async () => {
    let mock = mockFloatCalls()
    try {
      await helper.edit()
      await nvim.setLine(' '.repeat(70))
      await nvim.input('Af')
      await helper.visible('foo', 'float')
      // The initial float is created asynchronously after the pum shows up.
      // Wait for it so the redraw below cannot be overtaken by it.
      await vi.waitFor(() => {
        expect(mock.createCalls.length).toBeGreaterThan(0)
      })
      await nvim.call('coc#pum#select', [1, 1, 0])
      // The redraw happens through the same async pipeline; wait until the
      // float content for the newly selected item is sent.
      await vi.waitFor(() => {
        let lines = mock.createCalls[mock.createCalls.length - 1][0] as string[]
        expect(lines.join('\n')).toMatch('foot')
      })
    } finally {
      mock.restore()
    }
  })

  it('should hide float window when item info is empty', async () => {
    let mock = mockFloatCalls()
    try {
      await helper.edit()
      await nvim.setLine(' '.repeat(70))
      await nvim.input('Af')
      await helper.visible('foo', 'float')
      await vi.waitFor(() => {
        expect(mock.createCalls.length).toBeGreaterThan(0)
      })
      let createsBefore = mock.createCalls.length
      await nvim.call('coc#pum#select', [2, 1, 0])
      // Selecting the item without documentation must close the detail float
      // instead of sending new content for it.
      await vi.waitFor(() => {
        expect(mock.closeCalls).toBeGreaterThan(0)
      })
      expect(mock.createCalls.length).toBe(createsBefore)
    } finally {
      mock.restore()
    }
  })

  it('should hide float window after completion', async () => {
    await helper.edit()
    await nvim.setLine(' '.repeat(70))
    await nvim.input('Af')
    await helper.visible('foo', 'float')
    await waitFloat('pumdetail')
    await nvim.input('<C-n>')
    await nvim.input('<C-y>')
    // Confirming completion closes the pum and its detail float; wait for the
    // actual state instead of relying on a fixed delay.
    await helper.waitFor('coc#float#has_float', [], 0)
  })
})

describe('float config', () => {
  beforeEach(async () => {
    await nvim.input('of')
    await helper.waitPopup()
  })

  async function createFloat(config: Partial<FloatConfig>, docs = [{ filetype: 'txt', content: 'doc' }]): Promise<Floating> {
    let floating = new Floating({
      floatConfig: {
        border: true,
        ...config
      }
    })
    floating.show(docs)
    return floating
  }

  async function getFloat(): Promise<number> {
    let win = await helper.getFloat('pumdetail')
    return win ? win.id : -1
  }

  async function getRelated(winid: number, kind: string): Promise<number> {
    if (!winid || winid == -1) return -1
    let win = nvim.createWindow(winid)
    let related = await win.getVar('related') as number[]
    if (!related || !related.length) return -1
    for (let id of related) {
      let w = nvim.createWindow(id)
      let v = await w.getVar('kind')
      if (v == kind) {
        return id
      }
    }
    return -1
  }

  it('should not shown with empty lines', async () => {
    await createFloat({}, [{ filetype: 'txt', content: '' }])
    let floatWin = await helper.getFloat('pumdetail')
    expect(floatWin).toBeUndefined()
  })

  it('should show window with border', async () => {
    await createFloat({ border: true, rounded: true, focusable: true })
    let winid = await getFloat()
    expect(winid).toBeGreaterThan(0)
    let id = await getRelated(winid, 'border')
    expect(id).toBeGreaterThan(0)
  })

  it('should change window highlights', async () => {
    await createFloat({ border: true, highlight: 'WarningMsg', borderhighlight: 'MoreMsg' })
    let winid = await getFloat()
    expect(winid).toBeGreaterThan(0)
    let win = nvim.createWindow(winid)
    let res = await win.getOption('winhl') as string
    expect(res).toMatch('WarningMsg')
    let id = await getRelated(winid, 'border')
    expect(id).toBeGreaterThan(0)
    win = nvim.createWindow(id)
    res = await win.getOption('winhl') as string
    expect(res).toMatch('MoreMsg')
  })

  it('should add shadow and winblend', async () => {
    await createFloat({ shadow: true, winblend: 30 })
    let winid = await getFloat()
    expect(winid).toBeGreaterThan(0)
  })
})
