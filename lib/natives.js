"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const index_1 = require("./util/index");
const fs = require("fs");
const path = require("path");
const pify = require("pify");
const service_1 = require("./source/service");
const logger = require('./util/logger')('natives'); // tslint:disable-line
// controll instances of native sources
class Natives {
    constructor() {
        this.list = [];
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
                            service: false,
                            instance: null
                        });
                    }
                    catch (e) {
                        logger.error(`Native source ${name} error: ${e.message}`);
                    }
                }
            }
            for (let key of Object.keys(service_1.serviceMap)) {
                let arr = service_1.serviceMap[key];
                for (let name of arr) {
                    this.list.push({
                        name,
                        Clz: require(`./source/service/${name}`).default,
                        filepath: path.join(root, `./service/${name}.js`),
                        service: true,
                        instance: null
                    });
                }
            }
        });
    }
    has(name) {
        return this.list.findIndex(o => o.name == name) != -1;
    }
    getSourceNamesOfFiletype(filetype) {
        let list = this.list.filter(o => !o.service);
        let names = list.map(o => o.name);
        let services = service_1.serviceMap[filetype];
        if (services)
            names = names.concat(services);
        return names;
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
            let instance = new Clz(nvim);
            if (typeof instance.onInit == 'function') {
                yield instance.onInit();
            }
            return instance;
        });
    }
    getSource(nvim, name) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let o = this.list.find(o => o.name == name);
            if (!o)
                return null;
            if (o.instance)
                return o.instance;
            let instance;
            try {
                instance = o.instance = yield this.createSource(nvim, name);
            }
            catch (e) {
                let msg = `Create source ${name} error: ${e.message}`;
                yield index_1.echoErr(nvim, msg);
                logger.error(e.stack);
                return null;
            }
            return instance;
        });
    }
}
exports.Natives = Natives;
exports.default = new Natives();
//# sourceMappingURL=natives.js.map