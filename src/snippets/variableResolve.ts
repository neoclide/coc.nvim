import * as path from "path"
import workspace from '../workspace'
import Uri from 'vscode-uri'
import { Variable, VariableResolver } from "./parser"
import { Neovim } from '@chemzqm/neovim'
import Document from '../model/document'
const logger = require('../util/logger')('snippets-variable')

export class SnippetVariableResolver implements VariableResolver {
  private _variableToValue: { [key: string]: string } = {}

  private get nvim(): Neovim {
    return workspace.nvim
  }

  public async init(document: Document): Promise<void> {
    let { nvim } = this
    let filepath = Uri.parse(document.uri).fsPath
    let lnum = await nvim.call('line', '.') as number
    let line = document.getline(lnum - 1)
    let cword = await this.nvim.call('expand', '<cword>')
    let selected = await this.nvim.getVar('coc_selected_text') as string
    let clipboard = await this.nvim.call('getreg', '+')
    let yank = await this.nvim.call('getreg', '"')
    Object.assign(this._variableToValue, {
      YANK: yank || undefined,
      CLIPBOARD: clipboard || undefined,
      TM_CURRENT_LINE: line,
      TM_SELECTED_TEXT: selected || undefined,
      TM_CURRENT_WORD: cword,
      TM_LINE_INDEX: (lnum - 1).toString(),
      TM_LINE_NUMBER: lnum.toString(),
      TM_FILENAME: path.basename(filepath),
      TM_FILENAME_BASE: path.basename(filepath, path.extname(filepath)),
      TM_DIRECTORY: path.dirname(filepath),
      TM_FILEPATH: filepath,
    })
  }

  constructor() {
    const currentDate = new Date()
    this._variableToValue = {
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
    }
  }

  public resolve(variable: Variable): string {
    const variableName = variable.name
    return this._variableToValue[variableName]
  }
}
