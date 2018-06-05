"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const string_1 = require("../../util/string");
// resolve for `require('/xxx')` `import from '/xxx'`
function shouldResolve(opt) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        let { line, col } = opt;
        let start = string_1.byteSlice(line, 0, col);
        if (/src=['"]\/$/.test(start))
            return true;
        return false;
    });
}
exports.shouldResolve = shouldResolve;
//# sourceMappingURL=wxml.js.map