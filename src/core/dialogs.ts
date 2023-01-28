import type { Neovim } from '@chemzqm/neovim'
import type { WorkspaceConfiguration } from '../configuration/types'
import events from '../events'
import { Dialog, DialogConfig, DialogPreferences } from '../model/dialog'
import InputBox, { InputPreference } from '../model/input'
import Menu, { MenuItem } from '../model/menu'
import Picker, { toPickerItems } from '../model/picker'
import QuickPick from '../model/quickpick'
import { QuickPickItem } from '../types'
import { defaultValue } from '../util'
import { isFalsyOrEmpty } from '../util/array'
import { floatHighlightGroup, isVim } from '../util/constants'
import { Mutex } from '../util/mutex'
import { toNumber } from '../util/numbers'
import { isWindows } from '../util/platform'
import { CancellationToken } from '../util/protocol'
import { toText } from '../util/string'
import { callAsync, has, PartialEnv } from './funcs'
import { showPrompt } from './ui'
export type Item = QuickPickItem | string
export type InputOptions = Pick<InputPreference, 'borderhighlight' | 'position' | 'marginTop' | 'placeHolder'>

export interface QuickPickConfig<T extends QuickPickItem> {
  placeholder?: string
  title?: string
  items?: readonly T[]
  value?: string
  canSelectMany?: boolean
  matchOnDescription?: boolean
}

/**
 * Options to configure the behavior of the quick pick UI.
 */
export interface QuickPickOptions {

  placeholder?: string
  /**
   * An optional string that represents the title of the quick pick.
   */
  title?: string

  /**
   * An optional flag to include the description when filtering the picks.
   */
  matchOnDescription?: boolean

  /**
   * An optional flag to make the picker accept multiple selections, if true the result is an array of picks.
   */
  canPickMany?: boolean
}

export type MenuOption = {
  title?: string,
  content?: string
  /**
   * Create and highlight shortcut characters.
   */
  shortcuts?: boolean
  /**
   * Position of menu picker, default to 'cursor'
   */
  position?: 'cursor' | 'center'
  /**
   * Border highlight that override user configuration.
   */
  borderhighlight?: string
} | string

export class Dialogs {
  public mutex = new Mutex()
  public nvim: Neovim
  public configuration: WorkspaceConfiguration
  constructor() {
  }

  public async showDialog(config: DialogConfig): Promise<Dialog | null> {
    return await this.mutex.use(async () => {
      let dialog = new Dialog(this.nvim, config)
      await dialog.show(this.dialogPreference)
      return dialog
    })
  }

  public async showPrompt(title: string): Promise<boolean> {
    return await this.mutex.use(() => {
      return showPrompt(this.nvim, title)
    })
  }

  public async createQuickPick<T extends QuickPickItem>(config: QuickPickConfig<T>): Promise<QuickPick<T>> {
    return await this.mutex.use(async () => {
      let quickpick = new QuickPick<T>(this.nvim, this.dialogPreference)
      Object.assign(quickpick, config)
      return quickpick
    })
  }

  public async showMenuPicker(items: string[] | MenuItem[], option?: MenuOption, token?: CancellationToken): Promise<number> {
    return await this.mutex.use(async () => {
      if (token && token.isCancellationRequested) return -1
      option = option || {}
      if (typeof option === 'string') option = { title: option }
      let menu = new Menu(this.nvim, { items, ...option }, token)
      let promise = new Promise<number>(resolve => {
        menu.onDidClose(selected => {
          events.race(['BufHidden'], 20).finally(() => {
            resolve(selected)
          })
        })
      })
      await menu.show(this.dialogPreference)
      return await promise
    })
  }

  /**
   * Shows a selection list.
   */
  public async showQuickPick(itemsOrItemsPromise: Item[] | Promise<Item[]>, options: QuickPickOptions, token: CancellationToken): Promise<Item | Item[] | undefined> {
    options = defaultValue(options, {})
    const items = await Promise.resolve(itemsOrItemsPromise)
    if (isFalsyOrEmpty(items)) return undefined
    let isText = items.some(s => typeof s === 'string')
    return await this.mutex.use(() => {
      return new Promise<Item | Item[] | undefined>((resolve, reject) => {
        if (token.isCancellationRequested) return resolve(undefined)
        let quickpick = new QuickPick<QuickPickItem>(this.nvim, this.dialogPreference)
        quickpick.items = items.map(o => typeof o === 'string' ? { label: o } : o)
        quickpick.title = toText(options.title)
        quickpick.placeholder = options.placeholder
        quickpick.canSelectMany = !!options.canPickMany
        quickpick.matchOnDescription = options.matchOnDescription
        quickpick.onDidFinish(items => {
          if (items == null) return resolve(undefined)
          let arr = isText ? items.map(o => o.label) : items
          if (options.canPickMany) return resolve(arr)
          resolve(arr[0])
        })
        quickpick.show().catch(reject)
      })
    })
  }

  public async showPickerDialog(items: string[], title: string, token?: CancellationToken): Promise<string[] | undefined>
  public async showPickerDialog<T extends QuickPickItem>(items: T[], title: string, token?: CancellationToken): Promise<T[] | undefined>
  public async showPickerDialog(items: any, title: string, token?: CancellationToken): Promise<any | undefined> {
    return await this.mutex.use(async () => {
      if (token && token.isCancellationRequested) {
        return undefined
      }
      const picker = new Picker(this.nvim, {
        title,
        items: toPickerItems(items),
      }, token)
      let promise = new Promise<number[]>(resolve => {
        picker.onDidClose(selected => {
          resolve(selected)
        })
      })
      await picker.show(this.dialogPreference)
      let picked = await promise
      return picked == undefined ? undefined : items.filter((_, i) => picked.includes(i))
    })
  }

  public async requestInput(title: string, env: PartialEnv, value?: string, option?: InputOptions): Promise<string | undefined> {
    let { nvim } = this
    const promptInput = this.configuration.get('coc.preferences.promptInput')
    const inputSupported = !isVim || (has(env, 'patch-8.2.750') && !isWindows)
    if (promptInput && inputSupported) {
      return await this.mutex.use(async () => {
        let input = new InputBox(nvim, toText(value))
        await input.show(title, Object.assign(this.inputPreference, defaultValue(option, {})))
        return await new Promise<string>(resolve => {
          input.onDidFinish(text => {
            setTimeout(() => {
              resolve(text)
            }, 20)
          })
        })
      })
    } else {
      return await this.mutex.use(async () => {
        let res = await callAsync<string>(this.nvim, 'input', [title + ': ', toText(value)])
        nvim.command('normal! :<C-u>', true)
        return res
      })
    }
  }

  public async createInputBox(title: string, value: string | undefined, option?: InputPreference): Promise<InputBox> {
    let input = new InputBox(this.nvim, toText(value))
    await input.show(title, Object.assign(this.inputPreference, defaultValue(option, {})))
    return input
  }

  private get inputPreference(): InputPreference {
    let config = this.configuration.get<any>('dialog')
    return {
      rounded: !!config.rounded,
      maxWidth: toNumber(config.maxWidth, 80),
      highlight: defaultValue(config.floatHighlight, floatHighlightGroup),
      borderhighlight: defaultValue(config.floatBorderHighlight, floatHighlightGroup)
    }
  }

  private get dialogPreference(): DialogPreferences {
    let config = this.configuration.get<any>('dialog')
    return {
      rounded: !!config.rounded,
      maxWidth: toNumber(config.maxWidth, 80),
      maxHeight: config.maxHeight,
      floatHighlight: defaultValue(config.floatHighlight, floatHighlightGroup),
      floatBorderHighlight: defaultValue(config.floatBorderHighlight, floatHighlightGroup),
      pickerButtons: config.pickerButtons,
      pickerButtonShortcut: config.pickerButtonShortcut,
      confirmKey: toText(config.confirmKey),
      shortcutHighlight: toText(config.shortcutHighlight)
    }
  }
}
