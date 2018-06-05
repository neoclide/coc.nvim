import * as Proto from '../protocol';
import { Logger } from 'log4js';
export default class Tracer {
    private readonly logger;
    private trace?;
    constructor(logger: Logger);
    private static readTrace;
    traceRequest(request: Proto.Request, responseExpected: boolean, queueLength: number): void;
    traceResponse(response: Proto.Response, startTime: number): void;
    traceEvent(event: Proto.Event): void;
    logTrace(message: string, data?: any): void;
}
