'use strict'
import { BaseLanguageClient, MessageTransports } from '../../language-client/client'
import { OutputChannel } from '../../types'

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

class TestLanguageClient extends BaseLanguageClient {
  constructor(outputChannel: OutputChannel) {
    super('slow-test', 'Slow Request Test', { outputChannel })
  }

  protected async createMessageTransports(): Promise<MessageTransports> {
    throw new Error('not implemented')
  }
}

describe('slow request log', () => {
  it('should log request still pending after 3s', async () => {
    vi.useFakeTimers()
    try {
      let channel = new RecordingChannel()
      let client = new TestLanguageClient(channel)
      let pending = new Promise<void>(() => {})
      void client['trackSlowRequest']('textDocument/hover', pending)
      await vi.advanceTimersByTimeAsync(3000)
      expect(channel.content).toContain('Request "textDocument/hover" still pending after 3s')
    } finally {
      vi.useRealTimers()
    }
  })

  it('should not log when request resolves before 3s', async () => {
    vi.useFakeTimers()
    try {
      let channel = new RecordingChannel()
      let client = new TestLanguageClient(channel)
      let p = client['trackSlowRequest']('textDocument/hover', Promise.resolve('ok'))
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(3000)
      expect(channel.content).toBe('')
      expect(await p).toBe('ok')
    } finally {
      vi.useRealTimers()
    }
  })
})
