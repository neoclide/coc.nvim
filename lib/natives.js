"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = require("./util/logger");
const fs = require("fs");
const path = require("path");
const pify = require("pify");
// controll instances of native sources
class Natives {
    constructor() {
        this.list = [];
    }
    init() {
        return __awaiter(this, void 0, void 0, function* () {
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
        return __awaiter(this, void 0, void 0, function* () {
            let o = this.list.find(o => o.name == name);
            if (!o)
                return null;
            let Clz = o.Clz;
            return new Clz(nvim);
        });
    }
    getSource(nvim, name) {
        return __awaiter(this, void 0, void 0, function* () {
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