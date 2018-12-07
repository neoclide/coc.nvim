import { exec } from 'child_process'
import fs from 'fs'
import net from 'net'
import os from 'os'
import path from 'path'
import pify from 'pify'
import readline from 'readline'
import mkdirp from 'mkdirp'
import findUp from 'find-up'
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

export function resolveRoot(cwd: string, subs: string[]): string | null {
  let home = os.homedir()
  let { root } = path.parse(cwd)
  let p = findUp.sync(subs, { cwd })
  p = p == null ? null : path.dirname(p)
  if (p == null || p == home || p == root) return cwd
  return p
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
