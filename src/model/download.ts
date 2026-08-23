'use strict'
import { EventEmitter } from 'events'
import http, { IncomingHttpHeaders, IncomingMessage } from 'http'
import { pipeline } from 'stream/promises'
import type { Writable } from 'stream'
import { getFileNameLowLevel, open } from 'yauzl'
import type { Entry, ZipFile } from 'yauzl'
import { createLogger } from '../logger'
import { crypto, fs, path } from '../util/node'
import { CancellationToken } from '../util/protocol'
import { FetchOptions, getRequestModule, resolveRequestOptions, timeout, toURL } from './fetch'
const logger = createLogger('model-download')
const DEFAULT_MAX_DOWNLOAD_SIZE = 512 * 1024 * 1024
const DEFAULT_MAX_EXTRACT_SIZE = 1024 * 1024 * 1024
const DEFAULT_MAX_ARCHIVE_ENTRIES = 100000

export interface DownloadOptions extends Omit<FetchOptions, 'buffer' | 'maxResponseSize'> {
  /**
   * Folder that contains downloaded file or extracted files by untar or unzip
   */
  dest: string
  /**
   * algorithm for check etag.
   */
  etagAlgorithm?: string
  /**
   * Remove the specified number of leading path elements for *untar* only, default to `1`.
   */
  strip?: number
  /**
   * If true, use untar for `.tar.gz` filename
   */
  extract?: boolean | 'untar' | 'unzip'
  onProgress?: (percent: string) => void
  agent?: http.Agent
  /** Maximum number of compressed bytes accepted from the network. */
  maxDownloadSize?: number
  /** Maximum total uncompressed ZIP size. */
  maxExtractSize?: number
  /** Maximum number of ZIP entries. */
  maxArchiveEntries?: number
}

export function getEtag(headers: IncomingHttpHeaders): string | undefined {
  let header = headers['etag']
  if (typeof header !== 'string') return undefined
  header = header.replace(/^W\//, '')
  if (!header.startsWith('"') || !header.endsWith('"')) return undefined
  return header.slice(1, -1)
}

export function getExtname(dispositionHeader: string): string | undefined {
  const contentDisposition = require('content-disposition')
  let disposition = contentDisposition.parse(dispositionHeader)
  let filename = disposition.parameters.filename
  if (filename) return path.extname(filename)
  return undefined
}

/**
 * Validate that zip entry path won't escape the dest folder. Absolute
 * entry paths are treated as relative and extracted under dest, same as
 * previous unzip behavior.
 */
function isSafeEntryPath(dest: string, entryPath: string): boolean {
  // path.join treats absolute entry paths as relative, keeping the
  // extracted files inside dest.
  let destPath = path.join(dest, entryPath)
  let relative = path.relative(dest, destPath)
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function openZip(filepath: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    // Decode names ourselves so absolute paths can retain the established
    // behavior of being extracted below dest after path.join normalization.
    open(filepath, { lazyEntries: true, decodeStrings: false }, (error, zipfile) => {
      if (error) reject(error)
      else resolve(zipfile)
    })
  })
}

function openZipEntry(zipfile: ZipFile, entry: Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (error, stream) => {
      if (error) reject(error)
      else resolve(stream)
    })
  })
}

async function unzipFile(filepath: string, dest: string, maxExtractSize: number, maxArchiveEntries: number): Promise<void> {
  let zipfile = await openZip(filepath)
  return await new Promise<void>((resolve, reject) => {
    let settled = false
    let entries = 0
    let extractedSize = 0
    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      zipfile.close()
      reject(error)
    }
    zipfile.on('error', fail)
    zipfile.on('end', () => {
      if (settled) return
      settled = true
      resolve()
    })
    zipfile.on('entry', (entry: Entry) => {
      entries++
      extractedSize += entry.uncompressedSize
      if (entries > maxArchiveEntries || extractedSize > maxExtractSize) {
        fail(new Error('Zip archive exceeds extraction limits'))
        return
      }
      let entryPath = getFileNameLowLevel(entry.generalPurposeBitFlag, entry.fileNameRaw, entry.extraFields, false)
      // Preserve unzip-stream's behavior: neutralize parent segments instead
      // of allowing them to escape dest or rejecting the whole archive.
      entryPath = entryPath.replace(/(?<=^|[/\\]+)[.][.]+(?=[/\\]+|$)/g, '.')
      if (!isSafeEntryPath(dest, entryPath)) {
        fail(new Error(`Zip entry path is invalid: ${entryPath}`))
        return
      }
      let target = path.join(dest, entryPath)
      let isDirectory = entryPath.endsWith('/')
      let parent = isDirectory ? target : path.dirname(target)
      void ensureNoSymlink(dest, parent).then(() => fs.promises.mkdir(parent, { recursive: true })).then(async () => {
        await ensureNoSymlink(dest, parent)
        if (!isDirectory) {
          let input = await openZipEntry(zipfile, entry)
          await writeZipEntry(input, target)
        }
        zipfile.readEntry()
      }, fail).catch(fail)
    })
    zipfile.readEntry()
  })
}

async function ensureNoSymlink(dest: string, target: string): Promise<void> {
  let relative = path.relative(dest, target)
  let current = dest
  for (let part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part)
    try {
      let stat = await fs.promises.lstat(current)
      if (stat.isSymbolicLink()) throw new Error(`Refusing to extract through symbolic link: ${current}`)
      if (!stat.isDirectory()) throw new Error(`Invalid extraction directory: ${current}`)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    }
  }
}

async function writeZipEntry(input: NodeJS.ReadableStream, target: string): Promise<void> {
  let flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC
  if (typeof fs.constants.O_NOFOLLOW === 'number') flags |= fs.constants.O_NOFOLLOW
  let handle = await fs.promises.open(target, flags, 0o666)
  try {
    await pipeline(input, handle.createWriteStream())
  } finally {
    await handle.close().catch(() => undefined)
  }
}

/**
 * Save a zip response to a temporary file and extract entries to dest.
 * yauzl uses random access, so archive data stays off the JS heap while each
 * entry is still decompressed through a stream.
 */
function extractZip(res: IncomingMessage, dest: string, options: DownloadOptions): EventEmitter {
  let emitter = new EventEmitter()
  let archive = path.join(dest, `.coc-download-${crypto.randomUUID()}.zip`)
  let output = fs.createWriteStream(archive)
  let settled = false
  const finish = (error?: Error): void => {
    if (settled) return
    settled = true
    void fs.promises.unlink(archive).catch(e => {
      if (e.code !== 'ENOENT') logger.warn(`Unable to remove temporary archive ${archive}:`, e)
    }).then(() => {
      if (error) emitter.emit('error', error)
      else emitter.emit('finish')
    })
  }
  output.on('error', finish)
  output.on('finish', () => {
    void unzipFile(
      archive,
      dest,
      options.maxExtractSize ?? DEFAULT_MAX_EXTRACT_SIZE,
      options.maxArchiveEntries ?? DEFAULT_MAX_ARCHIVE_ENTRIES
    ).then(() => finish(), finish)
  })
  res.on('error', error => {
    output.destroy(error)
  })
  res.pipe(output)
  return emitter
}

/**
 * Download file from url, with optional untar/unzip support.
 * @param {string} url
 * @param {DownloadOptions} options contains dest folder and optional onProgress callback
 */
export default function download(urlInput: string | URL, options: DownloadOptions, token?: CancellationToken, obj: any = {}): Promise<string> {
  let url = toURL(urlInput)
  let { etagAlgorithm } = options
  let { dest, onProgress, extract } = options
  for (let [name, value] of Object.entries({
    maxDownloadSize: options.maxDownloadSize,
    maxExtractSize: options.maxExtractSize,
    maxArchiveEntries: options.maxArchiveEntries
  })) {
    if (value !== undefined && (!Number.isFinite(value) || value <= 0)) throw new Error(`${name} must be a positive finite number`)
  }
  if (!dest || !path.isAbsolute(dest)) {
    throw new Error(`Invalid dest path: ${dest}`)
  }
  // Use one canonical lexical representation for filesystem operations and
  // archive-boundary checks. path.resolve also removes a trailing separator.
  dest = path.resolve(dest)
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true })
  } else {
    let stat = fs.statSync(dest)
    if (stat && !stat.isDirectory()) {
      throw new Error(`${dest} exists, but not directory!`)
    }
  }
  let mod = getRequestModule(url)
  let opts = resolveRequestOptions(url, options)
  if (!opts.agent && options.agent) opts.agent = options.agent
  let extname = path.extname(url.pathname)
  return new Promise<string>((resolve, reject) => {
    let timer: NodeJS.Timeout
    let settled = false
    let cancellation: { dispose(): void } | undefined
    const cleanup = (): void => {
      cancellation?.dispose()
      cancellation = undefined
      if (timer) clearTimeout(timer)
    }
    const succeed = (value: string): void => {
      if (settled) return
      settled = true
      cleanup()
      resolve(value)
    }
    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const req = mod.request(opts, (res: IncomingMessage) => {
      if ((res.statusCode >= 200 && res.statusCode < 300) || res.statusCode === 1223) {
        let headers = res.headers
        let dispositionHeader = headers['content-disposition']
        let etag = getEtag(headers)
        let checkEtag = etag && typeof etagAlgorithm === 'string'
        if (!extname && dispositionHeader) {
          extname = getExtname(dispositionHeader)
        }
        if (extract === true) {
          if (extname === '.zip' || headers['content-type'] == 'application/zip') {
            extract = 'unzip'
          } else if (extname == '.tgz') {
            extract = 'untar'
          } else {
            fail(new Error(`Unable to detect extract method for ${url}`))
            return
          }
        }
        let total = Number(headers['content-length'])
        let hasTotal = !isNaN(total)
        let cur = 0
        res.on('error', err => {
          fail(new Error(`Unable to connect ${url}: ${err.message}`))
        })
        let hash = checkEtag ? crypto.createHash(etagAlgorithm) : undefined
        res.on('data', chunk => {
          cur += chunk.length
          if (cur > (options.maxDownloadSize ?? DEFAULT_MAX_DOWNLOAD_SIZE)) {
            res.destroy(new Error(`Download exceeds maximum size of ${options.maxDownloadSize ?? DEFAULT_MAX_DOWNLOAD_SIZE} bytes`))
            return
          }
          if (hash) hash.update(chunk)
          if (hasTotal) {
            let percent = (cur / total * 100).toFixed(1)
            if (typeof onProgress === 'function') {
              onProgress(percent)
            } else {
              logger.info(`Download ${url} progress ${percent}%`)
            }
          }
        })
        res.on('end', () => {
          clearTimeout(timer)
          timer = undefined
          logger.info('Download completed:', url)
        })
        let stream: any
        const attachStreamHandlers = (): void => {
          stream.on('finish', () => {
            if (hash) {
              if (hash.digest('hex') !== etag) {
                fail(new Error(`Etag check failed by ${etagAlgorithm}, content not match.`))
                return
              }
            }
            logger.info(`Downloaded ${url} => ${dest}`)
            setTimeout(() => {
              succeed(dest)
            }, 100)
          })
          stream.on('error', fail)
        }
        if (extract === 'untar') {
          const tar = require('tar')
          let entries = 0
          let extractedSize = 0
          let rejected = false
          let extraction: Writable & { abort(error: Error): void }
          const rejectEntry = (error: Error): false => {
            if (!rejected) {
              rejected = true
              // tar's parser abort path destroys its underlying streams and
              // emits `error`; unlike throwing from filter, it is caught by
              // the handler installed below.
              extraction.abort(error)
            }
            return false
          }
          extraction = tar.x({
            strip: options.strip ?? 1,
            C: dest,
            preservePaths: false,
            filter: (_entryPath: string, entry: { size?: number, type?: string }) => {
              entries++
              extractedSize += entry.size ?? 0
              if (entry.type === 'SymbolicLink' || entry.type === 'Link') {
                return rejectEntry(new Error('Tar archive links are not supported'))
              }
              if (entries > (options.maxArchiveEntries ?? DEFAULT_MAX_ARCHIVE_ENTRIES)
                || extractedSize > (options.maxExtractSize ?? DEFAULT_MAX_EXTRACT_SIZE)) {
                return rejectEntry(new Error('Tar archive exceeds extraction limits'))
              }
              return true
            }
          })
          stream = extraction
          // Attach the rejection handler before piping. The tar parser invokes
          // filter synchronously while consuming a response data event.
          attachStreamHandlers()
          res.pipe(stream)
          return
        } else if (extract === 'unzip') {
          stream = extractZip(res, dest, options)
        } else {
          dest = path.join(dest, `${crypto.randomUUID()}${extname}`)
          stream = res.pipe(fs.createWriteStream(dest))
        }
        attachStreamHandlers()
      } else {
        res.resume()
        fail(new Error(`Invalid response from ${url}: ${res.statusCode}`))
      }
    })
    obj.req = req
    req.on('error', e => {
      // Possible succeed proxy request with ECONNRESET error on node > 14
      if (e['code'] == 'ECONNRESET') {
        timer = setTimeout(() => {
          fail(e)
        }, timeout)
      } else {
        clearTimeout(timer)
        if (opts.agent && opts.agent.proxy) {
          fail(new Error(`Request failed using proxy ${opts.agent.proxy.host}: ${e.message}`))
          return
        }
        fail(e)
      }
    })
    cancellation = token?.onCancellationRequested(() => {
      req.destroy(new Error('request aborted'))
    })
    req.on('timeout', () => {
      req.destroy(new Error(`request timeout after ${options.timeout}ms`))
    })
    if (typeof options.timeout === 'number' && options.timeout) {
      req.setTimeout(options.timeout)
    }
    req.end()
  })
}
