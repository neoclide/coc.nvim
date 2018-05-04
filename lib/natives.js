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
// controll instances of native sources
class Natives {
    constructor() {
        this.sourceMap = {};
        this.classMap = {};
        this.names = [];
        fs.readdir(path.join(__dirname, 'source'), 'utf8', (err, files) => {
            if (err)
                return logger_1.logger.error(`Get not read source ${err.message}`);
            for (let file of files) {
                if (/\.js$/.test(file)) {
                    let name = file.replace(/\.js$/, '');
                    this.names.push(name);
                    this.classMap[name] = require(`./source/${name}`).default;
                }
            }
        });
    }
    has(name) {
        return this.names.indexOf(name) !== -1;
    }
    createSource(nvim, name) {
        return __awaiter(this, void 0, void 0, function* () {
            let Clz = this.classMap[name];
            if (!Clz)
                return null;
            return new Clz(nvim);
        });
    }
    getSource(nvim, name) {
        return __awaiter(this, void 0, void 0, function* () {
            let source = this.sourceMap[name];
            if (source)
                return source;
            source = yield this.createSource(nvim, name);
            this.sourceMap[name] = source;
            return source;
        });
    }
}
exports.Natives = Natives;
exports.default = new Natives();
//# sourceMappingURL=natives.js.map