import { spawn } from 'child_process'
import fs from 'fs'
import which from 'which'

interface PingConfig {
  bin: string
  args: string[]
  regmatch: RegExp
}

let pingConfig: PingConfig | undefined

export function getPing(platform = process.platform): PingConfig | undefined {
  let config: PingConfig
  if (/^win/.test(platform)) {
    config = {
      bin: 'c:/windows/system32/ping.exe',
      args: ['-n', '1', '-w', '5000'],
      regmatch: /[><=]([0-9.]+?)\s?ms/
    }
  } else if (/^linux/.test(platform)) {
    config = {
      bin: '/bin/ping',
      args: ['-n', '-w', '2', '-c', '1'],
      regmatch: /=([0-9.]+?) ms/
    }
  } else if (/^darwin/.test(platform)) {
    config = {
      bin: '/sbin/ping',
      args: ['-n', '-t', '2', '-c', '1'],
      regmatch: /=([0-9.]+?) ms/
    }
  } else {
    try {
      let bin = which.sync('ping')
      config = {
        bin,
        args: ['-n', '-w', '2', '-c', '1'],
        regmatch: /=([0-9.]+?) ms/
      }
    } catch (_e) {
      // not found
    }
  }
  if (!config || !fs.existsSync(config.bin)) return undefined
  return config
}

export async function findBestHost(hosts: string[], timeout: number, bin?: string): Promise<string | undefined> {
  let config = pingConfig ?? getPing()
  pingConfig = config
  if (hosts.length === 0 || !config) return undefined
  if (hosts.length === 1) return hosts[0]
  const check = (host: string) => {
    return new Promise<number | undefined>(resolve => {
      let args = pingConfig.args.concat([host])
      let stdout = ''
      let cp = spawn(bin ?? pingConfig.bin, args)
      let finished = false
      let timer = setTimeout(() => {
        finished = true
        cp.kill()
        resolve(undefined)
      }, timeout)
      cp.on('error', _e => {
        finished = true
        clearTimeout(timer)
        resolve(undefined)
      })
      let onEnd = () => {
        clearTimeout(timer)
        if (finished) return
        finished = true
        let ms = stdout.match(config.regmatch)
        let milliseconds = (ms && ms[1]) ? Number(ms[1]) : undefined
        resolve(milliseconds)
      }
      cp.stdout.on('data', data => {
        stdout = stdout + data.toString()
      })
      cp.stdout.on('end', () => {
        onEnd()
      })
      cp.on('exit', () => {
        onEnd()
      })
    })
  }
  let minIndex = -1
  let minValue: undefined | number
  await Promise.all(hosts.map((host, idx) => {
    return check(host).then(val => {
      if (val === undefined) return
      if (!minValue || val < minValue) {
        minValue = val
        minIndex = idx
      }
    })
  }))
  return minIndex == -1 ? undefined : hosts[minIndex]
}
