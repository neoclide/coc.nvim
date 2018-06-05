"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
const os = require("os");
const net = require("net");
const cp = require("child_process");
const logger = require('../../util/logger')('typescript-service-process');
function makeRandomHexString(length) {
    let chars = ['0', '1', '2', '3', '4', '5', '6', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f'];
    let result = '';
    for (let i = 0; i < length; i++) {
        const idx = Math.floor(chars.length * Math.random());
        result += chars[idx];
    }
    return result;
}
exports.makeRandomHexString = makeRandomHexString;
function generatePipeName() {
    return getPipeName(makeRandomHexString(40));
}
function getPipeName(name) {
    const fullName = 'coc-tsc-' + name;
    if (process.platform === 'win32') {
        return '\\\\.\\pipe\\' + fullName + '-sock';
    }
    // Mac/Unix: use socket file
    return path.join(os.tmpdir(), fullName + '.sock');
}
function getTempFile(name) {
    const fullName = 'vscode-' + name;
    return path.join(os.tmpdir(), fullName + '.sock');
}
exports.getTempFile = getTempFile;
function generatePatchedEnv(env, stdInPipeName, stdOutPipeName, stdErrPipeName) {
    const newEnv = Object.assign({}, env);
    // Set the two unique pipe names and the electron flag as process env
    newEnv['STDIN_PIPE_NAME'] = stdInPipeName; // tslint:disable-line
    newEnv['STDOUT_PIPE_NAME'] = stdOutPipeName; // tslint:disable-line
    newEnv['STDERR_PIPE_NAME'] = stdErrPipeName; // tslint:disable-line
    // Ensure we always have a PATH set
    newEnv['PATH'] = newEnv['PATH'] || process.env.PATH; // tslint:disable-line
    return newEnv;
}
function fork(modulePath, args, options, callback) {
    let callbackCalled = false;
    const resolve = (result) => {
        if (callbackCalled) {
            return;
        }
        callbackCalled = true;
        callback(null, result);
    };
    const reject = (err) => {
        if (callbackCalled) {
            return;
        }
        callbackCalled = true;
        callback(err, null);
    };
    // Generate three unique pipe names
    const stdInPipeName = generatePipeName();
    const stdOutPipeName = generatePipeName();
    const stdErrPipeName = generatePipeName();
    const newEnv = generatePatchedEnv(process.env, stdInPipeName, stdOutPipeName, stdErrPipeName);
    newEnv['NODE_PATH'] = path.join(modulePath, '..', '..', '..'); // tslint:disable-line
    let childProcess;
    // Begin listening to stderr pipe
    let stdErrServer = net.createServer(stdErrStream => {
        // From now on the childProcess.stderr is available for reading
        childProcess.stderr = stdErrStream;
    });
    stdErrServer.listen(stdErrPipeName);
    // Begin listening to stdout pipe
    let stdOutServer = net.createServer(stdOutStream => {
        // The child process will write exactly one chunk with content `ready` when it has installed a listener to the stdin pipe
        stdOutStream.once('data', (_chunk) => {
            // The child process is sending me the `ready` chunk, time to connect to the stdin pipe
            childProcess.stdin = net.connect(stdInPipeName);
            // From now on the childProcess.stdout is available for reading
            childProcess.stdout = stdOutStream;
            resolve(childProcess);
        });
    });
    stdOutServer.listen(stdOutPipeName);
    let serverClosed = false;
    const closeServer = () => {
        if (serverClosed) {
            return;
        }
        serverClosed = true;
        stdOutServer.close();
        stdErrServer.close();
    };
    // Create the process
    logger.info('Forking TSServer', `PATH: ${newEnv['PATH']}`); // tslint:disable-line
    const bootstrapperPath = require.resolve('./electronForkStart');
    childProcess = cp.fork(bootstrapperPath, [modulePath].concat(args), {
        silent: true,
        cwd: options.cwd,
        env: newEnv,
        execArgv: options.execArgv
    });
    childProcess.once('error', (err) => {
        closeServer();
        reject(err);
    });
    childProcess.once('exit', (err) => {
        closeServer();
        reject(err);
    });
}
exports.fork = fork;
//# sourceMappingURL=process.js.map