import { Neovim } from '@chemzqm/neovim'
import { CodeActionContext, CodeActionKind, ExecuteCommandParams, ExecuteCommandRequest, Range } from 'vscode-languageserver-protocol'
import commandManager from '../../commands'
import diagnosticManager from '../../diagnostic/manager'
import languages from '../../languages'
import services from '../../services'
import { CodeAction, ListArgument, ListContext, ListItem } from '../../types'
import workspace from '../../workspace'
import BasicList from '../basic'
const logger = require('../../util/logger')('list-actions')

export default class ActionsList extends BasicList {
  public defaultAction = 'do'
  public description = 'code actions of selected range.'
  public name = 'actions'
  public options: ListArgument[] = [{
    name: '-start',
    description: 'start of line',
    hasValue: true
  }, {
    name: '-end',
    description: 'end of line',
    hasValue: true
  }, {
    name: '-quickfix',
    description: 'quickfix only',
  }, {
    name: '-source',
    description: 'source action only'
  }]

  constructor(nvim: Neovim) {
    super(nvim)

    this.addAction('do', async item => {
      let action = item.data.action as CodeAction
      let { command, edit } = action
      if (edit) await workspace.applyEdit(edit)
      if (command) {
        if (commandManager.has(command.command)) {
          commandManager.execute(command)
        } else {
          let clientId = (action as any).clientId
          let service = services.getService(clientId)
          let params: ExecuteCommandParams = {
            command: command.command,
            arguments: command.arguments
          }
          if (service.client) {
            let { client } = service
            client
              .sendRequest(ExecuteCommandRequest.type, params)
              .then(undefined, error => {
                workspace.showMessage(`Execute '${command.command} error: ${error}'`, 'error')
              })
          }
        }
      }
    })
  }

  public async loadItems(context: ListContext): Promise<ListItem[]> {
    let buf = await context.window.buffer
    let doc = workspace.getDocument(buf.id)
    if (!doc) return null
    let args = this.parseArguments(context.args)
    let range: Range
    if (args.start && args.end) {
      range = Range.create(parseInt(args.start as string, 10) - 1, 0, parseInt(args.end as string, 10), 0)
    } else {
      range = Range.create(0, 0, doc.lineCount, 0)
    }
    let diagnostics = diagnosticManager.getDiagnosticsInRange(doc.textDocument, range)
    let actionContext: CodeActionContext = { diagnostics }
    if (args.quickfix) {
      actionContext.only = [CodeActionKind.QuickFix]
    } else if (args.source) {
      actionContext.only = [CodeActionKind.Source]
    }
    let codeActionsMap = await languages.getCodeActions(doc.textDocument, range, actionContext)
    if (!codeActionsMap) return []
    let codeActions: CodeAction[] = []
    for (let clientId of codeActionsMap.keys()) {
      let actions = codeActionsMap.get(clientId)
      for (let action of actions) {
        codeActions.push({ clientId, ...action })
      }
    }
    codeActions.sort((a, b) => {
      if (a.isPrefered && !b.isPrefered) {
        return -1
      }
      if (b.isPrefered && !a.isPrefered) {
        return 1
      }
      return 0
    })

    let items: ListItem[] = codeActions.map(action => {
      return {
        label: `${action.title} ${action.clientId ? `[${action.clientId}]` : ''} ${action.kind ? `(${action.kind})` : ''}`,
        data: { action }
      } as ListItem
    })
    return items
  }

  public doHighlight(): void {
    let { nvim } = this
    nvim.pauseNotification()
    nvim.command('syntax match CocActionsTitle /\\v^[^[]+/ contained containedin=CocActionsLine', true)
    nvim.command('syntax match CocActionsClient /\\[\\w\\+\\]/ contained containedin=CocActionsLine', true)
    nvim.command('syntax match CocActionsKind /\\v\\(.*\\)$/ contained containedin=CocActionsLine', true)
    nvim.command('highlight default link CocActionsTitle Normal', true)
    nvim.command('highlight default link CocActionsClient Typedef', true)
    nvim.command('highlight default link CocActionsKind Comment', true)
    nvim.resumeNotification().catch(_e => {
      // noop
    })
  }
}
