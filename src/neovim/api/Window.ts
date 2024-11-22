import { Range } from '../types'
import { BaseApi } from './Base'
import { Buffer } from './Buffer'
import { Tabpage } from './Tabpage'
import { FloatOptions } from './types'

export class Window extends BaseApi {
  public prefix = 'nvim_win_'

  /**
   * The windowid that not change within a Vim session
   */
  public get id(): number {
    return this.data as number
  }

  public setBuffer(buffer: Buffer): Promise<void> {
    return this.request(`${this.prefix}set_buf`, [buffer])
  }

  /** Get current buffer of window */
  public get buffer(): Promise<Buffer> {
    return this.request(`${this.prefix}get_buf`, [])
  }

  /** Get the Tabpage that contains the window */
  public get tabpage(): Promise<Tabpage> {
    return this.request(`${this.prefix}get_tabpage`, [])
  }

  /** Get cursor position */
  public get cursor(): Promise<[number, number]> {
    return this.request(`${this.prefix}get_cursor`, [])
  }

  /** Set cursor position */
  public setCursor(pos: [number, number]): Promise<void>
  public setCursor(pos: [number, number], isNotify: true): null
  public setCursor(pos: [number, number], isNotify = false): Promise<void> | null {
    let method = isNotify ? 'notify' : 'request'
    return this[method](`${this.prefix}set_cursor`, [pos])
  }

  /** Get window height by number of rows */
  public get height(): Promise<number> {
    return this.request(`${this.prefix}get_height`, [])
  }

  /** Set window height by number of rows */
  public setHeight(height: number): Promise<void>
  public setHeight(height: number, isNotify: true): null
  public setHeight(height: number, isNotify = false): Promise<void> | null {
    let method = isNotify ? 'notify' : 'request'
    return this[method](`${this.prefix}set_height`, [height])
  }

  /** Get window width by number of columns */
  public get width(): Promise<number> {
    return this.request(`${this.prefix}get_width`, [])
  }

  /** Set window width by number of columns  */
  public setWidth(width: number): Promise<void>
  public setWidth(width: number, isNotify: true): null
  public setWidth(width: number, isNotify = false): Promise<void> | null {
    let method = isNotify ? 'notify' : 'request'
    return this[method](`${this.prefix}set_width`, [width])
  }

  /** Get window position */
  public get position(): Promise<[number, number]> {
    return this.request(`${this.prefix}get_position`, [])
  }

  /** 0-indexed, on-screen window position(row) in display cells. */
  public get row(): Promise<number> {
    return this.request(`${this.prefix}get_position`, []).then(
      position => position[0]
    )
  }

  /** 0-indexed, on-screen window position(col) in display cells. */
  public get col(): Promise<number> {
    return this.request(`${this.prefix}get_position`, []).then(
      position => position[1]
    )
  }

  /** Is window valid */
  public get valid(): Promise<boolean> {
    return this.request(`${this.prefix}is_valid`, [])
  }

  /** Get window number */
  // eslint-disable-next-line id-blacklist
  public get number(): Promise<number> {
    return this.request(`${this.prefix}get_number`, [])
  }

  public setConfig(options: FloatOptions): Promise<any>
  public setConfig(options: FloatOptions, isNotify: true): null
  public setConfig(options: FloatOptions, isNotify?: boolean): Promise<void> {
    let method = isNotify ? 'notify' : 'request'
    return this[method](`${this.prefix}set_config`, [options])
  }

  public getConfig(): Promise<FloatOptions> {
    return this.request(`${this.prefix}get_config`, [])
  }

  public close(force: boolean): Promise<void>
  public close(force: boolean, isNotify: true): null
  public close(force: boolean, isNotify?: boolean): Promise<void> {
    if (isNotify) {
      this.notify(`${this.prefix}close`, [force])
      return null
    }
    return this.request(`${this.prefix}close`, [force])
  }

  /**
   * Add highlight to ranges by using matchaddpos.
   */
  public highlightRanges(hlGroup: string, ranges: Range[], priority?: number): Promise<number[]>
  public highlightRanges(hlGroup: string, ranges: Range[], priority: number, isNotify: true): null
  public highlightRanges(hlGroup: string, ranges: Range[], priority = 10, isNotify?: boolean): Promise<number[]> | null {
    if (isNotify) {
      this.client.call('coc#highlight#match_ranges', [this.id, 0, ranges, hlGroup, priority], true)
      return undefined
    }
    return this.client.call('coc#highlight#match_ranges', [this.id, 0, ranges, hlGroup, priority]) as Promise<number[]>
  }

  /**
   * Clear match by highlight group.
   */
  public clearMatchGroup(hlGroup: string): void {
    this.client.call('coc#highlight#clear_match_group', [this.id, hlGroup], true)
  }

  /**
   * Clear match by match ids.
   */
  public clearMatches(ids: number[]): void {
    this.client.call('coc#highlight#clear_matches', [this.id, ids], true)
  }
}
