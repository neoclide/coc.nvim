'use strict'
import { WorkspaceFolder } from 'vscode-languageserver-types'
import diagnosticManager from '../diagnostic/manager'
import services, { getStateName } from '../services'
import { disposeAll } from '../util'
import { Disposable } from '../util/protocol'
import window from '../window'
import workspace from '../workspace'
import type { McpServer } from './server'

export function editorStateParams(editor: { uri: string, bufnr: number, document?: { languageId: string } } | null | undefined): {
  uri: string | null
  bufnr: number | null
  languageId: string | null
} {
  return {
    uri: editor ? editor.uri : null,
    bufnr: editor ? editor.bufnr : null,
    languageId: editor?.document ? editor.document.languageId : null
  }
}

export function serviceStateParams(stat: { id: string, languageIds: string[] }, current?: { state: number }): {
  id: string
  state: string
  languageIds: string[]
} {
  return {
    id: stat.id,
    state: current ? getStateName(current.state) : 'running',
    languageIds: stat.languageIds
  }
}

/**
 * Bridges coc.nvim events to MCP `coc/*` notifications. Only sessions that
 * subscribed via coc/subscribe receive an event.
 */
export class NotificationManager implements Disposable {
  private disposables: Disposable[] = []

  constructor(private server: McpServer) {
    this.disposables.push(diagnosticManager.onDidRefresh(e => {
      let version = -1
      try {
        version = workspace.getDocument(e.uri)?.version ?? -1
      } catch (_err) {
        // ignore
      }
      this.server.broadcastEvent('coc/diagnostics_changed', {
        uri: e.uri,
        bufnr: e.bufnr,
        version,
        diagnostics: e.diagnostics
      })
    }))
    this.disposables.push(workspace.onDidChangeTextDocument(e => {
      this.server.broadcastEvent('coc/document_changed', {
        uri: e.textDocument.uri,
        version: e.textDocument.version,
        changes: e.contentChanges
      })
    }))
    this.disposables.push(workspace.onDidSaveTextDocument(doc => {
      this.server.broadcastEvent('coc/document_saved', {
        uri: doc.uri,
        version: doc.version,
        languageId: doc.languageId
      })
    }))
    this.disposables.push(workspace.onDidChangeWorkspaceFolders(e => {
      let map = (f: WorkspaceFolder): { name: string, uri: string } => ({ name: f.name, uri: f.uri })
      this.server.broadcastEvent('coc/workspace_folders_changed', {
        added: e.added.map(map),
        removed: e.removed.map(map)
      })
    }))
    try {
      this.disposables.push(window.onDidChangeActiveTextEditor(editor => {
        this.server.broadcastEvent('coc/editor_state_changed', editorStateParams(editor))
      }))
    } catch (_e) {
      // window is not attached to a plugin instance (e.g. tests)
    }
    // Service state: emit on service ready for services registered so far.
    for (let stat of services.getServiceStats()) {
      let service = services.getService(stat.id)
      if (!service) continue
      this.disposables.push(service.onServiceReady(() => {
        let current = services.getService(stat.id)
        this.server.broadcastEvent('coc/service_state_changed', serviceStateParams(stat, current))
      }))
    }
  }

  public dispose(): void {
    disposeAll(this.disposables)
  }
}
