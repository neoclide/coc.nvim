import {Neovim} from 'neovim'
import {CompleteOption, VimCompleteItem} from './types'
import {getConfig} from './config'
import Input from './input'
import buffers from './buffers'
import completes from './completes'
const logger = require('./util/logger')('increment')

export interface CompleteDone {
  word: string
  timestamp: number
  colnr: number
  linenr: number
}

export interface InsertedChar {
  character: string
  timestamp: number
}

export interface ChangedI {
  linenr: number
  colnr: number
}

const MAX_DURATION = 50

export default class Increment {
  private nvim:Neovim
  public activted: boolean
  public input: Input | null | undefined
  public done: CompleteDone | null | undefined
  public lastInsert: InsertedChar | null | undefined
  public option: CompleteOption | null | undefined
  public changedI: ChangedI | null | undefined

  constructor(nvim:Neovim) {
    this.activted = false
    this.nvim = nvim
  }

  public isKeyword(str: string):boolean {
    let {document} = buffers
    return document ? document.isWord(str) : /^\w$/.test(str)
  }

  public async stop():Promise<void> {
    if (!this.activted) return
    this.activted = false
    if (this.input) await this.input.clear()
    this.done = this.input = this.option = this.changedI = null
    let completeOpt = getConfig('completeOpt')
    completes.reset()
    await this.nvim.call('execute', [`noa set completeopt=${completeOpt}`])
    logger.debug('increment stoped')
  }

  /**
   * start
   *
   * @public
   * @param {string} input - current user input
   * @param {string} word - the word before cursor
   * @returns {Promise<void>}
   */
  public async start(input: string, word: string):Promise<void> {
    let {nvim, activted, option} = this
    if (activted || !option) return
    let {linenr, col} = option
    // clear beginning input
    if (this.input) {
      await this.input.clear()
      this.input = null
    }

    let inputTarget = new Input(nvim, input, word, linenr, col)
    if (inputTarget.isValid) {
      this.activted = true
      this.input = inputTarget
      await inputTarget.highlight()
      let opt = this.getNoinsertOption()
      await nvim.call('execute', [`noa set completeopt=${opt}`])
      logger.debug('increment started')
    } else {
      this.option = this.changedI = null
    }
  }

  public setOption(opt: CompleteOption):void {
    this.option = opt
  }

  private isCompleteItem(item: any):boolean {
    if (!item) return false
    let {user_data} = item
    if (!user_data) return false
    try {
      let res = JSON.parse(user_data)
      return res.cid != null
    } catch (e) {
      return false
    }
  }

  public async onCompleteDone():Promise<VimCompleteItem | null> {
    let {option, nvim} = this
    if (!option) return null
    let [_, lnum, colnr] = await nvim.call('getcurpos', [])
    let item = await nvim.getVvar('completed_item')
    if (Object.keys(item).length && !this.isCompleteItem(item)) {
      await this.stop()
      return null
    }
    if (this.input && !this.activted) {
      this.input = null
      await this.input.clear()
    }
    this.done = {
      word: item ? (item as VimCompleteItem).word || '' : '',
      timestamp: Date.now(),
      colnr: Number(colnr),
      linenr: Number(lnum),
    }
    logger.debug(JSON.stringify(this.done))
  }

  public async onCharInsert():Promise<void> {
    let ch:string = (await this.nvim.getVvar('char') as string)
    this.lastInsert = {
      character: ch,
      timestamp: Date.now()
    }
    let {activted} = this
    if (!activted) return
    let isKeyword = this.isKeyword(ch)
    if (!isKeyword) return await this.stop()
    // vim would attamp to match the string
    // if vim find match, no TextChangeI would fire
    // we should disable this behavior by
    // hide the popup
    let visible = await this.nvim.call('pumvisible')
    if (visible) await this.nvim.call('coc#_hide')
  }

  // keep other options
  private getNoinsertOption():string {
    let opt = getConfig('completeOpt')
    let parts = opt.split(',')
    parts.filter(s => s != 'menu')
    if (parts.indexOf('menuone') === -1) {
      parts.push('menuone')
    }
    if (parts.indexOf('noinsert') === -1) {
      parts.push('noinsert')
    }
    return parts.join(',')
  }

  public async onTextChangeI():Promise<boolean> {
    let {option, activted, done, lastInsert, nvim} = this
    if (!option || !activted) return false
    let [_, linenr, colnr] = await nvim.call('getcurpos', [])
    let ts = Date.now()
    if (linenr != option.linenr) {
      await this.stop()
      return false
    }
    let lastChanged = Object.assign({}, this.changedI)
    this.changedI = {
      linenr,
      colnr
    }
    // check continue
    if (lastInsert
      && ts - lastInsert.timestamp < MAX_DURATION
      && colnr - lastChanged.colnr === 1) {
      await this.input.addCharactor(lastInsert.character)
      return true
    }
    // could be not called when user remove one character
    // maybe we could just remove more character then?
    // TODO improve this
    if (lastChanged.colnr - colnr === 1
      && ts - done.timestamp < MAX_DURATION) {
      let invalid = await this.input.removeCharactor()
      if (!invalid) return true
    }
    logger.debug('increment failed')
    await this.stop()
    return false
  }
}
