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
    this.child.stderr.on('data', str => {
      logger.error(str)
      this.emit('error', str)
    })
    this.child.stdout.on('data', msg => {
      this.emit('message', msg)
    })
    this.child.on('exit', (code, signal) => {
      this.running = false
      if (code) {
        logger.error(`Service abnormal exit ${code}`)
      }
      this.emit('exit')
    })
  }

  public request(data:{[index:string]: any}):Promise<VimCompleteItem[]|null> {
    if (!this.running) return
    this.child.stdin.write(JSON.stringify(data) + '\n')
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        reject(new Error('Request time out'))
      }, 3000)
      this.once('message', msg => {
        logger.debug(msg.toString())
        try {
          resolve(JSON.parse(msg.toString()))
        } catch (e) {
          reject(new Error('invalid result'))
        }
      })
    })
  }

  public stop():void {
    if (this.child) {
      this.child.kill('SIGHUP')
    }
  }
}
