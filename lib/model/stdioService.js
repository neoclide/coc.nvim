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
        let { command } = this;
        this.child.stderr.on('data', str => {
            logger.error(`${command} error: ${str}`);
        });
        let msgs = '';
        this.child.stdout.on('data', msg => {
            msgs = msgs + msg.toString();
            if (msgs.trim().slice(-3) === 'END') {
                this.emit('message', msgs.trim().slice(0, -3));
                msgs = '';
            }
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
        this.child.stdin.write(data + '\n');
        return new Promise((resolve, reject) => {
            setTimeout(() => {
                reject(new Error('Request time out'));
            }, 3000);
            this.once('message', msg => {
                resolve(msg);
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