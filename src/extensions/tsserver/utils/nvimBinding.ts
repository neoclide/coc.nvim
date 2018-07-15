import {echoErr, echoMessage, echoWarning} from '../../../util'
import workspace from '../../../workspace'

export function errorMsg(msg): void {
  echoErr(workspace.nvim, msg)
}

export function moreMsg(msg): void {
  echoMessage(workspace.nvim, msg)
}

export function warningMsg(msg): void {
  echoWarning(workspace.nvim, msg)
}
