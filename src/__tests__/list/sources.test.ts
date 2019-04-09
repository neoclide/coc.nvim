import { Neovim } from '@chemzqm/neovim'
import manager from '../../list/manager'
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
  await manager.cancel()
  await helper.reset()
})

describe('list sources', () => {

  describe('commands', () => {
    it('should load commands source', async () => {
      await manager.start(['commands'])
      expect(manager.isActivated).toBe(true)
    })

    it('should do run action', async () => {
      await manager.start(['commands'])
      await helper.wait(100)
      await manager.doAction()
    })
  })

  describe('diagnostics', () => {
    it('should load diagnostics source', async () => {
      await manager.start(['diagnostics'])
      await manager.ui.ready
      await helper.wait(100)
      expect(manager.isActivated).toBe(true)
    })
  })

  describe('extensions', () => {
    it('should load extensions source', async () => {
      await manager.start(['extensions'])
      await manager.ui.ready
      await helper.wait(100)
      expect(manager.isActivated).toBe(true)
    })
  })

  describe('folders', () => {
    it('should load folders source', async () => {
      await manager.start(['folders'])
      await manager.ui.ready
      await helper.wait(100)
      expect(manager.isActivated).toBe(true)
    })

    it('should run delete action', async () => {
      await manager.start(['folders'])
      await manager.ui.ready
      await helper.wait(100)
      await manager.doAction('delete')
    })
  })

  describe('links', () => {
    it('should load links source', async () => {
      await manager.start(['links'])
      await manager.ui.ready
      await helper.wait(100)
      expect(manager.isActivated).toBe(true)
    })
  })

  describe('lists', () => {
    it('should load lists source', async () => {
      await manager.start(['lists'])
      await manager.ui.ready
      await helper.wait(100)
      expect(manager.isActivated).toBe(true)
    })
  })

  describe('outline', () => {
    it('should load outline source', async () => {
      await manager.start(['outline'])
      await manager.ui.ready
      await helper.wait(100)
      expect(manager.isActivated).toBe(true)
    })
  })

  describe('output', () => {
    it('should load output source', async () => {
      await manager.start(['output'])
      await manager.ui.ready
      await helper.wait(100)
      expect(manager.isActivated).toBe(true)
    })
  })

  describe('services', () => {
    it('should load services source', async () => {
      await manager.start(['services'])
      await manager.ui.ready
      await helper.wait(100)
      expect(manager.isActivated).toBe(true)
    })
  })

  describe('sources', () => {
    it('should load sources source', async () => {
      await manager.start(['sources'])
      await manager.ui.ready
      await helper.wait(100)
      expect(manager.isActivated).toBe(true)
    })
  })

  describe('symbols', () => {
    it('should load symbols source', async () => {
      await manager.start(['symbols'])
      await manager.ui.ready
      await helper.wait(100)
      expect(manager.isActivated).toBe(true)
    })
  })
})
