"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const uri_1 = require("./uri");
exports.Uri = uri_1.default;
const platform = require("./platform");
exports.platform = platform;
const fileSchemes = require("./fileSchemes");
exports.fileSchemes = fileSchemes;
const event_1 = require("./event");
exports.Event = event_1.Event;
exports.EventEmitter = event_1.Emitter;
var DiagnosticKind;
(function (DiagnosticKind) {
    DiagnosticKind[DiagnosticKind["Syntax"] = 0] = "Syntax";
    DiagnosticKind[DiagnosticKind["Semantic"] = 1] = "Semantic";
    DiagnosticKind[DiagnosticKind["Suggestion"] = 2] = "Suggestion";
})(DiagnosticKind = exports.DiagnosticKind || (exports.DiagnosticKind = {}));
function disposeAll(disposables) {
    while (disposables.length) {
        const item = disposables.pop();
        if (item) {
            item.dispose();
        }
    }
}
exports.disposeAll = disposeAll;
//# sourceMappingURL=index.js.map