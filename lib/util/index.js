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
function wait(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}
exports.wait = wait;
function echoErr(nvim, line) {
    return __awaiter(this, void 0, void 0, function* () {
        return yield nvim.command(`echoerr '${line.replace(/'/g, "''")}'`);
    });
}
exports.echoErr = echoErr;
function echoErrors(nvim, lines) {
    nvim.call('complete#util#print_errors', lines);
}
exports.echoErrors = echoErrors;
//# sourceMappingURL=index.js.map