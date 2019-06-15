"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const array_1 = require("../util/array");
const object_1 = require("../util/object");
const position_1 = require("../util/position");
const workspace_1 = tslib_1.__importDefault(require("../workspace"));
const logger = require('../util/logger')('highlighter');
const usedColors = new Set();
class Highlighter {
    constructor(nvim, document, srcId) {
        this.nvim = nvim;
        this.document = document;
        this.srcId = srcId;
        this.matchIds = [];
        this._colors = [];
    }
    get version() {
        return this._version;
    }
    get bufnr() {
        return this.document.bufnr;
    }
    get colors() {
        return this._colors;
    }
    hasColor() {
        return this._colors.length > 0;
    }
    async highlight(colors) {
        colors = colors || [];
        this._version = this.document.version;
        if (workspace_1.default.isVim && workspace_1.default.bufnr != this.document.bufnr)
            return;
        if (colors.length == 0)
            return this.clearHighlight();
        let window = await this.nvim.window;
        this.winid = window.id;
        this._colors = colors;
        let groups = array_1.group(colors, 100);
        let cleared = false;
        for (let colors of groups) {
            this.nvim.pauseNotification();
            if (!cleared) {
                cleared = true;
                if (workspace_1.default.isVim) {
                    this.document.clearMatchIds(this.matchIds);
                    this.matchIds = [];
                }
                else {
                    this.document.clearMatchIds([this.srcId]);
                }
            }
            let colorRanges = this.getColorRanges(colors);
            this.addColors(colors.map(o => o.color));
            for (let o of colorRanges) {
                this.addHighlight(o.ranges, o.color);
            }
            await this.nvim.resumeNotification();
        }
    }
    addHighlight(ranges, color) {
        let { red, green, blue } = toHexColor(color);
        let hlGroup = `BG${toHexString(color)}`;
        let ids = this.document.highlightRanges(ranges, hlGroup, this.srcId);
        if (workspace_1.default.isVim)
            this.matchIds.push(...ids);
    }
    addColors(colors) {
        let commands = [];
        for (let color of colors) {
            let hex = toHexString(color);
            if (!usedColors.has(hex)) {
                commands.push(`hi BG${hex} guibg=#${hex} guifg=#${isDark(color) ? 'ffffff' : '000000'}`);
                usedColors.add(hex);
            }
        }
        this.nvim.command(commands.join('|'), true);
    }
    clearHighlight() {
        let { matchIds, srcId } = this;
        if (!this.document)
            return;
        if (workspace_1.default.isVim) {
            this.matchIds = [];
            this.document.clearMatchIds(matchIds);
        }
        else {
            this.document.clearMatchIds([srcId]);
        }
        this._colors = [];
    }
    getColorRanges(infos) {
        let res = [];
        for (let info of infos) {
            let { color, range } = info;
            let idx = res.findIndex(o => {
                return object_1.equals(toHexColor(o.color), toHexColor(color));
            });
            if (idx == -1) {
                res.push({
                    color,
                    ranges: [range]
                });
            }
            else {
                let r = res[idx];
                r.ranges.push(range);
            }
        }
        return res;
    }
    hasColorAtPostion(position) {
        let { colors } = this;
        return colors.some(o => position_1.positionInRange(position, o.range) == 0);
    }
    dispose() {
        this.document = null;
    }
}
exports.default = Highlighter;
function toHexString(color) {
    let c = toHexColor(color);
    return `${pad(c.red.toString(16))}${pad(c.green.toString(16))}${pad(c.blue.toString(16))}`;
}
exports.toHexString = toHexString;
function pad(str) {
    return str.length == 1 ? `0${str}` : str;
}
function toHexColor(color) {
    let { red, green, blue } = color;
    return {
        red: Math.round(red * 255),
        green: Math.round(green * 255),
        blue: Math.round(blue * 255)
    };
}
function isDark(color) {
    let { red, green, blue } = toHexColor(color);
    let luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    return luma < 40;
}
//# sourceMappingURL=highlighter.js.map