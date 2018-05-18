"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const cp = require("child_process");
const EventEmitter = require("events");
const logger = require('../util/logger')('model-child');
class Child extends EventEmitter {
    constructor(command, args) {
        super();
        this.command = command;
        this.args = args;
        this.command = command;
        this.args = args || [];
        this.cb = () => { }; // tslint:disable-line
    }
    get isRunnning() {
        return this.running;
    }
    start() {
        if (this.running)
            return;
        this.cp = cp.spawn(this.command, this.args, {
            detached: false
        });
        this.running = true;
        this.cp.stderr.on('data', str => {
            logger.error(str);
            this.emit('error', str);
        });
        this.cp.stdout.on('data', msg => {
            this.emit('message', msg);
        });
        this.reader = this.cp.stdout;
        this.writer = this.cp.stdin;
        this.cp.on('close', () => {
            this.running = false;
            this.emit('close');
        });
    }
    request(data) {
        if (!this.running)
            return;
        this.writer.write(JSON.stringify(data) + '\n');
        return new Promise((resolve, reject) => {
            setTimeout(() => {
                reject(new Error('Request time out'));
            }, 3000);
            this.once('message', msg => {
                resolve(msg.toString());
            });
        });
    }
    stop() {
        if (this.cp) {
            this.cp.kill('SIGHUP');
        }
    }
}
exports.default = Child;
//# sourceMappingURL=child.js.map