"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const uuidv1 = require("uuid/v1");
const logger = require('../util/logger')('model-status');
const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
class StatusLine {
    constructor(nvim) {
        this.nvim = nvim;
        this.items = new Map();
        this.shownIds = new Set();
        this._text = '';
        this.interval = setInterval(() => {
            this.setStatusText().catch(_e => {
                // noop
            });
        }, 100);
    }
    dispose() {
        clearInterval(this.interval);
    }
    createStatusBarItem(priority = 0, isProgress = false) {
        let uid = uuidv1();
        let item = {
            text: '',
            priority,
            isProgress,
            show: () => {
                this.shownIds.add(uid);
            },
            hide: () => {
                this.shownIds.delete(uid);
            },
            dispose: () => {
                this.shownIds.delete(uid);
                this.items.delete(uid);
            }
        };
        this.items.set(uid, item);
        return item;
    }
    getText() {
        if (this.shownIds.size == 0)
            return '';
        let d = new Date();
        let idx = Math.floor(d.getMilliseconds() / 100);
        let text = '';
        let items = [];
        for (let [id, item] of this.items) {
            if (this.shownIds.has(id)) {
                items.push(item);
            }
        }
        items.sort((a, b) => a.priority - b.priority);
        for (let item of items) {
            if (!item.isProgress) {
                text = `${text} ${item.text}`;
            }
            else {
                text = `${text} ${frames[idx]} ${item.text}`;
            }
        }
        return text;
    }
    async setStatusText() {
        let text = this.getText();
        if (text != this._text) {
            this._text = text;
            await this.nvim.setVar('coc_status', text);
            this.nvim.command('redraws', true);
        }
    }
}
exports.default = StatusLine;
//# sourceMappingURL=status.js.map