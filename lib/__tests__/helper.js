"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const cp = tslib_1.__importStar(require("child_process"));
const events_1 = tslib_1.__importDefault(require("events"));
const fs_1 = tslib_1.__importDefault(require("fs"));
const os_1 = tslib_1.__importDefault(require("os"));
const path_1 = tslib_1.__importDefault(require("path"));
const util_1 = tslib_1.__importDefault(require("util"));
const attach_1 = tslib_1.__importDefault(require("../attach"));
const workspace_1 = tslib_1.__importDefault(require("../workspace"));
const uuid = require("uuid/v4");
process.on('uncaughtException', err => {
    let msg = 'Uncaught exception: ' + err.stack;
    // tslint:disable-next-line: no-console
    console.error(msg);
});
class Helper extends events_1.default {
    constructor() {
        super();
        this.setMaxListeners(99);
    }
    setup() {
        const vimrc = path_1.default.resolve(__dirname, 'vimrc');
        let proc = this.proc = cp.spawn('nvim', ['-u', vimrc, '-i', 'NONE', '--embed'], {
            cwd: __dirname
        });
        let plugin = this.plugin = attach_1.default({ proc });
        this.nvim = plugin.nvim;
        this.nvim.uiAttach(80, 80, {}).catch(_e => {
            // noop
        });
        proc.on('exit', () => {
            this.proc = null;
        });
        this.nvim.on('notification', (method, args) => {
            if (method == 'redraw') {
                for (let arg of args) {
                    let event = arg[0];
                    this.emit(event, arg.slice(1));
                }
            }
        });
        return new Promise(resolve => {
            plugin.once('ready', resolve);
        });
    }
    async shutdown() {
        await this.plugin.dispose();
        await this.nvim.quit();
        if (this.proc) {
            this.proc.kill('SIGKILL');
        }
        await this.wait(60);
    }
    async waitPopup() {
        for (let i = 0; i < 40; i++) {
            await this.wait(50);
            let visible = await this.nvim.call('pumvisible');
            if (visible)
                return;
        }
        throw new Error('timeout after 2s');
    }
    async waitFloat() {
        for (let i = 0; i < 40; i++) {
            await this.wait(50);
            let winid = await this.nvim.call('coc#util#get_float');
            if (winid)
                return winid;
        }
        throw new Error('timeout after 2s');
    }
    async reset() {
        let mode = await this.nvim.call('mode');
        if (mode !== 'n') {
            await this.nvim.command('stopinsert');
            await this.nvim.call('feedkeys', [String.fromCharCode(27), 'in']);
        }
        await this.nvim.command('silent! %bwipeout!');
        await this.wait(60);
    }
    async pumvisible() {
        let res = await this.nvim.call('pumvisible', []);
        return res == 1;
    }
    wait(ms = 30) {
        return new Promise(resolve => {
            setTimeout(() => {
                resolve();
            }, ms);
        });
    }
    async visible(word, source) {
        await this.waitPopup();
        let context = await this.nvim.getVar('coc#_context');
        let items = context.candidates;
        if (!items)
            return false;
        let item = items.find(o => o.word == word);
        if (!item || !item.user_data)
            return false;
        try {
            let o = JSON.parse(item.user_data);
            if (source && o.source !== source) {
                return false;
            }
        }
        catch (e) {
            return false;
        }
        return true;
    }
    async notVisible(word) {
        let items = await this.getItems();
        return items.findIndex(o => o.word == word) == -1;
    }
    async getItems() {
        let visible = await this.pumvisible();
        if (!visible)
            return [];
        let context = await this.nvim.getVar('coc#_context');
        let items = context.candidates;
        return items || [];
    }
    async edit(file) {
        file = path_1.default.join(__dirname, file ? file : `${uuid()}`);
        let escaped = await this.nvim.call('fnameescape', file);
        await this.nvim.command(`edit ${escaped}`);
        await this.wait(60);
        let bufnr = await this.nvim.call('bufnr', ['%']);
        return this.nvim.createBuffer(bufnr);
    }
    async createDocument(name) {
        let buf = await this.edit(name);
        let doc = workspace_1.default.getDocument(buf.id);
        if (!doc)
            return await workspace_1.default.document;
        return doc;
    }
    async getCmdline() {
        let str = '';
        for (let i = 1, l = 70; i < l; i++) {
            let ch = await this.nvim.call('screenchar', [79, i]);
            if (ch == -1)
                break;
            str += String.fromCharCode(ch);
        }
        return str.trim();
    }
    updateConfiguration(key, value) {
        let { configurations } = workspace_1.default;
        configurations.updateUserConfig({ [key]: value });
    }
    async mockFunction(name, result) {
        let content = `
    function! ${name}(...)
      return ${JSON.stringify(result)}
    endfunction
    `;
        let file = await createTmpFile(content);
        await this.nvim.command(`source ${file}`);
    }
    async items() {
        let context = await this.nvim.getVar('coc#_context');
        return context['candidates'] || [];
    }
    async screenLine(line) {
        let res = '';
        for (let i = 1; i <= 80; i++) {
            let ch = await this.nvim.call('screenchar', [line, i]);
            res = res + String.fromCharCode(ch);
        }
        return res;
    }
    async getFloat() {
        let wins = await this.nvim.windows;
        let floatWin;
        for (let win of wins) {
            let f = await win.getVar('float');
            if (f)
                floatWin = win;
        }
        return floatWin;
    }
}
exports.Helper = Helper;
async function createTmpFile(content) {
    let tmpFolder = path_1.default.join(os_1.default.tmpdir(), `coc-${process.pid}`);
    if (!fs_1.default.existsSync(tmpFolder)) {
        fs_1.default.mkdirSync(tmpFolder);
    }
    let filename = path_1.default.join(tmpFolder, uuid());
    await util_1.default.promisify(fs_1.default.writeFile)(filename, content, 'utf8');
    return filename;
}
exports.createTmpFile = createTmpFile;
exports.default = new Helper();
//# sourceMappingURL=helper.js.map