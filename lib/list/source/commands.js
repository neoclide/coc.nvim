"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const commands_1 = tslib_1.__importDefault(require("../../commands"));
const events_1 = tslib_1.__importDefault(require("../../events"));
const workspace_1 = tslib_1.__importDefault(require("../../workspace"));
const basic_1 = tslib_1.__importDefault(require("../basic"));
class CommandsList extends basic_1.default {
    constructor(nvim) {
        super(nvim);
        this.defaultAction = 'run';
        this.description = 'registed commands of coc.nvim';
        this.name = 'commands';
        this.mru = workspace_1.default.createMru('commands');
        this.addAction('run', async (item) => {
            let { cmd } = item.data;
            await events_1.default.fire('Command', [cmd]);
            await commands_1.default.executeCommand(cmd);
            await this.mru.add(cmd);
            await nvim.command(`silent! call repeat#set("\\<Plug>(coc-command-repeat)", -1)`);
        });
    }
    async loadItems(_context) {
        let items = [];
        let list = commands_1.default.commandList;
        let { titles } = commands_1.default;
        let mruList = await this.mru.load();
        for (let key of titles.keys()) {
            items.push({
                label: `${key}\t${titles.get(key)}`,
                filterText: key,
                data: { cmd: key, score: score(mruList, key) }
            });
        }
        for (let o of list) {
            let { id } = o;
            if (!titles.has(id)) {
                items.push({
                    label: id,
                    filterText: id,
                    data: { cmd: id, score: score(mruList, id) }
                });
            }
        }
        items.sort((a, b) => {
            return b.data.score - a.data.score;
        });
        return items;
    }
    doHighlight() {
        let { nvim } = this;
        nvim.pauseNotification();
        nvim.command('syntax match CocCommandsTitle /\\t.*$/ contained containedin=CocCommandsLine', true);
        nvim.command('highlight default link CocCommandsTitle Comment', true);
        nvim.resumeNotification().catch(_e => {
            // noop
        });
    }
}
exports.default = CommandsList;
function score(list, key) {
    let idx = list.indexOf(key);
    return idx == -1 ? -1 : list.length - idx;
}
//# sourceMappingURL=commands.js.map