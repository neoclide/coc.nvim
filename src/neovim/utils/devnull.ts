import { Duplex } from 'stream'

export class DevNull extends Duplex {
  public _read() { }
  public _write(chunk: any, enc: any, cb: (...args: any[]) => any) {
    cb()
  }
}
