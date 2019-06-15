"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const path_1 = tslib_1.__importDefault(require("path"));
const rimraf_1 = tslib_1.__importDefault(require("rimraf"));
const vscode_uri_1 = require("vscode-uri");
const os_1 = tslib_1.__importDefault(require("os"));
const util_1 = require("../../util");
const fs_1 = require("../../util/fs");
const fuzzy_1 = require("../../util/fuzzy");
const fzy_1 = require("../../util/fzy");
const highlight_1 = require("../../util/highlight");
const match_1 = require("../../util/match");
const object_1 = require("../../util/object");
const string_1 = require("../../util/string");
const helper_1 = tslib_1.__importDefault(require("../helper"));
const ansiparse_1 = require("../../util/ansiparse");
let nvim;
beforeAll(async () => {
    await helper_1.default.setup();
    nvim = helper_1.default.nvim;
});
afterAll(async () => {
    await helper_1.default.shutdown();
});
describe('score test', () => {
    test('should match schema', () => {
        let uri = vscode_uri_1.URI.file('/foo').toString();
        let s = match_1.score([{ language: '*', scheme: 'file' }], uri, 'typescript');
        expect(s).toBe(5);
    });
    test('fzy#score', async () => {
        let a = fzy_1.score("amuser", "app/models/user.rb");
        let b = fzy_1.score("amuser", "app/models/customer.rb");
        expect(a).toBeGreaterThan(b);
    });
    test('fzy#positions', async () => {
        let arr = fzy_1.positions("amuser", "app/models/user.rb");
        expect(arr).toEqual([0, 4, 11, 12, 13, 14]);
    });
});
describe('mkdirp', () => {
    test('should mkdirp', async () => {
        let dir = path_1.default.join(__dirname, 'a/b/c');
        let res = await util_1.mkdirp(dir);
        expect(res).toBe(true);
        rimraf_1.default.sync(path_1.default.join(__dirname, 'a'));
    });
});
describe('parentDirs', () => {
    test('get parentDirs', () => {
        let dirs = fs_1.parentDirs('/a/b/c');
        expect(dirs).toEqual(['/', '/a', '/a/b']);
    });
});
describe('isParentFolder', () => {
    test('check parent folder', () => {
        expect(fs_1.isParentFolder('/a', '/a/b')).toBe(true);
        expect(fs_1.isParentFolder('/a/b', '/a/b/')).toBe(true);
    });
});
describe('string test', () => {
    test('should find index', () => {
        expect(string_1.indexOf('a,b,c', ',', 2)).toBe(3);
        expect(string_1.indexOf('a,b,c', ',', 1)).toBe(1);
    });
    test('resolve variables', async () => {
        let res = string_1.resolveVariables('${workspace}/foo', { workspace: '/home' });
        expect(res).toBe('/home/foo');
        expect(string_1.resolveVariables('${x}', {})).toBe('${x}');
    });
});
describe('fuzzy match test', () => {
    test('should be fuzzy match', () => {
        let needle = 'aBc';
        let codes = fuzzy_1.getCharCodes(needle);
        expect(fuzzy_1.fuzzyMatch(codes, 'abc')).toBeFalsy;
        expect(fuzzy_1.fuzzyMatch(codes, 'ab')).toBeFalsy;
        expect(fuzzy_1.fuzzyMatch(codes, 'addbdd')).toBeFalsy;
        expect(fuzzy_1.fuzzyMatch(codes, 'abbbBc')).toBeTruthy;
        expect(fuzzy_1.fuzzyMatch(codes, 'daBc')).toBeTruthy;
        expect(fuzzy_1.fuzzyMatch(codes, 'ABCz')).toBeTruthy;
    });
    test('should be fuzzy for character', () => {
        expect(fuzzy_1.fuzzyChar('a', 'a')).toBeTruthy;
        expect(fuzzy_1.fuzzyChar('a', 'A')).toBeTruthy;
        expect(fuzzy_1.fuzzyChar('z', 'z')).toBeTruthy;
        expect(fuzzy_1.fuzzyChar('z', 'Z')).toBeTruthy;
        expect(fuzzy_1.fuzzyChar('A', 'a')).toBeFalsy;
        expect(fuzzy_1.fuzzyChar('A', 'A')).toBeTruthy;
        expect(fuzzy_1.fuzzyChar('Z', 'z')).toBeFalsy;
        expect(fuzzy_1.fuzzyChar('Z', 'Z')).toBeTruthy;
    });
});
describe('fs test', () => {
    test('fs statAsync', async () => {
        let res = await fs_1.statAsync(__filename);
        expect(res).toBeDefined;
        expect(res.isFile()).toBe(true);
    });
    test('fs statAsync #1', async () => {
        let res = await fs_1.statAsync(path_1.default.join(__dirname, 'file_not_exist'));
        expect(res).toBeNull;
    });
    test('should be not ignored', async () => {
        let res = await fs_1.isGitIgnored(__filename);
        expect(res).toBeFalsy;
    });
    test('should be ignored', async () => {
        let res = await fs_1.isGitIgnored(path_1.default.resolve(__dirname, '../lib/index.js.map'));
        expect(res).toBeTruthy;
    });
});
describe('object test', () => {
    test('mixin should recursive', () => {
        let res = object_1.mixin({ a: { b: 1 } }, { a: { c: 2 }, d: 3 });
        expect(res.a.b).toBe(1);
        expect(res.a.c).toBe(2);
        expect(res.d).toBe(3);
    });
});
describe('resolveRoot', () => {
    test('resolve root consider root path', () => {
        let res = fs_1.resolveRoot(__dirname, ['.git']);
        expect(res).toMatch('coc.nvim');
    });
    test('should resolve from parent folders', () => {
        let root = path_1.default.resolve(__dirname, '../extensions/snippet-sample');
        let res = fs_1.resolveRoot(root, ['package.json']);
        expect(res.endsWith('coc.nvim')).toBe(true);
    });
    test('should not resolve to home', () => {
        let res = fs_1.resolveRoot(__dirname, ['.config']);
        expect(res != os_1.default.homedir()).toBeTruthy();
    });
});
describe('findUp', () => {
    test('findUp by filename', () => {
        let filepath = fs_1.findUp('package.json', __dirname);
        expect(filepath).toMatch('coc.nvim');
        filepath = fs_1.findUp('not_exists', __dirname);
        expect(filepath).toBeNull();
    });
    test('findUp by filenames', async () => {
        let filepath = fs_1.findUp(['src'], __dirname);
        expect(filepath).toMatch('coc.nvim');
    });
});
describe('getHiglights', () => {
    test('getHiglights', async () => {
        let res = await highlight_1.getHiglights([
            '*@param* `buffer`'
        ], 'markdown');
        expect(res.length > 0).toBe(true);
        for (let filetype of ['Error', 'Warning', 'Info', 'Hint']) {
            let res = await highlight_1.getHiglights(['foo'], filetype);
            expect(res.length > 0).toBe(true);
        }
    });
});
describe('ansiparse', () => {
    test('ansiparse #1', () => {
        let str = '\u001b[33mText\u001b[mnormal';
        let res = ansiparse_1.ansiparse(str);
        expect(res).toEqual([{
                foreground: 'yellow', text: 'Text'
            }, {
                text: 'normal'
            }]);
    });
    test('ansiparse #2', () => {
        let str = '\u001b[33m\u001b[mText';
        let res = ansiparse_1.ansiparse(str);
        expect(res).toEqual([
            { foreground: 'yellow', text: '' },
            { text: 'Text' }
        ]);
    });
    test('ansiparse #3', () => {
        let str = 'this.\u001b[0m\u001b[31m\u001b[1mhistory\u001b[0m.add()';
        let res = ansiparse_1.ansiparse(str);
        expect(res[1]).toEqual({
            foreground: 'red',
            bold: true, text: 'history'
        });
    });
});
//# sourceMappingURL=util.test.js.map