"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const pify = require("pify");
const fs = require("fs");
function statAsync(filepath) {
    return __awaiter(this, void 0, void 0, function* () {
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