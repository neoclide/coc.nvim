"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const debounce_1 = tslib_1.__importDefault(require("debounce"));
const vscode_languageserver_protocol_1 = require("vscode-languageserver-protocol");
const events_1 = tslib_1.__importDefault(require("../events"));
const sources_1 = tslib_1.__importDefault(require("../sources"));
const util_1 = require("../util");
const string_1 = require("../util/string");
const workspace_1 = tslib_1.__importDefault(require("../workspace"));
const complete_1 = tslib_1.__importDefault(require("./complete"));
const floating_1 = tslib_1.__importDefault(require("./floating"));
const logger = require('../util/logger')('completion');
const completeItemKeys = ['abbr', 'menu', 'info', 'kind', 'icase', 'dup', 'empty', 'user_data'];
class Completion {
    constructor() {
        // current input string
        this.activted = false;
        this.disposables = [];
        this.complete = null;
        this.recentScores = {};
        this.changedTick = 0;
        this.insertCharTs = 0;
        this.insertLeaveTs = 0;
        // only used when no pum change event
        this.isResolving = false;
    }
    init(nvim) {
        this.nvim = nvim;
        this.config = this.getCompleteConfig();
        this.floating = new floating_1.default(nvim);
        events_1.default.on('InsertCharPre', this.onInsertCharPre, this, this.disposables);
        events_1.default.on('InsertLeave', this.onInsertLeave, this, this.disposables);
        events_1.default.on('InsertEnter', this.onInsertEnter, this, this.disposables);
        events_1.default.on('TextChangedP', this.onTextChangedP, this, this.disposables);
        events_1.default.on('TextChangedI', this.onTextChangedI, this, this.disposables);
        events_1.default.on('CompleteDone', this.onCompleteDone, this, this.disposables);
        events_1.default.on('MenuPopupChanged', this.onPumChange, this, this.disposables);
        events_1.default.on('CursorMovedI', debounce_1.default(async (bufnr, cursor) => {
            // try trigger completion
            let doc = workspace_1.default.getDocument(bufnr);
            if (this.isActivted || !doc || cursor[1] == 1)
                return;
            let line = doc.getline(cursor[0] - 1);
            if (!line)
                return;
            let { latestInsertChar } = this;
            let pre = string_1.byteSlice(line, 0, cursor[1] - 1);
            if (!latestInsertChar || !pre.endsWith(latestInsertChar))
                return;
            if (sources_1.default.shouldTrigger(pre, doc.filetype)) {
                await this.triggerCompletion(doc, pre, false);
            }
        }, 20));
        workspace_1.default.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('suggest')) {
                Object.assign(this.config, this.getCompleteConfig());
            }
        }, null, this.disposables);
    }
    get option() {
        if (!this.complete)
            return null;
        return this.complete.option;
    }
    addRecent(word, bufnr) {
        if (!word)
            return;
        this.recentScores[`${bufnr}|${word}`] = Date.now();
    }
    async getPreviousContent(document) {
        let [, lnum, col] = await this.nvim.call('getcurpos');
        if (this.option && lnum != this.option.linenr)
            return null;
        let line = document.getline(lnum - 1);
        return col == 1 ? '' : string_1.byteSlice(line, 0, col - 1);
    }
    getResumeInput(pre) {
        let { option, activted } = this;
        if (!activted)
            return null;
        if (!pre)
            return '';
        let input = string_1.byteSlice(pre, option.col);
        if (option.blacklist && option.blacklist.indexOf(input) !== -1)
            return null;
        return input;
    }
    get bufnr() {
        let { option } = this;
        return option ? option.bufnr : null;
    }
    get isActivted() {
        return this.activted;
    }
    getCompleteConfig() {
        let config = workspace_1.default.getConfiguration('coc.preferences');
        let suggest = workspace_1.default.getConfiguration('suggest');
        function getConfig(key, defaultValue) {
            return config.get(key, suggest.get(key, defaultValue));
        }
        let keepCompleteopt = getConfig('keepCompleteopt', false);
        let autoTrigger = getConfig('autoTrigger', 'always');
        if (keepCompleteopt) {
            let { completeOpt } = workspace_1.default;
            if (!completeOpt.includes('noinsert') && !completeOpt.includes('noselect')) {
                autoTrigger = 'none';
            }
        }
        let acceptSuggestionOnCommitCharacter = workspace_1.default.env.pumevent && getConfig('acceptSuggestionOnCommitCharacter', false);
        return {
            autoTrigger,
            keepCompleteopt,
            disableMenuShortcut: getConfig('disableMenuShortcut', false),
            acceptSuggestionOnCommitCharacter,
            disableKind: getConfig('disableKind', false),
            disableMenu: getConfig('disableMenu', false),
            previewIsKeyword: getConfig('previewIsKeyword', '@,48-57,_192-255'),
            enablePreview: getConfig('enablePreview', false),
            maxPreviewWidth: getConfig('maxPreviewWidth', 50),
            labelMaxLength: getConfig('labelMaxLength', 100),
            triggerAfterInsertEnter: getConfig('triggerAfterInsertEnter', false),
            noselect: getConfig('noselect', true),
            numberSelect: getConfig('numberSelect', false),
            maxItemCount: getConfig('maxCompleteItemCount', 50),
            timeout: getConfig('timeout', 500),
            minTriggerInputLength: getConfig('minTriggerInputLength', 1),
            snippetIndicator: getConfig('snippetIndicator', '~'),
            fixInsertedWord: getConfig('fixInsertedWord', true),
            localityBonus: getConfig('localityBonus', true),
            highPrioritySourceLimit: getConfig('highPrioritySourceLimit', null),
            lowPrioritySourceLimit: getConfig('lowPrioritySourceLimit', null),
        };
    }
    async startCompletion(option) {
        workspace_1.default.bufnr = option.bufnr;
        let document = workspace_1.default.getDocument(option.bufnr);
        if (!document)
            return;
        // use fixed filetype
        option.filetype = document.filetype;
        this.document = document;
        try {
            await this._doComplete(option);
        }
        catch (e) {
            this.stop();
            workspace_1.default.showMessage(`Error happens on complete: ${e.message}`, 'error');
            logger.error(e.stack);
        }
    }
    async resumeCompletion(pre, search, force = false) {
        let { document, complete, activted } = this;
        if (!activted || !complete.results)
            return;
        if (search == this.input && !force)
            return;
        let last = search == null ? '' : search.slice(-1);
        if (last.length == 0 ||
            /\s/.test(last) ||
            sources_1.default.shouldTrigger(pre, document.filetype) ||
            search.length < complete.input.length) {
            this.stop();
            return;
        }
        let { changedtick } = document;
        this.input = search;
        let items;
        if (complete.isIncomplete && document.chars.isKeywordChar(last)) {
            await document.patchChange();
            document.forceSync();
            await util_1.wait(30);
            if (document.changedtick != changedtick)
                return;
            items = await complete.completeInComplete(search);
            if (document.changedtick != changedtick)
                return;
        }
        else {
            items = complete.filterResults(search);
        }
        if (!this.isActivted)
            return;
        if (!complete.isCompleting && (!items || items.length === 0)) {
            this.stop();
            return;
        }
        await this.showCompletion(this.option.col, items);
    }
    hasSelected() {
        if (workspace_1.default.env.pumevent)
            return this.currItem != null;
        if (this.config.noselect === false)
            return true;
        return this.isResolving;
    }
    async showCompletion(col, items) {
        let { nvim, document } = this;
        let { numberSelect, disableKind, labelMaxLength, disableMenuShortcut, disableMenu } = this.config;
        if (numberSelect) {
            items = items.map((item, i) => {
                let idx = i + 1;
                if (i < 9) {
                    return Object.assign({}, item, {
                        abbr: item.abbr ? `${idx} ${item.abbr}` : `${idx} ${item.word}`
                    });
                }
                return item;
            });
        }
        this.changedTick = document.changedtick;
        if (this.config.numberSelect) {
            nvim.call('coc#_map', [], true);
        }
        let validKeys = completeItemKeys.slice();
        if (disableKind)
            validKeys = validKeys.filter(s => s != 'kind');
        if (disableMenu)
            validKeys = validKeys.filter(s => s != 'menu');
        let vimItems = items.map(item => {
            let obj = { word: item.word, equal: 1 };
            for (let key of validKeys) {
                if (item.hasOwnProperty(key)) {
                    if (disableMenuShortcut && key == 'menu') {
                        obj[key] = item[key].replace(/\[\w+\]$/, '');
                    }
                    else if (key == 'abbr' && item[key].length > labelMaxLength) {
                        obj[key] = item[key].slice(0, labelMaxLength);
                    }
                    else {
                        obj[key] = item[key];
                    }
                }
            }
            return obj;
        });
        nvim.call('coc#_do_complete', [col, vimItems], true);
    }
    async _doComplete(option) {
        let { source } = option;
        let { nvim, config, document } = this;
        // current input
        this.input = option.input;
        let arr = [];
        if (source == null) {
            arr = sources_1.default.getCompleteSources(option);
        }
        else {
            let s = sources_1.default.getSource(source);
            if (s)
                arr.push(s);
        }
        if (!arr.length)
            return;
        let complete = new complete_1.default(option, document, this.recentScores, config, arr, nvim);
        this.start(complete);
        let items = await this.complete.doComplete();
        if (complete.isCanceled)
            return;
        if (items.length == 0 && !complete.isCompleting) {
            this.stop();
            return;
        }
        complete.onDidComplete(async () => {
            let content = await this.getPreviousContent(document);
            let search = this.getResumeInput(content);
            if (complete.isCanceled)
                return;
            let hasSelected = this.hasSelected();
            if (hasSelected && this.completeOpt.indexOf('noselect') !== -1)
                return;
            if (search == this.option.input) {
                let items = complete.filterResults(search, Math.floor(Date.now() / 1000));
                await this.showCompletion(option.col, items);
                return;
            }
            await this.resumeCompletion(content, search, true);
        });
        if (items.length) {
            let content = await this.getPreviousContent(document);
            let search = this.getResumeInput(content);
            if (complete.isCanceled)
                return;
            if (search == this.option.input) {
                await this.showCompletion(option.col, items);
                return;
            }
            await this.resumeCompletion(content, search, true);
        }
    }
    async onTextChangedP() {
        let { option, document } = this;
        if (!option)
            return;
        await document.patchChange();
        let hasInsert = this.latestInsert != null;
        this.lastInsert = null;
        // avoid trigger filter on pumvisible
        if (document.changedtick == this.changedTick)
            return;
        let line = document.getline(option.linenr - 1);
        let curr = line.match(/^\s*/)[0];
        let ind = option.line.match(/^\s*/)[0];
        // indent change
        if (ind.length != curr.length) {
            this.stop();
            return;
        }
        if (!hasInsert) {
            // this could be wrong, but can't avoid.
            this.isResolving = true;
            return;
        }
        let col = await this.nvim.call('col', '.');
        let search = string_1.byteSlice(line, option.col, col - 1);
        let pre = string_1.byteSlice(line, 0, col - 1);
        if (sources_1.default.shouldTrigger(pre, document.filetype)) {
            await this.triggerCompletion(document, pre, false);
        }
        else {
            await this.resumeCompletion(pre, search);
        }
    }
    async onTextChangedI(bufnr) {
        let { nvim, latestInsertChar } = this;
        this.lastInsert = null;
        let document = workspace_1.default.getDocument(workspace_1.default.bufnr);
        if (!document)
            return;
        await document.patchChange();
        if (!this.isActivted) {
            if (!latestInsertChar)
                return;
            let pre = await this.getPreviousContent(document);
            await this.triggerCompletion(document, pre);
            return;
        }
        if (bufnr !== this.bufnr)
            return;
        // check commit character
        if (this.config.acceptSuggestionOnCommitCharacter
            && this.currItem
            && latestInsertChar
            && !this.document.isWord(latestInsertChar)) {
            let resolvedItem = this.getCompleteItem(this.currItem);
            if (sources_1.default.shouldCommit(resolvedItem, latestInsertChar)) {
                let { linenr, col, line, colnr } = this.option;
                this.stop();
                let { word } = resolvedItem;
                let newLine = `${line.slice(0, col)}${word}${latestInsertChar}${line.slice(colnr - 1)}`;
                await nvim.call('coc#util#setline', [linenr, newLine]);
                let curcol = col + word.length + 2;
                await nvim.call('cursor', [linenr, curcol]);
                return;
            }
        }
        let content = await this.getPreviousContent(document);
        if (content == null) {
            // cursor line changed
            this.stop();
            return;
        }
        // check trigger character
        if (sources_1.default.shouldTrigger(content, document.filetype)) {
            await this.triggerCompletion(document, content, false);
            return;
        }
        if (!this.isActivted || this.complete.isEmpty)
            return;
        let search = content.slice(string_1.characterIndex(content, this.option.col));
        return await this.resumeCompletion(content, search);
    }
    async triggerCompletion(document, pre, checkTrigger = true) {
        // check trigger
        if (checkTrigger) {
            let shouldTrigger = await this.shouldTrigger(document, pre);
            if (!shouldTrigger)
                return;
        }
        let option = await this.nvim.call('coc#util#get_complete_option');
        if (!option)
            return;
        option.triggerCharacter = pre.slice(-1);
        logger.debug('trigger completion with', option);
        await this.startCompletion(option);
    }
    async onCompleteDone(item) {
        let { document } = this;
        if (!this.isActivted || !document || !item.hasOwnProperty('word'))
            return;
        let opt = Object.assign({}, this.option);
        let resolvedItem = this.getCompleteItem(item);
        this.stop();
        if (!resolvedItem)
            return;
        let timestamp = this.insertCharTs;
        let insertLeaveTs = this.insertLeaveTs;
        try {
            await sources_1.default.doCompleteResolve(resolvedItem, (new vscode_languageserver_protocol_1.CancellationTokenSource()).token);
            this.addRecent(resolvedItem.word, document.bufnr);
            await util_1.wait(50);
            if (this.insertCharTs != timestamp
                || this.insertLeaveTs != insertLeaveTs)
                return;
            await document.patchChange();
            let content = await this.getPreviousContent(document);
            if (!content.endsWith(resolvedItem.word))
                return;
            await sources_1.default.doCompleteDone(resolvedItem, opt);
            document.forceSync();
        }
        catch (e) {
            // tslint:disable-next-line:no-console
            console.error(e.stack);
            logger.error(`error on complete done`, e.stack);
        }
    }
    async onInsertLeave(bufnr) {
        this.insertLeaveTs = Date.now();
        let doc = workspace_1.default.getDocument(bufnr);
        if (doc)
            doc.forceSync(true);
        this.stop();
    }
    async onInsertEnter() {
        if (!this.config.triggerAfterInsertEnter)
            return;
        let option = await this.nvim.call('coc#util#get_complete_option');
        if (option && option.input.length >= this.config.minTriggerInputLength) {
            await this.startCompletion(option);
        }
    }
    async onInsertCharPre(character) {
        this.lastInsert = {
            character,
            timestamp: Date.now(),
        };
        this.insertCharTs = this.lastInsert.timestamp;
    }
    get latestInsert() {
        let { lastInsert } = this;
        if (!lastInsert || Date.now() - lastInsert.timestamp > 200) {
            return null;
        }
        return lastInsert;
    }
    get latestInsertChar() {
        let { latestInsert } = this;
        if (!latestInsert)
            return '';
        return latestInsert.character;
    }
    async shouldTrigger(document, pre) {
        if (pre.length == 0 || /\s/.test(pre[pre.length - 1]))
            return false;
        let autoTrigger = this.config.autoTrigger;
        if (autoTrigger == 'none')
            return false;
        if (sources_1.default.shouldTrigger(pre, document.filetype))
            return true;
        if (autoTrigger !== 'always')
            return false;
        let last = pre.slice(-1);
        if (last && (document.isWord(pre.slice(-1)) || last.codePointAt(0) > 255)) {
            let minLength = this.config.minTriggerInputLength;
            if (minLength == 1)
                return true;
            let input = this.getInput(document, pre);
            return input.length >= minLength;
        }
        return false;
    }
    async onPumChange(ev) {
        if (!this.activted)
            return;
        this.cancel();
        let { completed_item, col, row, height, width, scrollbar } = ev;
        let bounding = { col, row, height, width, scrollbar };
        this.currItem = completed_item.hasOwnProperty('word') ? completed_item : null;
        // it's pum change by vim, ignore it
        if (this.lastInsert)
            return;
        let resolvedItem = this.getCompleteItem(completed_item);
        if (!resolvedItem) {
            this.floating.close();
            return;
        }
        let source = this.resolveTokenSource = new vscode_languageserver_protocol_1.CancellationTokenSource();
        let { token } = source;
        await sources_1.default.doCompleteResolve(resolvedItem, token);
        if (token.isCancellationRequested)
            return;
        let docs = resolvedItem.documentation;
        if (!docs && resolvedItem.info) {
            let { info } = resolvedItem;
            let isText = /^[\w-\s.,\t]+$/.test(info);
            docs = [{ filetype: isText ? 'txt' : this.document.filetype, content: info }];
        }
        if (!docs || docs.length == 0) {
            this.floating.close();
        }
        else {
            if (token.isCancellationRequested)
                return;
            await this.floating.show(docs, bounding, token);
        }
        this.resolveTokenSource = null;
    }
    start(complete) {
        let { activted } = this;
        this.activted = true;
        this.isResolving = false;
        if (activted) {
            this.complete.dispose();
        }
        this.complete = complete;
        if (!this.config.keepCompleteopt) {
            this.nvim.command(`noa set completeopt=${this.completeOpt}`, true);
        }
        this.document.forceSync(true);
        this.document.paused = true;
    }
    cancel() {
        if (this.resolveTokenSource) {
            this.resolveTokenSource.cancel();
            this.resolveTokenSource = null;
        }
    }
    stop() {
        let { nvim } = this;
        if (!this.activted)
            return;
        this.cancel();
        this.currItem = null;
        this.activted = false;
        this.document.paused = false;
        this.document.fireContentChanges();
        if (this.complete) {
            this.complete.dispose();
            this.complete = null;
        }
        nvim.pauseNotification();
        if (this.config.numberSelect) {
            nvim.call('coc#_unmap', [], true);
        }
        if (!this.config.keepCompleteopt) {
            this.nvim.command(`noa set completeopt=${workspace_1.default.completeOpt}`, true);
        }
        nvim.command(`let g:coc#_context['candidates'] = []`, true);
        nvim.call('coc#_hide', [], true);
        nvim.resumeNotification(false, true).catch(_e => {
            // noop
        });
    }
    getInput(document, pre) {
        let input = '';
        for (let i = pre.length - 1; i >= 0; i--) {
            let ch = i == 0 ? null : pre[i - 1];
            if (!ch || !document.isWord(ch)) {
                input = pre.slice(i, pre.length);
                break;
            }
        }
        return input;
    }
    get completeOpt() {
        let { noselect, enablePreview } = this.config;
        let preview = enablePreview && !workspace_1.default.env.pumevent ? ',preview' : '';
        if (noselect)
            return `noselect,menuone${preview}`;
        return `noinsert,menuone${preview}`;
    }
    getCompleteItem(item) {
        if (!this.isActivted)
            return null;
        return this.complete.resolveCompletionItem(item);
    }
    dispose() {
        util_1.disposeAll(this.disposables);
    }
}
exports.Completion = Completion;
exports.default = new Completion();
//# sourceMappingURL=index.js.map