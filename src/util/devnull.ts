import { Duplex } from 'stream'

export class DevNull extends Duplex {
  public _read(): void {
    // noop
  }
  public _write(_chunk: any, _enc: any, cb: Function): void {
    cb()
  }
}
