"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const pify = require("pify");
const fs = require("fs");
function statAsync(filepath) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        let stat = null;
        try {
            stat = yield pify(fs.stat)(filepath);
        }
        catch (e) { } // tslint:disable-line
        return stat;
    });
}
exports.statAsync = statAsync;
//# sourceMappingURL=fs.js.map