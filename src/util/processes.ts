'use strict'
import type { ChildProcess, ExecOptions } from 'child_process'
import { pluginRoot } from './constants'
import { CancellationError } from './errors'
import { child_process, path, which } from './node'
import { platform, Platform } from './platform'

export function isRunning(pid: number): boolean {
  try {
    let res: any = process.kill(pid, 0)
    return res == true
  }
  catch (e) {
    return e['code'] === 'EPERM'
  }
}

export function executable(command: string): boolean {
  try {
    which.sync(command)
  } catch (e) {
    return false
  }
  return true
}

export function runCommand(cmd: string, opts: ExecOptions = {}, timeout?: number, isWindows = platform === Platform.Windows): Promise<string> {
  if (!isWindows) {
    opts.shell = opts.shell || process.env.SHELL
  }
  opts.maxBuffer = 500 * 1024
  return new Promise<string>((resolve, reject) => {
    let timer: NodeJS.Timer
    let cp: ChildProcess
    if (timeout) {
      timer = setTimeout(() => {
        cp.kill('SIGKILL')
        reject(new CancellationError())
      }, timeout * 1000)
    }
    cp = child_process.exec(cmd, opts, (err, stdout, stderr) => {
      if (timer) clearTimeout(timer)
      if (err) {
        reject(new Error(`exited with ${err.code}\n${err}\n${stderr}`))
        return
      }
      resolve(stdout)
    })
  })
}

export function terminate(process: ChildProcess, cwd?: string, pt = platform): boolean {
  if (process.killed) return
  if (pt === Platform.Windows) {
    try {
      // This we run in Atom execFileSync is available.
      // Ignore stderr since this is otherwise piped to parent.stderr
      // which might be already closed.
      let options: any = {
        stdio: ['pipe', 'pipe', 'ignore']
      }
      if (cwd) options.cwd = cwd

      child_process.execFileSync(
        'taskkill',
        ['/T', '/F', '/PID', process.pid.toString()],
        options
      )
      return true
    } catch (err) {
      return false
    }
  } else if (pt === Platform.Linux || pt === Platform.Mac) {
    try {
      let filepath = path.join(pluginRoot, 'bin/terminateProcess.sh')
      let result = child_process.spawnSync(filepath, [process.pid.toString()])
      return result.error ? false : true
    } catch (err) {
      return false
    }
  } else {
    process.kill('SIGKILL')
    return true
  }
}
