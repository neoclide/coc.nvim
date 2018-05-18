import * as cp from 'child_process'
import ChildProcess = cp.ChildProcess
import EventEmitter = require('events')
const logger = require('../util/logger')('model-child')

export type Callback = (msg:string) => void

export default class StdioService extends EventEmitter {
  private cb:Callback
  private cp:ChildProcess
  private running:boolean
  private reader:NodeJS.ReadableStream
  private writer:NodeJS.WritableStream

  constructor(public command:string, public args?:string[]) {
    super()
    this.command = command
    this.args = args || []
    this.cb = () => { } // tslint:disable-line
  }

  public get isRunnning():boolean {
    return this.running
  }

  public start():void {
    if (this.running) return
    this.cp = cp.spawn(this.command, this.args, {
      detached: false
    })
    this.running = true
    this.cp.stderr.on('data', str => {
      logger.error(str)
      this.emit('error', str)
    })
    this.cp.stdout.on('data', msg => {
      this.emit('message', msg)
    })
    this.reader = this.cp.stdout
    this.writer = this.cp.stdin
    this.cp.on('close', () => {
      this.running = false
      this.emit('close')
    })
  }

  public request(data:{[index:string]: any}):Promise<string|null> {
    if (!this.running) return
    this.writer.write(JSON.stringify(data) + '\n')

    return new Promise((resolve, reject) => {
      setTimeout(() => {
        reject(new Error('Request time out'))
      }, 3000)
      this.once('message', msg => {
        resolve(msg.toString())
      })
    })
  }

  public stop():void {
    if (this.cp) {
      this.cp.kill('SIGHUP')
    }
  }
}
