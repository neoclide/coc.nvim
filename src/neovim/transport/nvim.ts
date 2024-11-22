import * as msgpack from '@chemzqm/msgpack-lite'
import { Metadata } from '../api/types'
import Buffered from '../utils/buffered'
import { ILogger } from '../utils/logger'
import Transport, { Response } from './base'

export class NvimTransport extends Transport {
  private pending: Map<number, Function> = new Map()
  private nextRequestId = 1
  private encodeStream: any
  private decodeStream: any
  private reader: NodeJS.ReadableStream
  private writer: NodeJS.WritableStream
  protected codec: msgpack.Codec
  private attached = false

  // Neovim client that holds state
  private client: any

  constructor(logger: ILogger) {
    super(logger, false)

    const codec = this.setupCodec()
    this.encodeStream = msgpack.createEncodeStream({ codec })
    this.decodeStream = msgpack.createDecodeStream({ codec })
    this.decodeStream.on('data', (msg: any[]) => {
      this.parseMessage(msg)
    })
    this.decodeStream.on('end', () => {
      this.detach()
      this.emit('detach')
    })
  }

  private parseMessage(msg: any[]): void {
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
      // tslint:disable-next-line: no-console
      console.error(`Invalid message type ${msgType}`)
    }
  }

  private setupCodec(): msgpack.Codec {
    const codec = msgpack.createCodec()

    Metadata.forEach(
      ({ constructor }, id: number): void => {
        codec.addExtPacker(id, constructor, (obj: any) =>
          msgpack.encode(obj.data)
        )
        codec.addExtUnpacker(
          id,
          data =>
            new constructor({
              client: this.client,
              data: msgpack.decode(data),
            })
        )
      }
    )

    this.codec = codec
    return this.codec
  }

  public attach(
    writer: NodeJS.WritableStream,
    reader: NodeJS.ReadableStream,
    client: any
  ): void {
    this.encodeStream = this.encodeStream.pipe(writer)
    const buffered = new Buffered()
    reader.pipe(buffered).pipe(this.decodeStream)
    this.writer = writer
    this.reader = reader
    this.client = client
    this.attached = true
  }

  public detach(): void {
    if (!this.attached) return
    this.attached = false
    this.encodeStream.unpipe(this.writer)
    this.reader.unpipe(this.decodeStream)
    for (let handler of this.pending.values()) {
      handler([0, 'transport disconnected'])
    }
    this.pending.clear()
  }

  public request(method: string, args: any[], cb: Function): any {
    if (!this.attached) return cb([0, 'transport disconnected'])
    let id = this.nextRequestId
    this.nextRequestId = this.nextRequestId + 1
    let startTs = Date.now()
    this.debug('request to nvim:', id, method, args)
    this.encodeStream.write(
      msgpack.encode([0, id, method, args], {
        codec: this.codec,
      })
    )
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
    this.encodeStream.write(
      msgpack.encode([2, method, args], {
        codec: this.codec,
      })
    )
  }

  public send(arr: any[]): void {
    this.encodeStream.write(
      msgpack.encode(arr, {
        codec: this.codec,
      })
    )
  }

  protected createResponse(method: string, requestId: number): Response {
    let { encodeStream } = this
    let startTs = Date.now()
    let called = false
    let timer = setTimeout(() => {
      this.debug(`request to client cost more than 1s`, requestId)
    }, 1000)
    return {
      send: (resp: any, isError?: boolean): void => {
        clearTimeout(timer)
        if (called || !this.attached) return
        this.debug('response of client:', requestId, `${Date.now() - startTs}ms`, resp, isError == true)
        called = true
        encodeStream.write(
          msgpack.encode([
            1,
            requestId,
            isError ? resp : null,
            !isError ? resp : null,
          ])
        )
      }
    }
  }
}
