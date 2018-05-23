"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const cp = require("child_process");
const EventEmitter = require("events");
const logger = require('../util/logger')('model-child');
/**
 * IpcService for commnucate with another nodejs process
 * @public
 *
 * @extends {EventEmitter}
 */
class IpcService extends EventEmitter {
    constructor(modulePath, cwd, execArgv, args) {
        super();
        this.modulePath = modulePath;
        this.cwd = cwd;
        this.execArgv = execArgv;
        this.args = args;
        this.modulePath = modulePath;
        this.args = args || [];
        this.execArgv = execArgv;
        this.cwd = cwd;
        this.cb = () => { }; // tslint:disable-line
    }
    get isRunnning() {
        return this.running;
    }
    start() {
        if (this.running)
            return;
        let { modulePath } = this;
        let child = this.child = cp.fork(this.modulePath, this.args, {
            cwd: this.cwd,
            execArgv: this.execArgv,
            stdio: ['pipe', 'pipe', 'pipe', 'ipc']
        });
        this.running = true;
        child.stderr.on('data', str => {
            logger.error(`${modulePath} error message: ${str}`);
        });
        child.stdout.on('data', str => {
            logger.debug(`${modulePath} output message: ${str}`);
        });
        child.on('message', message => {
            this.emit('message', message);
        });
        child.on('error', err => {
            logger.error(`service error ${err.message}`);
            logger.debug(`${err.stack}`);
            this.emit('error', err);
        });
        child.on('exit', (code, signal) => {
            this.running = false;
            if (code) {
                logger.error(`Service abnormal exit ${code}`);
            }
            logger.debug(`${modulePath} exit with code ${code} and signal ${signal}`);
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
                if (!msg)
                    return resolve(null);
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