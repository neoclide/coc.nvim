import { PassThrough } from 'stream'
import { describe, expect, it } from 'vitest'
import { attach } from '@chemzqm/neovim'
import { nullLogger } from '@chemzqm/neovim/lib/utils/logger'

function createClient() {
  let reader = new PassThrough()
  let writer = new PassThrough()
  let client = attach({ reader, writer }, nullLogger, false)
  return { reader, writer, client }
}

describe('NeovimClient async request cleanup', () => {
  it('should reject pending async requests on detach', async () => {
    let { reader, writer, client } = createClient()
    let p = client.callAsync('foo', [1])
    client.detach()
    await expect(p).rejects.toThrow('transport disconnected')
    reader.destroy()
    writer.destroy()
  })

  it('should reject pending async requests when transport disconnects', async () => {
    let { reader, writer, client } = createClient()
    let p = client.callAsync('foo', [1])
    // EOF on the reader makes the transport detach and emit 'detach'
    reader.end()
    await expect(p).rejects.toThrow('transport disconnected')
    writer.destroy()
  })
})
