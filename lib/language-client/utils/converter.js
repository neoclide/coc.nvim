"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const lodash_1 = require("../../util/lodash");
function asLanguageIds(documentSelector) {
    let res = documentSelector.map(filter => {
        if (typeof filter == 'string') {
            return filter;
        }
        return filter.language;
    });
    res = res.filter(s => s != null);
    return res.length == 0 ? null : res;
}
exports.asLanguageIds = asLanguageIds;
function convertToTextDocumentItem(document) {
    return {
        uri: document.uri,
        languageId: document.languageId,
        version: document.version,
        text: document.getText()
    };
}
exports.convertToTextDocumentItem = convertToTextDocumentItem;
function asCloseTextDocumentParams(document) {
    return {
        textDocument: {
            uri: document.uri
        }
    };
}
exports.asCloseTextDocumentParams = asCloseTextDocumentParams;
function asChangeTextDocumentParams(document) {
    let result = {
        textDocument: {
            uri: document.uri,
            version: document.version
        },
        contentChanges: [{ text: document.getText() }]
    };
    return result;
}
exports.asChangeTextDocumentParams = asChangeTextDocumentParams;
function asWillSaveTextDocumentParams(event) {
    return {
        textDocument: asVersionedTextDocumentIdentifier(event.document),
        reason: event.reason
    };
}
exports.asWillSaveTextDocumentParams = asWillSaveTextDocumentParams;
function asVersionedTextDocumentIdentifier(textDocument) {
    return {
        uri: textDocument.uri,
        version: textDocument.version
    };
}
exports.asVersionedTextDocumentIdentifier = asVersionedTextDocumentIdentifier;
function asSaveTextDocumentParams(document, includeText) {
    let result = {
        textDocument: asVersionedTextDocumentIdentifier(document)
    };
    if (includeText) {
        result.text = document.getText();
    }
    return result;
}
exports.asSaveTextDocumentParams = asSaveTextDocumentParams;
function asUri(resource) {
    return resource.toString();
}
exports.asUri = asUri;
function asCompletionParams(textDocument, position, context) {
    return {
        textDocument: {
            uri: textDocument.uri,
        },
        position,
        context: lodash_1.omit(context, ['option']),
    };
}
exports.asCompletionParams = asCompletionParams;
function asTextDocumentPositionParams(textDocument, position) {
    return {
        textDocument: {
            uri: textDocument.uri,
        },
        position
    };
}
exports.asTextDocumentPositionParams = asTextDocumentPositionParams;
function asTextDocumentIdentifier(textDocument) {
    return {
        uri: textDocument.uri
    };
}
exports.asTextDocumentIdentifier = asTextDocumentIdentifier;
function asReferenceParams(textDocument, position, options) {
    return {
        textDocument: {
            uri: textDocument.uri,
        },
        position,
        context: { includeDeclaration: options.includeDeclaration }
    };
}
exports.asReferenceParams = asReferenceParams;
function asDocumentSymbolParams(textDocument) {
    return {
        textDocument: {
            uri: textDocument.uri
        }
    };
}
exports.asDocumentSymbolParams = asDocumentSymbolParams;
function asCodeLensParams(textDocument) {
    return {
        textDocument: {
            uri: textDocument.uri
        }
    };
}
exports.asCodeLensParams = asCodeLensParams;
//# sourceMappingURL=converter.js.map