"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const neovim_1 = require("@chemzqm/neovim");
const cp = tslib_1.__importStar(require("child_process"));
const crypto_1 = require("crypto");
const workspace_1 = tslib_1.__importDefault(require("../workspace"));
const path_1 = tslib_1.__importDefault(require("path"));
const lodash_1 = require("./lodash");
const os_1 = tslib_1.__importDefault(require("os"));
const fs_1 = tslib_1.__importDefault(require("fs"));
const string_1 = require("./string");
const processes_1 = require("./processes");
const uuid = require("uuid/v4");
const logger = require('./logger')('util-highlights');
const diagnosticFiletypes = ['Error', 'Warning', 'Info', 'Hint'];
const cache = {};
let env = null;
// get highlights by send text to another neovim instance.
function getHiglights(lines, filetype) {
    const hlMap = new Map();
    const content = lines.join('\n');
    if (diagnosticFiletypes.indexOf(filetype) != -1) {
        let highlights = lines.map((line, i) => {
            return {
                line: i,
                colStart: 0,
                colEnd: string_1.byteLength(line),
                hlGroup: `Coc${filetype}Float`
            };
        });
        return Promise.resolve(highlights);
    }
    if (filetype == 'javascriptreact') {
        filetype = 'javascript';
    }
    if (filetype == 'typescriptreact') {
        filetype = 'typescript';
    }
    const id = crypto_1.createHash('md5').update(content).digest('hex');
    if (cache[id])
        return Promise.resolve(cache[id]);
    if (workspace_1.default.env.isVim)
        return Promise.resolve([]);
    const res = [];
    let nvim;
    return new Promise(async (resolve) => {
        if (!env) {
            env = await workspace_1.default.nvim.call('coc#util#highlight_options');
            if (!env)
                resolve([]);
            let paths = env.runtimepath.split(',');
            let dirs = paths.filter(p => {
                if (env.colorscheme) {
                    let schemeFile = path_1.default.join(p, `colors/${env.colorscheme}.vim`);
                    if (fs_1.default.existsSync(schemeFile))
                        return true;
                }
                if (fs_1.default.existsSync(path_1.default.join(p, 'syntax')))
                    return true;
                if (fs_1.default.existsSync(path_1.default.join(p, 'after/syntax')))
                    return true;
                return false;
            });
            env.runtimepath = dirs.join(',');
        }
        let prog = workspace_1.default.isVim ? 'nvim' : workspace_1.default.env.progpath;
        let proc = cp.spawn(prog, ['-u', 'NORC', '-i', 'NONE', '--embed', uuid()], {
            shell: false,
            cwd: os_1.default.tmpdir(),
            env: lodash_1.omit(process.env, ['NVIM_LISTEN_ADDRESS', 'VIM_NODE_RPC'])
        });
        proc.on('error', error => {
            logger.info('highlight error:', error);
            resolve([]);
        });
        let timer;
        let exited = false;
        const exit = () => {
            if (exited)
                return;
            exited = true;
            if (timer)
                clearTimeout(timer);
            if (nvim) {
                nvim.command('qa!').catch(() => {
                    let killed = processes_1.terminate(proc);
                    if (!killed) {
                        setTimeout(() => {
                            processes_1.terminate(proc);
                        }, 50);
                    }
                });
            }
        };
        try {
            proc.once('exit', () => {
                if (exited)
                    return;
                logger.info('highlight nvim exited.');
                resolve([]);
            });
            timer = setTimeout(() => {
                exit();
                resolve([]);
            }, 500);
            nvim = neovim_1.attach({ proc }, null, false);
            const callback = (method, args) => {
                if (method == 'redraw') {
                    for (let arr of args) {
                        let [name, ...list] = arr;
                        if (name == 'hl_attr_define') {
                            for (let item of list) {
                                let id = item[0];
                                let { hi_name } = item[item.length - 1][0];
                                hlMap.set(id, hi_name);
                            }
                        }
                        if (name == 'grid_line') {
                            // logger.debug('list:', JSON.stringify(list, null, 2))
                            for (let def of list) {
                                let [, line, col, cells] = def;
                                if (line >= lines.length)
                                    continue;
                                let colStart = 0;
                                let hlGroup = '';
                                let currId = 0;
                                // tslint:disable-next-line: prefer-for-of
                                for (let i = 0; i < cells.length; i++) {
                                    let cell = cells[i];
                                    let [ch, hlId, repeat] = cell;
                                    repeat = repeat || 1;
                                    let len = string_1.byteLength(ch.repeat(repeat));
                                    // append result
                                    if (hlId == 0 || (hlId > 0 && hlId != currId)) {
                                        if (hlGroup) {
                                            res.push({
                                                line,
                                                hlGroup,
                                                colStart,
                                                colEnd: col,
                                                isMarkdown: filetype == 'markdown'
                                            });
                                        }
                                        colStart = col;
                                        hlGroup = hlId == 0 ? '' : hlMap.get(hlId);
                                    }
                                    if (hlId != null)
                                        currId = hlId;
                                    col = col + len;
                                }
                                if (hlGroup) {
                                    res.push({
                                        hlGroup,
                                        line,
                                        colStart,
                                        colEnd: col,
                                        isMarkdown: filetype == 'markdown'
                                    });
                                }
                            }
                            cache[id] = res;
                            exit();
                            resolve(res);
                        }
                    }
                }
            };
            nvim.on('notification', callback);
            await nvim.callAtomic([
                ['nvim_set_option', ['runtimepath', env.runtimepath]],
                ['nvim_command', [`runtime syntax/${filetype}.vim`]],
                ['nvim_command', [`colorscheme ${env.colorscheme || 'default'}`]],
                ['nvim_command', [`set background=${env.background}`]],
                ['nvim_command', ['set nowrap']],
                ['nvim_command', ['set noswapfile']],
                ['nvim_command', ['set nobackup']],
                ['nvim_command', ['set noshowmode']],
                ['nvim_command', ['set noruler']],
                ['nvim_command', ['set laststatus=0']],
            ]);
            let buf = await nvim.buffer;
            await buf.setLines(lines, { start: 0, end: -1, strictIndexing: false });
            await buf.setOption('filetype', filetype);
            await nvim.uiAttach(200, lines.length + 1, {
                ext_hlstate: true,
                ext_linegrid: true
            });
        }
        catch (e) {
            logger.error(e);
            exit();
            resolve([]);
        }
    });
}
exports.getHiglights = getHiglights;
//# sourceMappingURL=highlight.js.map