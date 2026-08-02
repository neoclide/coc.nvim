import { Notifications } from '../../core/notifications'

describe('Notifications.showMenuPicker', () => {
  it('should return undefined when menu is cancelled', async () => {
    let dialogs = { showMenuPicker: vi.fn().mockResolvedValue(-1) }
    let notifications = new Notifications(dialogs as any)
    let res = await notifications.showMenuPicker('title', 'content', 'CocInfoFloat', ['a', 'b'])
    expect(res).toBeUndefined()
  })

  it('should return selected item and normalize all title line breaks', async () => {
    let dialogs = { showMenuPicker: vi.fn().mockResolvedValue(1) }
    let notifications = new Notifications(dialogs as any)
    let res = await notifications.showMenuPicker('title\nsecond line', 'content', 'CocInfoFloat', ['a', 'b'])
    expect(res).toBe('b')
    expect(dialogs.showMenuPicker).toHaveBeenCalledWith(['a', 'b'], expect.objectContaining({ title: 'title second line' }))
  })
})
