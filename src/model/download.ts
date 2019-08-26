import { http, https } from 'follow-redirects'
import fs from 'fs'
import { RequestOptions, ServerResponse } from 'http'
import mkdirp from 'mkdirp'
import path from 'path'
import tar from 'tar'
import { parse } from 'url'
import { DownloadOptions } from '../types'
import { getAgent } from './fetch'

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
  let endpoint = parse(url)
  let mod = url.startsWith('https') ? https : http
  let agent = getAgent(endpoint)
  let opts: RequestOptions = Object.assign({
    method: 'GET',
    hostname: endpoint.hostname,
    port: endpoint.port ? parseInt(endpoint.port, 10) : (endpoint.protocol === 'https:' ? 443 : 80),
    path: endpoint.path,
    protocol: url.startsWith('https') ? 'https:' : 'http:',
    agent,
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64)'
    }
  }, options)
  return new Promise<void>((resolve, reject) => {
    const req = mod.request(opts, (res: ServerResponse) => {
      if (res.statusCode != 200) {
        reject(new Error(`Invalid response from ${url}: ${res.statusCode}`))
        return
      }
      if (onProgress) {
        const len = parseInt((res as any).headers['content-length'], 10)
        let cur = 0
        if (!isNaN(len)) {
          res.on('data', chunk => {
            cur += chunk.length
            onProgress(cur / len)
          })
        }
      }
      let stream = res.pipe(tar.x({ strip: 1, C: dest }))
      stream.on('finish', () => {
        setTimeout(resolve, 100)
      })
      stream.on('error', reject)
    })
    req.on('error', reject)
    req.end()
  })
}
