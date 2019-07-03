import { http, https } from 'follow-redirects'
import { Agent, RequestOptions } from 'http'
import { Readable } from 'stream'
import tunnel from 'tunnel'
import { parse } from 'url'
import zlib from 'zlib'
import { objectLiteral } from '../util/is'
import workspace from '../workspace'
const logger = require('../util/logger')('model-fetch')

export function getAgent(protocol: string): Agent {
  let proxy = workspace.getConfiguration('http').get<string>('proxy', '')
  let key = protocol.startsWith('https') ? 'HTTPS_PROXY' : 'HTTP_PROXY'
  if (!proxy && process.env[key]) {
    proxy = process.env[key].replace(/^https?:\/\//, '').replace(/\/$/, '')
  }
  if (proxy) {
    let auth = proxy.includes('@') ? proxy.split('@', 2)[0] : ''
    let parts = auth.length ? proxy.slice(auth.length + 1).split(':') : proxy.split(':')
    if (parts.length > 1) {
      let agent = tunnel.httpsOverHttp({
        proxy: {
          headers: {},
          host: parts[0],
          port: parseInt(parts[1], 10),
          proxyAuth: auth
        }
      })
      return agent
    }
  }
}

/**
 * Fetch text from server
 */
export default function fetch(url: string, data?: string | { [key: string]: any }, options: RequestOptions = {}): Promise<string | { [key: string]: any }> {
  let mod = url.startsWith('https') ? https : http
  let endpoint = parse(url)
  let agent = getAgent(endpoint.protocol)
  let opts: RequestOptions = Object.assign({
    method: 'GET',
    hostname: endpoint.hostname,
    port: endpoint.port ? parseInt(endpoint.port, 10) : (endpoint.protocol === 'https:' ? 443 : 80),
    path: endpoint.path,
    protocol: url.startsWith('https') ? 'https:' : 'http:',
    agent,
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64)',
      'Accept-Encoding': 'gzip'
    }
  }, options)
  if (data && objectLiteral(data)) {
    opts.headers['Content-Type'] = 'application/json'
  }
  if (data && !opts.method) {
    opts.method = 'POST'
  }
  return new Promise<string>((resolve, reject) => {
    // tslint:disable-next-line: only-arrow-functions
    try {
      const req = mod.request(opts, res => {
        let readable: Readable = res
        if (res.statusCode != 200) {
          reject(new Error(`Invalid response from ${url}: ${res.statusCode}`))
          return
        }
        let chunks: Buffer[] = []
        let contentType = res.headers['content-type']
        let contentEncoding = res.headers['content-encoding']
        let ms = contentType.match(/charset=(\S+)/)
        let encoding = ms ? ms[1] : 'utf8'
        if (contentEncoding == 'gzip') {
          const unzip = zlib.createGunzip()
          readable = res.pipe(unzip)
        }
        readable.on('data', chunk => {
          chunks.push(chunk)
        })
        readable.on('end', () => {
          let buf = Buffer.concat(chunks)
          let rawData = buf.toString(encoding)
          if (/^application\/json/.test(contentType)) {
            try {
              const parsedData = JSON.parse(rawData)
              resolve(parsedData)
            } catch (e) {
              reject(`Parse error: ${e}`)
            }
          } else {
            resolve(rawData)
          }
        })
      })
      req.on('error', reject)
      if (data) {
        if (typeof data == 'string') {
          req.write(data)
        } else {
          req.write(JSON.stringify(data))
        }
      }
      req.end()
    } catch (e) {
      logger.error(e)
      reject(e)
    }
  })
}
