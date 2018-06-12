import {Neovim} from 'neovim'
import Source from './source'
import {
  QueryOption,
  SourceOption
} from '../types'
import {
  showQuickpick,
  echoMessage,
} from '../util/index'

export default abstract class ServiceSource extends Source {

  constructor(nvim: Neovim, option: SourceOption) {
    option.priority = option.priority || 4
    super(nvim, option)
  }

  protected async previewMessage(msg:string):Promise<void> {
    return this.nvim.call('coc#util#preview_info', [msg])
  }

  // protected async echoMessage(line:string):Promise<void> {
  //   let {nvim} = this
  //   await nvim.command(`echohl MoreMsg | echomsg '${escapeSingleQuote(line)}' | echohl None"`)
  // }

  protected async promptList(items:string[]):Promise<number> {
    return await showQuickpick(this.nvim, items)
  }

  protected async echoLines(lines:string[]):Promise<void> {
    let {nvim} = this
    let cmdHeight = (await nvim.getOption('cmdheight') as number)
    if (lines.length > cmdHeight) {
      lines = lines.slice(0, cmdHeight)
      let last = lines[cmdHeight - 1]
      lines[cmdHeight - 1] = `${last} ...`
    }
    let str = lines.join('\\n').replace(/"/g, '\\"')
    await nvim.command(`echo "${str}"`)
  }

  public async bindEvents():Promise<void> {
    let {nvim} = this
    let {showSignature, bindKeywordprg, signatureEvents} = this.config
    if (bindKeywordprg) {
      await nvim.command('setl keywordprg=:CocShowDoc')
    }
    if (showSignature && signatureEvents && signatureEvents.length) {
      await nvim.command(`autocmd ${signatureEvents.join(',')} <buffer> :call CocShowSignature()`)
    }
  }

  public async showDefinition(query:QueryOption):Promise<void> {
    let {nvim, name} = this
    await echoMessage(nvim, `show definition not supported by ${name}`)
  }

  public async showDocuments(query:QueryOption):Promise<void> {
    let {nvim, name} = this
    await echoMessage(nvim, `show documents not supported by ${name}`)
  }

  public async jumpDefinition(query:QueryOption):Promise<void> {
    let {nvim, name} = this
    await echoMessage(nvim, `jump definition not supported by ${name}`)
  }

  public async showSignature(query:QueryOption):Promise<void> {
    let {nvim, name} = this
    await echoMessage(nvim, `show signature not supported by ${name}`)
  }
}
