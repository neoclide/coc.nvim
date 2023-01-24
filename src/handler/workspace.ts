'use strict'
import { Neovim } from '@chemzqm/neovim'
import { v4 as uuid } from 'uuid'
import { writeHeapSnapshot } from 'v8'
import { Location } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import commands from '../commands'
import type { WorkspaceConfiguration } from '../configuration/types'
import { PatternType } from '../core/workspaceFolder'
import extensions from '../extension'
import languages, { ProviderName } from '../languages'
import { getLoggerFile } from '../logger'
import Highligher from '../model/highligher'
import snippetManager from '../snippets/manager'
import { defaultValue } from '../util'
import { CONFIG_FILE_NAME, isVim } from '../util/constants'
import { directoryNotExists } from '../util/errors'
import { isDirectory } from '../util/fs'
import * as Is from '../util/is'
import { fs, os, path } from '../util/node'
import { toText } from '../util/string'
import window from '../window'
import workspace from '../workspace'

declare const REVISION

interface RootPatterns {
  buffer: ReadonlyArray<string>
  server: ReadonlyArray<string>
  global: ReadonlyArray<string>
}

export default class WorkspaceHandler {
  constructor(
    private nvim: Neovim
  ) {
    // exported by window.
    Object.defineProperty(window, 'openLocalConfig', {
      get: () => this.openLocalConfig.bind(this)
    })

    commands.register({
      id: 'workspace.openLocation',
      execute: async (winid: number, loc: Location, openCommand?: string) => {
        await nvim.call('win_gotoid', [winid])
        await workspace.jumpTo(loc.uri, loc.range.start, openCommand)
      }
    }, true)
    commands.register({
      id: 'workspace.undo',
      execute: async () => {
        await workspace.files.undoWorkspaceEdit()
      }
    }, false, 'Undo previous this.workspace edit')
    commands.register({
      id: 'workspace.redo',
      execute: async () => {
        await workspace.files.redoWorkspaceEdit()
      }
    }, false, 'Redo previous this.workspace edit')
    commands.register({
      id: 'workspace.inspectEdit',
      execute: async () => {
        await workspace.files.inspectEdit()
      }
    }, false, 'Inspect previous this.workspace edit in new tab')
    commands.register({
      id: 'workspace.renameCurrentFile',
      execute: async () => {
        await this.renameCurrent()
      }
    }, false, 'change current filename to a new name and reload it.')
    commands.register({
      id: 'document.checkBuffer',
      execute: async () => {
        await this.bufferCheck()
      }
    }, false, 'Check providers for current buffer.')
    commands.register({
      id: 'document.echoFiletype',
      execute: async () => {
        let bufnr = await nvim.call('bufnr', '%') as number
        let doc = workspace.getAttachedDocument(bufnr)
        await window.echoLines([doc.filetype])
      }
    }, false, 'echo the mapped filetype of the current buffer')
    commands.register({
      id: 'workspace.workspaceFolders',
      execute: async () => {
        let folders = workspace.workspaceFolders
        let lines = folders.map(folder => URI.parse(folder.uri).fsPath)
        await window.echoLines(lines)
      }
    }, false, 'show opened workspaceFolders.')
    commands.register({
      id: 'workspace.writeHeapSnapshot',
      execute: async () => {
        let filepath = path.join(os.homedir(), `${uuid()}-${process.pid}.heapsnapshot`)
        writeHeapSnapshot(filepath)
        void window.showInformationMessage(`Create heapdump at: ${filepath}`)
        return filepath
      }
    }, false, 'Generates a snapshot of the current V8 heap and writes it to a JSON file.')
    commands.register({
      id: 'workspace.showOutput',
      execute: async (name?: string) => {
        if (!name) name = await window.showQuickPick(workspace.channelNames, { title: 'Choose output name' }) as string
        window.showOutputChannel(toText(name))
      }
    }, false, 'open output buffer to show output from languageservers or extensions.')
    commands.register({
      id: 'workspace.clearWatchman',
      execute: async () => {
        let res = await window.runTerminalCommand('watchman watch-del-all')
        if (res.success) void window.showInformationMessage('Cleared watchman watching directories.')
        return res.success
      }
    }, false, 'run watch-del-all for watchman to free up memory.')
  }

  public async openLog(): Promise<void> {
    let file = getLoggerFile()
    await workspace.jumpTo(URI.file(file).toString())
  }

  /**
   * Open local config file
   */
  public async openLocalConfig(): Promise<void> {
    let fsPath = await this.nvim.call('expand', ['%:p']) as string
    let filetype = await this.nvim.eval('&filetype') as string
    if (!fsPath || !path.isAbsolute(fsPath)) {
      void window.showWarningMessage(`Current buffer doesn't have valid file path.`)
      return
    }
    let folder = workspace.getWorkspaceFolder(URI.file(fsPath).toString())
    if (!folder) {
      let c = workspace.initialConfiguration.get<any>('workspace')
      let patterns = defaultValue<string[]>(c.rootPatterns, [])
      let ignored = defaultValue<string[]>(c.ignoredFiletypes, [])
      let msg: string
      if (ignored.includes(filetype)) msg = `Filetype '${filetype}' is ignored for workspace folder resolve.`
      if (!msg) msg = `Can't resolve workspace folder for file '${fsPath}, consider create one of ${patterns.join(', ')} in your project root.'.`
      void window.showWarningMessage(msg)
      return
    }
    let root = URI.parse(folder.uri).fsPath
    let dir = path.join(root, '.vim')
    if (!fs.existsSync(dir)) {
      let res = await window.showPrompt(`Would you like to create folder'${root}/.vim'?`)
      if (!res) return
      fs.mkdirSync(dir)
    }
    await workspace.jumpTo(URI.file(path.join(dir, CONFIG_FILE_NAME)))
  }

  public async renameCurrent(): Promise<void> {
    let { nvim } = this
    let oldPath = await nvim.call('expand', ['%:p']) as string
    let newPath = await nvim.callAsync('coc#util#with_callback', ['input', ['New path: ', oldPath, 'file']]) as string
    newPath = newPath.trim()
    if (newPath === oldPath || !newPath) return
    if (oldPath.toLowerCase() != newPath.toLowerCase() && fs.existsSync(newPath)) {
      let overwrite = await window.showPrompt(`${newPath} exists, overwrite?`)
      if (!overwrite) return
    }
    await workspace.renameFile(oldPath, newPath, { overwrite: true })
  }

  public addWorkspaceFolder(folder: string): void {
    if (!Is.string(folder)) throw TypeError(`folder should be string`)
    folder = workspace.expand(folder)
    if (!isDirectory(folder)) throw directoryNotExists(folder)
    workspace.workspaceFolderControl.addWorkspaceFolder(folder, true)
  }

  public async bufferCheck(): Promise<void> {
    let doc = await workspace.document
    if (!doc.attached) {
      await window.showDialog({
        title: 'Buffer check result',
        content: `Document not attached, ${doc.notAttachReason}`,
        highlight: 'WarningMsg'
      })
      return
    }
    let hi = new Highligher()
    hi.addLine('Provider state', 'Title')
    hi.addLine('')
    for (let name of Object.values(ProviderName)) {
      if (name === ProviderName.OnTypeEdit) continue
      let exists = languages.hasProvider(name, doc.textDocument)
      hi.addTexts([
        { text: '-', hlGroup: 'Comment' },
        { text: ' ' },
        exists ? { text: '✓', hlGroup: 'CocListFgGreen' } : { text: '✗', hlGroup: 'CocListFgRed' },
        { text: ' ' },
        { text: name, hlGroup: exists ? 'Normal' : 'CocFadeOut' }
      ])
    }
    await window.showDialog({
      title: 'Buffer check result',
      content: hi.content,
      highlights: hi.highlights
    })
  }

  public async doAutocmd(id: number, args: any[]): Promise<void> {
    await workspace.autocmds.doAutocmd(id, args)
  }

  public async getConfiguration(key: string): Promise<WorkspaceConfiguration> {
    let document = await workspace.document
    return workspace.getConfiguration(key, document)
  }

  public getRootPatterns(bufnr: number): RootPatterns | null {
    let doc = workspace.getDocument(bufnr)
    if (!doc) return null
    return {
      buffer: workspace.workspaceFolderControl.getRootPatterns(doc, PatternType.Buffer),
      server: workspace.workspaceFolderControl.getRootPatterns(doc, PatternType.LanguageServer),
      global: workspace.workspaceFolderControl.getRootPatterns(doc, PatternType.Global)
    }
  }

  public async ensureDocument(): Promise<boolean> {
    let doc = await workspace.document
    return doc && doc.attached
  }

  public async doKeymap(key: string, defaultReturn = ''): Promise<string> {
    return await workspace.keymaps.doKeymap(key, defaultReturn)
  }

  public async snippetCheck(checkExpand: boolean, checkJump: boolean): Promise<boolean> {
    if (checkJump) {
      let jumpable = snippetManager.jumpable()
      if (jumpable) return true
    }
    if (checkExpand) {
      let expandable = await Promise.resolve(extensions.manager.call('coc-snippets', 'expandable', []))
      if (expandable) return true
    }
    return false
  }

  public async showInfo(): Promise<void> {
    let lines: string[] = []
    let version = workspace.version + (typeof REVISION === 'string' ? '-' + REVISION : '')
    lines.push('## versions')
    lines.push('')
    let out = await this.nvim.call('execute', ['version']) as string
    let first = out.trim().split(/\r?\n/, 2)[0].replace(/\(.*\)/, '').trim()
    lines.push('vim version: ' + first + `${isVim ? ' ' + workspace.env.version : ''}`)
    lines.push('node version: ' + process.version)
    lines.push('coc.nvim version: ' + version)
    lines.push('coc.nvim directory: ' + path.dirname(__dirname))
    lines.push('term: ' + defaultValue(process.env.TERM_PROGRAM, process.env.TERM))
    lines.push('platform: ' + process.platform)
    lines.push('')
    lines.push('## Log of coc.nvim')
    lines.push('')
    let file = getLoggerFile()
    const stripAnsi = require('strip-ansi')
    if (fs.existsSync(file)) {
      let content = fs.readFileSync(file, { encoding: 'utf8' })
      lines.push(...content.split(/\r?\n/).map(line => stripAnsi(line)))
    }
    await this.nvim.command('vnew +setl\\ buftype=nofile\\ bufhidden=wipe\\ nobuflisted')
    let buf = await this.nvim.buffer
    await buf.setLines(lines, { start: 0, end: -1, strictIndexing: false })
  }
}
