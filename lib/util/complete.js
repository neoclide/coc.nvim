"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vscode_languageserver_types_1 = require("vscode-languageserver-types");
const parser_1 = require("../snippets/parser");
const string_1 = require("./string");
const logger = require('./logger')('util-complete');
const invalidInsertCharacters = ['(', '<', '{', '[', '\r', '\n'];
function getPosition(opt) {
    let { line, linenr, colnr } = opt;
    let part = string_1.byteSlice(line, 0, colnr - 1);
    return {
        line: linenr - 1,
        character: part.length
    };
}
exports.getPosition = getPosition;
function getWord(item, opt) {
    // tslint:disable-next-line: deprecation
    let { label, data, insertTextFormat, insertText, textEdit } = item;
    let word;
    let newText;
    if (data && data.word)
        return data.word;
    if (textEdit) {
        let { range } = textEdit;
        newText = textEdit.newText;
        if (range && range.start.line == range.end.line) {
            let { line, col, colnr } = opt;
            let character = string_1.characterIndex(line, col);
            if (range.start.character > character) {
                let before = line.slice(character - range.start.character);
                newText = before + newText;
            }
            else {
                let start = line.slice(range.start.character, character);
                if (start.length && newText.startsWith(start)) {
                    newText = newText.slice(start.length);
                }
            }
            character = string_1.characterIndex(line, colnr - 1);
            if (range.end.character > character) {
                let end = line.slice(character, range.end.character);
                if (newText.endsWith(end)) {
                    newText = newText.slice(0, -end.length);
                }
            }
        }
    }
    else {
        newText = insertText;
    }
    if (insertTextFormat == vscode_languageserver_types_1.InsertTextFormat.Snippet
        && newText
        && newText.indexOf('$') !== -1) {
        let parser = new parser_1.SnippetParser();
        let snippet = parser.text(newText);
        word = snippet ? getValidWord(snippet, invalidInsertCharacters) : label;
    }
    else {
        word = getValidWord(newText, invalidInsertCharacters) || label;
    }
    return word;
}
exports.getWord = getWord;
function getDocumentation(item) {
    let { documentation } = item;
    if (!documentation)
        return '';
    if (typeof documentation === 'string')
        return documentation;
    return documentation.value;
}
exports.getDocumentation = getDocumentation;
function completionKindString(kind, map, defaultValue = '') {
    return map.get(kind) || defaultValue;
}
exports.completionKindString = completionKindString;
function getSnippetDocumentation(languageId, body) {
    languageId = languageId.replace(/react$/, '');
    let str = body.replace(/\$\d+/g, '').replace(/\$\{\d+(?::([^{]+))?\}/, '$1');
    str = '``` ' + languageId + '\n' + str + '\n' + '```';
    return str;
}
exports.getSnippetDocumentation = getSnippetDocumentation;
function getValidWord(text, invalidChars) {
    if (!text)
        return '';
    for (let i = 0; i < text.length; i++) {
        let c = text[i];
        if (invalidChars.indexOf(c) !== -1) {
            return text.slice(0, i);
        }
    }
    return text;
}
exports.getValidWord = getValidWord;
//# sourceMappingURL=complete.js.map