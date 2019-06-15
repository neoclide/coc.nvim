"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const types_1 = require("../../types");
const helper_1 = tslib_1.__importDefault(require("../helper"));
const sources_1 = tslib_1.__importDefault(require("../../sources"));
let nvim;
beforeAll(async () => {
    await helper_1.default.setup();
    nvim = helper_1.default.nvim;
});
afterAll(async () => {
    await helper_1.default.shutdown();
});
afterEach(async () => {
    await helper_1.default.reset();
});
describe('completion', () => {
    it('should not show word of word source on empty input', async () => {
        await nvim.setLine('foo bar');
        await helper_1.default.wait(200);
        await nvim.input('of');
        let res = await helper_1.default.visible('foo', 'around');
        expect(res).toBe(true);
        await nvim.input('<backspace>');
        await helper_1.default.wait(200);
        res = await helper_1.default.notVisible('foo');
        expect(res).toBe(true);
    });
    it('should trigger on first letter insert', async () => {
        await helper_1.default.edit();
        await nvim.setLine('foo bar');
        await helper_1.default.wait(30);
        await nvim.input('of');
        let res = await helper_1.default.visible('foo', 'around');
        expect(res).toBe(true);
    });
    it('should trigger on force refresh', async () => {
        await helper_1.default.edit();
        await nvim.setLine('foo f');
        await helper_1.default.wait(100);
        await nvim.input('A');
        await helper_1.default.wait(10);
        await nvim.call('coc#start');
        let res = await helper_1.default.visible('foo', 'around');
        expect(res).toBe(true);
    });
    it('should filter and sort on increment search', async () => {
        await helper_1.default.edit();
        await nvim.setLine('forceDocumentSync format  fallback');
        await helper_1.default.wait(30);
        await nvim.input('of');
        await helper_1.default.waitPopup();
        let items = await helper_1.default.getItems();
        let l = items.length;
        await nvim.input('oa');
        await helper_1.default.wait(100);
        items = await helper_1.default.getItems();
        expect(items.findIndex(o => o.word == 'fallback')).toBe(-1);
        expect(items.length).toBeLessThan(l);
    });
    it('should filter on character remove by backspace', async () => {
        await helper_1.default.edit();
        await nvim.setLine('forceDocumentSync format  fallback');
        await helper_1.default.wait(30);
        await nvim.input('ofa');
        await helper_1.default.waitPopup();
        let items = await helper_1.default.getItems();
        let words = items.map(o => o.word);
        expect(words).toContain('fallback');
        expect(words).toContain('format');
        await nvim.input('<backspace>');
        await helper_1.default.wait(100);
        items = await helper_1.default.getItems();
        words = items.map(o => o.word);
        expect(words).toEqual([]);
    });
    it('should not trigger on insert enter', async () => {
        await helper_1.default.edit();
        await nvim.setLine('foo bar');
        await helper_1.default.wait(30);
        await nvim.input('o');
        let visible = await nvim.call('pumvisible');
        expect(visible).toBe(0);
    });
    it('should filter on fast input', async () => {
        await helper_1.default.edit();
        await nvim.setLine('foo bar');
        await helper_1.default.wait(60);
        await nvim.input('oba');
        await helper_1.default.waitPopup();
        let items = await helper_1.default.getItems();
        let item = items.find(o => o.word == 'foo');
        expect(item).toBeFalsy();
        expect(items[0].word).toBe('bar');
    });
    it('should fix start column', async () => {
        await helper_1.default.edit();
        let source = {
            name: 'test',
            priority: 10,
            enable: true,
            firstMatch: false,
            sourceType: types_1.SourceType.Native,
            triggerCharacters: [],
            doComplete: async () => {
                let result = {
                    startcol: 0,
                    items: [{ word: 'foo.bar' }]
                };
                return Promise.resolve(result);
            }
        };
        let disposable = sources_1.default.addSource(source);
        await nvim.setLine('foo.');
        await nvim.input('Ab');
        await helper_1.default.waitPopup();
        let val = await nvim.getVar('coc#_context');
        expect(val.start).toBe(0);
        disposable.dispose();
    });
    it('should trigger on triggerCharacters', async () => {
        await helper_1.default.edit();
        let source = {
            name: 'trigger',
            priority: 10,
            enable: true,
            sourceType: types_1.SourceType.Native,
            triggerCharacters: ['.'],
            doComplete: async () => {
                return Promise.resolve({
                    items: [{ word: 'foo' }]
                });
            }
        };
        sources_1.default.addSource(source);
        await nvim.input('i');
        await helper_1.default.wait(30);
        await nvim.input('.');
        await helper_1.default.waitPopup();
        sources_1.default.removeSource(source);
        let res = await helper_1.default.visible('foo', 'trigger');
        expect(res).toBe(true);
    });
    it('should should complete items without input', async () => {
        await helper_1.default.edit();
        let source = {
            enable: true,
            name: 'trigger',
            priority: 10,
            sourceType: types_1.SourceType.Native,
            doComplete: async () => {
                return Promise.resolve({
                    items: [{ word: 'foo' }, { word: 'bar' }]
                });
            }
        };
        let disposable = sources_1.default.addSource(source);
        await nvim.command('inoremap <silent><expr> <c-space> coc#refresh()');
        await nvim.input('i');
        await helper_1.default.wait(30);
        await nvim.input('<c-space>');
        await helper_1.default.waitPopup();
        let items = await helper_1.default.getItems();
        expect(items.length).toBeGreaterThan(1);
        disposable.dispose();
    });
    it('should show float window', async () => {
        await helper_1.default.edit();
        let source = {
            name: 'float',
            priority: 10,
            enable: true,
            sourceType: types_1.SourceType.Native,
            doComplete: () => {
                return Promise.resolve({
                    items: [{ word: 'foo', info: 'bar' }]
                });
            }
        };
        sources_1.default.addSource(source);
        await nvim.input('i');
        await helper_1.default.wait(30);
        await nvim.input('f');
        await helper_1.default.waitPopup();
        await nvim.eval('feedkeys("\\<down>","in")');
        await helper_1.default.wait(500);
        let hasFloat = await nvim.call('coc#util#has_float');
        expect(hasFloat).toBe(1);
        sources_1.default.removeSource(source);
        let res = await helper_1.default.visible('foo', 'float');
        expect(res).toBe(true);
    });
    it('should trigger on triggerPatterns', async () => {
        await helper_1.default.edit();
        let source = {
            name: 'pattern',
            priority: 10,
            enable: true,
            sourceType: types_1.SourceType.Native,
            triggerPatterns: [/\w+\.$/],
            doComplete: async () => {
                return Promise.resolve({
                    items: [{ word: 'foo' }]
                });
            }
        };
        sources_1.default.addSource(source);
        await nvim.input('i');
        await helper_1.default.wait(10);
        await nvim.input('.');
        await helper_1.default.wait(30);
        let pumvisible = await nvim.call('pumvisible');
        expect(pumvisible).toBe(0);
        await nvim.input('a');
        await helper_1.default.wait(30);
        await nvim.input('.');
        await helper_1.default.waitPopup();
        sources_1.default.removeSource(source);
        let res = await helper_1.default.visible('foo', 'pattern');
        expect(res).toBe(true);
    });
    it('should not trigger triggerOnly source', async () => {
        await helper_1.default.edit();
        await nvim.setLine('foo bar');
        let source = {
            name: 'pattern',
            triggerOnly: true,
            priority: 10,
            enable: true,
            sourceType: types_1.SourceType.Native,
            triggerPatterns: [/^From:\s*/],
            doComplete: async () => {
                return Promise.resolve({
                    items: [{ word: 'foo' }]
                });
            }
        };
        let disposable = sources_1.default.addSource(source);
        await nvim.input('o');
        await helper_1.default.wait(10);
        await nvim.input('f');
        await helper_1.default.wait(10);
        let res = await helper_1.default.visible('foo', 'around');
        expect(res).toBe(true);
        let items = await helper_1.default.items();
        expect(items.length).toBe(1);
        disposable.dispose();
    });
    it('should not trigger when cursor moved', async () => {
        await helper_1.default.edit();
        let source = {
            name: 'trigger',
            priority: 10,
            enable: true,
            sourceType: types_1.SourceType.Native,
            triggerCharacters: ['.'],
            doComplete: async () => {
                return Promise.resolve({
                    items: [{ word: 'foo' }]
                });
            }
        };
        sources_1.default.addSource(source);
        await nvim.setLine('.a');
        await nvim.input('A');
        await nvim.eval('feedkeys("\\<bs>")');
        await helper_1.default.wait(10);
        await nvim.eval('feedkeys("\\<left>")');
        await helper_1.default.wait(200);
        let visible = await nvim.call('pumvisible');
        expect(visible).toBe(0);
        sources_1.default.removeSource(source);
    });
    it('should trigger when completion is not completed', async () => {
        await helper_1.default.edit();
        let token;
        let source = {
            name: 'completion',
            priority: 10,
            enable: true,
            sourceType: types_1.SourceType.Native,
            triggerCharacters: ['.'],
            doComplete: async (opt, cancellationToken) => {
                if (opt.triggerCharacter != '.') {
                    token = cancellationToken;
                    return new Promise((resolve, reject) => {
                        let timer = setTimeout(() => {
                            resolve({ items: [{ word: 'foo' }] });
                        }, 200);
                        if (cancellationToken.isCancellationRequested) {
                            clearTimeout(timer);
                            reject(new Error('Cancelled'));
                        }
                    });
                }
                return Promise.resolve({
                    items: [{ word: 'bar' }]
                });
            }
        };
        let disposable = sources_1.default.addSource(source);
        await nvim.input('i');
        await helper_1.default.wait(30);
        await nvim.input('f');
        await helper_1.default.wait(30);
        await nvim.input('.');
        await helper_1.default.visible('bar', 'completion');
        expect(token.isCancellationRequested).toBe(true);
        disposable.dispose();
    });
    it('should limit results for low priority source', async () => {
        helper_1.default.updateConfiguration('suggest.lowPrioritySourceLimit', 2);
        await nvim.setLine('filename filepath find filter findIndex');
        await helper_1.default.wait(200);
        await nvim.input('of');
        await helper_1.default.waitPopup();
        let items = await helper_1.default.getItems();
        items = items.filter(o => o.menu == '[A]');
        expect(items.length).toBe(2);
    });
    it('should limit result for high priority source', async () => {
        helper_1.default.updateConfiguration('suggest.highPrioritySourceLimit', 2);
        await helper_1.default.edit();
        let source = {
            name: 'high',
            priority: 90,
            enable: true,
            sourceType: types_1.SourceType.Native,
            triggerCharacters: ['.'],
            doComplete: async () => {
                return Promise.resolve({
                    items: ['filename', 'filepath', 'filter', 'file'].map(key => {
                        return { word: key };
                    })
                });
            }
        };
        let disposable = sources_1.default.addSource(source);
        await nvim.input('i');
        await helper_1.default.wait(30);
        await nvim.input('.');
        await helper_1.default.waitPopup();
        let items = await helper_1.default.getItems();
        expect(items.length).toBe(2);
        disposable.dispose();
    });
    it('should truncate label of complete items', async () => {
        helper_1.default.updateConfiguration('suggest.labelMaxLength', 10);
        await helper_1.default.edit();
        let source = {
            name: 'high',
            priority: 90,
            enable: true,
            sourceType: types_1.SourceType.Native,
            triggerCharacters: ['.'],
            doComplete: async () => {
                return Promise.resolve({
                    items: ['a', 'b', 'c', 'd'].map(key => {
                        return { word: key.repeat(20) };
                    })
                });
            }
        };
        let disposable = sources_1.default.addSource(source);
        await nvim.input('i');
        await helper_1.default.wait(30);
        await nvim.input('.');
        await helper_1.default.waitPopup();
        let items = await helper_1.default.getItems();
        for (let item of items) {
            expect(item.abbr.length).toBeLessThanOrEqual(10);
        }
        disposable.dispose();
    });
});
//# sourceMappingURL=basic.test.js.map