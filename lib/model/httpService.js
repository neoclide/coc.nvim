"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const cp = require("child_process");
const EventEmitter = require("events");
const got = require("got");
const logger = require('../util/logger')('model-httpService');
class HttpService extends EventEmitter {
    constructor(command, args) {
        super();
        this.command = command;
        this.args = args;
        this.command = command;
        this.args = args || [];
        this.running = false;
    }
    get isRunnning() {
        return this.running;
    }
    start() {
        if (this.running)
            return;
        this.child = cp.spawn(this.command, this.args, {
            detached: false
        });
        this.running = true;
        this.child.stderr.on('data', str => {
            logger.error(`${this.command} error: ${str}`);
        });
        this.child.stdout.on('data', msg => {
            logger.debug(`${this.command} ourput: ${msg}`);
        });
        this.child.on('exit', (code, signal) => {
            this.running = false;
            if (code) {
                logger.error(`${this.command} service abnormal exit ${code}`);
            }
            this.emit('exit');
        });
    }
    request(opt) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            // if (!this.running) return
            let { port, path, headers } = opt;
            try {
                const response = yield got(`http://127.0.0.1:${port}${path}`, {
                    headers
                });
                let items = JSON.parse(response.body);
                logger.debug(items.length);
                // logger.debug(JSON.stringify(items))
                return response.body;
            }
            catch (e) {
                logger.error(e.message);
            }
            return '';
        });
    }
    stop() {
        if (this.child) {
            this.child.kill('SIGHUP');
        }
    }
}
exports.default = HttpService;
//# sourceMappingURL=httpService.js.map