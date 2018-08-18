import fs from 'fs'
import path from 'path'
import { Diagnostic, DiagnosticSeverity, Disposable, Range } from 'vscode-languageserver-protocol'
import Uri from 'vscode-uri'
import { Command, CommandManager } from '../../../commands'
import languages from '../../../languages'
import Document from '../../../model/document'
import { DiagnosticCollection } from '../../../types'
import { disposeAll } from '../../../util'
import { resolveRoot } from '../../../util/fs'
import workspace from '../../../workspace'
import { errorMsg } from '../utils/nvimBinding'
const logger = require('../../../util/logger')('typescript-watch')

const TSC = './node_modules/.bin/tsc'
const countRegex = /Found\s(\d+)\serror/
const startRegex = /File\s+change\s+detected/
const errorRegex = /^(.+):(\d+):(\d+)\s-\s(\w+)\s+[A-Za-z]+(\d+):\s+(.*)$/

enum TscStatus {
  INIT,
  COMPILING,
  RUNNING,
  ERROR,
}

class WatchCommand implements Command {
  public readonly id: string = 'tsserver.watchBuild'

  constructor(
    private collection: DiagnosticCollection
  ) {
  }

  private setStatus(state: TscStatus): void {
    let s = 'init'
    switch (state) {
      case TscStatus.COMPILING:
        s = 'compiling'
        break
      case TscStatus.RUNNING:
        s = 'running'
        break
      case TscStatus.ERROR:
        s = 'error'
        break
    }
    workspace.nvim.setVar('tsc_status', s, true)
  }

  public async execute(): Promise<void> {
    let docs = workspace.documents
    let idx = docs.findIndex(doc => doc.uri.indexOf(TSC) !== -1)
    if (idx !== -1) return
    let document = await workspace.document
    let fsPath = Uri.parse(document.uri).fsPath
    let cwd = path.dirname(fsPath)
    let dir = resolveRoot(cwd, ['node_modules'])
    if (dir) {
      let file = path.join(dir, 'node_modules/.bin/tsc')
      if (!fs.existsSync(file)) dir = null
    }
    if (!dir) {
      errorMsg('typescript module not found!')
      return
    }
    let configRoot = resolveRoot(cwd, ['tsconfig.json'])
    if (!configRoot) {
      errorMsg('tsconfig.json not found!')
      return
    }
    let configPath = path.relative(dir, path.join(configRoot, 'tsconfig.json'))
    let cmd = `${TSC} -p ${configPath} --watch true`
    await workspace.nvim.call('coc#util#open_terminal', {
      keepfocus: 1,
      cwd: dir,
      cmd
    })
  }

  private getcwd(uri: string): string {
    let { path } = Uri.parse(uri)
    let m = path.match(/\/\/\d+/)
    if (!m) return
    return path.slice(0, m.index)
  }

  public onTerminalCreated(doc: Document): void {
    let entries: Map<string, Diagnostic[]> = new Map()
    let cwd = this.getcwd(doc.uri)
    if (!cwd) return
    let uris = new Set()
    this.setStatus(TscStatus.RUNNING)
    let parseLine = (line: string): void => {
      if (startRegex.test(line)) {
        this.setStatus(TscStatus.COMPILING)
        entries = new Map()
      } else if (errorRegex.test(line)) {
        let ms = line.match(errorRegex)
        let severity = /error/.test(ms[4]) ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning
        let lnum = Number(ms[2]) - 1
        let character = Number(ms[3]) - 1
        let range = Range.create(lnum, character, lnum, character)
        let uri = Uri.file(path.join(cwd, ms[1])).toString()
        let diagnostics = entries.get(uri) || []
        diagnostics.push(Diagnostic.create(range, ms[6], severity, ms[5], 'tsc'))
        entries.set(uri, diagnostics)
      } else if (countRegex.test(line)) {
        let ms = line.match(countRegex)
        if (ms[1] == '0') {
          entries = new Map()
          this.setStatus(TscStatus.RUNNING)
          this.collection.clear()
          uris = new Set()
          return
        }
        this.setStatus(TscStatus.ERROR)
        for (let [key, value] of entries.entries()) {
          this.collection.set(key, value)
        }
        for (let uri of uris) {
          if (!entries.has(uri)) {
            this.collection.set(uri, [])
          }
        }
        uris = new Set(entries.keys())
      }
    }
    for (let line of doc.content.split('\n')) {
      parseLine(line)
    }
    doc.onDocumentDetach(() => {
      entries = new Map()
      this.setStatus(TscStatus.INIT)
      this.collection.clear()
    })
    doc.onDocumentChange(e => {
      let { contentChanges } = e
      for (let change of contentChanges) {
        let lines = change.text.split('\n')
        for (let line of lines) {
          parseLine(line)
        }
      }
    })
  }
}

export default class WatchProject {
  private disposables: Disposable[] = []
  public constructor(
    commandManager: CommandManager
  ) {
    let collection = languages.createDiagnosticCollection('tsc')
    let cmd = new WatchCommand(collection)
    commandManager.register(cmd)
    this.disposables.push(Disposable.create(() => {
      commandManager.unregister(cmd.id)
    }))
    workspace.documents.forEach(doc => {
      let { uri } = doc
      if (this.isTscBuffer(uri)) {
        cmd.onTerminalCreated(doc)
      }
    })
    workspace.onDidOpenTextDocument(doc => {
      let { uri } = doc
      if (this.isTscBuffer(uri)) {
        cmd.onTerminalCreated(workspace.getDocument(uri))
      }
    }, this, this.disposables)
  }

  private isTscBuffer(uri: string): boolean {
    return uri.startsWith('term://') && uri.indexOf(TSC) !== -1
  }

  public dispose(): void {
    disposeAll(this.disposables)
  }
}
