import { exec } from 'child_process'
import path from 'path'
import { statAsync } from './fs'

let resolved

function resolveRoot(): Promise<string> {
  if (resolved) return Promise.resolve(resolved)
  return new Promise(resolve => {
    exec('npm root -g', (error, out) => {
      if (error) {
        return resolve('')
      }
      resolved = out.trim()
      resolve(resolved)
    })
  })
}

export async function globalResolve(name: string): Promise<string> {
  let root = await resolveRoot()
  if (!root) return
  let p = path.join(root, name)
  let stat = await statAsync(p)
  if (stat && stat.isDirectory()) {
    return p
  }
}
