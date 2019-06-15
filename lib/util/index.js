"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const path_1 = tslib_1.__importStar(require("path"));
const child_process_1 = require("child_process");
const debounce_1 = tslib_1.__importDefault(require("debounce"));
const fs_1 = tslib_1.__importDefault(require("fs"));
const vscode_languageserver_protocol_1 = require("vscode-languageserver-protocol");
const vscode_uri_1 = require("vscode-uri");
const which_1 = tslib_1.__importDefault(require("which"));
const platform = tslib_1.__importStar(require("./platform"));
exports.platform = platform;
const isuri_1 = tslib_1.__importDefault(require("isuri"));
const logger = require('./logger')('util-index');
const prefix = '[coc.nvim] ';
function escapeSingleQuote(str) {
    return str.replace(/'/g, "''");
}
exports.escapeSingleQuote = escapeSingleQuote;
function echoErr(nvim, msg) {
    echoMsg(nvim, prefix + msg, 'Error'); // tslint:disable-line
}
exports.echoErr = echoErr;
function echoWarning(nvim, msg) {
    echoMsg(nvim, prefix + msg, 'WarningMsg'); // tslint:disable-line
}
exports.echoWarning = echoWarning;
function echoMessage(nvim, msg) {
    echoMsg(nvim, prefix + msg, 'MoreMsg'); // tslint:disable-line
}
exports.echoMessage = echoMessage;
function wait(ms) {
    return new Promise(resolve => {
        setTimeout(() => {
            resolve();
        }, ms);
    });
}
exports.wait = wait;
function echoMsg(nvim, msg, hl) {
    nvim.callTimer('coc#util#echo_messages', [hl, msg.split('\n')], true);
}
function getUri(fullpath, id, buftype) {
    if (!fullpath)
        return `untitled:${id}`;
    if (platform.isWindows)
        fullpath = path_1.default.win32.normalize(fullpath);
    if (path_1.default.isAbsolute(fullpath))
        return vscode_uri_1.URI.file(fullpath).toString();
    if (isuri_1.default.isValid(fullpath))
        return vscode_uri_1.URI.parse(fullpath).toString();
    if (buftype != '')
        return `${buftype}:${id}`;
    return `unknown:${id}`;
}
exports.getUri = getUri;
function disposeAll(disposables) {
    while (disposables.length) {
        const item = disposables.pop();
        if (item) {
            item.dispose();
        }
    }
}
exports.disposeAll = disposeAll;
function executable(command) {
    try {
        which_1.default.sync(command);
    }
    catch (e) {
        return false;
    }
    return true;
}
exports.executable = executable;
function runCommand(cmd, opts = {}, timeout) {
    return new Promise((resolve, reject) => {
        let timer;
        if (timeout) {
            timer = setTimeout(() => {
                reject(new Error(`timeout after ${timeout}s`));
            }, timeout * 1000);
        }
        child_process_1.exec(cmd, opts, (err, stdout, stderr) => {
            if (timer)
                clearTimeout(timer);
            if (err) {
                reject(new Error(`exited with ${err.code}\n${stderr}`));
                return;
            }
            resolve(stdout);
        });
    });
}
exports.runCommand = runCommand;
function watchFile(filepath, onChange) {
    let callback = debounce_1.default(onChange, 100);
    try {
        let watcher = fs_1.default.watch(filepath, {
            persistent: true,
            recursive: false,
            encoding: 'utf8'
        }, () => {
            callback();
        });
        return vscode_languageserver_protocol_1.Disposable.create(() => {
            watcher.close();
        });
    }
    catch (e) {
        return vscode_languageserver_protocol_1.Disposable.create(() => {
            // noop
        });
    }
}
exports.watchFile = watchFile;
function isRunning(pid) {
    try {
        let res = process.kill(pid, 0);
        return res == true;
    }
    catch (e) {
        return e.code === 'EPERM';
    }
}
exports.isRunning = isRunning;
function getKeymapModifier(mode) {
    if (mode == 'n' || mode == 'v')
        return '';
    if (mode == 'i')
        return '<C-o>';
    if (mode == 's' || mode == 'x')
        return '<Esc>';
    return '';
}
exports.getKeymapModifier = getKeymapModifier;
async function mkdirp(path, mode) {
    const mkdir = async () => {
        try {
            await nfcall(fs_1.default.mkdir, path, mode);
        }
        catch (err) {
            if (err.code === 'EEXIST') {
                const stat = await nfcall(fs_1.default.stat, path);
                if (stat.isDirectory) {
                    return;
                }
                throw new Error(`'${path}' exists and is not a directory.`);
            }
            throw err;
        }
    };
    // is root?
    if (path === path_1.dirname(path)) {
        return true;
    }
    try {
        await mkdir();
    }
    catch (err) {
        if (err.code !== 'ENOENT') {
            throw err;
        }
        await mkdirp(path_1.dirname(path), mode);
        await mkdir();
    }
    return true;
}
exports.mkdirp = mkdirp;
function nfcall(fn, ...args) {
    return new Promise((c, e) => fn(...args, (err, r) => err ? e(err) : c(r)));
}
// consider textDocument without version to be valid
function isDocumentEdit(edit) {
    if (edit == null)
        return false;
    if (!vscode_languageserver_protocol_1.TextDocumentIdentifier.is(edit.textDocument))
        return false;
    if (!Array.isArray(edit.edits))
        return false;
    return true;
}
exports.isDocumentEdit = isDocumentEdit;
//# sourceMappingURL=index.js.map