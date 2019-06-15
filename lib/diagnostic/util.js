"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vscode_languageserver_protocol_1 = require("vscode-languageserver-protocol");
function getSeverityName(severity) {
    switch (severity) {
        case vscode_languageserver_protocol_1.DiagnosticSeverity.Error:
            return 'Error';
        case vscode_languageserver_protocol_1.DiagnosticSeverity.Warning:
            return 'Warning';
        case vscode_languageserver_protocol_1.DiagnosticSeverity.Information:
            return 'Information';
        case vscode_languageserver_protocol_1.DiagnosticSeverity.Hint:
            return 'Hint';
        default:
            return 'Error';
    }
}
exports.getSeverityName = getSeverityName;
function getSeverityType(severity) {
    switch (severity) {
        case vscode_languageserver_protocol_1.DiagnosticSeverity.Error:
            return 'E';
        case vscode_languageserver_protocol_1.DiagnosticSeverity.Warning:
            return 'W';
        case vscode_languageserver_protocol_1.DiagnosticSeverity.Information:
            return 'I';
        case vscode_languageserver_protocol_1.DiagnosticSeverity.Hint:
            return 'I';
        default:
            return 'Error';
    }
}
exports.getSeverityType = getSeverityType;
function severityLevel(level) {
    switch (level) {
        case 'hint':
            return vscode_languageserver_protocol_1.DiagnosticSeverity.Hint;
        case 'information':
            return vscode_languageserver_protocol_1.DiagnosticSeverity.Information;
        case 'warning':
            return vscode_languageserver_protocol_1.DiagnosticSeverity.Warning;
        case 'error':
            return vscode_languageserver_protocol_1.DiagnosticSeverity.Error;
        default:
            return vscode_languageserver_protocol_1.DiagnosticSeverity.Hint;
    }
}
exports.severityLevel = severityLevel;
function getNameFromSeverity(severity) {
    switch (severity) {
        case vscode_languageserver_protocol_1.DiagnosticSeverity.Error:
            return 'CocError';
        case vscode_languageserver_protocol_1.DiagnosticSeverity.Warning:
            return 'CocWarning';
        case vscode_languageserver_protocol_1.DiagnosticSeverity.Information:
            return 'CocInfo';
        case vscode_languageserver_protocol_1.DiagnosticSeverity.Hint:
            return 'CocHint';
        default:
            return 'CocError';
    }
}
exports.getNameFromSeverity = getNameFromSeverity;
function getLocationListItem(owner, bufnr, diagnostic) {
    let { start } = diagnostic.range;
    let msg = diagnostic.message.split('\n')[0];
    let type = getSeverityName(diagnostic.severity).slice(0, 1).toUpperCase();
    return {
        bufnr,
        lnum: start.line + 1,
        col: start.character + 1,
        text: `[${owner}${diagnostic.code ? ' ' + diagnostic.code : ''}] ${msg} [${type}]`,
        type
    };
}
exports.getLocationListItem = getLocationListItem;
//# sourceMappingURL=util.js.map