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
        logger.debug(`args:${this.args.join(' ')}`);
        logger.debug(this.command);
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
            // let data = ''
            // return new Promise((resolve, reject) => {
            //   logger.debug(JSON.stringify(opt))
            //   const response = await got('http://127.0.0.1:5588/complete', {
            //     headers: {
            //       'X-Offset': '445',
            //       'X-Path': '/tmp/coc-91386/b6kfm',
            //       'X-File': 'processer/WeatherView.swift'
            //     }
            //   })
            //   console.log(response.body)
            //   const req = request(opt, res => {
            //     logger.debug(`STATUS: ${res.statusCode}`)
            //     logger.debug(`headers: ${JSON.stringify(res.headers)}`)
            //     logger.debug(6666)
            //     res.on('error', reject)
            //     res.on('data', chunk => {
            //       logger.debug(55555)
            //       logger.debug(chunk)
            //       data += chunk.toString()
            //     })
            //     res.on('end', () => {
            //       resolve(data)
            //     })
            //   })
            // })
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