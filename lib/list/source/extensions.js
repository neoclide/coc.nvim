"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const extensions_1 = tslib_1.__importDefault(require("../../extensions"));
const basic_1 = tslib_1.__importDefault(require("../basic"));
const os_1 = tslib_1.__importDefault(require("os"));
const util_1 = require("../../util");
const logger = require('../../util/logger')('list-extensions');
class ExtensionList extends basic_1.default {
    constructor(nvim) {
        super(nvim);
        this.defaultAction = 'toggle';
        this.description = 'manage coc extensions';
        this.name = 'extensions';
        this.addAction('toggle', async (item) => {
            let { id, state } = item.data;
            if (state == 'disabled')
                return;
            if (state == 'activated') {
                extensions_1.default.deactivate(id);
            }
            else {
                extensions_1.default.activate(id);
            }
            await util_1.wait(100);
        }, { persist: true, reload: true, parallel: true });
        this.addAction('disable', async (item) => {
            let { id, state } = item.data;
            if (state !== 'disabled')
                await extensions_1.default.toggleExtension(id);
        }, { persist: true, reload: true, parallel: true });
        this.addAction('enable', async (item) => {
            let { id, state } = item.data;
            if (state == 'disabled')
                await extensions_1.default.toggleExtension(id);
        }, { persist: true, reload: true, parallel: true });
        this.addAction('open', async (item) => {
            let { root } = item.data;
            let escaped = await nvim.call('fnameescape', root);
            if (process.platform === 'darwin') {
                nvim.call('coc#util#iterm_open', [escaped], true);
            }
            else {
                await nvim.command(`lcd ${escaped}`);
                nvim.command('terminal', true);
            }
        });
        this.addAction('reload', async (item) => {
            let { id, state } = item.data;
            if (state == 'disabled')
                return;
            if (state == 'activated') {
                extensions_1.default.deactivate(id);
            }
            extensions_1.default.activate(id);
            await util_1.wait(100);
        }, { persist: true, reload: true });
        this.addAction('uninstall', async (item) => {
            let { id, isLocal } = item.data;
            if (isLocal) {
                util_1.echoWarning(nvim, 'Unable to uninstall extension loaded from &rtp.');
                return;
            }
            extensions_1.default.uninstallExtension([id]).catch(e => {
                logger.error(e);
            });
        });
    }
    async loadItems(_context) {
        let items = [];
        let list = await extensions_1.default.getExtensionStates();
        for (let stat of list) {
            let prefix = '+';
            if (stat.state == 'disabled') {
                prefix = '-';
            }
            else if (stat.state == 'activated') {
                prefix = '*';
            }
            else if (stat.state == 'unknown') {
                prefix = '?';
            }
            let root = await this.nvim.call('resolve', stat.root);
            items.push({
                label: `${prefix} ${stat.id}\t${stat.isLocal ? '[RTP]\t' : ''}${stat.version}\t${root.replace(os_1.default.homedir(), '~')}`,
                filterText: stat.id,
                data: {
                    id: stat.id,
                    root,
                    state: stat.state,
                    isLocal: stat.isLocal,
                    priority: getPriority(stat.state)
                }
            });
        }
        items.sort((a, b) => {
            if (a.data.priority != b.data.priority) {
                return b.data.priority - a.data.priority;
            }
            return b.data.id - a.data.id ? 1 : -1;
        });
        return items;
    }
    doHighlight() {
        let { nvim } = this;
        nvim.pauseNotification();
        nvim.command('syntax match CocExtensionsActivited /\\v^\\*/ contained containedin=CocExtensionsLine', true);
        nvim.command('syntax match CocExtensionsLoaded /\\v^\\+/ contained containedin=CocExtensionsLine', true);
        nvim.command('syntax match CocExtensionsDisabled /\\v^-/ contained containedin=CocExtensionsLine', true);
        nvim.command('syntax match CocExtensionsName /\\v%3c\\S+/ contained containedin=CocExtensionsLine', true);
        nvim.command('syntax match CocExtensionsRoot /\\v\\t[^\\t]*$/ contained containedin=CocExtensionsLine', true);
        nvim.command('syntax match CocExtensionsLocal /\\v\\[RTP\\]/ contained containedin=CocExtensionsLine', true);
        nvim.command('highlight default link CocExtensionsActivited Special', true);
        nvim.command('highlight default link CocExtensionsLoaded Normal', true);
        nvim.command('highlight default link CocExtensionsDisabled Comment', true);
        nvim.command('highlight default link CocExtensionsName String', true);
        nvim.command('highlight default link CocExtensionsLocal MoreMsg', true);
        nvim.command('highlight default link CocExtensionsRoot Comment', true);
        nvim.resumeNotification().catch(_e => {
            // noop
        });
    }
}
exports.default = ExtensionList;
function getPriority(stat) {
    switch (stat) {
        case 'unknown':
            return 2;
        case 'activated':
            return 1;
        case 'disabled':
            return -1;
        default:
            return 0;
    }
}
//# sourceMappingURL=extensions.js.map