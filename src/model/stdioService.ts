import * as cp from 'child_process'
import ChildProcess = cp.ChildProcess
import EventEmitter = require('events')
import {VimCompleteItem} from '../types'
const logger = require('../util/logger')('model-stdioService')

export type Callback = (msg:string) => void

export default class StdioService extends EventEmitter {
  private child:ChildProcess
  private running:boolean

  constructor(public command:string, public args?:string[]) {
    super()
    this.command = command
    this.args = args || []
  }

  public get isRunnning():boolean {
    return this.running
  }

  public start():void {
    if (this.running) return
    this.child = cp.spawn(this.command, this.args, {
      detached: false
    })
    this.running = true
    let {command} = this
    this.child.stderr.on('data', str => {
      logger.error(`${command} error: ${str}`)
    })
    let msgs = ''
    this.child.stdout.on('data', msg => {
      msgs = msgs + msg.toString()
      if (msgs.trim().slice(-3) === 'END') {
        this.emit('message', msgs.trim().slice(0, -3))
        msgs = ''
      }
    })
    this.child.on('exit', (code, signal) => {
      this.running = false
      if (code) {
        logger.error(`Service abnormal exit ${code}`)
      }
      this.emit('exit')
    })
  }

  public request(data:string):Promise<string|null> {
    if (!this.running) return
    this.child.stdin.write(data + '\n')
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        reject(new Error('Request time out'))
      }, 3000)
      this.once('message', msg => {
        resolve(msg)
      })
    })
  }

  public stop():void {
    if (this.child) {
      this.child.kill('SIGHUP')
    }
  }
}
