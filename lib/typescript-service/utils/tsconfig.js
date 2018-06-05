"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function inferredProjectConfig(config) {
    const base = {
        module: 'commonjs',
        target: 'es2016',
        jsx: 'preserve'
    };
    if (config.checkJs) {
        base.checkJs = true;
    }
    if (config.experimentalDecorators) {
        base.experimentalDecorators = true;
    }
    return base;
}
exports.inferredProjectConfig = inferredProjectConfig;
//# sourceMappingURL=tsconfig.js.map