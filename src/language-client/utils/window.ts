/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import {echoErr, echoMessage, echoWarning} from '../../util'
import workspace from '../../workspace'

export function showErrorMessage(...args: string[]): void {
  echoErr(workspace.nvim, args.join('\n')).catch(_e => {
    // noop
  })
}
export function showWarningMessage(...args: string[]): void {
  echoWarning(workspace.nvim, args.join('\n')).catch(_e => {
    // noop
  })
}
export function showInformationMessage(...args: string[]): void {
  echoMessage(workspace.nvim, args.join('\n')).catch(_e => {
    // noop
  })
}

export function promptAction(input: string): Promise<boolean> {
  return workspace.nvim.call('input', [input + '(y/n)']).then(res => {
    if ((res as string).toLowerCase() == 'y') {
      return true
    }
    return false
  })
}
