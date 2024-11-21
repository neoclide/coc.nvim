/* eslint-disable @typescript-eslint/explicit-member-accessibility */
import { Duplex } from 'stream'

export class DevNull extends Duplex {
  _read() {}
  _write(chunk: any, enc: any, cb: Function) {
    cb()
  }
}
