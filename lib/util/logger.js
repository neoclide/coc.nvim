"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const fs_1 = tslib_1.__importDefault(require("fs"));
const log4js_1 = tslib_1.__importDefault(require("log4js"));
const path_1 = tslib_1.__importDefault(require("path"));
const os_1 = tslib_1.__importDefault(require("os"));
function getLogFile() {
    let file = process.env.NVIM_COC_LOG_FILE;
    if (file)
        return file;
    let dir = process.env.XDG_RUNTIME_DIR;
    if (dir)
        return path_1.default.join(dir, 'coc-nvim.log');
    return path_1.default.join(os_1.default.tmpdir(), `coc-nvim-${process.pid}.log`);
}
const MAX_LOG_SIZE = 1024 * 1024;
const MAX_LOG_BACKUPS = 10;
const logfile = getLogFile();
const level = process.env.NVIM_COC_LOG_LEVEL || 'info';
if (!fs_1.default.existsSync(logfile)) {
    try {
        fs_1.default.writeFileSync(logfile, '', { encoding: 'utf8', mode: 0o666 });
    }
    catch (e) {
        // noop
    }
}
log4js_1.default.configure({
    disableClustering: true,
    appenders: {
        out: {
            type: 'file',
            mode: 0o666,
            filename: logfile,
            maxLogSize: MAX_LOG_SIZE,
            backups: MAX_LOG_BACKUPS,
            layout: {
                type: 'pattern',
                // Format log in following pattern:
                // yyyy-MM-dd HH:mm:ss.mil $Level (pid:$pid) $categroy - $message.
                pattern: `%d{ISO8601} %p (pid:${process.pid}) [%c] - %m`,
            },
        }
    },
    categories: {
        default: { appenders: ['out'], level }
    }
});
module.exports = (name = 'coc-nvim') => {
    let logger = log4js_1.default.getLogger(name);
    logger.getLogFile = getLogFile;
    return logger;
};
//# sourceMappingURL=logger.js.map