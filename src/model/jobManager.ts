import { IWorkspace } from '../types'
import { Neovim } from '@chemzqm/neovim'
import { echoErr } from '../util'

const logger = require('../util/logger')('model-jobManager')

const default_timeout = 60 * 1000

type ResolveCallback = (res: string | null) => void

export default class JobManager {
  private jobid = 1
  private callbackMap: Map<number, (data: string) => void> = new Map()

  constructor(private workspace: IWorkspace) {
  }

  private get nvim(): Neovim {
    return this.workspace.nvim
  }

  public handleResult(id: number, data: string): void {
    let fn = this.callbackMap.get(id)
    this.callbackMap.delete(id)
    if (fn) fn(data)
  }

  public async runCommand(cmd: string, cwd?: string, timeout?: number): Promise<string> {
    timeout = timeout || default_timeout
    let jobid = this.jobid
    this.jobid = this.jobid + 1
    let { callbackMap } = this
    await this.nvim.call('coc#util#run_command', [{
      id: jobid,
      timeout,
      cwd,
      cmd
    }])
    let promise = new Promise((resolve: ResolveCallback) => { // tslint:disable-line
      let timer = setTimeout(() => {
        echoErr(this.nvim, `Command "${cmd}" timeout after ${timeout}s`)
        resolve(null)
      }, timeout * 1000)
      let fn = (data: string): void => {
        clearTimeout(timer)
        resolve(data)
      }
      callbackMap.set(jobid, fn)
    })
    let res = await promise
    return res as string
  }
}
