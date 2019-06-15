"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const basic_1 = tslib_1.__importDefault(require("../basic"));
const mru_1 = tslib_1.__importDefault(require("../../model/mru"));
class LinksList extends basic_1.default {
    constructor(nvim, listMap) {
        super(nvim);
        this.listMap = listMap;
        this.name = 'lists';
        this.defaultAction = 'open';
        this.description = 'registed lists of coc.nvim';
        this.mru = new mru_1.default('lists');
        this.addAction('open', async (item) => {
            let { name } = item.data;
            await this.mru.add(name);
            await nvim.command(`CocList ${name}`);
        });
    }
    async loadItems(_context) {
        let items = [];
        let mruList = await this.mru.load();
        for (let list of this.listMap.values()) {
            if (list.name == 'lists')
                continue;
            items.push({
                label: `${list.name}\t${list.description || ''}`,
                data: {
                    name: list.name,
                    interactive: list.interactive,
                    score: score(mruList, list.name)
                }
            });
        }
        items.sort((a, b) => {
            return b.data.score - a.data.score;
        });
        return items;
    }
    doHighlight() {
        let { nvim } = this;
        nvim.pauseNotification();
        nvim.command('syntax match CocListsDesc /\\t.*$/ contained containedin=CocListsLine', true);
        nvim.command('highlight default link CocListsDesc Comment', true);
        nvim.resumeNotification().catch(_e => {
            // noop
        });
    }
}
exports.default = LinksList;
function score(list, key) {
    let idx = list.indexOf(key);
    return idx == -1 ? -1 : list.length - idx;
}
//# sourceMappingURL=lists.js.map