import {exec} from 'child_process'
import {statAsync} from './fs'
import path from 'path'

let promise:Promise<string> = new Promise(resolve => {
  exec('npm root -g', (error, out) => {
    if (error) {
      return resolve('')
    }
    resolve(out.trim())
  })
})

export async function globalResolve(name:string):Promise<string> {
  let root = await promise
  if (!root) return
  let p = path.join(root, name)
  let stat = await statAsync(p)
  if (stat && stat.isDirectory()) {
    return p
  }
}
