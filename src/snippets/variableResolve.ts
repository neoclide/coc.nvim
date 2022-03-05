import { Neovim } from '@chemzqm/neovim'
import path from 'path'
import { Variable, VariableResolver } from "./parser"
const logger = require('../util/logger')('snippets-variable')

function padZero(n: number): string {
  return n < 10 ? '0' + n : n.toString()
}

export class SnippetVariableResolver implements VariableResolver {
  private _variableToValue: { [key: string]: string } = {}

  constructor(private nvim: Neovim) {
    const currentDate = new Date()
    const fullyear = currentDate.getFullYear().toString()
    Object.assign(this._variableToValue, {
      CURRENT_YEAR: fullyear,
      CURRENT_YEAR_SHORT: fullyear.slice(-2),
      CURRENT_MONTH: padZero(currentDate.getMonth() + 1),
      CURRENT_DATE: padZero(currentDate.getDate()),
      CURRENT_HOUR: padZero(currentDate.getHours()),
      CURRENT_MINUTE: padZero(currentDate.getMinutes()),
      CURRENT_SECOND: padZero(currentDate.getSeconds()),
      CURRENT_DAY_NAME: currentDate.toLocaleString("en-US", { weekday: "long" }),
      CURRENT_DAY_NAME_SHORT: currentDate.toLocaleString("en-US", { weekday: "short" }),
      CURRENT_MONTH_NAME: currentDate.toLocaleString("en-US", { month: "long" }),
      CURRENT_MONTH_NAME_SHORT: currentDate.toLocaleString("en-US", { month: "short" }),
      TM_FILENAME: null,
      TM_FILENAME_BASE: null,
      TM_DIRECTORY: null,
      TM_FILEPATH: null,
      YANK: null,
      TM_LINE_INDEX: null,
      TM_LINE_NUMBER: null,
      TM_CURRENT_LINE: null,
      TM_CURRENT_WORD: null,
      TM_SELECTED_TEXT: null,
      CLIPBOARD: null
    })
  }

  private async resolveValue(name: string): Promise<string | undefined> {
    let { nvim } = this
    if (['TM_FILENAME', 'TM_FILENAME_BASE', 'TM_DIRECTORY', 'TM_FILEPATH'].includes(name)) {
      let filepath = await nvim.eval('expand("%:p")') as string
      if (name == 'TM_FILENAME') return path.basename(filepath)
      if (name == 'TM_FILENAME_BASE') return path.basename(filepath, path.extname(filepath))
      if (name == 'TM_DIRECTORY') return path.dirname(filepath)
      if (name == 'TM_FILEPATH') return filepath
    }
    if (name == 'YANK') {
      let yank = await nvim.call('getreg', ['""']) as string
      return yank
    }
    if (name == 'TM_LINE_INDEX') {
      let lnum = await nvim.call('line', ['.']) as number
      return (lnum - 1).toString()
    }
    if (name == 'TM_LINE_NUMBER') {
      let lnum = await nvim.call('line', ['.']) as number
      return lnum.toString()
    }
    if (name == 'TM_CURRENT_LINE') {
      let line = await nvim.call('getline', ['.']) as string
      return line
    }
    if (name == 'TM_CURRENT_WORD') {
      let word = await nvim.eval(`expand('<cword>')`) as string
      return word
    }
    if (name == 'TM_SELECTED_TEXT' || name == 'VISUAL') {
      let text = await nvim.eval(`get(g:,'coc_selected_text', '')`) as string
      return text
    }
    if (name == 'CLIPBOARD') {
      return await nvim.eval('@*') as string
    }
  }

  public async resolve(variable: Variable): Promise<string> {
    const name = variable.name
    let resolved = this._variableToValue[name]
    if (resolved != null) return resolved.toString()
    // resolve value from vim
    let value = await this.resolveValue(name)
    if (value) return value
    // use default value when resolved is undefined
    if (variable.children && variable.children.length) {
      return variable.toString()
    }
    if (!this._variableToValue.hasOwnProperty(name)) {
      // VSCode behavior
      return name
    }
    return ''
  }
}
