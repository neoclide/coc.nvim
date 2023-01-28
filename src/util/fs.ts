'use strict'
import type { Stats } from 'fs'
import { parse, ParseError } from 'jsonc-parser'
import { Location, Position, Range } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import { createLogger } from '../logger'
import { fs, path, promisify } from '../util/node'
import { CancellationToken, Disposable } from '../util/protocol'
import { isFalsyOrEmpty, toArray } from './array'
import { CancellationError } from './errors'
import { child_process, debounce, glob, minimatch, readline } from './node'
import { toObject } from './object'
import * as platform from './platform'
const logger = createLogger('util-fs')
const exec = child_process.exec

export enum FileType {
  /**
   * The file type is unknown.
   */
  Unknown = 0,
  /**
   * A regular file.
   */
  File = 1,
  /**
   * A directory.
   */
  Directory = 2,
  /**
   * A symbolic link to a file.
   */
  SymbolicLink = 64
}

export type OnReadLine = (line: string) => void

export function watchFile(filepath: string, onChange: () => void, immediate = false): Disposable {
  let callback = debounce(onChange, 100)
  try {
    let watcher = fs.watch(filepath, {
      persistent: true,
      recursive: false,
      encoding: 'utf8'
    }, () => {
      callback()
    })
    if (immediate) {
      setTimeout(onChange, 10)
    }
    return Disposable.create(() => {
      callback.clear()
      watcher.close()
    })
  } catch (e) {
    return Disposable.create(() => {
      callback.clear()
    })
  }
}

export function loadJson(filepath: string): object {
  try {
    let errors: ParseError[] = []
    let text = fs.readFileSync(filepath, 'utf8')
    let data = parse(text, errors, { allowTrailingComma: true })
    if (errors.length > 0) {
      logger.error(`Error on parse json file ${filepath}`, errors)
    }
    return data ?? {}
  } catch (e) {
    return {}
  }
}

export function writeJson(filepath: string, obj: any): void {
  let dir = path.dirname(filepath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
    logger.info(`Creating directory ${dir}`)
  }
  fs.writeFileSync(filepath, JSON.stringify(toObject(obj), null, 2), 'utf8')
}

export async function statAsync(filepath: string): Promise<Stats | null> {
  let stat = null
  try {
    stat = await promisify(fs.stat)(filepath)
  } catch (e) {}
  return stat
}

export function isDirectory(filepath: string | undefined): boolean {
  if (!filepath || !path.isAbsolute(filepath) || !fs.existsSync(filepath)) return false
  let stat = fs.statSync(filepath)
  return stat.isDirectory()
}

export function renameAsync(oldPath: string, newPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.rename(oldPath, newPath, err => {
      if (err) return reject(err)
      resolve()
    })
  })
}

export async function remove(filepath: string | undefined): Promise<void> {
  if (!filepath) return
  try {
    await promisify(fs.rm)(filepath, { force: true, recursive: true })
  } catch (e) {
    return
  }
}

export async function getFileType(filepath: string): Promise<FileType | undefined> {
  try {
    const stat = await promisify(fs.lstat)(filepath)
    if (stat.isFile()) {
      return FileType.File
    }
    if (stat.isDirectory()) {
      return FileType.Directory
    }
    if (stat.isSymbolicLink()) {
      return FileType.SymbolicLink
    }
    return FileType.Unknown
  } catch (e) {
    return undefined
  }
}

export async function isGitIgnored(fullpath: string | undefined): Promise<boolean> {
  if (!fullpath) return false
  let stat = await statAsync(fullpath)
  if (!stat || !stat.isFile()) return false
  let root = null
  try {
    let { stdout } = await promisify(exec)('git rev-parse --show-toplevel', { cwd: path.dirname(fullpath) })
    root = stdout.trim()
  } catch (e) {}
  if (!root) return false
  let file = path.relative(root, fullpath)
  try {
    let { stdout } = await promisify(exec)(`git check-ignore ${file}`, { cwd: root })
    return stdout.trim() == file
  } catch (e) {}
  return false
}

export function isFolderIgnored(folder: string, ignored: string[] | undefined): boolean {
  if (isFalsyOrEmpty(ignored)) return false
  return ignored.some(p => sameFile(p, folder) || minimatch(folder, p, { dot: true }))
}

export function resolveRoot(folder: string, subs: ReadonlyArray<string>, cwd?: string, bottomup = false, checkCwd = true, ignored: string[] = []): string | null {
  let dir = normalizeFilePath(folder)
  if (checkCwd
    && cwd
    && isParentFolder(cwd, dir, true)
    && !isFolderIgnored(cwd, ignored)
    && inDirectory(cwd, subs)) return cwd
  let parts = dir.split(path.sep)
  if (bottomup) {
    while (parts.length > 0) {
      let dir = parts.join(path.sep)
      if (!isFolderIgnored(dir, ignored) && inDirectory(dir, subs)) {
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
      if (!isFolderIgnored(dir, ignored) && inDirectory(dir, subs)) {
        return dir
      }
    }
    return null
  }
}

export function checkFolder(dir: string, patterns: string[], token?: CancellationToken): Promise<boolean> {
  return new Promise((resolve, reject) => {
    if (isFalsyOrEmpty(patterns)) return resolve(false)
    let disposable: Disposable | undefined
    if (token) {
      disposable = token.onCancellationRequested(() => {
        reject(new CancellationError())
      })
    }
    let find = false
    let pattern = patterns.length == 1 ? patterns[0] : `{${patterns.join(',')}}`
    let gl = new glob.Glob(pattern, {
      nosort: true,
      ignore: ['node_modules/**', '.git/**'],
      dot: true,
      cwd: dir,
      nodir: true,
      absolute: false
    }, _err => {
      if (disposable) disposable.dispose()
      resolve(find)
    })
    gl.on('match', () => {
      if (disposable) disposable.dispose()
      find = true
      resolve(true)
    })
    gl.on('end', () => {
      if (disposable) disposable.dispose()
      resolve(find)
    })
  })
}

export function inDirectory(dir: string, subs: ReadonlyArray<string>): boolean {
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

/**
 * Find a matched file inside directory.
 */
export function findMatch(dir: string, subs: string[]): string | undefined {
  try {
    let files = fs.readdirSync(dir)
    for (let pattern of subs) {
      // note, only '*' expanded
      let isWildcard = (pattern.includes('*'))
      if (isWildcard) {
        let filtered = files.filter(minimatch.filter(pattern, { nobrace: true, noext: true, nocomment: true, nonegate: true, dot: true }))
        if (filtered.length > 0) return filtered[0]
      } else {
        let file = files.find(s => s === pattern)
        if (file) return file
      }
    }
  } catch (e) {
    // could be failed without permission
  }
  return undefined
}

export function findUp(name: string | string[], cwd: string): string {
  let root = path.parse(cwd).root
  let subs = toArray(name)
  while (cwd && cwd !== root) {
    let find = findMatch(cwd, subs)
    if (find) return path.join(cwd, find)
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
  const input = fs.createReadStream(fullpath, { encoding: 'utf8' })
  const rl = readline.createInterface({
    input,
    crlfDelay: Infinity,
    terminal: false
  } as any)
  let n = 0
  return new Promise((resolve, reject) => {
    rl.on('line', line => {
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
      input.close()
    })
    rl.on('error', reject)
  })
}

export function readFileLine(fullpath: string, count: number): Promise<string> {
  if (!fs.existsSync(fullpath)) return Promise.reject(new Error(`file does not exist: ${fullpath}`))
  const input = fs.createReadStream(fullpath, { encoding: 'utf8' })
  const rl = readline.createInterface({ input, crlfDelay: Infinity, terminal: false } as any)
  let n = 0
  let result = ''
  return new Promise((resolve, reject) => {
    rl.on('line', line => {
      if (n == count) {
        result = line
        rl.close()
        input.close()
      }
      n = n + 1
    })
    rl.on('close', () => {
      resolve(result)
    })
    rl.on('error', reject)
  })
}

export async function lineToLocation(fsPath: string, match: string, text?: string): Promise<Location> {
  let uri = URI.file(fsPath).toString()
  if (!fs.existsSync(fsPath)) return Location.create(uri, Range.create(0, 0, 0, 0))
  const rl = readline.createInterface({
    input: fs.createReadStream(fsPath, { encoding: 'utf8' }),
  })
  let n = 0
  let line = await new Promise<string | undefined>(resolve => {
    let find = false
    rl.on('line', line => {
      if (line.includes(match)) {
        find = true
        rl.removeAllListeners()
        rl.close()
        resolve(line)
        return
      }
      n = n + 1
    })
    rl.on('close', () => {
      if (!find) resolve(undefined)
    })
  })
  if (line != null) {
    let character = text == null ? 0 : line.indexOf(text)
    if (character == 0) character = line.match(/^\s*/)[0].length
    let end = Position.create(n, character + (text ? text.length : 0))
    return Location.create(uri, Range.create(Position.create(n, character), end))
  }
  return Location.create(uri, Range.create(0, 0, 0, 0))
}

export function sameFile(fullpath: string | null, other: string | null, caseInsensitive?: boolean): boolean {
  caseInsensitive = typeof caseInsensitive == 'boolean' ? caseInsensitive : platform.isWindows || platform.isMacintosh
  if (!fullpath || !other) return false
  fullpath = normalizeFilePath(fullpath)
  other = normalizeFilePath(other)
  if (caseInsensitive) return fullpath.toLowerCase() === other.toLowerCase()
  return fullpath === other
}

export function fileStartsWith(dir: string, pdir: string, caseInsensitive = platform.isWindows || platform.isMacintosh) {
  if (caseInsensitive) return dir.toLowerCase().startsWith(pdir.toLowerCase())
  return dir.startsWith(pdir)
}

export async function writeFile(fullpath: string, content: string): Promise<void> {
  await promisify(fs.writeFile)(fullpath, content, { encoding: 'utf8' })
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

export function normalizeFilePath(filepath: string) {
  return URI.file(path.resolve(path.normalize(filepath))).fsPath
}

export function isParentFolder(folder: string, filepath: string, checkEqual = false): boolean {
  let pdir = normalizeFilePath(folder)
  let dir = normalizeFilePath(filepath)
  if (sameFile(pdir, dir)) return checkEqual ? true : false
  return fileStartsWith(dir, pdir) && dir[pdir.length] == path.sep
}
