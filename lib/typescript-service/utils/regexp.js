"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function escapeRegExp(text) {
    return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}
exports.escapeRegExp = escapeRegExp;
//# sourceMappingURL=regexp.js.map