"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const helper_1 = tslib_1.__importDefault(require("../helper"));
const vscode_languageserver_protocol_1 = require("vscode-languageserver-protocol");
const highlighter_1 = require("../../handler/highlighter");
const languages_1 = tslib_1.__importDefault(require("../../languages"));
const util_1 = require("../../util");
let nvim;
let state = 'normal';
let colors;
let disposables = [];
beforeAll(async () => {
    await helper_1.default.setup();
    await helper_1.default.wait(500);
    nvim = helper_1.default.nvim;
    colors = helper_1.default.plugin.handler.colors;
    disposables.push(languages_1.default.registerDocumentColorProvider([{ language: '*' }], {
        provideColorPresentations: (_color, _context, _token) => {
            return [vscode_languageserver_protocol_1.ColorPresentation.create('red'), vscode_languageserver_protocol_1.ColorPresentation.create('#ff0000')];
        },
        provideDocumentColors: (_document, _token) => {
            if (state == 'empty')
                return [];
            if (state == 'error')
                return Promise.reject(new Error('no color'));
            return [{
                    range: vscode_languageserver_protocol_1.Range.create(0, 0, 0, 7),
                    color: getColor(255, 255, 255)
                }];
        }
    }));
});
afterAll(async () => {
    util_1.disposeAll(disposables);
    await helper_1.default.shutdown();
});
afterEach(async () => {
    await helper_1.default.reset();
});
function getColor(r, g, b) {
    return { red: r / 255, green: g / 255, blue: b / 255, alpha: 1 };
}
describe('Colors', () => {
    it('should get hex string', () => {
        let color = getColor(255, 255, 255);
        let hex = highlighter_1.toHexString(color);
        expect(hex).toBe('ffffff');
    });
    it('should toggle enable state on configuration change', () => {
        helper_1.default.updateConfiguration('coc.preferences.colorSupport', false);
        expect(colors.enabled).toBe(false);
        helper_1.default.updateConfiguration('coc.preferences.colorSupport', true);
        expect(colors.enabled).toBe(true);
    });
    it('should clearHighlight on empty result', async () => {
        let doc = await helper_1.default.createDocument();
        await nvim.setLine('#ffffff');
        state = 'empty';
        await colors.highlightColors(doc, true);
        let res = colors.hasColor(doc.bufnr);
        expect(res).toBe(false);
        state = 'normal';
    });
    it('should not highlight on error result', async () => {
        let doc = await helper_1.default.createDocument();
        await nvim.setLine('#ffffff');
        state = 'error';
        await colors.highlightColors(doc, true);
        let res = colors.hasColor(doc.bufnr);
        expect(res).toBe(false);
        state = 'normal';
    });
    it('should clearHighlight on clearHighlight', async () => {
        let doc = await helper_1.default.createDocument();
        await nvim.setLine('#ffffff');
        await colors.highlightColors(doc);
        expect(colors.hasColor(doc.bufnr)).toBe(true);
        colors.clearHighlight(doc.bufnr);
        expect(colors.hasColor(doc.bufnr)).toBe(false);
    });
    it('should highlight colors', async () => {
        let doc = await helper_1.default.createDocument();
        await nvim.setLine('#ffffff');
        await colors.highlightColors(doc, true);
        let exists = await nvim.call('hlexists', 'BGffffff');
        expect(exists).toBe(1);
    });
    it('should pick presentations', async () => {
        let doc = await helper_1.default.createDocument();
        await nvim.setLine('#ffffff');
        await colors.highlightColors(doc, true);
        let p = colors.pickPresentation();
        await helper_1.default.wait(100);
        let m = await nvim.mode;
        expect(m.blocking).toBe(true);
        await nvim.input('1<enter>');
        await p;
        let line = await nvim.getLine();
        expect(line).toBe('red');
    });
    it('should pickColor', async () => {
        await helper_1.default.mockFunction('coc#util#pick_color', [0, 0, 0]);
        let doc = await helper_1.default.createDocument();
        await nvim.setLine('#ffffff');
        await colors.highlightColors(doc);
        await colors.pickColor();
        let line = await nvim.getLine();
        expect(line).toBe('#000000');
    });
});
//# sourceMappingURL=colors.test.js.map