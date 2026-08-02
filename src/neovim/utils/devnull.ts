import { Duplex } from 'stream'

export class DevNull extends Duplex {
  public _read() { }
  public _write(chunk: Buffer | string, enc: BufferEncoding, cb: (error?: Error | null) => void) {
    cb()
  }
}
