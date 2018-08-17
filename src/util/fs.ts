import { exec } from 'child_process'
import fs from 'fs'
import net from 'net'
import os from 'os'
import path from 'path'
import pify from 'pify'
import readline from 'readline'
const logger = require('./logger')('util-fs')

export type OnReadLine = (line: string) => void

export async function statAsync(filepath: string): Promise<fs.Stats | null> {
  let stat = null
  try {
    stat = await pify(fs.stat)(filepath)
  } catch (e) { } // tslint:disable-line
  return stat
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
/**
 * Resolve directory from `root` that contains `sub`
 *
 * @public
 * @param {string} root
 * @param {string} sub
 * @returns {string | null}
 */
export function resolveDirectory(root: string, sub: string): string | null {
  let paths = getParentDirs(root)
  paths.unshift(root)
  for (let p of paths) {
    let d = path.join(p, sub)
    if (fs.existsSync(d)) return d
  }
  return null
}

export function resolveRoot(cwd: string, subs: string[], home?: string): string | null {
  home = home || os.homedir()
  let { root } = path.parse(cwd)
  let paths = getParentDirs(cwd)
  paths.unshift(cwd)
  for (let p of paths) {
    if (p == home || p == root) return null
    for (let sub of subs) {
      let d = path.join(p, sub)
      if (fs.existsSync(d)) return path.dirname(d)
    }
  }
  return root
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

export async function createTmpFile(content: string): Promise<string> {
  let tmpFolder = path.join(os.tmpdir(), `coc-${process.pid}`)
  if (!fs.existsSync(tmpFolder)) {
    fs.mkdirSync(tmpFolder)
  }
  let filename = path.join(tmpFolder, Date.now().toString(26).slice(4))
  await pify(fs.writeFile)(filename, content, 'utf8')
  return filename
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
