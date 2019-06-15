const logger = require('./logger')('extensions');
/**
 * Explicitly tells that promise should be run asynchonously.
 */
Promise.prototype.logError = function () {
    // tslint:disable-next-line:no-empty
    this.catch(e => {
        logger.error(e);
    });
};
//# sourceMappingURL=extensions.js.map