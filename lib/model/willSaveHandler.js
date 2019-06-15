"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vscode_languageserver_protocol_1 = require("vscode-languageserver-protocol");
const util_1 = require("../util");
const logger = require('../util/logger')('willSaveHandler');
class WillSaveUntilHandler {
    constructor(workspace) {
        this.workspace = workspace;
        this.callbacks = [];
    }
    get nvim() {
        return this.workspace.nvim;
    }
    addCallback(callback, thisArg, clientId) {
        let fn = (event) => {
            let { nvim, workspace } = this;
            let ev = Object.assign({}, event);
            return new Promise(resolve => {
                let called = false;
                ev.waitUntil = (thenable) => {
                    called = true;
                    let { document } = ev;
                    let timer = setTimeout(() => {
                        workspace.showMessage(`${clientId} will save operation timeout after 0.5s`, 'warning');
                        resolve(null);
                    }, 500);
                    Promise.resolve(thenable).then((edits) => {
                        clearTimeout(timer);
                        let doc = workspace.getDocument(document.uri);
                        if (doc && edits && vscode_languageserver_protocol_1.TextEdit.is(edits[0])) {
                            doc.applyEdits(nvim, edits).then(() => {
                                // make sure server received ChangedText
                                setTimeout(resolve, 50);
                            }, e => {
                                logger.error(e);
                                workspace.showMessage(`${clientId} error on applyEdits ${e.message}`, 'error');
                                resolve();
                            });
                        }
                        else {
                            resolve();
                        }
                    }, e => {
                        clearTimeout(timer);
                        logger.error(`${clientId} error on willSaveUntil ${e.message}`, 'error');
                        resolve();
                    });
                };
                callback.call(thisArg, ev);
                if (!called) {
                    resolve();
                }
            });
        };
        this.callbacks.push(fn);
        return vscode_languageserver_protocol_1.Disposable.create(() => {
            let idx = this.callbacks.indexOf(fn);
            if (idx != -1) {
                this.callbacks.splice(idx, 1);
            }
        });
    }
    get hasCallback() {
        let { callbacks } = this;
        return callbacks.length > 0;
    }
    async handeWillSaveUntil(event) {
        let { callbacks, workspace } = this;
        let { document } = event;
        if (!callbacks.length)
            return;
        let doc = workspace.getDocument(document.uri);
        if (!doc)
            return;
        let now = Date.now();
        if (doc.dirty) {
            doc.forceSync();
            await util_1.wait(60);
        }
        for (let fn of callbacks) {
            event.document = doc.textDocument;
            try {
                await fn(event);
            }
            catch (e) {
                logger.error(e);
            }
        }
        logger.info(`Will save cost: ${Date.now() - now}`);
    }
}
exports.default = WillSaveUntilHandler;
//# sourceMappingURL=willSaveHandler.js.map