import { Notifications } from '../../core/notifications'

describe('Notifications.showMenuPicker', () => {
  it('should return undefined when menu is cancelled', async (t) => {
    let dialogs = { showMenuPicker: t.mock.fn(() => Promise.resolve(-1)) }
    let notifications = new Notifications(dialogs as any)
    let res = await notifications.showMenuPicker('title', 'content', 'CocInfoFloat', ['a', 'b'])
    assert.strictEqual(res, undefined)
  })

  it('should return selected item and normalize all title line breaks', async (t) => {
    let dialogs = { showMenuPicker: t.mock.fn(() => Promise.resolve(1)) }
    let notifications = new Notifications(dialogs as any)
    let res = await notifications.showMenuPicker('title\nsecond line', 'content', 'CocInfoFloat', ['a', 'b'])
    assert.strictEqual(res, 'b')
    let args = dialogs.showMenuPicker.mock.calls[0].arguments as unknown[]
    assert.deepStrictEqual(args[0], ['a', 'b'])
    assert.strictEqual((args[1] as { title: string }).title, 'title second line')
  })
})
