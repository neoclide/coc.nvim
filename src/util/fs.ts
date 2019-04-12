import { exec } from 'child_process'
import fs from 'fs'
import net from 'net'
import os from 'os'
import path from 'path'
import readline from 'readline'
import util from 'util'
const logger = require('./logger')('util-fs')

export type OnReadLine = (line: string) => void

export async function statAsync(filepath: string): Promise<fs.Stats | null> {
  let stat = null
  try {
    stat = await util.promisify(fs.stat)(filepath)
  } catch (e) { } // tslint:disable-line
  return stat
}

export async function isDirectory(filepath: string): Promise<boolean> {
  let stat = await statAsync(filepath)
  return stat && stat.isDirectory()
}

export async function unlinkAsync(filepath: string): Promise<void> {
  try {
    await util.promisify(fs.unlink)(filepath)
  } catch (e) { } // tslint:disable-line
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
    let { stdout } = await util.promisify(exec)('git rev-parse --show-toplevel', { cwd: path.dirname(fullpath) })
    root = stdout.trim()
  } catch (e) { } // tslint:disable-line
  if (!root) return false
  let file = path.relative(root, fullpath)
  try {
    let { stdout } = await util.promisify(exec)(`git check-ignore ${file}`, { cwd: root })
    return stdout.trim() == file
  } catch (e) { } // tslint:disable-line
  return false
}

export function resolveRoot(dir: string, subs: string[], cwd?: string): string | null {
  let home = os.homedir()
  if (home.startsWith(dir)) return null
  let { root } = path.parse(dir)
  if (root == dir) return null
  if (cwd && cwd != home && dir.startsWith(cwd) && inDirectory(cwd, subs)) return cwd
  let parts = dir.split(path.sep)
  let curr: string[] = [parts.shift()]
  for (let part of parts) {
    curr.push(part)
    let dir = curr.join(path.sep)
    if (dir != home && inDirectory(dir, subs)) {
      return dir
    }
  }
  return null
}

export function inDirectory(dir: string, subs: string[]): boolean {
  try {
    let files = fs.readdirSync(dir)
    return files.findIndex(f => subs.indexOf(f) !== -1) !== -1
  } catch (e) {
    // could be failed without permission
    return false
  }
}

export function readFile(fullpath: string, encoding: string): Promise<string> {
  return new Promise((resolve, reject) => {
    fs.readFile(fullpath, encoding, (err, content) => {
      if (err) reject(err)
      resolve(content)
    })
  })
}

export function readFileLine(fullpath: string, count: number): Promise<string> {
  const rl = readline.createInterface({
    input: fs.createReadStream(fullpath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
    terminal: false
  } as any)
  let n = 0
  return new Promise((resolve, reject) => {
    rl.on('line', line => {
      if (n == count) {
        rl.close()
        resolve(line)
        return
      }
      n = n + 1
    })
    rl.on('error', reject)
  })
}

export async function writeFile(fullpath, content: string): Promise<void> {
  await util.promisify(fs.writeFile)(fullpath, content, 'utf8')
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
  return await util.promisify(fs.readdir)(path)
}

export function isFile(uri: string): boolean {
  return uri.startsWith('file:')
}
