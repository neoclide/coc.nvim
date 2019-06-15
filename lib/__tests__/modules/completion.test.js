"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const helper_1 = tslib_1.__importDefault(require("../helper"));
const workspace_1 = tslib_1.__importDefault(require("../../workspace"));
const completion_1 = tslib_1.__importDefault(require("../../completion"));
const languages_1 = tslib_1.__importDefault(require("../../languages"));
const sources_1 = tslib_1.__importDefault(require("../../sources"));
const types_1 = require("../../types");
const vscode_languageserver_types_1 = require("vscode-languageserver-types");
let nvim;
beforeAll(async () => {
    await helper_1.default.setup();
    nvim = helper_1.default.nvim;
});
beforeEach(async () => {
    await helper_1.default.createDocument();
    await nvim.call('feedkeys', [String.fromCharCode(27), 'in']);
});
afterAll(async () => {
    await helper_1.default.shutdown();
});
afterEach(async () => {
    await helper_1.default.reset();
});
describe('completion events', () => {
    it('should load preferences', () => {
        let minTriggerInputLength = completion_1.default.config.minTriggerInputLength;
        expect(minTriggerInputLength).toBe(1);
    });
    it('should reload preferences onChange', () => {
        let { configurations } = workspace_1.default;
        configurations.updateUserConfig({ 'suggest.maxCompleteItemCount': 30 });
        let snippetIndicator = completion_1.default.config.maxItemCount;
        expect(snippetIndicator).toBe(30);
    });
});
describe('completion start', () => {
    it('should deactivate on doComplete error', async () => {
        let fn = completion_1.default._doComplete;
        completion_1.default._doComplete = async () => {
            throw new Error('fake');
        };
        let option = await nvim.call('coc#util#get_complete_option');
        await completion_1.default.startCompletion(option);
        completion_1.default._doComplete = fn;
        expect(completion_1.default.isActivted).toBe(false);
        await nvim.input('<esc>');
    });
    it('should start completion', async () => {
        await nvim.setLine('foo football');
        await nvim.input('a');
        await nvim.call('cursor', [1, 2]);
        let option = await nvim.call('coc#util#get_complete_option');
        await completion_1.default.startCompletion(option);
        await helper_1.default.wait(30);
        expect(completion_1.default.isActivted).toBe(true);
    });
    it('should show slow source', async () => {
        let source = {
            priority: 0,
            enable: true,
            name: 'slow',
            sourceType: types_1.SourceType.Service,
            triggerCharacters: ['.'],
            doComplete: (_opt) => {
                return new Promise(resolve => {
                    setTimeout(() => {
                        resolve({ items: [{ word: 'foo' }, { word: 'bar' }] });
                    }, 600);
                });
            }
        };
        let disposable = sources_1.default.addSource(source);
        await helper_1.default.edit();
        await nvim.input('i.');
        await helper_1.default.waitPopup();
        expect(completion_1.default.isActivted).toBe(true);
        let items = await helper_1.default.items();
        expect(items.length).toBe(2);
        disposable.dispose();
    });
});
describe('completion#resumeCompletion', () => {
    it('should stop if no filtered items', async () => {
        await nvim.setLine('foo ');
        await helper_1.default.wait(50);
        await nvim.input('Af');
        await helper_1.default.waitPopup();
        expect(completion_1.default.isActivted).toBe(true);
        await nvim.input('d');
        await helper_1.default.wait(60);
        expect(completion_1.default.isActivted).toBe(false);
        await nvim.input('<esc>');
    });
    it('should deactivate without filtered items', async () => {
        await nvim.setLine('foo fbi ');
        await nvim.input('Af');
        await helper_1.default.waitPopup();
        await nvim.input('c');
        await helper_1.default.wait(100);
        let items = await helper_1.default.items();
        expect(items.length).toBe(0);
        expect(completion_1.default.isActivted).toBe(false);
        await nvim.input('<esc>');
    });
    it('should deactivate when insert space', async () => {
        let source = {
            priority: 0,
            enable: true,
            name: 'empty',
            sourceType: types_1.SourceType.Service,
            triggerCharacters: ['.'],
            doComplete: (_opt) => {
                return new Promise(resolve => {
                    resolve({ items: [{ word: 'foo bar' }] });
                });
            }
        };
        sources_1.default.addSource(source);
        await helper_1.default.edit();
        await nvim.input('i.');
        await helper_1.default.waitPopup();
        expect(completion_1.default.isActivted).toBe(true);
        sources_1.default.removeSource(source);
        let items = await helper_1.default.items();
        expect(items[0].word).toBe('foo bar');
        await nvim.input(' ');
        await helper_1.default.wait(60);
        expect(completion_1.default.isActivted).toBe(false);
    });
    it('should use resume input to filter', async () => {
        let source = {
            priority: 0,
            enable: true,
            name: 'source',
            sourceType: types_1.SourceType.Service,
            triggerCharacters: ['.'],
            doComplete: (_opt) => {
                return new Promise(resolve => {
                    setTimeout(() => {
                        resolve({ items: [{ word: 'foo' }, { word: 'bar' }] });
                    }, 60);
                });
            }
        };
        sources_1.default.addSource(source);
        await helper_1.default.edit();
        await nvim.input('i.');
        await helper_1.default.wait(20);
        await nvim.input('f');
        await helper_1.default.waitPopup();
        expect(completion_1.default.isActivted).toBe(true);
        let items = await helper_1.default.items();
        expect(items.length).toBe(1);
        expect(items[0].word).toBe('foo');
        sources_1.default.removeSource(source);
    });
    it('should filter slow source', async () => {
        let source = {
            priority: 0,
            enable: true,
            name: 'slow',
            sourceType: types_1.SourceType.Service,
            triggerCharacters: ['.'],
            doComplete: (_opt) => {
                return new Promise(resolve => {
                    setTimeout(() => {
                        resolve({ items: [{ word: 'foo' }, { word: 'bar' }] });
                    }, 600);
                });
            }
        };
        let disposable = sources_1.default.addSource(source);
        await helper_1.default.edit();
        await nvim.input('i.');
        await helper_1.default.wait(60);
        await nvim.input('f');
        await helper_1.default.waitPopup();
        await nvim.input('o');
        await helper_1.default.wait(100);
        expect(completion_1.default.isActivted).toBe(true);
        let items = await helper_1.default.items();
        expect(items.length).toBe(1);
        expect(items[0].word).toBe('foo');
        disposable.dispose();
    });
    it('should complete inComplete source', async () => {
        let source = {
            priority: 0,
            enable: true,
            name: 'inComplete',
            sourceType: types_1.SourceType.Service,
            triggerCharacters: ['.'],
            doComplete: async (opt) => {
                await helper_1.default.wait(30);
                if (opt.input.length <= 1) {
                    return { isIncomplete: true, items: [{ word: 'foo' }, { word: opt.input }] };
                }
                return { isIncomplete: false, items: [{ word: 'foo' }, { word: opt.input }] };
            }
        };
        let disposable = sources_1.default.addSource(source);
        await helper_1.default.edit();
        await nvim.input('i.');
        await helper_1.default.waitPopup();
        expect(completion_1.default.isActivted).toBe(true);
        let items = await helper_1.default.items();
        await nvim.input('a');
        await helper_1.default.wait(10);
        await nvim.input('b');
        await helper_1.default.wait(100);
        disposable.dispose();
        items = await helper_1.default.items();
        expect(items[0].word).toBe('ab');
        await nvim.input('<esc>');
    });
    it('should not complete inComplete source when none word inserted', async () => {
        let lastOption;
        let source = {
            priority: 0,
            enable: true,
            name: 'inComplete',
            sourceType: types_1.SourceType.Service,
            triggerCharacters: ['.'],
            doComplete: async (opt) => {
                lastOption = opt;
                await helper_1.default.wait(30);
                if (opt.input.length <= 1) {
                    return { isIncomplete: true, items: [{ word: 'foo' }, { word: opt.input }] };
                }
                return { isIncomplete: false, items: [{ word: 'foo' }, { word: opt.input }] };
            }
        };
        sources_1.default.addSource(source);
        await helper_1.default.edit();
        await nvim.input('i.');
        await helper_1.default.waitPopup();
        expect(completion_1.default.isActivted).toBe(true);
        await nvim.input('a');
        await helper_1.default.wait(10);
        await nvim.input(',');
        await helper_1.default.wait(300);
        sources_1.default.removeSource(source);
        expect(lastOption.triggerForInComplete).toBeFalsy();
        await nvim.input('<esc>');
    });
});
describe('completion#TextChangedP', () => {
    it('should stop when input length below option input length', async () => {
        await nvim.setLine('foo fbi ');
        await nvim.input('Afo');
        await helper_1.default.waitPopup();
        await nvim.input('<backspace>');
        await helper_1.default.wait(100);
        expect(completion_1.default.isActivted).toBe(false);
    });
    it('should fix cursor position on additionalTextEdits', async () => {
        let provider = {
            provideCompletionItems: async (_document, _position, _token, _context) => {
                return [{
                        label: 'foo',
                        filterText: 'foo',
                        additionalTextEdits: [vscode_languageserver_types_1.TextEdit.insert(vscode_languageserver_types_1.Position.create(0, 0), 'a\nbar')]
                    }];
            }
        };
        let disposable = languages_1.default.registerCompletionItemProvider('edits', 'edit', null, provider);
        await nvim.input('if');
        await helper_1.default.waitPopup();
        await helper_1.default.wait(100);
        await nvim.input('<C-n>');
        await helper_1.default.wait(100);
        await nvim.input('<C-y>');
        await helper_1.default.wait(200);
        let line = await nvim.line;
        expect(line).toBe('barfoo');
        let [, lnum, col] = await nvim.call('getcurpos');
        expect(lnum).toBe(2);
        expect(col).toBe(7);
        disposable.dispose();
    });
    it('should fix input for snippet item', async () => {
        let provider = {
            provideCompletionItems: async (_document, _position, _token, _context) => {
                return [{
                        label: 'foo',
                        filterText: 'foo',
                        insertText: '${1:foo}($2)',
                        insertTextFormat: vscode_languageserver_types_1.InsertTextFormat.Snippet,
                    }];
            }
        };
        let disposable = languages_1.default.registerCompletionItemProvider('snippets-test', 'st', null, provider);
        await nvim.input('if');
        await helper_1.default.waitPopup();
        await nvim.input('<C-n>');
        await helper_1.default.wait(100);
        let line = await nvim.line;
        expect(line).toBe('foo');
        disposable.dispose();
    });
    it('should filter on none keyword input', async () => {
        let source = {
            priority: 99,
            enable: true,
            name: 'temp',
            sourceType: types_1.SourceType.Service,
            doComplete: (_opt) => {
                return Promise.resolve({ items: [{ word: 'foo#abc' }] });
            },
        };
        let disposable = sources_1.default.addSource(source);
        await nvim.input('if');
        await helper_1.default.waitPopup();
        await nvim.input('#');
        await helper_1.default.wait(100);
        let items = await helper_1.default.getItems();
        expect(items[0].word).toBe('foo#abc');
        disposable.dispose();
    });
    it('should do resolve for complete item', async () => {
        let source = {
            priority: 0,
            enable: true,
            name: 'resolve',
            sourceType: types_1.SourceType.Service,
            triggerCharacters: ['.'],
            doComplete: (_opt) => {
                return Promise.resolve({ items: [{ word: 'foo' }] });
            },
            onCompleteResolve: item => {
                item.info = 'detail';
            }
        };
        sources_1.default.addSource(source);
        await nvim.input('i.');
        await helper_1.default.waitPopup();
        await helper_1.default.wait(100);
        await nvim.input('<C-n>');
        await helper_1.default.wait(100);
        // let items = completion.completeItems
        // expect(items[0].info).toBe('detail')
        sources_1.default.removeSource(source);
    });
});
describe('completion done', () => {
    it('should fix word on CompleteDone', async () => {
        await nvim.setLine('fball football');
        await nvim.input('i');
        await nvim.call('cursor', [1, 2]);
        let option = await nvim.call('coc#util#get_complete_option');
        await completion_1.default.startCompletion(option);
        let items = await helper_1.default.items();
        expect(items.length).toBe(1);
        await nvim.input('<C-n>');
        await helper_1.default.wait(30);
        await nvim.call('coc#_select');
        await helper_1.default.wait(100);
        let line = await nvim.line;
        expect(line).toBe('football football');
    });
});
describe('completion option', () => {
    it('should hide kind and menu when configured', async () => {
        helper_1.default.updateConfiguration('suggest.disableKind', true);
        helper_1.default.updateConfiguration('suggest.disableMenu', true);
        await nvim.setLine('fball football');
        await nvim.input('of');
        await helper_1.default.waitPopup();
        let items = await helper_1.default.getItems();
        expect(items[0].kind).toBeUndefined();
        expect(items[0].menu).toBeUndefined();
        helper_1.default.updateConfiguration('suggest.disableKind', false);
        helper_1.default.updateConfiguration('suggest.disableMenu', false);
    });
});
describe('completion resume', () => {
    it('should respect commitCharacter on TextChangedI', async () => {
        let source = {
            priority: 0,
            enable: true,
            name: 'slow',
            sourceType: types_1.SourceType.Service,
            triggerCharacters: ['.'],
            doComplete: (opt) => {
                if (opt.triggerCharacter == '.') {
                    return Promise.resolve({ items: [{ word: 'bar' }] });
                }
                return Promise.resolve({ items: [{ word: 'foo' }] });
            },
            shouldCommit: (_item, character) => {
                return character == '.';
            }
        };
        sources_1.default.addSource(source);
        await nvim.input('if');
        await helper_1.default.pumvisible();
        await helper_1.default.wait(100);
        await nvim.input('.');
        await helper_1.default.wait(100);
        sources_1.default.removeSource(source);
    });
});
describe('completion trigger', () => {
    it('should trigger completion on CursorMovedI', async () => {
        let source = {
            priority: 0,
            enable: true,
            name: 'trigger',
            sourceType: types_1.SourceType.Service,
            triggerCharacters: ['>'],
            doComplete: async (opt) => {
                if (opt.triggerCharacter == '>') {
                    return { items: [{ word: 'foo' }] };
                }
                return null;
            }
        };
        let disposable = sources_1.default.addSource(source);
        await helper_1.default.edit();
        await nvim.input('i><esc>a');
        await helper_1.default.waitPopup();
        let items = await helper_1.default.getItems();
        expect(items.length).toBe(1);
        disposable.dispose();
    });
    it('should trigger completion on type trigger character', async () => {
        let source = {
            priority: 1,
            enable: true,
            name: 'trigger',
            sourceType: types_1.SourceType.Service,
            triggerCharacters: ['.'],
            doComplete: (opt) => {
                if (opt.triggerCharacter == '.') {
                    return Promise.resolve({ items: [{ word: 'bar' }] });
                }
                return Promise.resolve({ items: [{ word: 'foo#bar' }] });
            }
        };
        sources_1.default.addSource(source);
        await nvim.input('i');
        await helper_1.default.wait(30);
        await nvim.input('.');
        await helper_1.default.waitPopup();
        let items = await helper_1.default.items();
        expect(items.length).toBeGreaterThan(0);
        sources_1.default.removeSource(source);
    });
    it('should not trigger if autoTrigger is none', async () => {
        let config = workspace_1.default.getConfiguration('suggest');
        config.update('autoTrigger', 'none');
        let autoTrigger = completion_1.default.config.autoTrigger;
        expect(autoTrigger).toBe('none');
        await nvim.setLine('foo fo');
        await nvim.input('A');
        await helper_1.default.wait(100);
        expect(completion_1.default.isActivted).toBe(false);
        config.update('autoTrigger', 'always');
        await helper_1.default.wait(100);
    });
    it('should trigger complete on trigger patterns match', async () => {
        let source = {
            priority: 99,
            enable: true,
            name: 'temp',
            triggerPatterns: [/EM/],
            sourceType: types_1.SourceType.Service,
            doComplete: (opt) => {
                if (!opt.input.startsWith('EM'))
                    return null;
                return Promise.resolve({
                    items: [
                        { word: 'foo', filterText: 'EMfoo' },
                        { word: 'bar', filterText: 'EMbar' }
                    ]
                });
            },
        };
        let disposable = sources_1.default.addSource(source);
        await nvim.input('i');
        await nvim.input('EM');
        await helper_1.default.waitPopup();
        let items = await helper_1.default.getItems();
        expect(items.length).toBe(2);
        disposable.dispose();
    });
    it('should trigger complete when pumvisible and triggerPatterns match', async () => {
        await nvim.setLine('EnumMember');
        let source = {
            priority: 99,
            enable: true,
            name: 'temp',
            triggerPatterns: [/EM/],
            sourceType: types_1.SourceType.Service,
            doComplete: (opt) => {
                if (!opt.input.startsWith('EM'))
                    return null;
                return Promise.resolve({
                    items: [
                        { word: 'a', filterText: 'EMa' },
                        { word: 'b', filterText: 'EMb' }
                    ]
                });
            },
        };
        let disposable = sources_1.default.addSource(source);
        await nvim.input('o');
        await helper_1.default.wait(10);
        await nvim.input('E');
        await helper_1.default.wait(30);
        await nvim.input('M');
        await helper_1.default.waitPopup();
        let items = await helper_1.default.getItems();
        expect(items.length).toBeGreaterThan(2);
        disposable.dispose();
    });
});
describe('completion#InsertEnter', () => {
    it('should trigger completion if triggerAfterInsertEnter is true', async () => {
        let config = workspace_1.default.getConfiguration('suggest');
        config.update('triggerAfterInsertEnter', true);
        await helper_1.default.wait(100);
        let triggerAfterInsertEnter = completion_1.default.config.triggerAfterInsertEnter;
        expect(triggerAfterInsertEnter).toBe(true);
        await nvim.setLine('foo fo');
        await nvim.input('A');
        await helper_1.default.waitPopup();
        expect(completion_1.default.isActivted).toBe(true);
        config.update('triggerAfterInsertEnter', undefined);
    });
    it('should not trigger when input length too small', async () => {
        let config = workspace_1.default.getConfiguration('suggest');
        config.update('triggerAfterInsertEnter', true);
        await helper_1.default.wait(100);
        let triggerAfterInsertEnter = completion_1.default.config.triggerAfterInsertEnter;
        expect(triggerAfterInsertEnter).toBe(true);
        await nvim.setLine('foo ');
        await nvim.input('A');
        await helper_1.default.wait(100);
        expect(completion_1.default.isActivted).toBe(false);
        config.update('triggerAfterInsertEnter', undefined);
    });
});
//# sourceMappingURL=completion.test.js.map