/**
 * Snippets.ts
 *
 * Manages snippet integration
 */

import * as path from "path"
import workspace from '../workspace'

import { Variable, VariableResolver } from "./parser"
import { Neovim } from '@chemzqm/neovim'
const logger = require('../util/logger')('snippets-variable')

export class SnippetVariableResolver implements VariableResolver {
  private _variableToValue: { [key: string]: string } = {}

  private get nvim(): Neovim {
    return workspace.nvim
  }

  public async init(): Promise<void> {
    let { nvim } = this
    let line = await nvim.call('getline', '.')
    this._variableToValue['TM_CURRENT_LINE'] = line
    let cword = await this.nvim.call('expand', '<cword>')
    this._variableToValue['TM_CURRENT_WORD'] = cword
    let selected = await this.nvim.getVar('coc_selected_text') as string
    logger.debug('text:', selected)
    this._variableToValue['TM_SELECTED_TEXT'] = selected
    await this.nvim.setVar('coc_selected_text', '')
  }

  constructor(line: number, filePath: string) {
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
      CURRENT_MONTH_NAME_SHORT: currentDate.toLocaleString("en-US", { month: "short" }),
      TM_SELECTED_TEXT: "",
      TM_LINE_INDEX: line.toString(),
      TM_LINE_NUMBER: (line + 1).toString(),
      TM_FILENAME: path.basename(filePath),
      TM_FILENAME_BASE: path.basename(filePath, path.extname(filePath)),
      TM_DIRECTORY: path.dirname(filePath),
      TM_FILEPATH: filePath,
    }
  }

  public resolve(variable: Variable): string {
    const variableName = variable.name
    return this._variableToValue[variableName] || ''
  }
}
