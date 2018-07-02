import {
  echoErr,
  echoMessage,
  echoWarning
} from '../../../util'
import workspace from '../../../workspace'

export function errorMsg(msg):void {
  if (workspace.nvim) {
    echoErr(workspace.nvim, msg).catch(_err => {
      // noop
    })
  }
}

export function moreMsg(msg):void {
  if (workspace.nvim) {
    echoMessage(workspace.nvim, msg).catch(_err => {
      // noop
    })
  }
}

export function warningMsg(msg):void {
  if (workspace.nvim) {
    echoWarning(workspace.nvim, msg).catch(_err => {
      // noop
    })
  }
}
