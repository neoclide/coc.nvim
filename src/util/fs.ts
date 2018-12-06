import { exec } from 'child_process'
import fs from 'fs'
import net from 'net'
import os from 'os'
import path from 'path'
import pify from 'pify'
import readline from 'readline'
import mkdirp from 'mkdirp'
const logger = require('./logger')('util-fs')

export type OnReadLine = (line: string) => void

export async function statAsync(filepath: string): Promise<fs.Stats | null> {
  let stat = null
  try {
    stat = await pify(fs.stat)(filepath)
  } catch (e) { } // tslint:disable-line
  return stat
}

export function mkdirAsync(filepath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    mkdirp(filepath, err => {
      if (err) return reject(err)
      resolve()
    })
  })
}

export function renameAsync(oldPath: string, newPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.rename(oldPath, newPath, err => {
      if (err) return reject(err)
      resolve()
    })
  })
}

export async function isGitIgnored(fullpath: string): Promise<boolean> {
  if (!fullpath) return false
  let stat = await statAsync(fullpath)
  if (!stat || !stat.isFile()) return false
  let root = null
  try {
    let out = await pify(exec)('git rev-parse --show-toplevel', { cwd: path.dirname(fullpath) })
    root = out.trim()
  } catch (e) { } // tslint:disable-line
  if (!root) return false
  let file = path.relative(root, fullpath)
  try {
    let out = await pify(exec)(`git check-ignore ${file}`, { cwd: root })
    return out.trim() == file
  } catch (e) { } // tslint:disable-line
  return false
}

export function getParentDirs(fullpath: string): string[] {
  let obj = path.parse(fullpath)
  if (!obj || !obj.root) return []
  let res = []
  let p = path.dirname(fullpath)
  while (p && p !== obj.root) {
    res.push(p)
    p = path.dirname(p)
  }
  return res
}

export function resolveRoot(cwd: string, subs: string[], home?: string): string | null {
  home = home || os.homedir()
  let { root } = path.parse(cwd)
  let paths = getParentDirs(cwd)
  for (let p of paths) {
    if (p == home || p == root) return null
    for (let sub of subs) {
      let d = path.join(p, sub)
      if (fs.existsSync(d)) return path.dirname(d)
    }
  }
  if (cwd !== home && cwd !== root) return cwd
  return null
}

export function readFile(fullpath: string, encoding: string): Promise<string> {
  return new Promise((resolve, reject) => {
    fs.readFile(fullpath, encoding, (err, content) => {
      if (err) reject(err)
      resolve(content)
    })
  })
}

export function readFileByLine(fullpath: string, onLine: OnReadLine, limit = 50000): Promise<void> {
  const rl = readline.createInterface({
    input: fs.createReadStream(fullpath),
    crlfDelay: Infinity,
    terminal: false,
    highWaterMark: 1024 * 1024
  } as any)
  let n = 0
  rl.on('line', line => {
    n = n + 1
    if (n === limit) {
      rl.close()
    } else {
      onLine(line)
    }
  })
  return new Promise((resolve, reject) => {
    rl.on('close', () => {
      resolve()
    })
    rl.on('error', reject)
  })
}

export async function writeFile(fullpath, content: string): Promise<void> {
  await pify(fs.writeFile)(fullpath, content, 'utf8')
}

export function validSocket(path: string): Promise<boolean> {
  let clientSocket = new net.Socket()
  return new Promise(resolve => {
    clientSocket.on('error', () => {
      resolve(false)
    })
    clientSocket.connect({ path }, () => {
      clientSocket.unref()
      resolve(true)
    })
  })
}

export async function readdirAsync(path: string): Promise<string[]> {
  return await pify(fs.readdir)(path)
}

export function isFile(uri: string): boolean {
  return uri.startsWith('file:')
}
