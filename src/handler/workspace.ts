import { Neovim } from '@chemzqm/neovim'
import { URI } from 'vscode-uri'
import fs from 'fs'
import path from 'path'
import extensions from '../extensions'
import { HandlerDelegate, PatternType, WorkspaceConfiguration } from '../types'
import workspace from '../workspace'
import window from '../window'
import snippetManager from '../snippets/manager'
const logger = require('../util/logger')('handler-workspace')
declare const REVISION

interface RootPatterns {
  buffer: string[]
  server: string[]
  global: string[]
}

export default class WorkspaceHandler {
  private called = false
  constructor(
    private nvim: Neovim,
    private handler: HandlerDelegate
  ) {
  }

  public async openLog(): Promise<void> {
    let file = logger.getLogFile()
    await workspace.jumpTo(URI.file(file).toString())
  }

  public async doAutocmd(id: number, args: any[]): Promise<void> {
    let autocmd = workspace.autocmds.get(id) as any
    if (autocmd) await Promise.resolve(autocmd.callback.apply(autocmd.thisArg, args))
  }

  public async getConfiguration(key: string): Promise<WorkspaceConfiguration> {
    let document = await workspace.document
    return workspace.getConfiguration(key, document ? document.uri : undefined)
  }

  public getRootPatterns(bufnr: number): RootPatterns | null {
    let doc = workspace.getDocument(bufnr)
    if (!doc) return null
    return {
      buffer: workspace.getRootPatterns(doc, PatternType.Buffer),
      server: workspace.getRootPatterns(doc, PatternType.LanguageServer) || [],
      global: workspace.getRootPatterns(doc, PatternType.Global)
    }
  }

  public async ensureDocument(): Promise<boolean> {
    let doc = await workspace.document
    return doc && !doc.isCommandLine && doc.attached
  }

  public async doKeymap(key: string, defaultReturn = '', pressed?: string): Promise<string> {
    let keymap = workspace.keymaps.get(key)
    if (!keymap) {
      logger.error(`keymap for ${key} not found`)
      if (pressed) this.nvim.command(`silent! unmap <buffer> ${pressed.startsWith('{') && pressed.endsWith('}') ? `<${pressed.slice(1, -1)}>` : pressed}`, true)
      return defaultReturn
    }
    let [fn, repeat] = keymap
    let res = await Promise.resolve(fn())
    if (repeat) await this.nvim.command(`silent! call repeat#set("\\<Plug>(coc-${key})", -1)`)
    return res ?? defaultReturn
  }

  public async snippetCheck(checkExpand: boolean, checkJump: boolean): Promise<boolean> {
    if (checkExpand && !extensions.has('coc-snippets')) {
      this.nvim.echoError('coc-snippets required for check expand status!')
      return false
    }
    if (checkJump) {
      let jumpable = snippetManager.jumpable()
      if (jumpable) return true
    }
    if (checkExpand) {
      let api = extensions.getExtensionApi('coc-snippets') as any
      if (api && api.hasOwnProperty('expandable')) {
        let expandable = await Promise.resolve(api.expandable())
        if (expandable) return true
      }
    }
    return false
  }

  public async showInfo(): Promise<void> {
    let channel = window.createOutputChannel('info')
    let version = workspace.version + (typeof REVISION === 'string' ? '-' + REVISION : '')
    if (this.called) {
      channel.clear()
    }
    this.called = true
    channel.appendLine('## versions')
    channel.appendLine('')
    let out = await this.nvim.call('execute', ['version']) as string
    let first = out.trim().split(/\r?\n/, 2)[0].replace(/\(.*\)/, '').trim()
    channel.appendLine('vim version: ' + first + `${workspace.isVim ? ' ' + workspace.env.version : ''}`)
    channel.appendLine('node version: ' + process.version)
    channel.appendLine('coc.nvim version: ' + version)
    channel.appendLine('coc.nvim directory: ' + path.dirname(__dirname))
    channel.appendLine('term: ' + (process.env.TERM_PROGRAM || process.env.TERM))
    channel.appendLine('platform: ' + process.platform)
    channel.appendLine('')
    channel.appendLine('## Log of coc.nvim')
    channel.appendLine('')
    let file = logger.getLogFile()
    if (fs.existsSync(file)) {
      let content = fs.readFileSync(file, { encoding: 'utf8' })
      channel.appendLine(content)
    }
    channel.show()
  }
}
