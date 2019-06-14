/**
 * popup interfact for vim
 */
import { TextItem, PopupOptions } from '../types'
import { Neovim } from '@chemzqm/neovim'

export class Popup {
  public id: number
  public bufferId: number
  constructor(private nvim: Neovim) {
  }

  public async create(text: string[] | TextItem[], options: PopupOptions): Promise<void> {
    let { nvim } = this
    this.id = await nvim.call('popup_create', [text, options])
    this.bufferId = await nvim.call('winbufnr', [this.id]) as number
  }

  public hide(): void {
    if (!this.id) return
    this.nvim.call('popup_hide', [this.id], true)
  }

  public async valid(): Promise<boolean> {
    if (!this.bufferId) return false
    await this.nvim.call('bufexists', [this.bufferId])
  }

  public async visible(): Promise<boolean> {
    if (!this.id) return false
    let opt = await this.nvim.call('popup_getpos', [this.id])
    return opt && opt.visible == 1
  }

  public show(): void {
    if (!this.id) return
    this.nvim.call('popup_show', [this.id], true)
  }

  public move(options: Partial<PopupOptions>): void {
    if (!this.id) return
    this.nvim.call('popup_move', [this.id, options], true)
  }

  public async getPosition(): Promise<any> {
    return await this.nvim.call('popup_getpos', [this.id])
  }

  public setFiletype(filetype: string): void {
    if (!this.id) return
    let { nvim } = this
    // nvim.call('win_execute', [this.id, 'syntax enable'], true)
    nvim.call('setbufvar', [this.bufferId, '&filetype', filetype], true)
  }

  public dispose(): void {
    if (this.id) {
      this.nvim.call('popup_close', [this.id], true)
    }
  }
}

export default async function createPopup(nvim: Neovim, text: string[] | TextItem[], options: PopupOptions): Promise<Popup> {
  let popup = new Popup(nvim)
  await popup.create(text, options)
  return popup
}
