"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const httpService_1 = require("../../model/httpService");
const source_1 = require("../../model/source");
const buffers_1 = require("../../buffers");
const util_1 = require("../../util");
const fs_1 = require("../../util/fs");
const which = require("which");
const pify = require("pify");
const fs = require("fs");
const path = require("path");
const logger = require('../../util/logger')('source-sourcekitten');
class SourceKitten extends source_1.default {
    constructor(nvim) {
        super(nvim, {
            name: 'sourcekitten',
            shortcut: 'SKT',
            priority: 8,
            filetypes: ['swift'],
            command: 'SourceKittenDaemon',
        });
        this.disabled = false;
    }
    onInit() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { command } = this.config;
            if (command === 'SourceKittenDaemon') {
                try {
                    which.sync('SourceKittenDaemon');
                }
                catch (e) {
                    yield util_1.echoWarning(this.nvim, 'Could not find SourceKittenDaemon in $PATH');
                    this.disabled = true;
                    return;
                }
            }
            let port = this.port = 5588;
            // await getPort()
            let filepath = yield this.nvim.call('expand', ['%:p']);
            let projectRoot = yield this.findProjectRoot(filepath);
            this.root = path.dirname(projectRoot);
            if (!projectRoot) {
                yield util_1.echoWarning(this.nvim, 'Could not find project root for SourceKittenDaemon');
                return;
            }
            this.service = new httpService_1.default(command, ['start', '--port', port + '', '--project', projectRoot]);
            // this.service.start()
            logger.info('starting sourcekitten daemon');
        });
    }
    findProjectRoot(filepath) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let dirs = fs_1.getParentDirs(filepath);
            for (let dir of dirs) {
                let files = yield pify(fs.readdir)(dir);
                let file = files.find(f => f.endsWith('xcodeproj'));
                if (file)
                    return path.join(dir, file);
            }
            return null;
        });
    }
    shouldComplete(opt) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { filetype } = opt;
            if (!this.checkFileType(filetype) || this.disabled)
                return false;
            // if (!this.service || !this.service.isRunnning) {
            //   await this.onInit()
            // }
            return true;
        });
    }
    doComplete(opt) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { id, bufnr, filepath, linenr, col, input } = opt;
            let { nvim, menu, port } = this;
            let { document } = buffers_1.default;
            let offset = document.getOffset(linenr, col);
            if (input.length) {
                // limit result
                col = col + 1;
            }
            let tmpfname = yield fs_1.createTmpFile(document.content);
            let output = yield this.service.request({
                port,
                path: '/complete',
                method: 'GET',
                headers: {
                    'X-Offset': offset + '',
                    'X-Path': tmpfname,
                    'X-File': path.relative(this.root, filepath)
                }
            });
            // let res = JSON.parse(output)
            // logger.debug(JSON.stringify(res))
            let items = [];
            return {
                items: items.map(item => {
                    return Object.assign({}, item, { menu: item.menu ? `${item.menu} ${menu}` : menu });
                })
            };
        });
    }
}
exports.default = SourceKitten;
//# sourceMappingURL=sourcekitten.js.map