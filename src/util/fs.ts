import pify = require('pify')
import fs = require('fs')
import path = require('path')
const exec = require('child_process').exec

export async function statAsync(filepath:string):Promise<fs.Stats|null> {
  let stat = null
  try {
    stat = await pify(fs.stat)(filepath)
  } catch (e) {} // tslint:disable-line
  return stat
}

export async function isGitIgnored(fullpath:string):Promise<boolean> {
  if (!fullpath) return false
  let root = null
  try {
    let out = await pify(exec)('git rev-parse --show-toplevel', {cwd: path.dirname(fullpath)})
    root = out.replace(/\r?\n$/, '')
  } catch (e) {} // tslint:disable-line
  if (!root) return false
  let file = path.relative(root, fullpath)
  try {
    let out = await pify(exec)(`git check-ignore ${file}`, {cwd: root})
    return out.replace(/\r?\n$/, '') == file
  } catch (e) {} // tslint:disable-line
  return false
}

export function findSourceDir(fullpath:string):string|null {
  let obj = path.parse(fullpath)
  if (!obj || !obj.root) return null
  let {root, dir} = obj
  let p = dir.slice(root.length)
  let parts = p.split(path.sep)
  let idx = parts.findIndex(s => s == 'src')
  if (idx === -1) return null
  return `${root}${parts.slice(0, idx + 1).join(path.sep)}`
}

export function readFile(fullpath:string, encoding:string, timeout = 1000):Promise<string> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      reject(new Error(`Read file ${fullpath} timeout`))
    }, timeout)
    fs.readFile(fullpath, encoding, (err, content) => {
      if (err) reject(err)
      resolve(content)
    })
  })
}
