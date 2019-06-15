"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const vscode_languageserver_protocol_1 = require("vscode-languageserver-protocol");
const commands_1 = tslib_1.__importDefault(require("./commands"));
const manager_1 = tslib_1.__importDefault(require("./diagnostic/manager"));
const codeActionmanager_1 = tslib_1.__importDefault(require("./provider/codeActionmanager"));
const rangeManager_1 = tslib_1.__importDefault(require("./provider/rangeManager"));
const codeLensManager_1 = tslib_1.__importDefault(require("./provider/codeLensManager"));
const declarationManager_1 = tslib_1.__importDefault(require("./provider/declarationManager"));
const definitionManager_1 = tslib_1.__importDefault(require("./provider/definitionManager"));
const documentColorManager_1 = tslib_1.__importDefault(require("./provider/documentColorManager"));
const documentHighlightManager_1 = tslib_1.__importDefault(require("./provider/documentHighlightManager"));
const documentLinkManager_1 = tslib_1.__importDefault(require("./provider/documentLinkManager"));
const documentSymbolManager_1 = tslib_1.__importDefault(require("./provider/documentSymbolManager"));
const foldingRangeManager_1 = tslib_1.__importDefault(require("./provider/foldingRangeManager"));
const formatManager_1 = tslib_1.__importDefault(require("./provider/formatManager"));
const formatRangeManager_1 = tslib_1.__importDefault(require("./provider/formatRangeManager"));
const hoverManager_1 = tslib_1.__importDefault(require("./provider/hoverManager"));
const implementatioinManager_1 = tslib_1.__importDefault(require("./provider/implementatioinManager"));
const onTypeFormatManager_1 = tslib_1.__importDefault(require("./provider/onTypeFormatManager"));
const referenceManager_1 = tslib_1.__importDefault(require("./provider/referenceManager"));
const renameManager_1 = tslib_1.__importDefault(require("./provider/renameManager"));
const signatureManager_1 = tslib_1.__importDefault(require("./provider/signatureManager"));
const typeDefinitionManager_1 = tslib_1.__importDefault(require("./provider/typeDefinitionManager"));
const workspaceSymbolsManager_1 = tslib_1.__importDefault(require("./provider/workspaceSymbolsManager"));
const manager_2 = tslib_1.__importDefault(require("./snippets/manager"));
const sources_1 = tslib_1.__importDefault(require("./sources"));
const types_1 = require("./types");
const util_1 = require("./util");
const complete = tslib_1.__importStar(require("./util/complete"));
const position_1 = require("./util/position");
const string_1 = require("./util/string");
const workspace_1 = tslib_1.__importDefault(require("./workspace"));
const logger = require('./util/logger')('languages');
function fixDocumentation(str) {
    return str.replace(/&nbsp;/g, ' ');
}
function check(_target, key, descriptor) {
    let fn = descriptor.value;
    if (typeof fn !== 'function') {
        return;
    }
    descriptor.value = function (...args) {
        let { cancelTokenSource } = this;
        this.cancelTokenSource = new vscode_languageserver_protocol_1.CancellationTokenSource();
        return new Promise((resolve, reject) => {
            let resolved = false;
            let timer = setTimeout(() => {
                cancelTokenSource.cancel();
                logger.error(`${key} timeout after 5s`);
                if (!resolved)
                    reject(new Error(`${key} timeout after 5s`));
            }, 5000);
            Promise.resolve(fn.apply(this, args)).then(res => {
                clearTimeout(timer);
                resolve(res);
            }, e => {
                clearTimeout(timer);
                reject(e);
            });
        });
    };
}
exports.check = check;
class Languages {
    constructor() {
        this.onTypeFormatManager = new onTypeFormatManager_1.default();
        this.documentLinkManager = new documentLinkManager_1.default();
        this.documentColorManager = new documentColorManager_1.default();
        this.foldingRangeManager = new foldingRangeManager_1.default();
        this.renameManager = new renameManager_1.default();
        this.formatManager = new formatManager_1.default();
        this.codeActionManager = new codeActionmanager_1.default();
        this.workspaceSymbolsManager = new workspaceSymbolsManager_1.default();
        this.formatRangeManager = new formatRangeManager_1.default();
        this.hoverManager = new hoverManager_1.default();
        this.signatureManager = new signatureManager_1.default();
        this.documentSymbolManager = new documentSymbolManager_1.default();
        this.documentHighlightManager = new documentHighlightManager_1.default();
        this.definitionManager = new definitionManager_1.default();
        this.declarationManager = new declarationManager_1.default();
        this.typeDefinitionManager = new typeDefinitionManager_1.default();
        this.referenceManager = new referenceManager_1.default();
        this.implementatioinManager = new implementatioinManager_1.default();
        this.codeLensManager = new codeLensManager_1.default();
        this.selectionRangeManager = new rangeManager_1.default();
        this.cancelTokenSource = new vscode_languageserver_protocol_1.CancellationTokenSource();
        workspace_1.default.onWillSaveUntil(event => {
            let config = workspace_1.default.getConfiguration('coc.preferences');
            let filetypes = config.get('formatOnSaveFiletypes', []);
            let { languageId } = event.document;
            if (filetypes.indexOf(languageId) !== -1) {
                let willSaveWaitUntil = async () => {
                    let options = await workspace_1.default.getFormatOptions(event.document.uri);
                    let textEdits = await this.provideDocumentFormattingEdits(event.document, options);
                    return textEdits;
                };
                event.waitUntil(willSaveWaitUntil());
            }
        }, null, 'languageserver');
        workspace_1.default.ready.then(() => {
            this.loadCompleteConfig();
        }, _e => {
            // noop
        });
        workspace_1.default.onDidChangeConfiguration(this.loadCompleteConfig, this);
    }
    get nvim() {
        return workspace_1.default.nvim;
    }
    loadCompleteConfig() {
        let config = workspace_1.default.getConfiguration('coc.preferences');
        let suggest = workspace_1.default.getConfiguration('suggest');
        function getConfig(key, defaultValue) {
            return config.get(key, suggest.get(key, defaultValue));
        }
        let labels = suggest.get('completionItemKindLabels', {});
        this.completionItemKindMap = new Map([
            [vscode_languageserver_protocol_1.CompletionItemKind.Text, labels['text'] || 'v'],
            [vscode_languageserver_protocol_1.CompletionItemKind.Method, labels['method'] || 'f'],
            [vscode_languageserver_protocol_1.CompletionItemKind.Function, labels['function'] || 'f'],
            [vscode_languageserver_protocol_1.CompletionItemKind.Constructor, typeof labels['constructor'] == 'function' ? 'f' : labels['con' + 'structor']],
            [vscode_languageserver_protocol_1.CompletionItemKind.Field, labels['field'] || 'm'],
            [vscode_languageserver_protocol_1.CompletionItemKind.Variable, labels['variable'] || 'v'],
            [vscode_languageserver_protocol_1.CompletionItemKind.Class, labels['class'] || 'C'],
            [vscode_languageserver_protocol_1.CompletionItemKind.Interface, labels['interface'] || 'I'],
            [vscode_languageserver_protocol_1.CompletionItemKind.Module, labels['module'] || 'M'],
            [vscode_languageserver_protocol_1.CompletionItemKind.Property, labels['property'] || 'm'],
            [vscode_languageserver_protocol_1.CompletionItemKind.Unit, labels['unit'] || 'U'],
            [vscode_languageserver_protocol_1.CompletionItemKind.Value, labels['value'] || 'v'],
            [vscode_languageserver_protocol_1.CompletionItemKind.Enum, labels['enum'] || 'E'],
            [vscode_languageserver_protocol_1.CompletionItemKind.Keyword, labels['keyword'] || 'k'],
            [vscode_languageserver_protocol_1.CompletionItemKind.Snippet, labels['snippet'] || 'S'],
            [vscode_languageserver_protocol_1.CompletionItemKind.Color, labels['color'] || 'v'],
            [vscode_languageserver_protocol_1.CompletionItemKind.File, labels['file'] || 'F'],
            [vscode_languageserver_protocol_1.CompletionItemKind.Reference, labels['reference'] || 'r'],
            [vscode_languageserver_protocol_1.CompletionItemKind.Folder, labels['folder'] || 'F'],
            [vscode_languageserver_protocol_1.CompletionItemKind.EnumMember, labels['enumMember'] || 'm'],
            [vscode_languageserver_protocol_1.CompletionItemKind.Constant, labels['constant'] || 'v'],
            [vscode_languageserver_protocol_1.CompletionItemKind.Struct, labels['struct'] || 'S'],
            [vscode_languageserver_protocol_1.CompletionItemKind.Event, labels['event'] || 'E'],
            [vscode_languageserver_protocol_1.CompletionItemKind.Operator, labels['operator'] || 'O'],
            [vscode_languageserver_protocol_1.CompletionItemKind.TypeParameter, labels['typeParameter'] || 'T'],
        ]);
        this.completeConfig = {
            defaultKindText: labels['default'] || '',
            priority: getConfig('languageSourcePriority', 99),
            echodocSupport: getConfig('echodocSupport', false),
            waitTime: getConfig('triggerCompletionWait', 60),
            detailField: getConfig('detailField', 'abbr'),
            detailMaxLength: getConfig('detailMaxLength', 50)
        };
    }
    registerOnTypeFormattingEditProvider(selector, provider, triggerCharacters) {
        return this.onTypeFormatManager.register(selector, provider, triggerCharacters);
    }
    registerCompletionItemProvider(name, shortcut, languageIds, provider, triggerCharacters = [], priority) {
        languageIds = typeof languageIds == 'string' ? [languageIds] : languageIds;
        let source = this.createCompleteSource(name, shortcut, provider, languageIds, triggerCharacters, priority);
        sources_1.default.addSource(source);
        logger.debug('created service source', name);
        return {
            dispose: () => {
                sources_1.default.removeSource(source);
            }
        };
    }
    registerCodeActionProvider(selector, provider, clientId, codeActionKinds) {
        return this.codeActionManager.register(selector, provider, clientId, codeActionKinds);
    }
    registerHoverProvider(selector, provider) {
        return this.hoverManager.register(selector, provider);
    }
    registerSelectionRangeProvider(selector, provider) {
        return this.selectionRangeManager.register(selector, provider);
    }
    registerSignatureHelpProvider(selector, provider, triggerCharacters) {
        return this.signatureManager.register(selector, provider, triggerCharacters);
    }
    registerDocumentSymbolProvider(selector, provider) {
        return this.documentSymbolManager.register(selector, provider);
    }
    registerFoldingRangeProvider(selector, provider) {
        return this.foldingRangeManager.register(selector, provider);
    }
    registerDocumentHighlightProvider(selector, provider) {
        return this.documentHighlightManager.register(selector, provider);
    }
    registerCodeLensProvider(selector, provider) {
        return this.codeLensManager.register(selector, provider);
    }
    registerDocumentLinkProvider(selector, provider) {
        return this.documentLinkManager.register(selector, provider);
    }
    registerDocumentColorProvider(selector, provider) {
        return this.documentColorManager.register(selector, provider);
    }
    registerDefinitionProvider(selector, provider) {
        return this.definitionManager.register(selector, provider);
    }
    registerDeclarationProvider(selector, provider) {
        return this.declarationManager.register(selector, provider);
    }
    registerTypeDefinitionProvider(selector, provider) {
        return this.typeDefinitionManager.register(selector, provider);
    }
    registerImplementationProvider(selector, provider) {
        return this.implementatioinManager.register(selector, provider);
    }
    registerReferencesProvider(selector, provider) {
        return this.referenceManager.register(selector, provider);
    }
    registerRenameProvider(selector, provider) {
        return this.renameManager.register(selector, provider);
    }
    registerWorkspaceSymbolProvider(selector, provider) {
        return this.workspaceSymbolsManager.register(selector, provider);
    }
    registerDocumentFormatProvider(selector, provider, priority = 0) {
        return this.formatManager.register(selector, provider, priority);
    }
    registerDocumentRangeFormatProvider(selector, provider, priority = 0) {
        return this.formatRangeManager.register(selector, provider, priority);
    }
    shouldTriggerSignatureHelp(document, triggerCharacter) {
        return this.signatureManager.shouldTrigger(document, triggerCharacter);
    }
    async getHover(document, position) {
        return await this.hoverManager.provideHover(document, position, this.token);
    }
    async getSignatureHelp(document, position, token) {
        return await this.signatureManager.provideSignatureHelp(document, position, token);
    }
    async getDefinition(document, position) {
        if (!this.definitionManager.hasProvider(document))
            return null;
        return await this.definitionManager.provideDefinition(document, position, this.token);
    }
    async getDeclaration(document, position) {
        if (!this.declarationManager.hasProvider(document))
            return null;
        return await this.declarationManager.provideDeclaration(document, position, this.token);
    }
    async getTypeDefinition(document, position) {
        if (!this.typeDefinitionManager.hasProvider(document))
            return null;
        return await this.typeDefinitionManager.provideTypeDefinition(document, position, this.token);
    }
    async getImplementation(document, position) {
        if (!this.implementatioinManager.hasProvider(document))
            return null;
        return await this.implementatioinManager.provideReferences(document, position, this.token);
    }
    async getReferences(document, context, position) {
        if (!this.referenceManager.hasProvider(document))
            return null;
        return await this.referenceManager.provideReferences(document, position, context, this.token);
    }
    async getDocumentSymbol(document) {
        return await this.documentSymbolManager.provideDocumentSymbols(document, this.token);
    }
    async getSelectionRanges(document, positions) {
        return await this.selectionRangeManager.provideSelectionRanges(document, positions, this.token);
    }
    async getWorkspaceSymbols(document, query) {
        query = query || '';
        return await this.workspaceSymbolsManager.provideWorkspaceSymbols(document, query, this.token);
    }
    async resolveWorkspaceSymbol(symbol) {
        return await this.workspaceSymbolsManager.resolveWorkspaceSymbol(symbol, this.token);
    }
    async provideRenameEdits(document, position, newName) {
        if (!this.renameManager.hasProvider(document)) {
            let doc = workspace_1.default.getDocument(document.uri);
            if (!doc)
                return null;
            let range = doc.getWordRangeAtPosition(position);
            if (!range)
                return null;
            let word = doc.textDocument.getText(range);
            let ranges = doc.getSymbolRanges(word);
            if (!ranges.length)
                return null;
            return {
                changes: {
                    [doc.uri]: ranges.map(r => {
                        return {
                            range: r,
                            newText: newName
                        };
                    })
                }
            };
        }
        return await this.renameManager.provideRenameEdits(document, position, newName, this.token);
    }
    async prepareRename(document, position) {
        return await this.renameManager.prepareRename(document, position, this.token);
    }
    async provideDocumentFormattingEdits(document, options) {
        if (!this.formatManager.hasProvider(document)) {
            let hasRangeFormater = this.formatRangeManager.hasProvider(document);
            if (!hasRangeFormater) {
                logger.error('Format provider not found for current document', 'error');
                return null;
            }
            let end = document.positionAt(document.getText().length);
            let range = vscode_languageserver_protocol_1.Range.create(vscode_languageserver_protocol_1.Position.create(0, 0), end);
            return await this.provideDocumentRangeFormattingEdits(document, range, options);
        }
        return await this.formatManager.provideDocumentFormattingEdits(document, options, this.token);
    }
    async provideDocumentRangeFormattingEdits(document, range, options) {
        if (!this.formatRangeManager.hasProvider(document))
            return null;
        return await this.formatRangeManager.provideDocumentRangeFormattingEdits(document, range, options, this.token);
    }
    /**
     * Get CodeAction list for current document
     *
     * @public
     * @param {TextDocument} document
     * @param {Range} range
     * @param {CodeActionContext} context
     * @returns {Promise<CodeAction[]>}
     */
    async getCodeActions(document, range, context, silent = false) {
        if (!silent && !this.codeActionManager.hasProvider(document)) {
            return null;
        }
        return await this.codeActionManager.provideCodeActions(document, range, context, this.token);
    }
    async getDocumentHighLight(document, position) {
        return await this.documentHighlightManager.provideDocumentHighlights(document, position, this.token);
    }
    async getDocumentLinks(document) {
        if (!this.documentLinkManager.hasProvider(document)) {
            return null;
        }
        return (await this.documentLinkManager.provideDocumentLinks(document, this.token)) || [];
    }
    async resolveDocumentLink(link) {
        return await this.documentLinkManager.resolveDocumentLink(link, this.token);
    }
    async provideDocumentColors(document) {
        return await this.documentColorManager.provideDocumentColors(document, this.token);
    }
    async provideFoldingRanges(document, context) {
        if (!this.formatRangeManager.hasProvider(document)) {
            return null;
        }
        return await this.foldingRangeManager.provideFoldingRanges(document, context, this.token);
    }
    async provideColorPresentations(color, document) {
        return await this.documentColorManager.provideColorPresentations(color, document, this.token);
    }
    async getCodeLens(document) {
        return await this.codeLensManager.provideCodeLenses(document, this.token);
    }
    async resolveCodeLens(codeLens) {
        return await this.codeLensManager.resolveCodeLens(codeLens, this.token);
    }
    async provideDocumentOntTypeEdits(character, document, position) {
        return this.onTypeFormatManager.onCharacterType(character, document, position, this.token);
    }
    hasOnTypeProvider(character, document) {
        return this.onTypeFormatManager.getProvider(document, character) != null;
    }
    dispose() {
        // noop
    }
    createDiagnosticCollection(owner) {
        return manager_1.default.create(owner);
    }
    createCompleteSource(name, shortcut, provider, languageIds, triggerCharacters, priority) {
        // track them for resolve
        let completeItems = [];
        // line used for TextEdit
        let hasResolve = typeof provider.resolveCompletionItem === 'function';
        priority = priority == null ? this.completeConfig.priority : priority;
        // index set of resolved items
        let resolvedIndexes = new Set();
        let doc = null;
        let waitTime = Math.min(Math.max(50, this.completeConfig.waitTime), 300);
        let source = {
            name,
            priority,
            shortcut,
            enable: true,
            sourceType: types_1.SourceType.Service,
            filetypes: languageIds,
            triggerCharacters: triggerCharacters || [],
            doComplete: async (opt, token) => {
                let { triggerCharacter, bufnr } = opt;
                doc = workspace_1.default.getDocument(bufnr);
                if (!doc)
                    return null;
                resolvedIndexes = new Set();
                let isTrigger = triggerCharacters && triggerCharacters.indexOf(triggerCharacter) != -1;
                let triggerKind = vscode_languageserver_protocol_1.CompletionTriggerKind.Invoked;
                if (opt.triggerForInComplete) {
                    triggerKind = vscode_languageserver_protocol_1.CompletionTriggerKind.TriggerForIncompleteCompletions;
                }
                else if (isTrigger) {
                    triggerKind = vscode_languageserver_protocol_1.CompletionTriggerKind.TriggerCharacter;
                }
                if (opt.triggerCharacter)
                    await util_1.wait(waitTime);
                if (token.isCancellationRequested)
                    return null;
                let position = complete.getPosition(opt);
                let context = { triggerKind, option: opt };
                if (isTrigger)
                    context.triggerCharacter = triggerCharacter;
                let result;
                try {
                    result = await Promise.resolve(provider.provideCompletionItems(doc.textDocument, position, token, context));
                }
                catch (e) {
                    // don't disturb user
                    logger.error(`Source "${name}" complete error:`, e);
                    return null;
                }
                if (!result || token.isCancellationRequested)
                    return null;
                completeItems = Array.isArray(result) ? result : result.items;
                if (!completeItems || completeItems.length == 0)
                    return null;
                // used for fixed col
                let option = Object.assign({}, opt);
                if (typeof result.startcol == 'number') {
                    option.col = result.startcol;
                }
                let items = completeItems.map((o, index) => {
                    let item = this.convertVimCompleteItem(o, shortcut, option);
                    item.index = index;
                    return item;
                });
                return {
                    startcol: result.startcol,
                    isIncomplete: !!result.isIncomplete,
                    items
                };
            },
            onCompleteResolve: async (item, token) => {
                let resolving = completeItems[item.index];
                if (!resolving)
                    return;
                if (hasResolve && !resolvedIndexes.has(item.index)) {
                    let resolved = await Promise.resolve(provider.resolveCompletionItem(resolving, token));
                    if (token.isCancellationRequested)
                        return;
                    resolvedIndexes.add(item.index);
                    if (resolved)
                        Object.assign(resolving, resolved);
                }
                if (item.documentation == null) {
                    let { documentation, detail } = resolving;
                    if (!documentation && !detail)
                        return;
                    let docs = [];
                    if (detail && !item.detailShown && detail != item.word) {
                        detail = detail.replace(/\n\s*/g, ' ');
                        if (detail.length) {
                            let isText = /^[\w-\s.,\t]+$/.test(detail);
                            docs.push({ filetype: isText ? 'txt' : doc.filetype, content: detail });
                        }
                    }
                    if (documentation) {
                        if (typeof documentation == 'string') {
                            docs.push({
                                filetype: 'markdown',
                                content: fixDocumentation(documentation)
                            });
                        }
                        else if (documentation.value) {
                            docs.push({
                                filetype: documentation.kind == 'markdown' ? 'markdown' : 'txt',
                                content: fixDocumentation(documentation.value)
                            });
                        }
                    }
                    item.documentation = docs;
                }
            },
            onCompleteDone: async (vimItem, opt) => {
                let item = completeItems[vimItem.index];
                if (!item)
                    return;
                let line = opt.linenr - 1;
                // tslint:disable-next-line: deprecation
                if (item.insertText && !item.textEdit) {
                    item.textEdit = {
                        range: vscode_languageserver_protocol_1.Range.create(line, opt.col, line, opt.colnr - 1),
                        // tslint:disable-next-line: deprecation
                        newText: item.insertText
                    };
                }
                if (vimItem.line)
                    Object.assign(opt, { line: vimItem.line });
                let snippet = await this.applyTextEdit(item, opt);
                let { additionalTextEdits } = item;
                if (additionalTextEdits && item.textEdit) {
                    let r = item.textEdit.range;
                    additionalTextEdits = additionalTextEdits.filter(edit => {
                        if (position_1.rangeOverlap(r, edit.range)) {
                            logger.info('Filtered overlap additionalTextEdit:', edit);
                            return false;
                        }
                        return true;
                    });
                }
                await this.applyAdditionalEdits(additionalTextEdits, opt.bufnr, snippet);
                if (snippet && !manager_2.default.isPlainText(item.textEdit.newText)) {
                    await manager_2.default.selectCurrentPlaceholder();
                }
                if (item.command)
                    commands_1.default.execute(item.command);
                doc = null;
            },
            shouldCommit: (item, character) => {
                let completeItem = completeItems[item.index];
                if (!completeItem)
                    return false;
                let { commitCharacters } = completeItem;
                if (commitCharacters && commitCharacters.indexOf(character) !== -1) {
                    return true;
                }
                return false;
            }
        };
        return source;
    }
    get token() {
        this.cancelTokenSource = new vscode_languageserver_protocol_1.CancellationTokenSource();
        return this.cancelTokenSource.token;
    }
    async applyTextEdit(item, option) {
        let { nvim } = this;
        let { textEdit } = item;
        if (!textEdit)
            return false;
        let { line, bufnr, linenr } = option;
        let { range, newText } = textEdit;
        let isSnippet = item.insertTextFormat === vscode_languageserver_protocol_1.InsertTextFormat.Snippet;
        // replace inserted word
        let start = line.substr(0, range.start.character);
        let end = line.substr(range.end.character);
        if (isSnippet) {
            let doc = workspace_1.default.getDocument(bufnr);
            await doc.applyEdits(nvim, [{
                    range: vscode_languageserver_protocol_1.Range.create(linenr - 1, 0, linenr, 0),
                    newText: `${start}${end}\n`
                }]);
            // can't select, since additionalTextEdits would break selection
            let pos = vscode_languageserver_protocol_1.Position.create(linenr - 1, range.start.character);
            return await manager_2.default.insertSnippet(newText, false, vscode_languageserver_protocol_1.Range.create(pos, pos));
        }
        let newLines = `${start}${newText}${end}`.split('\n');
        if (newLines.length == 1) {
            await nvim.call('coc#util#setline', [linenr, newLines[0]]);
            await workspace_1.default.moveTo(vscode_languageserver_protocol_1.Position.create(linenr - 1, (start + newText).length));
        }
        else {
            let document = workspace_1.default.getDocument(bufnr);
            if (document) {
                await document.buffer.setLines(newLines, {
                    start: linenr - 1,
                    end: linenr,
                    strictIndexing: false
                });
            }
            let line = linenr - 1 + newLines.length - 1;
            let character = newLines[newLines.length - 1].length - end.length;
            await workspace_1.default.moveTo({ line, character });
        }
        return false;
    }
    async applyAdditionalEdits(textEdits, bufnr, snippet) {
        if (!textEdits || textEdits.length == 0)
            return;
        let document = workspace_1.default.getDocument(bufnr);
        if (!document)
            return;
        await util_1.wait(workspace_1.default.isVim ? 100 : 10);
        // how to move cursor after edit
        let changed = null;
        let pos = await workspace_1.default.getCursorPosition();
        if (!snippet)
            changed = position_1.getChangedFromEdits(pos, textEdits);
        await document.applyEdits(this.nvim, textEdits);
        if (changed) {
            await workspace_1.default.moveTo(vscode_languageserver_protocol_1.Position.create(pos.line + changed.line, pos.character + changed.character));
        }
    }
    convertVimCompleteItem(item, shortcut, opt) {
        let { echodocSupport, detailField, detailMaxLength } = this.completeConfig;
        let hasAdditionalEdit = item.additionalTextEdits && item.additionalTextEdits.length > 0;
        let isSnippet = item.insertTextFormat === vscode_languageserver_protocol_1.InsertTextFormat.Snippet || hasAdditionalEdit;
        let label = item.label.trim();
        // tslint:disable-next-line:deprecation
        if (isSnippet && item.insertText && item.insertText.indexOf('$') == -1 && !hasAdditionalEdit) {
            // fix wrong insert format
            isSnippet = false;
            item.insertTextFormat = vscode_languageserver_protocol_1.InsertTextFormat.PlainText;
        }
        let obj = {
            word: complete.getWord(item, opt),
            abbr: label,
            menu: `[${shortcut}]`,
            kind: complete.completionKindString(item.kind, this.completionItemKindMap, this.completeConfig.defaultKindText),
            sortText: item.sortText || null,
            filterText: item.filterText || label,
            isSnippet,
            dup: 1
        };
        if (item && item.detail && detailField != 'preview') {
            let detail = item.detail.replace(/\n\s*/g, ' ');
            if (string_1.byteLength(detail) < detailMaxLength) {
                if (detailField == 'menu') {
                    obj.menu = `${detail} ${obj.menu}`;
                }
                else if (detailField == 'abbr') {
                    obj.abbr = `${obj.abbr} - ${detail}`;
                }
                obj.detailShown = 1;
            }
        }
        if (item.documentation) {
            obj.info = typeof item.documentation == 'string' ? item.documentation : item.documentation.value;
        }
        if (!obj.word)
            obj.empty = 1;
        if (item.textEdit)
            obj.line = opt.line;
        if (item.kind == vscode_languageserver_protocol_1.CompletionItemKind.Folder && !obj.abbr.endsWith('/')) {
            obj.abbr = obj.abbr + '/';
        }
        if (echodocSupport && item.kind >= 2 && item.kind <= 4) {
            let fields = [item.detail || '', obj.abbr, obj.word];
            for (let s of fields) {
                if (s.indexOf('(') !== -1) {
                    obj.signature = s;
                    break;
                }
            }
        }
        if (item.preselect)
            obj.preselect = true;
        item.data = item.data || {};
        if (item.data.optional)
            obj.abbr = obj.abbr + '?';
        return obj;
    }
}
tslib_1.__decorate([
    check
], Languages.prototype, "getHover", null);
tslib_1.__decorate([
    check
], Languages.prototype, "getDefinition", null);
tslib_1.__decorate([
    check
], Languages.prototype, "getDeclaration", null);
tslib_1.__decorate([
    check
], Languages.prototype, "getTypeDefinition", null);
tslib_1.__decorate([
    check
], Languages.prototype, "getImplementation", null);
tslib_1.__decorate([
    check
], Languages.prototype, "getReferences", null);
tslib_1.__decorate([
    check
], Languages.prototype, "getDocumentSymbol", null);
tslib_1.__decorate([
    check
], Languages.prototype, "getSelectionRanges", null);
tslib_1.__decorate([
    check
], Languages.prototype, "getWorkspaceSymbols", null);
tslib_1.__decorate([
    check
], Languages.prototype, "resolveWorkspaceSymbol", null);
tslib_1.__decorate([
    check
], Languages.prototype, "provideRenameEdits", null);
tslib_1.__decorate([
    check
], Languages.prototype, "prepareRename", null);
tslib_1.__decorate([
    check
], Languages.prototype, "provideDocumentFormattingEdits", null);
tslib_1.__decorate([
    check
], Languages.prototype, "provideDocumentRangeFormattingEdits", null);
tslib_1.__decorate([
    check
], Languages.prototype, "getCodeActions", null);
tslib_1.__decorate([
    check
], Languages.prototype, "getDocumentHighLight", null);
tslib_1.__decorate([
    check
], Languages.prototype, "getDocumentLinks", null);
tslib_1.__decorate([
    check
], Languages.prototype, "resolveDocumentLink", null);
tslib_1.__decorate([
    check
], Languages.prototype, "provideDocumentColors", null);
tslib_1.__decorate([
    check
], Languages.prototype, "provideFoldingRanges", null);
tslib_1.__decorate([
    check
], Languages.prototype, "provideColorPresentations", null);
tslib_1.__decorate([
    check
], Languages.prototype, "getCodeLens", null);
tslib_1.__decorate([
    check
], Languages.prototype, "resolveCodeLens", null);
tslib_1.__decorate([
    check
], Languages.prototype, "provideDocumentOntTypeEdits", null);
exports.default = new Languages();
//# sourceMappingURL=languages.js.map