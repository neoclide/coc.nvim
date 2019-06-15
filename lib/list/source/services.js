"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const services_1 = tslib_1.__importDefault(require("../../services"));
const basic_1 = tslib_1.__importDefault(require("../basic"));
const util_1 = require("../../util");
class ServicesList extends basic_1.default {
    constructor(nvim) {
        super(nvim);
        this.defaultAction = 'toggle';
        this.description = 'registed services of coc.nvim';
        this.name = 'services';
        this.addAction('toggle', async (item) => {
            let { id } = item.data;
            await services_1.default.toggle(id);
            await util_1.wait(100);
        }, { persist: true, reload: true });
    }
    async loadItems(_context) {
        let stats = services_1.default.getServiceStats();
        stats.sort((a, b) => {
            return a.id > b.id ? -1 : 1;
        });
        return stats.map(stat => {
            let prefix = stat.state == 'running' ? '*' : ' ';
            return {
                label: `${prefix}\t${stat.id}\t[${stat.state}]\t${stat.languageIds.join(', ')}`,
                data: { id: stat.id }
            };
        });
    }
    doHighlight() {
        let { nvim } = this;
        nvim.pauseNotification();
        nvim.command('syntax match CocServicesPrefix /\\v^./ contained containedin=CocServicesLine', true);
        nvim.command('syntax match CocServicesName /\\v%3c\\S+/ contained containedin=CocServicesLine', true);
        nvim.command('syntax match CocServicesStat /\\v\\t\\[\\w+\\]/ contained containedin=CocServicesLine', true);
        nvim.command('syntax match CocServicesLanguages /\\v(\\])@<=.*$/ contained containedin=CocServicesLine', true);
        nvim.command('highlight default link CocServicesPrefix Special', true);
        nvim.command('highlight default link CocServicesName Type', true);
        nvim.command('highlight default link CocServicesStat Statement', true);
        nvim.command('highlight default link CocServicesLanguages Comment', true);
        nvim.resumeNotification().catch(_e => {
            // noop
        });
    }
}
exports.default = ServicesList;
//# sourceMappingURL=services.js.map