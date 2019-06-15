"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class Popup {
    constructor(nvim) {
        this.nvim = nvim;
    }
    async create(text, options) {
        let { nvim } = this;
        this.id = await nvim.call('popup_create', [text, options]);
        this.bufferId = await nvim.call('winbufnr', [this.id]);
    }
    hide() {
        if (!this.id)
            return;
        this.nvim.call('popup_hide', [this.id], true);
    }
    async valid() {
        if (!this.bufferId)
            return false;
        await this.nvim.call('bufexists', [this.bufferId]);
    }
    async visible() {
        if (!this.id)
            return false;
        let opt = await this.nvim.call('popup_getpos', [this.id]);
        return opt && opt.visible == 1;
    }
    show() {
        if (!this.id)
            return;
        this.nvim.call('popup_show', [this.id], true);
    }
    move(options) {
        if (!this.id)
            return;
        this.nvim.call('popup_move', [this.id, options], true);
    }
    async getPosition() {
        return await this.nvim.call('popup_getpos', [this.id]);
    }
    setFiletype(filetype) {
        if (!this.id)
            return;
        let { nvim } = this;
        // nvim.call('win_execute', [this.id, 'syntax enable'], true)
        nvim.call('setbufvar', [this.bufferId, '&filetype', filetype], true);
    }
    dispose() {
        if (this.id) {
            this.nvim.call('popup_close', [this.id], true);
        }
    }
}
exports.Popup = Popup;
async function createPopup(nvim, text, options) {
    let popup = new Popup(nvim);
    await popup.create(text, options);
    return popup;
}
exports.default = createPopup;
//# sourceMappingURL=popup.js.map