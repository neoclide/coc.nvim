"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const vscode_languageserver_types_1 = require("vscode-languageserver-types");
const vscode_uri_1 = require("vscode-uri");
const sources_1 = tslib_1.__importDefault(require("../../sources"));
const basic_1 = tslib_1.__importDefault(require("../basic"));
class SourcesList extends basic_1.default {
    constructor(nvim) {
        super(nvim);
        this.defaultAction = 'toggle';
        this.description = 'registed completion sources';
        this.name = 'sources';
        this.addAction('toggle', async (item) => {
            let { name } = item.data;
            sources_1.default.toggleSource(name);
        }, { persist: true, reload: true });
        this.addAction('refresh', async (item) => {
            let { name } = item.data;
            await sources_1.default.refresh(name);
        }, { persist: true, reload: true });
        this.addAction('open', async (item) => {
            let { location } = item;
            if (location)
                await this.jumpTo(location);
        });
    }
    async loadItems(_context) {
        let stats = sources_1.default.sourceStats();
        stats.sort((a, b) => {
            if (a.type != b.type)
                return a.type < b.type ? 1 : -1;
            return a.name > b.name ? -1 : 1;
        });
        return stats.map(stat => {
            let prefix = stat.disabled ? ' ' : '*';
            let location;
            if (stat.filepath) {
                location = vscode_languageserver_types_1.Location.create(vscode_uri_1.URI.file(stat.filepath).toString(), vscode_languageserver_types_1.Range.create(0, 0, 0, 0));
            }
            return {
                label: `${prefix}\t${stat.name}\t[${stat.shortcut}]\t${stat.filetypes.join(',')}`,
                location,
                data: { name: stat.name }
            };
        });
    }
    doHighlight() {
        let { nvim } = this;
        nvim.pauseNotification();
        nvim.command('syntax match CocSourcesPrefix /\\v^./ contained containedin=CocSourcesLine', true);
        nvim.command('syntax match CocSourcesName /\\v%3c\\S+/ contained containedin=CocSourcesLine', true);
        nvim.command('syntax match CocSourcesType /\\v\\t\\[\\w+\\]/ contained containedin=CocSourcesLine', true);
        nvim.command('syntax match CocSourcesFileTypes /\\v\\S+$/ contained containedin=CocSourcesLine', true);
        nvim.command('highlight default link CocSourcesPrefix Special', true);
        nvim.command('highlight default link CocSourcesName Type', true);
        nvim.command('highlight default link CocSourcesFileTypes Comment', true);
        nvim.command('highlight default link CocSourcesType Statement', true);
        nvim.resumeNotification().catch(_e => {
            // noop
        });
    }
}
exports.default = SourcesList;
//# sourceMappingURL=sources.js.map