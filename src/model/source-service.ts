import Source from './source'
import {QueryOption} from '../types'
import {echoWarning, escapeSingleQuote} from '../util/index'

export default abstract class ServiceSource extends Source{

  protected async previewMessage(msg:string):Promise<void> {
    return this.nvim.call('coc#util#preview_info', [msg])
  }

  protected async echoMessage(line:string):Promise<void> {
    let {nvim} = this
    await nvim.command(`echohl MoreMsg | echomsg '${escapeSingleQuote(line)}' | echohl None"`)
  }

  protected async promptList(items:string[]):Promise<string> {
    let msgs = ['Choose by number:']
    msgs = msgs.concat(items.map((str, index) => {
      return `${index + 1}) ${str}`
    }))
    return await this.nvim.call('input', [msgs.join('\n') + '\n'])
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
