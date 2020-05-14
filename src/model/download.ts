import { http, https } from 'follow-redirects'
import fs from 'fs'
import mkdirp from 'mkdirp'
import path from 'path'
import tar from 'tar'
import { DownloadOptions } from '../types'
import { resolveRequestOptions } from './fetch'
const logger = require('../util/logger')('model-download')

/**
 * Download and extract tgz from url
 *
 * @param {string} url
 * @param {DownloadOptions} options contains dest folder and optional onProgress callback
 */
export default function download(url: string, options: DownloadOptions): Promise<void> {
  let { dest, onProgress } = options
  if (!dest || !path.isAbsolute(dest)) {
    throw new Error(`Expect absolute file path for dest option.`)
  }
  if (!fs.existsSync(dest)) mkdirp.sync(dest)
  let mod = url.startsWith('https') ? https : http
  let opts = resolveRequestOptions(url, options)
  return new Promise<void>((resolve, reject) => {
    const req = mod.request(opts, (res) => {
      if ((res.statusCode >= 200 && res.statusCode < 300) || res.statusCode === 1223) {
        let headers = res.headers || {}
        const total = parseInt(headers['content-length'], 10)
        let cur = 0
        if (!isNaN(total)) {
          res.on('data', chunk => {
            cur += chunk.length
            let percent = cur / total
            logger.info(`Download progress ${Math.floor(percent * 100)}%`)
            if (onProgress) onProgress(cur / total)
          })
        }
        res.on('error', err => {
          reject(new Error(`Unable to connect ${url}: ${err.message}`))
        })
        res.on('end', () => {
          logger.info('Download completed:', url)
        })
        let stream = res.pipe(tar.x({ strip: 1, C: dest }))
        stream.on('finish', () => {
          logger.info(`Untar finished ${url} => ${dest}`)
          setTimeout(resolve, 100)
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
