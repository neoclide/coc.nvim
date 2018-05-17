"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
// resolve for `require('/xxx')` `import from '/xxx'`
function shouldResolve(opt) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        let { line, colnr } = opt;
        let end = line.slice(colnr - 1);
        if (!/(['"]\))?;?$/.test(end))
            return false;
        let start = line.slice(0, colnr - 1);
        if (/require\(['"]\/[^\/\s]+$/.test(start))
            return true;
        if (/^import/.test(line) && /from\s+['"]\/[^\/\s]+$/.test(start))
            return true;
        return false;
    });
}
exports.shouldResolve = shouldResolve;
//# sourceMappingURL=javascript.js.map