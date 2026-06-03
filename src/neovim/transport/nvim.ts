import { decode, decodeMultiStream, Encoder, ExtensionCodec } from '@msgpack/msgpack'
import { Metadata } from '../api/types'
import { ILogger } from '../utils/logger'
import Transport, { Response } from './base'

export class NvimTransport extends Transport {
  private pending: Map<number, (...args: any[]) => any> = new Map()
  private nextRequestId = 1
  private reader: NodeJS.ReadableStream
  private writer: NodeJS.WritableStream
  private readonly extensionCodec: ExtensionCodec = this.initializeExtensionCodec()
  private readonly encoder: Encoder = new Encoder({ extensionCodec: this.extensionCodec, ignoreUndefined: true })
  private readonly extEncoder: Encoder = new Encoder({ ignoreUndefined: true })
  private decodeIterator: AsyncGenerator<unknown, void, unknown> | undefined
  private decodeGeneration = 0
  private onReaderEnd: (() => void) | undefined
  private attached = false

  // Neovim client that holds state
  private client: any

  constructor(logger: ILogger) {
    super(logger, false)
  }

  private initializeExtensionCodec(): ExtensionCodec {
    const codec = new ExtensionCodec()
    Metadata.forEach(({ constructor }, id: number): void => {
      codec.register({
        type: id,
        encode: (input: any) => {
          if (input instanceof constructor) {
            return this.extEncoder.encode(input.data)
          }
          return null
        },
        decode: data =>
          new constructor({
            client: this.client,
            data: decode(data),
          }),
      })
    })
    return codec
  }

  private encodeToBuffer(value: unknown): Buffer {
    const encoded = this.encoder.encode(value)
    return Buffer.from(encoded.buffer, encoded.byteOffset, encoded.byteLength)
  }

  private parseMessage(msg: any[]): void {
    if (!this.attached) return
    const msgType = msg[0]
    this.debugMessage(msg)

    if (msgType === 0) {
      // request
      //   - msg[1]: id
      //   - msg[2]: method name
      //   - msg[3]: arguments
      let method = msg[2].toString()
      this.emit(
        'request',
        method,
        msg[3],
        this.createResponse(method, msg[1])
      )
    } else if (msgType === 1) {
      // response to a previous request:
      //   - msg[1]: the id
      //   - msg[2]: error(if any)
      //   - msg[3]: result(if not errored)
      const id = msg[1]
      const handler = this.pending.get(id)
      if (handler) {
        this.pending.delete(id)
        let err = msg[2]
        if (err && err.length != 2) {
          err = [0, err.toString()]
        }
        handler(err, msg[3])
      }
    } else if (msgType === 2) {
      // notification/event
      //   - msg[1]: event name
      //   - msg[2]: arguments
      this.emit('notification', msg[1].toString(), msg[2])
    } else {

      console.error(`Invalid message type ${msgType}`)
    }
  }

  private createDecodeSource(reader: NodeJS.ReadableStream): any {
    let readable = reader as any
    if (typeof readable.iterator === 'function') {
      return readable.iterator({ destroyOnReturn: false })
    }
    return reader
  }

  private async decodeLoop(iter: AsyncGenerator<unknown, void, unknown>, generation: number): Promise<void> {
    try {
      while (true) {
        const resolved = await iter.next()
        if (resolved.done || !this.attached || iter !== this.decodeIterator || generation !== this.decodeGeneration) return
        if (Array.isArray(resolved.value)) {
          this.parseMessage(resolved.value)
        } else {

          console.error('invalid msgpack-RPC message: expected array')
        }
      }
    } catch (err) {
      if (iter !== this.decodeIterator || generation !== this.decodeGeneration) return

      console.error('Decode stream error:', err)
      this.detach()
      this.emit('detach')
    }
  }

  public attach(
    writer: NodeJS.WritableStream,
    reader: NodeJS.ReadableStream,
    client: any
  ): void {
    this.writer = writer
    this.reader = reader
    this.client = client
    this.attached = true
    this.decodeGeneration = this.decodeGeneration + 1
    const generation = this.decodeGeneration

    this.onReaderEnd = () => {
      const wasAttached = this.attached
      this.detach()
      if (wasAttached) this.emit('detach')
    }
    this.reader.once('end', this.onReaderEnd)

    const asyncDecodeGenerator = decodeMultiStream(this.createDecodeSource(this.reader), {
      extensionCodec: this.extensionCodec,
    })
    this.decodeIterator = asyncDecodeGenerator
    void this.decodeLoop(asyncDecodeGenerator, generation)
  }

  public detach(): void {
    if (!this.attached) return
    this.attached = false
    this.decodeGeneration = this.decodeGeneration + 1
    if (this.onReaderEnd) {
      this.reader.off('end', this.onReaderEnd)
      this.onReaderEnd = undefined
    }
    let iter = this.decodeIterator
    this.decodeIterator = undefined
    if (iter && typeof iter.return === 'function') {
      void iter.return(undefined).catch(err => {
        this.debug('decode iterator return error:', err)
      })
    }
    for (let handler of this.pending.values()) {
      handler([0, 'transport disconnected'])
    }
    this.pending.clear()
  }

  public request(method: string, args: any[], cb: (...args: any[]) => any): any {
    if (!this.attached) return cb([0, 'transport disconnected'])
    let id = this.nextRequestId
    this.nextRequestId = this.nextRequestId + 1
    let startTs = Date.now()
    this.debug('request to nvim:', id, method, args)
    this.writer.write(this.encodeToBuffer([0, id, method, args]))
    this.pending.set(id, (err, res) => {
      this.debug('response of nvim:', id, Date.now() - startTs, res, err)
      cb(err, res)
    })
  }

  public notify(method: string, args: any[]): void {
    if (!this.attached) return
    if (this.pauseLevel != 0) {
      let arr = this.paused.get(this.pauseLevel)
      if (arr) {
        arr.push([method, args])
        return
      }
    }
    this.debug('nvim notification:', method, args)
    this.writer.write(this.encodeToBuffer([2, method, args]))
  }

  public send(arr: any[]): void {
    this.writer.write(this.encodeToBuffer(arr))
  }

  public vimCommand(command, ..._args: any[]): void {
    throw new Error(`Command "${command}"  not exists on nvim`)
  }

  public vimRequest(command, _args: any[]): Promise<any> {
    throw new Error(`Command "${command}"  not exists on nvim`)
  }

  protected createResponse(_method: string, requestId: number): Response {
    let startTs = Date.now()
    let called = false
    return {
      send: (resp: any, isError?: boolean): void => {
        if (called || !this.attached) return
        this.debug('response of client:', requestId, `${Date.now() - startTs}ms`, resp, isError == true)
        called = true
        this.writer.write(this.encodeToBuffer([
          1,
          requestId,
          isError ? resp : null,
          !isError ? resp : null,
        ]))
      }
    }
  }
}
