"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const position_1 = require("../../util/position");
const vscode_languageserver_types_1 = require("vscode-languageserver-types");
function addPosition(position, line, character) {
    return vscode_languageserver_types_1.Position.create(position.line + line, position.character + character);
}
describe('Position', () => {
    test('rangeInRange', () => {
        let pos = vscode_languageserver_types_1.Position.create(0, 0);
        let r = vscode_languageserver_types_1.Range.create(pos, pos);
        expect(position_1.rangeInRange(r, r)).toBe(true);
        expect(position_1.rangeInRange(r, vscode_languageserver_types_1.Range.create(addPosition(pos, 1, 0), pos))).toBe(false);
    });
    test('rangeOverlap', () => {
        let r = vscode_languageserver_types_1.Range.create(0, 0, 0, 0);
        expect(position_1.rangeOverlap(r, vscode_languageserver_types_1.Range.create(0, 0, 0, 0))).toBe(true);
        expect(position_1.rangeOverlap(vscode_languageserver_types_1.Range.create(0, 0, 0, 10), vscode_languageserver_types_1.Range.create(0, 1, 0, 2))).toBe(true);
        expect(position_1.rangeOverlap(vscode_languageserver_types_1.Range.create(0, 0, 0, 1), vscode_languageserver_types_1.Range.create(0, 1, 0, 2))).toBe(true);
        expect(position_1.rangeOverlap(vscode_languageserver_types_1.Range.create(0, 1, 0, 2), vscode_languageserver_types_1.Range.create(0, 0, 0, 1))).toBe(true);
        expect(position_1.rangeOverlap(vscode_languageserver_types_1.Range.create(0, 0, 0, 1), vscode_languageserver_types_1.Range.create(0, 2, 0, 3))).toBe(false);
    });
    test('positionInRange', () => {
        let pos = vscode_languageserver_types_1.Position.create(0, 0);
        let r = vscode_languageserver_types_1.Range.create(pos, pos);
        expect(position_1.positionInRange(pos, r)).toBe(0);
    });
    test('comparePosition', () => {
        let pos = vscode_languageserver_types_1.Position.create(0, 0);
        expect(position_1.comparePosition(pos, pos)).toBe(0);
    });
    test('isSingleLine', () => {
        let pos = vscode_languageserver_types_1.Position.create(0, 0);
        let r = vscode_languageserver_types_1.Range.create(pos, pos);
        expect(position_1.isSingleLine(r)).toBe(true);
    });
    test('getChangedPosition #1', () => {
        let pos = vscode_languageserver_types_1.Position.create(0, 0);
        let edit = vscode_languageserver_types_1.TextEdit.insert(pos, 'abc');
        let res = position_1.getChangedPosition(pos, edit);
        expect(res).toEqual({ line: 0, character: 3 });
    });
    test('getChangedPosition #2', () => {
        let pos = vscode_languageserver_types_1.Position.create(0, 0);
        let edit = vscode_languageserver_types_1.TextEdit.insert(pos, 'a\nb\nc');
        let res = position_1.getChangedPosition(pos, edit);
        expect(res).toEqual({ line: 2, character: 1 });
    });
    test('getChangedPosition #3', () => {
        let pos = vscode_languageserver_types_1.Position.create(0, 1);
        let r = vscode_languageserver_types_1.Range.create(addPosition(pos, 0, -1), pos);
        let edit = vscode_languageserver_types_1.TextEdit.replace(r, 'a\nb\n');
        let res = position_1.getChangedPosition(pos, edit);
        expect(res).toEqual({ line: 2, character: -1 });
    });
});
//# sourceMappingURL=position.test.js.map