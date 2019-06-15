"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vscode_languageserver_protocol_1 = require("vscode-languageserver-protocol");
function getSymbolKind(kind) {
    switch (kind) {
        case vscode_languageserver_protocol_1.SymbolKind.File:
            return 'File';
        case vscode_languageserver_protocol_1.SymbolKind.Module:
            return 'Module';
        case vscode_languageserver_protocol_1.SymbolKind.Namespace:
            return 'Namespace';
        case vscode_languageserver_protocol_1.SymbolKind.Package:
            return 'Package';
        case vscode_languageserver_protocol_1.SymbolKind.Class:
            return 'Class';
        case vscode_languageserver_protocol_1.SymbolKind.Method:
            return 'Method';
        case vscode_languageserver_protocol_1.SymbolKind.Property:
            return 'Property';
        case vscode_languageserver_protocol_1.SymbolKind.Field:
            return 'Field';
        case vscode_languageserver_protocol_1.SymbolKind.Constructor:
            return 'Constructor';
        case vscode_languageserver_protocol_1.SymbolKind.Enum:
            return 'Enum';
        case vscode_languageserver_protocol_1.SymbolKind.Interface:
            return 'Interface';
        case vscode_languageserver_protocol_1.SymbolKind.Function:
            return 'Function';
        case vscode_languageserver_protocol_1.SymbolKind.Variable:
            return 'Variable';
        case vscode_languageserver_protocol_1.SymbolKind.Constant:
            return 'Constant';
        case vscode_languageserver_protocol_1.SymbolKind.String:
            return 'String';
        case vscode_languageserver_protocol_1.SymbolKind.Number:
            return 'Number';
        case vscode_languageserver_protocol_1.SymbolKind.Boolean:
            return 'Boolean';
        case vscode_languageserver_protocol_1.SymbolKind.Array:
            return 'Array';
        case vscode_languageserver_protocol_1.SymbolKind.Object:
            return 'Object';
        case vscode_languageserver_protocol_1.SymbolKind.Key:
            return 'Key';
        case vscode_languageserver_protocol_1.SymbolKind.Null:
            return 'Null';
        case vscode_languageserver_protocol_1.SymbolKind.EnumMember:
            return 'EnumMember';
        case vscode_languageserver_protocol_1.SymbolKind.Struct:
            return 'Struct';
        case vscode_languageserver_protocol_1.SymbolKind.Event:
            return 'Event';
        case vscode_languageserver_protocol_1.SymbolKind.Operator:
            return 'Operator';
        case vscode_languageserver_protocol_1.SymbolKind.TypeParameter:
            return 'TypeParameter';
        default:
            return 'Unknown';
    }
}
exports.getSymbolKind = getSymbolKind;
//# sourceMappingURL=convert.js.map