import path from 'path'
import window from '../window'
import { Variable, VariableResolver } from "./parser"
import { Neovim } from '@chemzqm/neovim'
import clipboardy from 'clipboardy'
const logger = require('../util/logger')('snippets-variable')

export class SnippetVariableResolver implements VariableResolver {
  private _variableToValue: { [key: string]: string } = {}

  private get nvim(): Neovim {
    return window.nvim
  }

  public async init(): Promise<void> {
    let [filepath, lnum, line, cword, selected, yank] = await this.nvim.eval(`[expand('%:p'),line('.'),getline('.'),expand('<cword>'),get(g:,'coc_selected_text', ''),getreg('"')]`) as any[]
    let clipboard = ''
    const currentDate = new Date()
    try {
      clipboard = await clipboardy.read()
    } catch (e) {
      logger.error(`Error with clipboardy:`, e.message)
    }
    Object.assign(this._variableToValue, {
      YANK: yank || undefined,
      CLIPBOARD: clipboard || undefined,
      TM_CURRENT_LINE: line,
      TM_SELECTED_TEXT: selected || undefined,
      TM_CURRENT_WORD: cword,
      TM_LINE_INDEX: (lnum as number - 1).toString(),
      TM_LINE_NUMBER: lnum.toString(),
      TM_FILENAME: path.basename(filepath),
      TM_FILENAME_BASE: path.basename(filepath, path.extname(filepath)),
      TM_DIRECTORY: path.dirname(filepath),
      TM_FILEPATH: filepath,
      CURRENT_YEAR: currentDate.getFullYear().toString(),
      CURRENT_YEAR_SHORT: currentDate
        .getFullYear()
        .toString()
        .slice(-2),
      CURRENT_MONTH: (currentDate.getMonth() + 1).toString(),
      CURRENT_DATE: currentDate.getDate().toString(),
      CURRENT_HOUR: currentDate.getHours().toString(),
      CURRENT_MINUTE: currentDate.getMinutes().toString(),
      CURRENT_SECOND: currentDate.getSeconds().toString(),
      CURRENT_DAY_NAME: currentDate.toLocaleString("en-US", { weekday: "long" }),
      CURRENT_DAY_NAME_SHORT: currentDate.toLocaleString("en-US", { weekday: "short" }),
      CURRENT_MONTH_NAME: currentDate.toLocaleString("en-US", { month: "long" }),
      CURRENT_MONTH_NAME_SHORT: currentDate.toLocaleString("en-US", { month: "short" })
    })
  }

  public resolve(variable: Variable): string {
    const variableName = variable.name
    let resolved = this._variableToValue[variableName]
    if (resolved != null) {
      return resolved.toString()
    }
    // use default value when resolved is undefined
    if (variable.children && variable.children.length) {
      return variable.toString()
    }
    if (!this._variableToValue.hasOwnProperty(variableName)) {
      return variableName
    }
    return ''
  }
}
