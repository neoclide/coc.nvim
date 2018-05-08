"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const logger_1 = require("./util/logger");
const fs = require("fs");
const path = require("path");
const pify = require("pify");
// controll instances of native sources
class Natives {
    constructor() {
        this.list = [];
    }
    findSource(name) {
        let o = this.list.find(o => o.name == name);
        let names = this.list.map(o => o.name);
        return o ? o.instance : null;
    }
    get sources() {
        let arr = this.list.map(o => o.instance);
        return arr.filter(o => o != null);
    }
    init() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let root = path.join(__dirname, 'source');
            let files = yield pify(fs.readdir)(root, 'utf8');
            for (let file of files) {
                if (/\.js$/.test(file)) {
                    let name = file.replace(/\.js$/, '');
                    try {
                        let Clz = require(`./source/${name}`).default;
                        this.list.push({
                            name,
                            Clz,
                            filepath: path.join(root, file),
                            instance: null
                        });
                    }
                    catch (e) {
                        logger_1.logger.error(`Native source ${name} error: ${e.message}`);
                    }
                }
            }
        });
    }
    has(name) {
        return this.list.findIndex(o => o.name == name) != -1;
    }
    get names() {
        return this.list.map(o => o.name);
    }
    createSource(nvim, name) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let o = this.list.find(o => o.name == name);
            if (!o)
                return null;
            let Clz = o.Clz;
            return new Clz(nvim);
        });
    }
    getSource(nvim, name) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let o = this.list.find(o => o.name == name);
            if (!o)
                return null;
            if (o.instance)
                return o.instance;
            let instance = o.instance = yield this.createSource(nvim, name);
            return instance;
        });
    }
}
exports.Natives = Natives;
exports.default = new Natives();
//# sourceMappingURL=natives.js.map