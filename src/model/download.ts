'use strict'
import { EventEmitter } from 'events'
import http, { IncomingHttpHeaders, IncomingMessage } from 'http'
import { pipeline } from 'stream/promises'
import { getFileNameLowLevel, open } from 'yauzl'
import type { Entry, ZipFile } from 'yauzl'
import { createLogger } from '../logger'
import { crypto, fs, path } from '../util/node'
import { CancellationToken } from '../util/protocol'
import { FetchOptions, getRequestModule, resolveRequestOptions, timeout, toURL } from './fetch'
const logger = createLogger('model-download')

export interface DownloadOptions extends Omit<FetchOptions, 'buffer'> {
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
  if (destPath === dest) return false
  return destPath.startsWith(dest + path.sep)
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

async function unzipFile(filepath: string, dest: string): Promise<void> {
  let zipfile = await openZip(filepath)
  return await new Promise<void>((resolve, reject) => {
    let settled = false
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
      void fs.promises.mkdir(isDirectory ? target : path.dirname(target), { recursive: true }).then(async () => {
        if (!isDirectory) {
          let input = await openZipEntry(zipfile, entry)
          await pipeline(input, fs.createWriteStream(target))
        }
        zipfile.readEntry()
      }, fail).catch(fail)
    })
    zipfile.readEntry()
  })
}

/**
 * Save a zip response to a temporary file and extract entries to dest.
 * yauzl uses random access, so archive data stays off the JS heap while each
 * entry is still decompressed through a stream.
 */
function extractZip(res: IncomingMessage, dest: string): EventEmitter {
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
    void unzipFile(archive, dest).then(() => finish(), finish)
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
  if (!dest || !path.isAbsolute(dest)) {
    throw new Error(`Invalid dest path: ${dest}`)
  }
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
    if (token) {
      let disposable = token.onCancellationRequested(() => {
        disposable.dispose()
        req.destroy(new Error('request aborted'))
      })
    }
    let timer: NodeJS.Timeout
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
            reject(new Error(`Unable to detect extract method for ${url}`))
            return
          }
        }
        let total = Number(headers['content-length'])
        let hasTotal = !isNaN(total)
        let cur = 0
        res.on('error', err => {
          reject(new Error(`Unable to connect ${url}: ${err.message}`))
        })
        let hash = checkEtag ? crypto.createHash(etagAlgorithm) : undefined
        res.on('data', chunk => {
          cur += chunk.length
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
        if (extract === 'untar') {
          const tar = require('tar')
          stream = res.pipe(tar.x({ strip: options.strip ?? 1, C: dest }))
        } else if (extract === 'unzip') {
          stream = extractZip(res, dest)
        } else {
          dest = path.join(dest, `${crypto.randomUUID()}${extname}`)
          stream = res.pipe(fs.createWriteStream(dest))
        }
        stream.on('finish', () => {
          if (hash) {
            if (hash.digest('hex') !== etag) {
              reject(new Error(`Etag check failed by ${etagAlgorithm}, content not match.`))
              return
            }
          }
          logger.info(`Downloaded ${url} => ${dest}`)
          setTimeout(() => {
            resolve(dest)
          }, 100)
        })
        stream.on('error', reject)
      } else {
        reject(new Error(`Invalid response from ${url}: ${res.statusCode}`))
      }
    })
    obj.req = req
    req.on('error', e => {
      // Possible succeed proxy request with ECONNRESET error on node > 14
      if (e['code'] == 'ECONNRESET') {
        timer = setTimeout(() => {
          reject(e)
        }, timeout)
      } else {
        clearTimeout(timer)
        if (opts.agent && opts.agent.proxy) {
          reject(new Error(`Request failed using proxy ${opts.agent.proxy.host}: ${e.message}`))
          return
        }
        reject(e)
      }
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
