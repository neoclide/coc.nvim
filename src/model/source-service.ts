import Source from './source'
import {QueryOption} from '../types'
import {echoWarning, escapeSingleQuote} from '../util/index'

export default abstract class ServiceSource extends Source{

  protected async previewMessage(msg:string):Promise<void> {
    return this.nvim.call('coc#util#preview_info', [msg])
  }

  protected async echoMessage(line):Promise<void> {
    let {nvim} = this
    await nvim.command(`echohl MoreMsg | echomsg '${escapeSingleQuote(line)}' | echohl None"`)
  }

  public async findType(query:QueryOption):Promise<void> {
    let {nvim, name} = this
    await echoWarning(nvim, `find type not supported by ${name}`)
  }

  public async showDocuments(query:QueryOption):Promise<void> {
    let {nvim, name} = this
    await echoWarning(nvim, `show documents not supported by ${name}`)
  }

  public async jumpDefinition(query:QueryOption):Promise<void> {
    let {nvim, name} = this
    await echoWarning(nvim, `jump definition not supported by ${name}`)
  }

  public async showSignature(query:QueryOption):Promise<void> {
    let {nvim, name} = this
    await echoWarning(nvim, `show signature not supported by ${name}`)
  }
}
