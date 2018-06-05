"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.typescript = 'typescript';
exports.typescriptreact = 'typescriptreact';
exports.javascript = 'javascript';
exports.javascriptreact = 'javascriptreact';
exports.jsxTags = 'jsx-tags';
function isSupportedLanguageMode(doc) {
    return [exports.typescript, exports.typescriptreact, exports.javascript, exports.javascriptreact].indexOf(doc.languageId) != -1;
}
exports.isSupportedLanguageMode = isSupportedLanguageMode;
//# sourceMappingURL=languageModeIds.js.map