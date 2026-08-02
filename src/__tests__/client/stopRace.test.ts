'use strict'
import { Duplex } from 'stream'
import { ClientCapabilities, createProtocolConnection, DocumentSelector, InitializeRequest, InitializeResult, ProtocolConnection, ServerCapabilities, ShutdownRequest, StreamMessageReader, StreamMessageWriter } from 'vscode-languageserver-protocol/node'
import { BaseLanguageClient, MessageTransports, NullLogger, State } from '../../language-client/client'
import { StaticFeature } from '../../language-client/features'
import { ErrorHandler } from '../../language-client/utils/errorHandler'
import { OutputChannel } from '../../types'

class TestStream extends Duplex {
  public _write(chunk: string, _encoding: string, done: () => void): void {
    this.emit('data', chunk)
    done()
  }

  public _read(_size: number): void {
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

class TestLanguageClient extends BaseLanguageClient {
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

async function stopAndDispose(client: TestLanguageClient): Promise<void> {
  try {
    await client.stop()
  } catch {
    // The buggy stop path rejects; still tear down the test server.
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

describe('Client stop/connection-close race (#9)', () => {
  it('resolves stop() and disposes features once when the connection closes during shutdown', async () => {
    const channel = new RecordingChannel()
    const feature = new CountingFeature()
    const client = new TestLanguageClient(true, {
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
    const client = new TestLanguageClient(false, {
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
