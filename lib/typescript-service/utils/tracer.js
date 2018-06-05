"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var Trace;
(function (Trace) {
    Trace[Trace["Off"] = 0] = "Off";
    Trace[Trace["Messages"] = 1] = "Messages";
    Trace[Trace["Verbose"] = 2] = "Verbose";
})(Trace || (Trace = {}));
(function (Trace) {
    function fromString(value) {
        value = value.toLowerCase();
        switch (value) {
            case 'off':
                return Trace.Off; // tslint:disable-line
            case 'messages':
                return Trace.Messages; // tslint:disable-line
            case 'verbose':
                return Trace.Verbose; // tslint:disable-line
            default:
                return Trace.Off; // tslint:disable-line
        }
    }
    Trace.fromString = fromString;
})(Trace || (Trace = {}));
class Tracer {
    constructor(logger) {
        this.logger = logger;
        this.trace = Tracer.readTrace();
    }
    static readTrace() {
        return Trace.fromString(process.env.TSS_TRACE);
    }
    traceRequest(request, responseExpected, queueLength) {
        if (this.trace === Trace.Off)
            return;
        let data;
        if (this.trace === Trace.Verbose && request.arguments) {
            data = `Arguments: ${JSON.stringify(request.arguments, null, 4)}`;
        }
        this.logTrace(`Sending request: ${request.command} (${request.seq}). Response expected: ${responseExpected ? 'yes' : 'no'}. Current queue length: ${queueLength}`, data);
    }
    traceResponse(response, startTime) {
        if (this.trace === Trace.Off) {
            return;
        }
        let data;
        if (this.trace === Trace.Verbose && response.body) {
            data = `Result: ${JSON.stringify(response.body, null, 4)}`;
        }
        this.logTrace(`Response received: ${response.command} (${response.request_seq}). Request took ${Date.now() - startTime} ms. Success: ${response.success} ${!response.success ? '. Message: ' + response.message : ''}`, data);
    }
    traceEvent(event) {
        if (this.trace === Trace.Off) {
            return;
        }
        let data;
        if (this.trace === Trace.Verbose && event.body) {
            data = `Data: ${JSON.stringify(event.body, null, 4)}`;
        }
        this.logTrace(`Event received: ${event.event} (${event.seq}).`, data);
    }
    logTrace(message, data) {
        if (this.trace !== Trace.Off) {
            this.logger.trace(message, data);
        }
    }
}
exports.default = Tracer;
//# sourceMappingURL=tracer.js.map