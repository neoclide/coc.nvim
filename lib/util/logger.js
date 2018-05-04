"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const winston = require("winston");
const os = require("os");
const path = require("path");
const transports = [];
const level = process.env.NVIM_COMPLETE_LOG_LEVEL || 'info';
const file = process.env.NVIM_COMPLETE_LOG_FILE || path.join(os.tmpdir(), 'nvim-complete.log');
transports.push(new winston.transports.File({
    filename: file,
    level,
    json: false,
}));
// transports.push(winston.transports.Console)
const logger = new winston.Logger({
    level,
    transports,
});
exports.logger = logger;
//# sourceMappingURL=logger.js.map