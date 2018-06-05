"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const logger = require('../util/logger')('vscode-errors');
const canceledName = 'Canceled';
/**
 * Checks if the given error is a promise in canceled state
 */
function isPromiseCanceledError(error) {
    return error instanceof Error && error.name === canceledName && error.message === canceledName;
}
exports.isPromiseCanceledError = isPromiseCanceledError;
function onUnexpectedError(e) {
    // ignore errors from cancelled promises
    if (!isPromiseCanceledError(e)) {
        logger.error(e.stack);
    }
    return undefined;
}
exports.onUnexpectedError = onUnexpectedError;
//# sourceMappingURL=errors.js.map