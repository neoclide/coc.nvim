"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const cp = require("child_process");
const EventEmitter = require("events");
const logger = require('../util/logger')('model-child');
class IpcService extends EventEmitter {
    constructor(modulePath, cwd, args) {
        super();
        this.modulePath = modulePath;
        this.cwd = cwd;
        this.args = args;
        this.modulePath = modulePath;
        this.args = args || [];
        this.cwd = cwd;
        this.cb = () => { }; // tslint:disable-line
    }
    get isRunnning() {
        return this.running;
    }
    start() {
        if (this.running)
            return;
        this.child = cp.fork(this.modulePath, this.args, {
            cwd: this.cwd,
            stdio: ['pipe', 'pipe', 'pipe', 'ipc']
        });
        this.running = true;
        this.child.on('message', message => {
            logger.debug(`ipc message: ${message}`);
            this.emit('message', message);
        });
        this.child.on('error', err => {
            logger.error(`service error ${err.message}`);
            logger.debug(`${err.stack}`);
            this.emit('error', err);
        });
        this.child.on('exit', (code, signal) => {
            this.running = false;
            if (code) {
                logger.error(`Service abnormal exit ${code}`);
            }
            logger.debug(`${this.modulePath} exit with code ${code} and signal ${signal}`);
            this.emit('exit');
        });
    }
    request(data) {
        if (!this.running)
            return;
        this.child.send(JSON.stringify(data));
        return new Promise((resolve, reject) => {
            setTimeout(() => {
                reject(new Error('Ipc service request time out'));
            }, 3000);
            this.once('message', msg => {
                resolve(JSON.parse(msg.toString()));
            });
        });
    }
    stop() {
        if (this.child) {
            this.child.kill('SIGHUP');
        }
    }
}
exports.default = IpcService;
//# sourceMappingURL=ipcService.js.map