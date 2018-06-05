"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var TsServerLogLevel;
(function (TsServerLogLevel) {
    TsServerLogLevel[TsServerLogLevel["Off"] = 0] = "Off";
    TsServerLogLevel[TsServerLogLevel["Normal"] = 1] = "Normal";
    TsServerLogLevel[TsServerLogLevel["Terse"] = 2] = "Terse";
    TsServerLogLevel[TsServerLogLevel["Verbose"] = 3] = "Verbose";
})(TsServerLogLevel = exports.TsServerLogLevel || (exports.TsServerLogLevel = {}));
(function (TsServerLogLevel) {
    function fromString(value) {
        switch (value && value.toLowerCase()) {
            case 'normal':
                return TsServerLogLevel.Normal;
            case 'terse':
                return TsServerLogLevel.Terse;
            case 'verbose':
                return TsServerLogLevel.Verbose;
            case 'off':
            default:
                return TsServerLogLevel.Off;
        }
    }
    TsServerLogLevel.fromString = fromString;
    function toString(value) {
        switch (value) {
            case TsServerLogLevel.Normal:
                return 'normal';
            case TsServerLogLevel.Terse:
                return 'terse';
            case TsServerLogLevel.Verbose:
                return 'verbose';
            case TsServerLogLevel.Off:
            default:
                return 'off';
        }
    }
    TsServerLogLevel.toString = toString;
})(TsServerLogLevel = exports.TsServerLogLevel || (exports.TsServerLogLevel = {}));
class TypeScriptServiceConfiguration {
    constructor() {
        // typescript.locale
        this.locale = null;
        // typescript.tsdk folder contains tsserver.js
        this.globalTsdk = null;
        // typescript.npmLocation
        this.npmLocation = null;
        // typescript.tsserver.logLevel
        this.tsServerLogLevel = TsServerLogLevel.fromString(process.env.TSS_LOG_LEVEL);
        // typescript.tsserver.plugin.names
        this.tsServerPluginNames = [];
        // typescript.tsserver.plugin.root
        this.tsServerPluginRoot = '';
        // typescript.implicitProjectConfig.checkJs
        this.checkJs = false;
        // typescript.implicitProjectConfig.experimentalDecorators
        this.experimentalDecorators = false;
        // typescript.disableAutomaticTypeAcquisition
        this.disableAutomaticTypeAcquisition = false;
    }
    static loadFromWorkspace() {
        return new TypeScriptServiceConfiguration();
    }
}
exports.TypeScriptServiceConfiguration = TypeScriptServiceConfiguration;
//# sourceMappingURL=configuration.js.map