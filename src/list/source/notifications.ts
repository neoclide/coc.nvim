import window from '../../window'
import BasicList from '../basic'
import { ListItem } from '../types'

export default class NotificationsList extends BasicList {
  public readonly defaultAction = 'clear'
  public readonly description = 'notifications history'
  public readonly name = 'notifications'

  constructor() {
    super()
    this.addAction('clear', async () => {
      window.notifications.clearHistory()
    })
  }

  public async loadItems(): Promise<ListItem[]> {
    return window.notifications.history.map(item => {
      return {
        label: `${item.time} ${item.kind.toUpperCase().padEnd(7)} ${item.message}`,
        filterText: item.message
      }
    })
  }

  public doHighlight(): void {
    let { nvim } = this
    nvim.pauseNotification()
    nvim.command('syntax match CocNotificationTime /\\v^\\s*\\S+/ contained containedin=CocNotificationsLine', true)
    nvim.command('syntax match CocNotificationInfo /\\<INFO\\>/ contained containedin=CocNotificationsLine', true)
    nvim.command('syntax match CocNotificationError /\\<ERROR\\>/ contained containedin=CocNotificationsLine', true)
    nvim.command('syntax match CocNotificationWarning /\\<WARNING\\>/ contained containedin=CocNotificationsLine', true)
    nvim.command('highlight default link CocNotificationTime Comment', true)
    nvim.command('highlight default link CocNotificationInfo CocInfoSign', true)
    nvim.command('highlight default link CocNotificationError CocErrorSign', true)
    nvim.command('highlight default link CocNotificationWarning CocWarningSign', true)
    nvim.resumeNotification(false, true)
  }
}
