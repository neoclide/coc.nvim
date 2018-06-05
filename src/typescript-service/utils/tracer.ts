import * as Proto from '../protocol'
import {Logger} from 'log4js'

enum Trace {
  Off,
  Messages,
  Verbose
}

namespace Trace {
  export function fromString(value: string): Trace {
    value = value.toLowerCase()
    switch (value) {
      case 'off':
        return Trace.Off // tslint:disable-line
      case 'messages':
        return Trace.Messages // tslint:disable-line
      case 'verbose':
        return Trace.Verbose // tslint:disable-line
      default:
        return Trace.Off // tslint:disable-line
    }
  }
}

export default class Tracer {
  private trace?: Trace

  constructor(private readonly logger: Logger) {
    this.trace = Tracer.readTrace()
  }

  private static readTrace(): Trace {
    return Trace.fromString(process.env.TSS_TRACE)
  }

  public traceRequest(
    request: Proto.Request,
    responseExpected: boolean,
    queueLength: number
  ): void {
    if (this.trace === Trace.Off) return
    let data: string | undefined
    if (this.trace === Trace.Verbose && request.arguments) {
      data = `Arguments: ${JSON.stringify(request.arguments, null, 4)}`
    }
    this.logTrace(
      `Sending request: ${request.command} (${
        request.seq
      }). Response expected: ${
        responseExpected ? 'yes' : 'no'
      }. Current queue length: ${queueLength}`,
      data
    )
  }

  public traceResponse(response: Proto.Response, startTime: number): void {
    if (this.trace === Trace.Off) {
      return
    }
    let data: string | undefined
    if (this.trace === Trace.Verbose && response.body) {
      data = `Result: ${JSON.stringify(response.body, null, 4)}`
    }
    this.logTrace(
      `Response received: ${response.command} (${
        response.request_seq
      }). Request took ${Date.now() - startTime} ms. Success: ${
        response.success
      } ${!response.success ? '. Message: ' + response.message : ''}`,
      data
    )
  }

  public traceEvent(event: Proto.Event): void {
    if (this.trace === Trace.Off) {
      return
    }
    let data: string | undefined
    if (this.trace === Trace.Verbose && event.body) {
      data = `Data: ${JSON.stringify(event.body, null, 4)}`
    }
    this.logTrace(`Event received: ${event.event} (${event.seq}).`, data)
  }

  public logTrace(message: string, data?: any): void {
    if (this.trace !== Trace.Off) {
      this.logger.trace(message, data)
    }
  }
}
