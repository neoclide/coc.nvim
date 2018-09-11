/*tslint:disable*/
var net = require('net'), fs = require('fs'), stream = require('stream'), util = require('util');
var ENABLE_LOGGING = false;
var log = (function () {
    if (!ENABLE_LOGGING) {
        return function () { };
    }
    var isFirst = true;
    var LOG_LOCATION = 'C:\\stdFork.log';
    return function log(str) {
        if (isFirst) {
            isFirst = false;
            fs.writeFileSync(LOG_LOCATION, str + '\n');
            return;
        }
        fs.appendFileSync(LOG_LOCATION, str + '\n');
    };
})();
var stdInPipeName = process.env['STDIN_PIPE_NAME'];
var stdOutPipeName = process.env['STDOUT_PIPE_NAME'];
log('STDIN_PIPE_NAME: ' + stdInPipeName);
log('STDOUT_PIPE_NAME: ' + stdOutPipeName);
(function () {
    log('Beginning stdout redirection...');
    // Create a writing stream to the stdout pipe
    var stdOutStream = net.connect(stdOutPipeName);
    // unref stdOutStream to behave like a normal standard out
    stdOutStream.unref();
    process.__defineGetter__('stdout', function () {
        return stdOutStream;
    });
    process.__defineGetter__('stderr', function () {
        return stdOutStream;
    });
    var fsWriteSyncString = function (fd, str, _position, encoding) {
        //  fs.writeSync(fd, string[, position[, encoding]]);
        var buf = Buffer.from(str, encoding || 'utf8');
        return fsWriteSyncBuffer(fd, buf, 0, buf.length);
    };
    var fsWriteSyncBuffer = function (_fd, buffer, off, len) {
        off = Math.abs(off | 0);
        len = Math.abs(len | 0);
        //  fs.writeSync(fd, buffer, offset, length[, position]);
        var buffer_length = buffer.length;
        if (off > buffer_length) {
            throw new Error('offset out of bounds');
        }
        if (len > buffer_length) {
            throw new Error('length out of bounds');
        }
        if (((off + len) | 0) < off) {
            throw new Error('off + len overflow');
        }
        if (buffer_length - off < len) {
            // Asking for more than is left over in the buffer
            throw new Error('off + len > buffer.length');
        }
        var slicedBuffer = buffer;
        if (off !== 0 || len !== buffer_length) {
            slicedBuffer = buffer.slice(off, off + len);
        }
        stdOutStream.write(slicedBuffer);
        return slicedBuffer.length;
    };
    // handle fs.writeSync(1, ...)
    var originalWriteSync = fs.writeSync;
    fs.writeSync = function (fd, data, _position, _encoding) {
        if (fd !== 1) {
            return originalWriteSync.apply(fs, arguments);
        }
        // usage:
        //  fs.writeSync(fd, buffer, offset, length[, position]);
        // OR
        //  fs.writeSync(fd, string[, position[, encoding]]);
        if (data instanceof Buffer) {
            return fsWriteSyncBuffer.apply(null, arguments);
        }
        // For compatibility reasons with fs.writeSync, writing null will write "null", etc
        if (typeof data !== 'string') {
            data += '';
        }
        return fsWriteSyncString.apply(null, arguments);
    };
    log('Finished defining process.stdout, process.stderr and fs.writeSync');
})();
(function () {
    // Begin listening to stdin pipe
    var server = net.createServer(function (stream) {
        // Stop accepting new connections, keep the existing one alive
        server.close();
        log('Parent process has connected to my stdin. All should be good now.');
        process.__defineGetter__('stdin', function () {
            return stream;
        });
        // Remove myself from process.argv
        process.argv.splice(1, 1);
        // Load the actual program
        var program = process.argv[1];
        log('Loading program: ' + program);
        // Unset the custom environmental variables that should not get inherited
        delete process.env['STDIN_PIPE_NAME'];
        delete process.env['STDOUT_PIPE_NAME'];
        require(program);
        log('Finished loading program.');
        var stdinIsReferenced = true;
        var timer = setInterval(function () {
            var listenerCount = stream.listeners('data').length +
                stream.listeners('end').length +
                stream.listeners('close').length +
                stream.listeners('error').length;
            // log('listenerCount: ' + listenerCount);
            if (listenerCount <= 1) {
                // No more "actual" listeners, only internal node
                if (stdinIsReferenced) {
                    stdinIsReferenced = false;
                    // log('unreferencing stream!!!');
                    stream.unref();
                }
            }
            else {
                // There are "actual" listeners
                if (!stdinIsReferenced) {
                    stdinIsReferenced = true;
                    stream.ref();
                }
            }
            // log(
            // 	'' + stream.listeners('data').length +
            // 	' ' + stream.listeners('end').length +
            // 	' ' + stream.listeners('close').length +
            // 	' ' + stream.listeners('error').length
            // );
        }, 1000);
        timer.unref();
    });
    server.listen(stdInPipeName, function () {
        // signal via stdout that the parent process can now begin writing to stdin pipe
        process.stdout.write('ready');
    });
})();
