"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const unique_1 = require("../util/unique");
const index_1 = require("../util/index");
const filter_1 = require("../util/filter");
const fs_1 = require("../util/fs");
const sorter_1 = require("../util/sorter");
const watch_obj_1 = require("../util/watch-obj");
const path = require("path");
describe('equalChar test', () => {
    test('should not ignore case', () => {
        expect(index_1.equalChar('a', 'b', false)).toBeFalsy;
        expect(index_1.equalChar('a', 'A', false)).toBeFalsy;
        expect(index_1.equalChar('a', 'a', false)).toBeTruthy;
    });
    test('should ignore case', () => {
        expect(index_1.equalChar('a', 'b', false)).toBeFalsy;
        expect(index_1.equalChar('a', 'A', false)).toBeTruthy;
        expect(index_1.equalChar('a', 'a', false)).toBeTruthy;
    });
});
describe('getUserData test', () => {
    test('should return null if no data', () => {
        let item = { word: '' };
        expect(index_1.getUserData(item)).toBeNull;
    });
    test('should return null if no cid', () => {
        let item = { word: '', user_data: '{"foo": 1}' };
        expect(index_1.getUserData(item)).toBeNull;
    });
    test('should return null if user_data not a json', () => {
        let item = { word: '', user_data: 'foo' };
        expect(index_1.getUserData(item)).toBeNull;
    });
    test('should return object if cid is in user_data', () => {
        let item = { word: '', user_data: '{"cid": 123}' };
        let obj = index_1.getUserData(item);
        expect(obj).toBeDefined;
        expect(obj.cid).toBe(123);
    });
});
describe('unique test', () => {
    test('should find out better abbr', () => tslib_1.__awaiter(this, void 0, void 0, function* () {
        let items = [{
                word: 'foo'
            }, {
                word: 'foo',
                abbr: 'bar'
            }];
        let res = unique_1.uniqueItems(items);
        expect(res.length).toBe(1);
        expect(res[0].abbr).toBe('bar');
    }));
    test('should unique words list', () => {
        let list = [['foo', 'bar'], ['foo']];
        let res = unique_1.uniqeWordsList(list);
        expect(res.length).toBe(2);
        expect(res[0]).toBe('foo');
        expect(res[1]).toBe('bar');
    });
    test('should find out better abbr #1', () => tslib_1.__awaiter(this, void 0, void 0, function* () {
        let items = [
            {
                info: '',
                additionalTextEdits: null,
                word: 'getConfig',
                kind: '',
                abbr: 'getConfig',
                score: 0.13
            },
            {
                word: 'getConfig',
                score: 0.13
            }
        ];
        let res = unique_1.uniqueItems(items);
        expect(res.length).toBe(1);
        expect(res[0].abbr).toBe('getConfig');
    }));
    test('should find out better kind', () => tslib_1.__awaiter(this, void 0, void 0, function* () {
        let items = [{
                word: 'foo'
            }, {
                word: 'foo',
                kind: 'M'
            }, {
                word: 'foo',
                kind: 'Method'
            }];
        let res = unique_1.uniqueItems(items);
        expect(res.length).toBe(1);
        expect(res[0].kind).toBe('Method');
    }));
    test('should find out better info', () => tslib_1.__awaiter(this, void 0, void 0, function* () {
        let items = [{
                word: 'foo'
            }, {
                word: 'foo',
                info: 'bar'
            }];
        let res = unique_1.uniqueItems(items);
        expect(res.length).toBe(1);
        expect(res[0].info).toBe('bar');
    }));
});
describe('contextDebounce test', () => tslib_1.__awaiter(this, void 0, void 0, function* () {
    test('should debounce #1', () => tslib_1.__awaiter(this, void 0, void 0, function* () {
        let i = 0;
        function incr(x) {
            i = i + x;
        }
        let fn = index_1.contextDebounce(incr, 100);
        expect(i).toBe(0);
        fn(1);
        yield index_1.wait(30);
        fn(1);
        expect(i).toBe(0);
        yield index_1.wait(110);
        expect(i).toBe(1);
        fn(1);
        expect(i).toBe(1);
        yield index_1.wait(110);
        expect(i).toBe(2);
    }));
    test('should debounce #2', () => tslib_1.__awaiter(this, void 0, void 0, function* () {
        let i = 0;
        let j = 0;
        function incr(x) {
            if (x == 1)
                i = i + 1;
            if (x == 2)
                j = j + 1;
        }
        let fn = index_1.contextDebounce(incr, 100);
        fn(1);
        fn(2);
        expect(i).toBe(0);
        expect(j).toBe(0);
        yield index_1.wait(110);
        expect(i).toBe(1);
        expect(j).toBe(1);
        fn(2);
        fn(2);
        fn(1);
        expect(i).toBe(1);
        expect(j).toBe(1);
        yield index_1.wait(110);
        expect(i).toBe(2);
        expect(j).toBe(2);
    }));
}));
describe('isCocItem test', () => {
    test('should be coc item', () => {
        let item = {
            word: 'f',
            user_data: '{"cid": 123}'
        };
        expect(index_1.isCocItem(item)).toBeTruthy;
    });
    test('shoud not be coc item', () => {
        expect(index_1.isCocItem(null)).toBeFalsy;
        expect(index_1.isCocItem({})).toBeFalsy;
        expect(index_1.isCocItem({ word: '' })).toBeFalsy;
        expect(index_1.isCocItem({ word: '', user_data: 'abc' })).toBeFalsy;
    });
});
describe('filter test', () => {
    test('filter fuzzy #1', () => {
        expect(filter_1.filterFuzzy('fo', 'foo', false)).toBeTruthy;
        expect(filter_1.filterFuzzy('fo', 'Foo', false)).toBeFalsy;
        expect(filter_1.filterFuzzy('fo', 'ofo', false)).toBeTruthy;
        expect(filter_1.filterFuzzy('fo', 'oof', false)).toBeFalsy;
    });
    test('filter fuzzy #2', () => {
        expect(filter_1.filterFuzzy('fo', 'foo', true)).toBeTruthy;
        expect(filter_1.filterFuzzy('fo', 'Foo', true)).toBeTruthy;
        expect(filter_1.filterFuzzy('fo', 'oFo', true)).toBeTruthy;
        expect(filter_1.filterFuzzy('fo', 'oof', true)).toBeFalsy;
    });
    test('filter word #1', () => {
        expect(filter_1.filterWord('fo', 'foo', false)).toBeTruthy;
        expect(filter_1.filterWord('fo', 'Foo', false)).toBeFalsy;
        expect(filter_1.filterWord('fo', 'ofo', false)).toBeFalsy;
    });
    test('filter word #2', () => {
        expect(filter_1.filterWord('fo', 'foo', true)).toBeTruthy;
        expect(filter_1.filterWord('fo', 'Foo', true)).toBeTruthy;
        expect(filter_1.filterWord('fo', 'oFo', true)).toBeFalsy;
    });
});
describe('fs test', () => {
    test('fs statAsync', () => tslib_1.__awaiter(this, void 0, void 0, function* () {
        let res = yield fs_1.statAsync(__filename);
        expect(res).toBeDefined;
        expect(res.isFile()).toBe(true);
    }));
    test('fs statAsync #1', () => tslib_1.__awaiter(this, void 0, void 0, function* () {
        let res = yield fs_1.statAsync(path.join(__dirname, 'file_not_exist'));
        expect(res).toBeNull;
    }));
    test('should be not ignored', () => tslib_1.__awaiter(this, void 0, void 0, function* () {
        let res = yield fs_1.isGitIgnored(__filename);
        expect(res).toBeFalsy;
    }));
    test('should be ignored', () => tslib_1.__awaiter(this, void 0, void 0, function* () {
        let res = yield fs_1.isGitIgnored(path.resolve(__dirname, '../lib/index.js.map'));
        expect(res).toBeTruthy;
    }));
    test('should find source directory', () => tslib_1.__awaiter(this, void 0, void 0, function* () {
        let dir = fs_1.findSourceDir(path.resolve(__dirname, '../util/index.js'));
        expect(dir).toBe(path.resolve(__dirname, '..'));
    }));
    test('should not find source directory', () => tslib_1.__awaiter(this, void 0, void 0, function* () {
        let dir = fs_1.findSourceDir(__filename);
        expect(dir).toBeNull;
    }));
});
describe('sort test', () => {
    test('should sort item by word', () => {
        let items = [{ word: 'ab' }, { word: 'ac' }];
        let res = sorter_1.wordSortItems(items);
        expect(res.length).toBe(2);
        expect(res[0].word).toBe('ab');
    });
});
describe('watchObj test', () => {
    test('should trigger watch', () => {
        const cached = {};
        let { watched, addWatcher } = watch_obj_1.default(cached);
        let result = null;
        addWatcher('foo', res => {
            result = res;
        });
        watched.foo = 'bar';
        expect(result).toBe('bar');
    });
    test('should not trigger watch', () => {
        const cached = {};
        let { watched, addWatcher } = watch_obj_1.default(cached);
        let result = null;
        addWatcher('foo', res => {
            result = res;
        });
        watched.bar = 'bar';
        delete watched.bar;
        expect(result).toBeNull;
    });
});
describe('readFileByLine', () => {
    test('should read file', () => tslib_1.__awaiter(this, void 0, void 0, function* () {
        let lines = [];
        yield fs_1.readFileByLine(path.join(__dirname, 'tags'), line => {
            lines.push(line);
        });
        expect(lines.length > 0).toBeTruthy;
    }));
});
//# sourceMappingURL=util.test.js.map