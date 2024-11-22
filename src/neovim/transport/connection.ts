import Emitter from 'events'
import { createLogger } from '../utils/logger'
const logger = createLogger('connection')
const NR_CODE = 10

// vim connection by using channel feature
export default class Connection extends Emitter {
  private clean: () => void
  constructor(
    readable: NodeJS.ReadableStream,
    private writeable: NodeJS.WritableStream) {
    super()
    let cached: Buffer[] = []
    let hasCache = false
    readable.once('data', buf => {
      if (!Buffer.isBuffer(buf)) throw new Error(`Vim connection expect buffer from readable stream.`)
    })
    // should be utf8 encoding.
    let onData = (buf: Buffer) => {
      let start = 0
      let len = buf.byteLength
      for (let i = 0; i < len; i++) {
        if (buf[i] === NR_CODE) { // '\n'
          let b = buf.slice(start, i)
          if (hasCache) {
            cached.push(b)
            let concated = Buffer.concat(cached)
            hasCache = false
            cached = []
            this.parseData(concated.toString('utf8'))
          } else {
            this.parseData(b.toString('utf8'))
          }
          start = i + 1
        }
      }
      if (start < len) {
        cached.push(start == 0 ? buf : buf.slice(start))
        hasCache = true
      }
    }
    readable.on('data', onData)
    let onClose = () => {
      logger.warn('readable stream closed.')
    }
    readable.on('close', onClose)
    this.clean = () => {
      readable.off('data', onData)
      readable.off('close', onClose)
    }
  }

  private parseData(str: string): void {
    if (str.length == 0) return
    let arr: any[]
    try {
      arr = JSON.parse(str)
    } catch (e) {
      // tslint:disable-next-line: no-console
      console.error(`Invalid data from vim: ${str}`)
      return
    }
    // request, notification, response
    let [id, obj] = arr
    if (id > 0) {
      logger.debug('received request:', id, obj)
      this.emit('request', id, obj)
    } else if (id == 0) {
      logger.debug('received notification:', obj)
      this.emit('notification', obj)
    } else {
      logger.debug('received response:', id, obj)
      // response for previous request
      this.emit('response', id, obj)
    }
  }

  public response(requestId: number, data?: any): void {
    this.send([requestId, data || null])
  }

  public notify(event: string, data?: any): void {
    this.send([0, [event, data || null]])
  }

  public send(arr: any[]): void {
    logger.debug('send to vim:', arr)
    this.writeable.write(JSON.stringify(arr) + '\n')
  }

  public redraw(force?: boolean): void {
    this.send(['redraw', force ? 'force' : ''])
  }

  public command(cmd: string): void {
    this.send(['ex', cmd])
  }

  public expr(expr: string): void {
    this.send(['expr', expr])
  }

  public call(func: string, args: any[], requestId?: number): void {
    if (typeof requestId === 'number') {
      this.send(['call', func, args, requestId])
      return
    }
    this.send(['call', func, args])
  }

  public dispose(): void {
    if (typeof this.clean === 'function') {
      this.clean()
      this.clean = undefined
    }
    this.removeAllListeners()
  }
}
