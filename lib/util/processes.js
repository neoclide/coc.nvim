"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
const cp = tslib_1.__importStar(require("child_process"));
const path_1 = require("path");
const isWebpack = typeof __webpack_require__ === "function";
const isWindows = process.platform === 'win32';
const isMacintosh = process.platform === 'darwin';
const isLinux = process.platform === 'linux';
const pluginRoot = isWebpack ? path_1.dirname(__dirname) : path_1.resolve(__dirname, '../..');
function terminate(process, cwd) {
    if (isWindows) {
        try {
            // This we run in Atom execFileSync is available.
            // Ignore stderr since this is otherwise piped to parent.stderr
            // which might be already closed.
            let options = {
                stdio: ['pipe', 'pipe', 'ignore']
            };
            if (cwd) {
                options.cwd = cwd;
            }
            cp.execFileSync('taskkill', ['/T', '/F', '/PID', process.pid.toString()], options);
            return true;
        }
        catch (err) {
            return false;
        }
    }
    else if (isLinux || isMacintosh) {
        try {
            let cmd = path_1.join(pluginRoot, 'bin/terminateProcess.sh');
            let result = cp.spawnSync(cmd, [process.pid.toString()]);
            return result.error ? false : true;
        }
        catch (err) {
            return false;
        }
    }
    else {
        process.kill('SIGKILL');
        return true;
    }
}
exports.terminate = terminate;
//# sourceMappingURL=processes.js.map