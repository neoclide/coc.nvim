import { Neovim } from '@chemzqm/neovim'
import { CancellationTokenSource, Disposable, SemanticTokens } from 'vscode-languageserver-protocol'
import languages from '../languages'
import Document from '../model/document'
import { disposeAll } from '../util'
import workspace from '../workspace'
const logger = require('../util/logger')('semanticTokensHighlight')

export default class SemanticHighlights {
  private disposables: Disposable[] = []
  private tokenSource: CancellationTokenSource
  constructor(private nvim: Neovim) {}

  public clearHighlights(): void {}

  public async highlight(): Promise<void> {
    this.cancel()
    let { nvim } = this
    let [bufnr, winid, cursors] = await nvim.eval(`[bufnr('%'),win_getid(),get(b:,'coc_cursors_activated',0)]`) as [number, number, number]
    let doc = workspace.getDocument(bufnr)
    if (!doc || !doc.attached) return
    if (cursors) return

    const res = await this.getHighlights(doc)
    logger.error('semanticTokens:', res)
    // if (!highlights) return
    // let groups: { [index: string]: Range[] } = {}
    // for (let hl of highlights) {
    //   if (!hl.range) continue
    //   let hlGroup = hl.kind == DocumentHighlightKind.Text
    //     ? 'CocHighlightText'
    //     : hl.kind == DocumentHighlightKind.Read ? 'CocHighlightRead' : 'CocHighlightWrite'
    //   groups[hlGroup] = groups[hlGroup] || []
    //   groups[hlGroup].push(hl.range)
    // }
    // let win = nvim.createWindow(winid)
    // nvim.pauseNotification()
    // win.clearMatchGroup('^CocHighlight')
    // for (let hlGroup of Object.keys(groups)) {
    //   win.highlightRanges(hlGroup, groups[hlGroup], -1, true)
    // }
    // if (workspace.isVim) nvim.command('redraw', true)
    // let res = this.nvim.resumeNotification()
    // if (Array.isArray(res) && res[1] != null) {
    //   logger.error(`Error on highlight`, res[1][2])
    // } else {
    //   this.highlights.set(winid, highlights)
    // }
  }

  private async getHighlights(doc: Document): Promise<SemanticTokens> {
    try {
      this.tokenSource = new CancellationTokenSource()
      doc.forceSync()
      let { token } = this.tokenSource

      let res = await languages.provideDocumentSemanticTokens(doc.textDocument, token)
      if (!res) {
        return null
      }

      this.tokenSource = null
      if (token.isCancellationRequested) return null

      return res
    } catch (_e) {
      return null
    }
  }

  private cancel(): void {
    if (this.tokenSource) {
      this.tokenSource.cancel()
      this.tokenSource.dispose()
      this.tokenSource = null
    }
  }

  public dispose(): void {
    this.cancel()
    disposeAll(this.disposables)
  }
}
