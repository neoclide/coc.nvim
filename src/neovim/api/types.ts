import { Buffer } from './Buffer'
import { Tabpage } from './Tabpage'
import { Window } from './Window'

export interface Disposable {
  /**
   * Dispose this object.
   */
  dispose(): void
}

export interface KeymapOption {
  noremap?: boolean
  nowait?: boolean
  silent?: boolean
  script?: boolean
  expr?: boolean
  unique?: boolean
  special?: boolean
}

export enum ExtType {
  Buffer,
  Window,
  Tabpage,
}
export interface ExtTypeConstructor<T> {
  new(...args: any[]): T
}

export interface FloatOptions {
  standalone?: boolean
  focusable?: boolean
  relative?: 'editor' | 'cursor' | 'win'
  anchor?: 'NW' | 'NE' | 'SW' | 'SE'
  height: number
  width: number
  row: number
  col: number
  style?: 'minimal'
  zindex?: number
  mouse?: boolean
  border?:
  | 'none'
  | 'single'
  | 'double'
  | 'rounded'
  | 'solid'
  | 'shadow'
  | string
  | string[]
  title?: string | [string, string]
  title_pos?: 'left' | 'center' | 'right'
  noautocmd?: boolean
  footer?: string | [string, string]
  fixed?: boolean
  hide?: boolean
}

export interface MetadataType {
  constructor: ExtTypeConstructor<Buffer | Tabpage | Window>
  name: string
  prefix: string
}

export const Metadata: MetadataType[] = [
  {
    constructor: Buffer,
    name: 'Buffer',
    prefix: 'nvim_buf_',
  },
  {
    constructor: Window,
    name: 'Window',
    prefix: 'nvim_win_',
  },
  {
    constructor: Tabpage,
    name: 'Tabpage',
    prefix: 'nvim_tabpage_',
  },
]
