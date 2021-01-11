import { exec } from 'child_process'
import fs from 'fs-extra'
import net from 'net'
import os from 'os'
import path from 'path'
import readline from 'readline'
import util from 'util'
import minimatch from 'minimatch'
const logger = require('./logger')('util-fs')

export type OnReadLine = (line: string) => void

export async function statAsync(filepath: string): Promise<fs.Stats | null> {
  let stat = null
  try {
    stat = await fs.stat(filepath)
  } catch (e) { }
  return stat
}

export async function isDirectory(filepath: string): Promise<boolean> {
  let stat = await statAsync(filepath)
  return stat && stat.isDirectory()
}

export async function unlinkAsync(filepath: string): Promise<void> {
  try {
    await fs.unlink(filepath)
  } catch (e) { }
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
  } catch (e) { }
  if (!root) return false
  let file = path.relative(root, fullpath)
  try {
    let { stdout } = await util.promisify(exec)(`git check-ignore ${file}`, { cwd: root })
    return stdout.trim() == file
  } catch (e) { }
  return false
}

export function resolveRoot(folder: string, subs: string[], cwd?: string, bottomup = false, checkCwd = true): string | null {
  let home = os.homedir()
  let dir = fixDriver(folder)
  if (isParentFolder(dir, home, true)) return null
  if (checkCwd && cwd && isParentFolder(cwd, dir, true) && inDirectory(cwd, subs)) return cwd
  let parts = dir.split(path.sep)
  if (bottomup) {
    while (parts.length > 0) {
      let dir = parts.join(path.sep)
      if (dir == home) {
          break
      }
      if (dir != home && inDirectory(dir, subs)) {
        return dir
      }
      parts.pop()
    }
  return null
  } else {
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
}

export function inDirectory(dir: string, subs: string[]): boolean {
  try {
    let files = fs.readdirSync(dir)
    for (let pattern of subs) {
      // note, only '*' expanded
      let is_wildcard = (pattern.includes('*'))
      let res = is_wildcard ?
        (minimatch.match(files, pattern, { nobrace: true, noext: true, nocomment: true, nonegate: true, dot: true }).length !== 0) :
        (files.includes(pattern))
      if (res) return true
    }
  } catch (e) {
    // could be failed without permission
  }
  return false
}

export function findUp(name: string | string[], cwd: string): string {
  let root = path.parse(cwd).root
  let subs = Array.isArray(name) ? name : [name]
  while (cwd && cwd !== root) {
    let find = inDirectory(cwd, subs)
    if (find) {
      for (let sub of subs) {
        let filepath = path.join(cwd, sub)
        if (fs.existsSync(filepath)) {
          return filepath
        }
      }
    }
    cwd = path.dirname(cwd)
  }
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

export function getFileLineCount(filepath: string): Promise<number> {
  let i
  let count = 0
  return new Promise((resolve, reject) => {
    fs.createReadStream(filepath)
      .on('error', e => reject(e))
      .on('data', chunk => {
        for (i = 0; i < chunk.length; ++i) if (chunk[i] == 10) count++
      })
      .on('end', () => resolve(count))
  })
}

export function readFileLines(fullpath: string, start: number, end: number): Promise<string[]> {
  if (!fs.existsSync(fullpath)) {
    return Promise.reject(new Error(`file does not exist: ${fullpath}`))
  }
  let res: string[] = []
  const rl = readline.createInterface({
    input: fs.createReadStream(fullpath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
    terminal: false
  } as any)
  let n = 0
  return new Promise((resolve, reject) => {
    rl.on('line', line => {
      if (n == 0 && line.startsWith('\uFEFF')) {
        // handle BOM
        line = line.slice(1)
      }
      if (n >= start && n <= end) {
        res.push(line)
      }
      if (n == end) {
        rl.close()
      }
      n = n + 1
    })
    rl.on('close', () => {
      resolve(res)
    })
    rl.on('error', reject)
  })
}

export function readFileLine(fullpath: string, count: number): Promise<string> {
  if (!fs.existsSync(fullpath)) {
    return Promise.reject(new Error(`file does not exist: ${fullpath}`))
  }
  const rl = readline.createInterface({
    input: fs.createReadStream(fullpath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
    terminal: false
  } as any)
  let n = 0
  return new Promise((resolve, reject) => {
    rl.on('line', line => {
      if (n == count) {
        if (n == 0 && line.startsWith('\uFEFF')) {
          // handle BOM
          line = line.slice(1)
        }
        rl.close()
        resolve(line)
        return
      }
      n = n + 1
    })
    rl.on('error', reject)
  })
}

export async function writeFile(fullpath: string, content: string): Promise<void> {
  await fs.writeFile(fullpath, content, { encoding: 'utf8' })
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

export function isFile(uri: string): boolean {
  return uri.startsWith('file:')
}

export function parentDirs(pth: string): string[] {
  let { root, dir } = path.parse(pth)
  if (dir === root) return [root]
  const dirs = [root]
  const parts = dir.slice(root.length).split(path.sep)
  for (let i = 1; i <= parts.length; i++) {
    dirs.push(path.join(root, parts.slice(0, i).join(path.sep)))
  }
  return dirs
}

export function isParentFolder(folder: string, filepath: string, checkEqual = false): boolean {
  let pdir = fixDriver(path.resolve(path.normalize(folder)))
  let dir = fixDriver(path.resolve(path.normalize(filepath)))
  if (pdir == '//') pdir = '/'
  if (pdir == dir) return checkEqual ? true : false
  if (pdir.endsWith(path.sep)) return dir.startsWith(pdir)
  return dir.startsWith(pdir) && dir[pdir.length] == path.sep
}

// use uppercase for windows driver
export function fixDriver(filepath: string): string {
  if (os.platform() != 'win32' || filepath[1] != ':') return filepath
  return filepath[0].toUpperCase() + filepath.slice(1)
}
