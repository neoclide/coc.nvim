import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Notifications } from '../../core/notifications'

describe('Notifications.showMenuPicker', () => {
  it('should return undefined when menu is cancelled', async () => {
    let dialogs = { showMenuPicker: async () => -1 }
    let notifications = new Notifications(dialogs as any)
    let res = await notifications.showMenuPicker('title', 'content', 'CocInfoFloat', ['a', 'b'])
    assert.strictEqual(res, undefined)
  })

  it('should return selected item and normalize all title line breaks', async t => {
    let dialogs = { showMenuPicker: t.mock.fn(async (_items: string[], _opts: any) => 1) }
    let notifications = new Notifications(dialogs as any)
    let res = await notifications.showMenuPicker('title\nsecond line', 'content', 'CocInfoFloat', ['a', 'b'])
    assert.strictEqual(res, 'b')
    let args = dialogs.showMenuPicker.mock.calls[0].arguments
    assert.deepStrictEqual(args[0], ['a', 'b'])
    assert.strictEqual((args[1] as any).title, 'title second line')
  })
})
