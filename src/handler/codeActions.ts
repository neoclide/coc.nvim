import { NeovimClient as Neovim } from '@chemzqm/neovim'
import diagnosticManager from '../diagnostic/manager'
import { CodeAction, CodeActionContext, Range, CodeActionKind } from 'vscode-languageserver-protocol'
import commandManager from '../commands'
import workspace from '../workspace'
import Document from '../model/document'
import window from '../window'
import { HandlerDelegate } from '../types'
import languages from '../languages'
const logger = require('../util/logger')('handler-codeActions')

/**
 * Handle codeActions related methods.
 */
export default class CodeActions {
  constructor(
    private nvim: Neovim,
    private handler: HandlerDelegate
  ) {
    handler.addDisposable(commandManager.registerCommand('editor.action.organizeImport', async (bufnr?: number) => {
      await this.organizeImport(bufnr)
    }))
    commandManager.titles.set('editor.action.organizeImport', 'run organize import code action.')
  }

  public async codeActionRange(start: number, end: number, only?: string): Promise<void> {
    let { doc } = await this.handler.getCurrentState()
    await doc.synchronize()
    let line = doc.getline(end - 1)
    let range = Range.create(start - 1, 0, end - 1, line.length)
    let codeActions = await this.getCodeActions(doc, range, only ? [only] : null)
    if (!codeActions || codeActions.length == 0) {
      window.showMessage(`No${only ? ' ' + only : ''} code action available`, 'warning')
      return
    }
    let idx = await window.showMenuPicker(codeActions.map(o => o.title), 'Choose action')
    let action = codeActions[idx]
    if (action) await this.applyCodeAction(action)
  }

  public async organizeImport(bufnr?: number): Promise<void> {
    let { doc } = await this.handler.getCurrentState()
    if (bufnr && doc.bufnr != bufnr) return
    await doc.synchronize()
    let actions = await this.getCodeActions(doc, undefined, [CodeActionKind.SourceOrganizeImports])
    if (actions && actions.length) {
      await this.applyCodeAction(actions[0])
      return
    }
    throw new Error('Organize import action not found.')
  }

  public async getCodeActions(doc: Document, range?: Range, only?: CodeActionKind[]): Promise<CodeAction[]> {
    range = range || Range.create(0, 0, doc.lineCount, 0)
    let diagnostics = diagnosticManager.getDiagnosticsInRange(doc.textDocument, range)
    let context: CodeActionContext = { diagnostics }
    if (only && Array.isArray(only)) context.only = only
    let codeActions = await this.handler.withRequestToken('code action', token => {
      return languages.getCodeActions(doc.textDocument, range, context, token)
    })
    if (!codeActions || codeActions.length == 0) return []
    // TODO support fadeout disabled actions in menu
    codeActions = codeActions.filter(o => !o.disabled)
    codeActions.sort((a, b) => {
      if (a.isPreferred && !b.isPreferred) {
        return -1
      }
      if (b.isPreferred && !a.isPreferred) {
        return 1
      }
      return 0
    })
    return codeActions
  }

  private get floatActions(): boolean {
    if (!workspace.floatSupported) return false
    let config = workspace.getConfiguration('coc.preferences')
    return config.get<boolean>('floatActions', true)
  }

  public async doCodeAction(mode: string | null, only?: CodeActionKind[] | string): Promise<void> {
    let { doc } = await this.handler.getCurrentState()
    let range: Range
    if (mode) range = await workspace.getSelectedRange(mode, doc)
    await doc.synchronize()
    let codeActions = await this.getCodeActions(doc, range, Array.isArray(only) ? only : null)
    if (typeof only == 'string') {
      codeActions = codeActions.filter(o => o.title == only || (o.command && o.command.title == only))
    } else if (Array.isArray(only)) {
      codeActions = codeActions.filter(o => only.some(k => o.kind && o.kind.startsWith(k)))
    }
    if (!codeActions || codeActions.length == 0) {
      window.showMessage(`No${only ? ' ' + only : ''} code action available`, 'warning')
      return
    }
    if (only && codeActions.length == 1) {
      await this.applyCodeAction(codeActions[0])
      return
    }
    let idx = this.floatActions
      ? await window.showMenuPicker(
        codeActions.map(o => o.title),
        "Choose action"
      )
      : await window.showQuickpick(codeActions.map(o => o.title))
    let action = codeActions[idx]
    if (action) await this.applyCodeAction(action)
  }

  /**
   * Get current codeActions
   */
  public async getCurrentCodeActions(mode?: string, only?: CodeActionKind[]): Promise<CodeAction[]> {
    let { doc } = await this.handler.getCurrentState()
    let range: Range
    if (mode) range = await workspace.getSelectedRange(mode, doc)
    return await this.getCodeActions(doc, range, only)
  }

  /**
   * Invoke preferred quickfix at current position
   */
  public async doQuickfix(): Promise<void> {
    let actions = await this.getCurrentCodeActions('line', [CodeActionKind.QuickFix])
    if (!actions || actions.length == 0) {
      throw new Error('No quickfix action available')
    }
    await this.applyCodeAction(actions[0])
    this.nvim.command(`silent! call repeat#set("\\<Plug>(coc-fix-current)", -1)`, true)
  }

  public async applyCodeAction(action: CodeAction): Promise<void> {
    if (action.disabled) {
      throw new Error(`Action "${action.title}" is disabled: ${action.disabled.reason}`)
    }
    action = await this.handler.withRequestToken('resolve codeAction', token => {
      return languages.resolveCodeAction(action, token)
    })
    let { edit, command } = action
    if (edit) await workspace.applyEdit(edit)
    if (command) await commandManager.execute(command)
  }
}
