'use strict'
import { Duplex } from 'stream'
import { ClientCapabilities, createProtocolConnection, DocumentSelector, ExitNotification, InitializeRequest, InitializeResult, ProtocolConnection, ServerCapabilities, ShutdownRequest, StreamMessageReader, StreamMessageWriter } from 'vscode-languageserver-protocol/node'
import { BaseLanguageClient, MessageTransports, NullLogger, State } from '../../language-client/client'
import { StaticFeature } from '../../language-client/features'
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

// Records everything the client logs so the tests can assert on the spurious
// "Stopping server failed" error reported by the buggy stop path.
class RecordingChannel implements OutputChannel {
  public content = ''
  public name = 'test'
  public show(): void {}
  public dispose(): void {}
  public append(value: string): void {
    this.content += value
  }
  public appendLine(value: string): void {
    this.content += value + '\n'
  }
  public clear(): void {}
  public hide(): void {}
}

// Counts how many times cleanUp() disposes the registered features. The bug
// re-runs cleanUp() while the client is Stopping, so dispose is called twice
// instead of once.
class CountingFeature implements StaticFeature {
  public readonly method = 'test/countingFeature'
  public disposeCount = 0
  public fillClientCapabilities(_capabilities: ClientCapabilities): void {
  }
  public initialize(_capabilities: ServerCapabilities, _documentSelector: DocumentSelector | undefined): void {
  }
  public dispose(): void {
    this.disposeCount++
  }
}

class StopTestLanguageClient extends BaseLanguageClient {
  public readonly servers: ProtocolConnection[] = []

  public constructor(
    private readonly crashOnShutdown: boolean,
    errorHandler: ErrorHandler,
    outputChannel: OutputChannel
  ) {
    super('stop-race', 'Stop Race Test', { outputChannel, errorHandler })
  }

  protected async createMessageTransports(): Promise<MessageTransports> {
    const up = new TestStream()
    const down = new TestStream()
    const server = createProtocolConnection(new StreamMessageReader(up), new StreamMessageWriter(down), new NullLogger())
    server.onRequest(InitializeRequest.type, () => {
      const result: InitializeResult = { capabilities: {} }
      return result
    })
    if (this.crashOnShutdown) {
      // The server dies at the moment it receives the shutdown request: it
      // disposes the connection and tears down both streams without ever
      // answering, exactly like a real process crashing during shutdown. The
      // close therefore arrives while the client is in the Stopping state.
      server.onRequest(ShutdownRequest.type, () => {
        server.dispose()
        down.end()
        up.destroy()
        return new Promise<null>(() => {})
      })
    } else {
      server.onRequest(ShutdownRequest.type, () => null)
    }
    server.listen()
    this.servers.push(server)
    return {
      reader: new StreamMessageReader(down),
      writer: new StreamMessageWriter(up)
    }
  }
}

function waitForState(client: BaseLanguageClient, state: State): Promise<void> {
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

async function stopAndDispose(client: BaseLanguageClient & { servers: ProtocolConnection[] }): Promise<void> {
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

  it('settles onReady with an error after the client stops', async () => {
    let client = new TestLanguageClient(['ok'], {
      error: () => ({ action: 1 }),
      closed: () => ({ action: CloseAction.DoNotRestart })
    })
    try {
      await client.start()
      await waitForState(client, State.Running)
      await client.stop()
      await waitForState(client, State.Stopped)
      let settled = false
      let err: any
      await Promise.race([
        client.onReady().then(() => {
          settled = true
        }, e => {
          settled = true
          err = e
        }),
        new Promise(resolve => setTimeout(resolve, 500))
      ])
      expect(settled).toBe(true)
      expect(err).toBeTruthy()
    } finally {
      await stopAndDispose(client)
    }
  })
})

describe('Client stop/connection-close race (#9)', () => {
  it('resolves stop() and disposes features once when the connection closes during shutdown', async () => {
    const channel = new RecordingChannel()
    const feature = new CountingFeature()
    const client = new StopTestLanguageClient(true, {
      error: () => ({ action: 1 }),
      closed: () => {
        throw new Error('closed() must not be called while the client is stopping')
      }
    }, channel)
    client.registerFeature(feature, 'test')
    try {
      await client.start()
      expect(client.isRunning()).toBe(true)

      // Bug: handleConnectionClosed re-runs cleanUp() while Stopping and
      // overwrites _onStop, while the pending shutdown rejects after the
      // connection is disposed. The original stop() therefore:
      //   1. rejects with a spurious "Stopping server failed" error
      //   2. double-disposes every feature (disposeCount === 2)
      let stopError: any
      await client.stop(100).catch(err => {
        stopError = err
      })
      expect(stopError).toBeUndefined()
      expect(feature.disposeCount).toBe(1)
      expect(channel.content).not.toContain('Stopping server failed')
      expect(client.isRunning()).toBe(false)
      await waitForState(client, State.Stopped)
    } finally {
      await stopAndDispose(client)
    }
  })

  it('keeps the close handler out of the stop path when shutdown completes normally', async () => {
    const channel = new RecordingChannel()
    const feature = new CountingFeature()
    const client = new StopTestLanguageClient(false, {
      error: () => ({ action: 1 }),
      closed: () => {
        throw new Error('closed() must not be called during a normal stop')
      }
    }, channel)
    client.registerFeature(feature, 'test')
    try {
      await client.start()
      await client.stop(100)
      expect(feature.disposeCount).toBe(1)
      expect(channel.content).not.toContain('Stopping server failed')
      await waitForState(client, State.Stopped)
    } finally {
      await stopAndDispose(client)
    }
  })
})
