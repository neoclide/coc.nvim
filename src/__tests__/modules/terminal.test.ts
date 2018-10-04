import { Neovim } from '@chemzqm/neovim'
import path from 'path'
import Terminal from '../../model/terminal'
import { createNvim, wait, platform } from '../../util'
import workspace from '../../workspace'

let nvim: Neovim
beforeEach(async () => {
  nvim = createNvim()
  let p = path.join(workspace.pluginRoot, 'autoload/coc/util.vim')
  await nvim.command(`source ${p}`)
})

afterEach(() => {
  nvim.quit()
})

describe('terminal', () => {

  test('terminal.resolveModule()', async () => {
    let t = new Terminal(nvim)
    let res = await t.resolveModule('typescript')
    expect(typeof res).toBe('string')
  })

  test('terminal.installModule()', async () => {
    let t = new Terminal(nvim)
      ; (workspace as any).nvim = nvim
    if (platform.isMacintosh) {
      let p = t.installModule('uid')
      await wait(100)
      await nvim.input('1<enter>')
      let res = await p
      expect(res).toMatch('uid')
    }
  }, 30000)
})
