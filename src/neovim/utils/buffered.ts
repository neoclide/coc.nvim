import { Transform } from 'stream'

const MIN_SIZE = Buffer.poolSize
const waterMark = 10 * 1024 * 1024

export default class Buffered extends Transform {
  private chunks: Buffer[] | null
  private timer: NodeJS.Timeout | null
  constructor() {
    super({
      readableHighWaterMark: waterMark,
      writableHighWaterMark: waterMark
    })
    this.chunks = null
    this.timer = null
  }

  public sendData() {
    const { chunks } = this
    if (chunks) {
      this.chunks = null
      this.push(Buffer.concat(chunks))
    }
  }

  // eslint-disable-next-line consistent-return, @typescript-eslint/explicit-member-accessibility
  _transform(chunk: Buffer, _encoding: any, callback: any): void {
    const { chunks, timer } = this
    if (timer) clearTimeout(timer)
    if (chunk.length < MIN_SIZE) {
      if (!chunks) return callback(null, chunk)
      chunks.push(chunk)
      this.sendData()
      callback()
    } else {
      if (!chunks) {
        this.chunks = [chunk]
      } else {
        chunks.push(chunk)
      }

      this.timer = setTimeout(this.sendData.bind(this), 20)
      callback()
    }
  }

  // eslint-disable-next-line @typescript-eslint/explicit-member-accessibility
  _flush(callback: any) {
    const { chunks } = this
    if (chunks) {
      this.chunks = null
      const buf = Buffer.concat(chunks)
      callback(null, buf)
    } else {
      callback()
    }
  }
}

