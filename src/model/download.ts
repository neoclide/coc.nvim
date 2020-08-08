import { http, https } from 'follow-redirects'
import { v1 as uuidv1 } from 'uuid'
import fs from 'fs'
import mkdirp from 'mkdirp'
import path from 'path'
import tar from 'tar'
import { DownloadOptions } from '../types'
import { resolveRequestOptions } from './fetch'
import { ServerResponse } from 'http'
const logger = require('../util/logger')('model-download')

/**
 * Download file from url, with optional untar/unzip support.
 *
 * @param {string} url
 * @param {DownloadOptions} options contains dest folder and optional onProgress callback
 */
export default function download(url: string, options: DownloadOptions): Promise<string> {
  let { dest, onProgress, extract } = options
  if (!dest || !path.isAbsolute(dest)) {
    throw new Error(`Expect absolute file path for dest option.`)
  }
  if (!fs.existsSync(dest)) mkdirp.sync(dest)
  let mod = url.startsWith('https') ? https : http
  let opts = resolveRequestOptions(url, options)
  let extname = path.extname(url)
  if (!extract) dest = path.join(dest, `${uuidv1()}${extname}`)
  return new Promise<string>((resolve, reject) => {
    const req = mod.request(opts, (res: ServerResponse) => {
      if ((res.statusCode >= 200 && res.statusCode < 300) || res.statusCode === 1223) {
        let headers = (res as any).headers || {}
        let total = Number(headers['content-length'])
        let cur = 0
        if (!isNaN(total)) {
          res.on('data', chunk => {
            cur += chunk.length
            let percent = (cur / total * 100).toFixed(1)
            if (onProgress) {
              onProgress(percent)
            } else {
              logger.info(`Download progress ${percent}%`)
            }
          })
        }
        res.on('error', err => {
          reject(new Error(`Unable to connect ${url}: ${err.message}`))
        })
        res.on('end', () => {
          logger.info('Download completed:', url)
        })
        let stream: any
        if (extract) {
          stream = res.pipe(tar.x({ strip: 1, C: dest }))
        } else {
          stream = res.pipe(fs.createWriteStream(dest))
        }
        stream.on('finish', () => {
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
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy(new Error(`request timeout after ${options.timeout}ms`))
    })
    if (options.timeout) {
      req.setTimeout(options.timeout)
    }
    req.end()
  })
}
