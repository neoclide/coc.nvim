'use strict'
import { Duplex } from 'stream'
import { createProtocolConnection, ExitNotification, InitializeRequest, InitializeResult, ProtocolConnection, ShutdownRequest, StreamMessageReader, StreamMessageWriter } from 'vscode-languageserver-protocol/node'
import { BaseLanguageClient, MessageTransports, NullLogger, State } from '../../language-client/client'
import { CloseAction, ErrorHandler } from '../../language-client/utils/errorHandler'
import { OutputChannel } from '../../types'

class TestStream extends Duplex {
  public _write(chunk: string, _encoding: string, done: () => void): void {
    this.emit('data', chunk)
    done()
  }

  public _read(_size: number): void {
  }
}

const nullChannel: OutputChannel = {
  content: '',
  show: () => {},
  dispose: () => {},
  name: 'null',
  append: () => {},
  appendLine: () => {},
  clear: () => {},
  hide: () => {}
}

type ServerBehavior = 'crash' | 'reject' | 'ok'

class TestLanguageClient extends BaseLanguageClient {
  public readonly servers: ProtocolConnection[] = []

  public constructor(
    private readonly behaviors: ServerBehavior[],
    errorHandler: ErrorHandler,
    initializationFailedHandler?: (error: any) => boolean
  ) {
    super('race', 'Race Test', {
      outputChannel: nullChannel,
      errorHandler,
      initializationFailedHandler
    })
  }

  protected async createMessageTransports(): Promise<MessageTransports> {
    const up = new TestStream()
    const down = new TestStream()
    const server = createProtocolConnection(new StreamMessageReader(up), new StreamMessageWriter(down), new NullLogger())
    const behavior = this.behaviors[this.servers.length] ?? 'ok'
    if (behavior === 'crash') {
      // Dies while handling `initialize`: disposes the connection without ever
      // answering the request. A real process crash shows up as EOF on the
      // client reader and a broken pipe on the client writer, so end/destroy
      // the streams as well.
      server.onRequest(InitializeRequest.type, () => {
        server.dispose()
        down.end()
        up.destroy()
        return new Promise<InitializeResult>(() => {})
      })
    } else if (behavior === 'reject') {
      server.onRequest(InitializeRequest.type, () => {
        throw new Error('server rejected initialize')
      })
    } else {
      server.onRequest(InitializeRequest.type, () => {
        const result: InitializeResult = { capabilities: {} }
        return result
      })
    }
    if (behavior !== 'crash') {
      server.onRequest(ShutdownRequest.type, () => null)
      server.onNotification(ExitNotification.type, () => {
        server.dispose()
      })
    }
    server.listen()
    this.servers.push(server)
    return {
      reader: new StreamMessageReader(down),
      writer: new StreamMessageWriter(up)
    }
  }
}

function waitForState(client: TestLanguageClient, state: State): Promise<void> {
  if (client.state === state) return Promise.resolve()
  return new Promise(resolve => {
    let disposable = client.onDidChangeState(e => {
      if (e.newState === state) {
        disposable.dispose()
        resolve()
      }
    })
  })
}

async function waitForSettled(client: TestLanguageClient): Promise<void> {
  // The stale failure path used to stop the restarted client, so wait until
  // the state settles outside Running/Starting before asserting.
  const deadline = Date.now() + 500
  while (Date.now() < deadline) {
    if (client.state !== State.Running && client.state !== State.Starting) {
      return
    }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

async function stopAndDispose(client: TestLanguageClient): Promise<void> {
  try {
    await client.stop()
  } catch {
    // A StartFailed client without a connection can't be stopped.
  } finally {
    for (let server of client.servers) {
      try {
        server.dispose()
      } catch {
        // noop
      }
    }
    await client.dispose()
  }
}

describe('Client start/restart race (#8)', () => {
  it('keeps the client running when the server crashes during initialize and is restarted', async () => {
    let client = new TestLanguageClient(['crash', 'ok'], {
      error: () => ({ action: 1 }),
      closed: () => ({ action: CloseAction.Restart })
    })
    let originalStartError: any
    try {
      let startPromise = client.start()
      // The original start attempt's promise is what the stale `_start` catch
      // used to reject. Attach a catch to record it.
      let ready = client.onReady()
      ready.catch(err => {
        originalStartError = err
      })

      // The automatic restart must bring the client to Running.
      await waitForState(client, State.Running)
      expect(client.isRunning()).toBe(true)

      // Give the stale failure path (old `_start` catch plus the failure
      // handler scheduled by `doInitialize`) a chance to run.
      await waitForSettled(client)
      expect(originalStartError).toBeUndefined()
      expect(client.isRunning()).toBe(true)
      expect(client.servers.length).toBe(2)

      // Both the original and the restarted attempt settle successfully.
      await ready
      await startPromise
    } finally {
      await stopAndDispose(client)
    }
  })

  it('marks the client StartFailed when the close handler declines to restart', async () => {
    let client = new TestLanguageClient(['crash'], {
      error: () => ({ action: 1 }),
      closed: () => ({ action: CloseAction.DoNotRestart })
    })
    let originalStartError: any
    try {
      let startPromise = client.start()
      let ready = client.onReady()
      ready.catch(err => {
        originalStartError = err
      })
      await waitForState(client, State.StartFailed)
      expect(client.isRunning()).toBe(false)
      expect(client.servers.length).toBe(1)
      // Wait until the original start promise settles before asserting.
      await ready.catch(() => {})
      // No restart happened, so the original start promise legitimately
      // rejects with the initialization failure.
      expect(originalStartError).toBeTruthy()
      await startPromise
    } finally {
      await stopAndDispose(client)
    }
  })

  it('reports StartFailed when the restarted server also dies during initialize', async () => {
    let closes = 0
    let client = new TestLanguageClient(['crash', 'crash'], {
      error: () => ({ action: 1 }),
      closed: () => {
        closes++
        return closes === 1
          ? { action: CloseAction.Restart }
          : { action: CloseAction.DoNotRestart }
      }
    })
    let originalStartError: any
    let startError: any
    try {
      let startPromise = client.start().catch(err => {
        startError = err
      })
      let ready = client.onReady()
      ready.catch(err => {
        originalStartError = err
      })
      await waitForState(client, State.StartFailed)
      expect(client.isRunning()).toBe(false)
      expect(client.servers.length).toBe(2)
      expect(closes).toBe(2)
      // Wait until both promises settle before asserting.
      await startPromise
      await ready.catch(() => {})
      // The restarted attempt failed too, so both the original and the
      // current attempt reject.
      expect(startError).toBeTruthy()
      expect(originalStartError).toBeTruthy()
    } finally {
      await stopAndDispose(client)
    }
  })

  it('still runs the initializationFailedHandler and stops on a real initialize error', async () => {
    let handler = vi.fn(() => false)
    let client = new TestLanguageClient(['reject'], {
      error: () => ({ action: 1 }),
      closed: () => {
        throw new Error('closed() should not be called for an error response')
      }
    }, handler)
    let startError: any
    try {
      let startPromise = client.start().catch(err => {
        startError = err
      })
      // Genuine failure path: StartFailed first, then the failure handler
      // calls stop() and the client settles in Stopped.
      await waitForState(client, State.StartFailed)
      await waitForState(client, State.Stopped)
      await new Promise(resolve => setTimeout(resolve, 50))
      expect(handler).toHaveBeenCalledTimes(1)
      expect(startError).toBeTruthy()
      expect(client.isRunning()).toBe(false)
      expect(client.servers.length).toBe(1)
      await startPromise
    } finally {
      await stopAndDispose(client)
    }
  })
})
