"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const cp = require("child_process");
const EventEmitter = require("events");
const logger = require('../util/logger')('model-stdioService');
class StdioService extends EventEmitter {
    constructor(command, args) {
        super();
        this.command = command;
        this.args = args;
        this.command = command;
        this.args = args || [];
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
            logger.error(str);
            this.emit('error', str);
        });
        this.child.stdout.on('data', msg => {
            this.emit('message', msg);
        });
        this.child.on('exit', (code, signal) => {
            this.running = false;
            if (code) {
                logger.error(`Service abnormal exit ${code}`);
            }
            this.emit('exit');
        });
    }
    request(data) {
        if (!this.running)
            return;
        this.child.stdin.write(JSON.stringify(data) + '\n');
        return new Promise((resolve, reject) => {
            setTimeout(() => {
                reject(new Error('Request time out'));
            }, 3000);
            this.once('message', msg => {
                logger.debug(msg.toString());
                try {
                    resolve(JSON.parse(msg.toString()));
                }
                catch (e) {
                    reject(new Error('invalid result'));
                }
            });
        });
    }
    stop() {
        if (this.child) {
            this.child.kill('SIGHUP');
        }
    }
}
exports.default = StdioService;
//# sourceMappingURL=stdioService.js.map