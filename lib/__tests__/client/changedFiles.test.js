"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
/*tslint:disable*/
const helper_1 = tslib_1.__importDefault(require("../helper"));
// import * as assert from 'assert'
const fs_1 = tslib_1.__importDefault(require("fs"));
const lsclient = tslib_1.__importStar(require("../../language-client"));
const path = tslib_1.__importStar(require("path"));
const vscode_uri_1 = require("vscode-uri");
// import which from 'which'
beforeAll(async () => {
    await helper_1.default.setup();
});
afterAll(async () => {
    await helper_1.default.shutdown();
});
afterEach(async () => {
    await helper_1.default.reset();
});
describe('Client integration', () => {
    it('should send file change notification', (done) => {
        if (global.hasOwnProperty('__TEST__'))
            return done();
        let serverModule = path.join(__dirname, './server/testFileWatcher.js');
        let serverOptions = {
            module: serverModule,
            transport: lsclient.TransportKind.ipc
        };
        let clientOptions = {
            documentSelector: ['css'],
            synchronize: {}, initializationOptions: {},
            middleware: {}
        };
        let client = new lsclient.LanguageClient('css', 'Test Language Server', serverOptions, clientOptions);
        let disposable = client.start();
        client.onReady().then(_ => {
            setTimeout(async () => {
                let file = path.join(__dirname, 'test.js');
                fs_1.default.writeFileSync(file, '', 'utf8');
                await helper_1.default.wait(300);
                let res = await client.sendRequest('custom/received');
                expect(res).toEqual({
                    changes: [{
                            uri: vscode_uri_1.URI.file(file).toString(),
                            type: 1
                        }]
                });
                fs_1.default.unlinkSync(file);
                disposable.dispose();
                done();
            }, 200);
        }, e => {
            disposable.dispose();
            done(e);
        });
    });
});
//# sourceMappingURL=changedFiles.test.js.map