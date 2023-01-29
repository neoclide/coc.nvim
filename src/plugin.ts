'use strict'
import { Neovim } from '@chemzqm/neovim'
import { CodeActionKind, InsertTextMode, Range } from 'vscode-languageserver-types'
import commandManager from './commands'
import completion, { Completion } from './completion'
import sources from './completion/sources'
import Cursors from './cursors'
import diagnosticManager from './diagnostic/manager'
import events from './events'
import extensions from './extension'
import Handler from './handler'
import listManager from './list/manager'
import { createLogger } from './logger'
import services from './services'
import snippetManager from './snippets/manager'
import { UltiSnippetOption } from './types'
import { Disposable, disposeAll, getConditionValue } from './util'
import window from './window'
import workspace, { Workspace } from './workspace'
const logger = createLogger('plugin')

export default class Plugin {
  private ready = false
  private initialized = false
  public handler: Handler | undefined
  private cursors: Cursors
  private actions: Map<string, Function> = new Map()
  private disposables: Disposable[] = []

  constructor(public nvim: Neovim) {
    Object.defineProperty(window, 'workspace', {
      get: () => workspace
    })
    Object.defineProperty(workspace, 'nvim', {
      get: () => this.nvim
    })
    Object.defineProperty(window, 'nvim', {
      get: () => this.nvim
    })
    Object.defineProperty(window, 'cursors', {
      get: () => this.cursors
    })
    Object.defineProperty(commandManager, 'nvim', {
      get: () => this.nvim
    })
    this.cursors = new Cursors(nvim)
    listManager.init(nvim)
    this.addAction('checkJsonExtension', () => {
      if (extensions.has('coc-json')) return
      void window.showInformationMessage(`Run :CocInstall coc-json for json intellisense`)
    })
    this.addAction('rootPatterns', (bufnr: number) => this.handler.workspace.getRootPatterns(bufnr))
    this.addAction('ensureDocument', () => this.handler.workspace.ensureDocument())
    this.addAction('addWorkspaceFolder', (folder: string) => this.handler.workspace.addWorkspaceFolder(folder))
    this.addAction('getConfig', (key: string) => this.handler.workspace.getConfiguration(key))
    this.addAction('doAutocmd', (id: number, ...args: []) => this.handler.workspace.doAutocmd(id, args))
    this.addAction('openLog', () => this.handler.workspace.openLog())
    this.addAction('attach', () => workspace.attach())
    this.addAction('detach', () => workspace.detach())
    this.addAction('doKeymap', (key, defaultReturn) => this.handler.workspace.doKeymap(key, defaultReturn))
    this.addAction('registerExtensions', (...folders: string[]) => extensions.manager.loadExtension(folders), 'registExtensions')
    this.addAction('snippetCheck', (checkExpand: boolean, checkJump: boolean) => this.handler.workspace.snippetCheck(checkExpand, checkJump))
    this.addAction('snippetInsert', (range: Range, newText: string, mode?: InsertTextMode, ultisnip?: UltiSnippetOption) => snippetManager.insertSnippet(newText, true, range, mode, ultisnip))
    this.addAction('snippetNext', () => snippetManager.nextPlaceholder())
    this.addAction('snippetPrev', () => snippetManager.previousPlaceholder())
    this.addAction('snippetCancel', () => snippetManager.cancel())
    this.addAction('openLocalConfig', () => this.handler.workspace.openLocalConfig())
    this.addAction('bufferCheck', () => this.handler.workspace.bufferCheck())
    this.addAction('showInfo', () => this.handler.workspace.showInfo())
    this.addAction('hasProvider', id => this.handler.hasProvider(id))
    this.addAction('cursorsSelect', (bufnr: number, kind: string, mode: string) => this.cursors.select(bufnr, kind, mode))
    this.addAction('fillDiagnostics', (bufnr: number) => diagnosticManager.setLocationlist(bufnr))
    this.addAction('commandList', () => this.handler.commands.getCommandList())
    this.addAction('selectSymbolRange', (inner: boolean, visualmode: string, supportedSymbols: string[]) => this.handler.symbols.selectSymbolRange(inner, visualmode, supportedSymbols))
    this.addAction('openList', (...args: string[]) => listManager.start(args))
    this.addAction('listNames', () => listManager.names)
    this.addAction('listDescriptions', () => listManager.descriptions)
    this.addAction('listLoadItems', name => listManager.loadItems(name))
    this.addAction('listResume', (name?: string) => listManager.resume(name))
    this.addAction('listCancel', () => listManager.cancel(true))
    this.addAction('listPrev', (name?: string) => listManager.previous(name))
    this.addAction('listNext', (name?: string) => listManager.next(name))
    this.addAction('listFirst', (name?: string) => listManager.first(name))
    this.addAction('listLast', (name?: string) => listManager.last(name))
    this.addAction('sendRequest', (id: string, method: string, params?: any) => services.sendRequest(id, method, params))
    this.addAction('sendNotification', (id: string, method: string, params?: any) => services.sendNotification(id, method, params))
    this.addAction('registerNotification', (id: string, method: string) => services.registerNotification(id, method), 'registNotification')
    this.addAction('updateConfig', (section: string, val: any) => workspace.configurations.updateMemoryConfig({ [section]: val }))
    this.addAction('links', () => this.handler.links.getLinks())
    this.addAction('openLink', () => this.handler.links.openCurrentLink())
    this.addAction('pickColor', () => this.handler.colors.pickColor())
    this.addAction('colorPresentation', () => this.handler.colors.pickPresentation())
    this.addAction('highlight', () => this.handler.documentHighlighter.highlight())
    this.addAction('fold', (kind?: string) => this.handler.fold.fold(kind))
    this.addAction('startCompletion', option => completion.startCompletion(option))
    this.addAction('sourceStat', () => sources.sourceStats())
    this.addAction('refreshSource', name => sources.refresh(name))
    this.addAction('toggleSource', name => sources.toggleSource(name))
    this.addAction('diagnosticRefresh', bufnr => diagnosticManager.refresh(bufnr))
    this.addAction('diagnosticInfo', () => diagnosticManager.echoCurrentMessage())
    this.addAction('diagnosticToggle', enable => diagnosticManager.toggleDiagnostic(enable))
    this.addAction('diagnosticToggleBuffer', (bufnr, enable) => diagnosticManager.toggleDiagnosticBuffer(bufnr, enable))
    this.addAction('diagnosticNext', severity => diagnosticManager.jumpNext(severity))
    this.addAction('diagnosticPrevious', severity => diagnosticManager.jumpPrevious(severity))
    this.addAction('diagnosticPreview', () => diagnosticManager.preview())
    this.addAction('diagnosticList', () => diagnosticManager.getDiagnosticList())
    this.addAction('findLocations', (id, method, params, openCommand) => this.handler.locations.findLocations(id, method, params, openCommand))
    this.addAction('getTagList', () => this.handler.locations.getTagList())
    this.addAction('definitions', () => this.handler.locations.definitions())
    this.addAction('declarations', () => this.handler.locations.declarations())
    this.addAction('implementations', () => this.handler.locations.implementations())
    this.addAction('typeDefinitions', () => this.handler.locations.typeDefinitions())
    this.addAction('references', excludeDeclaration => this.handler.locations.references(excludeDeclaration))
    this.addAction('jumpUsed', openCommand => this.handler.locations.gotoReferences(openCommand, false))
    this.addAction('jumpDefinition', openCommand => this.handler.locations.gotoDefinition(openCommand))
    this.addAction('jumpReferences', openCommand => this.handler.locations.gotoReferences(openCommand))
    this.addAction('jumpTypeDefinition', openCommand => this.handler.locations.gotoTypeDefinition(openCommand))
    this.addAction('jumpDeclaration', openCommand => this.handler.locations.gotoDeclaration(openCommand))
    this.addAction('jumpImplementation', openCommand => this.handler.locations.gotoImplementation(openCommand))
    this.addAction('doHover', hoverTarget => this.handler.hover.onHover(hoverTarget))
    this.addAction('definitionHover', hoverTarget => this.handler.hover.definitionHover(hoverTarget))
    this.addAction('getHover', loc => this.handler.hover.getHover(loc))
    this.addAction('showSignatureHelp', () => this.handler.signature.triggerSignatureHelp())
    this.addAction('documentSymbols', (bufnr?: number) => this.handler.symbols.getDocumentSymbols(bufnr))
    this.addAction('symbolRanges', () => this.handler.documentHighlighter.getSymbolsRanges())
    this.addAction('selectionRanges', () => this.handler.selectionRange.getSelectionRanges())
    this.addAction('rangeSelect', (visualmode, forward) => this.handler.selectionRange.selectRange(visualmode, forward))
    this.addAction('rename', newName => this.handler.rename.rename(newName))
    this.addAction('getWorkspaceSymbols', input => this.handler.symbols.getWorkspaceSymbols(input))
    this.addAction('resolveWorkspaceSymbol', symbolInfo => this.handler.symbols.resolveWorkspaceSymbol(symbolInfo))
    this.addAction('formatSelected', mode => this.handler.format.formatCurrentRange(mode))
    this.addAction('format', () => this.handler.format.formatCurrentBuffer())
    this.addAction('commands', () => commandManager.commandList)
    this.addAction('services', () => services.getServiceStats())
    this.addAction('toggleService', name => services.toggle(name))
    this.addAction('codeAction', (mode, only, noExclude) => this.handler.codeActions.doCodeAction(mode, only, noExclude))
    this.addAction('organizeImport', () => this.handler.codeActions.organizeImport())
    this.addAction('fixAll', () => this.handler.codeActions.doCodeAction(null, [CodeActionKind.SourceFixAll]))
    this.addAction('doCodeAction', codeAction => this.handler.codeActions.applyCodeAction(codeAction))
    this.addAction('codeActions', (mode, only) => this.handler.codeActions.getCurrentCodeActions(mode, only))
    this.addAction('quickfixes', mode => this.handler.codeActions.getCurrentCodeActions(mode, [CodeActionKind.QuickFix]))
    this.addAction('codeLensAction', () => this.handler.codeLens.doAction())
    this.addAction('doQuickfix', () => this.handler.codeActions.doQuickfix())
    this.addAction('search', (...args: string[]) => this.handler.refactor.search(args))
    this.addAction('saveRefactor', bufnr => this.handler.refactor.save(bufnr))
    this.addAction('refactor', () => this.handler.refactor.doRefactor())
    this.addAction('runCommand', (...args: any[]) => this.handler.commands.runCommand(...args))
    this.addAction('repeatCommand', () => this.handler.commands.repeat())
    this.addAction('installExtensions', (...list: string[]) => extensions.installExtensions(list))
    this.addAction('updateExtensions', (silent: boolean) => extensions.updateExtensions(silent))
    this.addAction('extensionStats', () => extensions.getExtensionStates())
    this.addAction('loadedExtensions', () => extensions.manager.loadedExtensions)
    this.addAction('watchExtension', (id: string) => extensions.manager.watchExtension(id))
    this.addAction('activeExtension', name => extensions.manager.activate(name))
    this.addAction('deactivateExtension', name => extensions.manager.deactivate(name))
    this.addAction('reloadExtension', name => extensions.manager.reloadExtension(name))
    this.addAction('toggleExtension', name => extensions.manager.toggleExtension(name))
    this.addAction('uninstallExtension', (...args: string[]) => extensions.manager.uninstallExtensions(args))
    this.addAction('getCurrentFunctionSymbol', () => this.handler.symbols.getCurrentFunctionSymbol())
    this.addAction('showOutline', (keep?: number) => this.handler.symbols.showOutline(keep))
    this.addAction('hideOutline', () => this.handler.symbols.hideOutline())
    this.addAction('getWordEdit', () => this.handler.rename.getWordEdit())
    this.addAction('addCommand', cmd => this.handler.commands.addVimCommand(cmd))
    this.addAction('addRanges', ranges => this.cursors.addRanges(ranges))
    this.addAction('currentWorkspacePath', () => workspace.rootPath)
    this.addAction('selectCurrentPlaceholder', triggerAutocmd => snippetManager.selectCurrentPlaceholder(!!triggerAutocmd))
    this.addAction('codeActionRange', (start, end, only) => this.handler.codeActions.codeActionRange(start, end, only))
    this.addAction('incomingCalls', item => this.handler.callHierarchy.getIncoming(item))
    this.addAction('outgoingCalls', item => this.handler.callHierarchy.getOutgoing(item))
    this.addAction('showIncomingCalls', () => this.handler.callHierarchy.showCallHierarchyTree('incoming'))
    this.addAction('showOutgoingCalls', () => this.handler.callHierarchy.showCallHierarchyTree('outgoing'))
    this.addAction('showSuperTypes', () => this.handler.typeHierarchy.showTypeHierarchyTree('supertypes'))
    this.addAction('showSubTypes', () => this.handler.typeHierarchy.showTypeHierarchyTree('subtypes'))
    this.addAction('inspectSemanticToken', () => this.handler.semanticHighlighter.inspectSemanticToken())
    this.addAction('semanticHighlight', () => this.handler.semanticHighlighter.highlightCurrent())
    this.addAction('showSemanticHighlightInfo', () => this.handler.semanticHighlighter.showHighlightInfo())
  }

  public get workspace(): Workspace {
    return workspace
  }

  public get completion(): Completion {
    return completion
  }

  public addAction(key: string, fn: Function, alias?: string): void {
    if (this.actions.has(key)) {
      throw new Error(`Action ${key} already exists`)
    }
    this.actions.set(key, fn)
    if (alias) this.actions.set(alias, fn)
  }

  public async init(rtp: string): Promise<void> {
    if (this.initialized) return
    this.initialized = true
    let { nvim } = this
    await extensions.init(rtp)
    await workspace.init(window)
    nvim.setVar('coc_workspace_initialized', true, true)
    snippetManager.init()
    services.init()
    sources.init()
    completion.init()
    diagnosticManager.init()
    this.handler = new Handler(nvim)
    this.disposables.push(this.handler)
    listManager.registerLists()
    await extensions.activateExtensions()
    workspace.configurations.flushConfigurations()
    nvim.pauseNotification()
    nvim.setVar('coc_service_initialized', 1, true)
    nvim.call('coc#util#do_autocmd', ['CocNvimInit'], true)
    nvim.resumeNotification(false, true)
    logger.info(`coc.nvim initialized with node: ${process.version} after`, Date.now() - getConditionValue(global.__starttime, Date.now()))
    this.ready = true
    await events.fire('ready', [])
  }

  public get isReady(): boolean {
    return this.ready
  }

  public hasAction(method: string): boolean {
    return this.actions.has(method)
  }

  public async cocAction(method: string, ...args: any[]): Promise<any> {
    let fn = this.actions.get(method)
    if (!fn) throw new Error(`Action "${method}" not exist`)
    return await Promise.resolve(fn.apply(null, args))
  }

  public getHandler(): Handler {
    return this.handler
  }

  public dispose(): void {
    disposeAll(this.disposables)
    extensions.dispose()
    listManager.dispose()
    workspace.dispose()
    window.dispose()
    sources.dispose()
    services.dispose()
    snippetManager.dispose()
    commandManager.dispose()
    completion.dispose()
    diagnosticManager.dispose()
  }
}
