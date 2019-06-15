"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var PatternType;
(function (PatternType) {
    PatternType[PatternType["Buffer"] = 0] = "Buffer";
    PatternType[PatternType["LanguageServer"] = 1] = "LanguageServer";
    PatternType[PatternType["Global"] = 2] = "Global";
})(PatternType = exports.PatternType || (exports.PatternType = {}));
var SourceType;
(function (SourceType) {
    SourceType[SourceType["Native"] = 0] = "Native";
    SourceType[SourceType["Remote"] = 1] = "Remote";
    SourceType[SourceType["Service"] = 2] = "Service";
})(SourceType = exports.SourceType || (exports.SourceType = {}));
var MessageLevel;
(function (MessageLevel) {
    MessageLevel[MessageLevel["More"] = 0] = "More";
    MessageLevel[MessageLevel["Warning"] = 1] = "Warning";
    MessageLevel[MessageLevel["Error"] = 2] = "Error";
})(MessageLevel = exports.MessageLevel || (exports.MessageLevel = {}));
var ConfigurationTarget;
(function (ConfigurationTarget) {
    ConfigurationTarget[ConfigurationTarget["Global"] = 0] = "Global";
    ConfigurationTarget[ConfigurationTarget["User"] = 1] = "User";
    ConfigurationTarget[ConfigurationTarget["Workspace"] = 2] = "Workspace";
})(ConfigurationTarget = exports.ConfigurationTarget || (exports.ConfigurationTarget = {}));
var DiagnosticKind;
(function (DiagnosticKind) {
    DiagnosticKind[DiagnosticKind["Syntax"] = 0] = "Syntax";
    DiagnosticKind[DiagnosticKind["Semantic"] = 1] = "Semantic";
    DiagnosticKind[DiagnosticKind["Suggestion"] = 2] = "Suggestion";
})(DiagnosticKind = exports.DiagnosticKind || (exports.DiagnosticKind = {}));
var ServiceStat;
(function (ServiceStat) {
    ServiceStat[ServiceStat["Initial"] = 0] = "Initial";
    ServiceStat[ServiceStat["Starting"] = 1] = "Starting";
    ServiceStat[ServiceStat["StartFailed"] = 2] = "StartFailed";
    ServiceStat[ServiceStat["Running"] = 3] = "Running";
    ServiceStat[ServiceStat["Stopping"] = 4] = "Stopping";
    ServiceStat[ServiceStat["Stopped"] = 5] = "Stopped";
})(ServiceStat = exports.ServiceStat || (exports.ServiceStat = {}));
//# sourceMappingURL=types.js.map