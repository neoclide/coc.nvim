import { http, https } from 'follow-redirects'
import { Readable } from 'stream'
import { parse, UrlWithStringQuery } from 'url'
import zlib from 'zlib'
import { objectLiteral } from '../util/is'
import workspace from '../workspace'
import { FetchOptions } from '../types'
import { stringify } from 'querystring'
import createHttpProxyAgent, { HttpProxyAgent } from 'http-proxy-agent'
import createHttpsProxyAgent, { HttpsProxyAgent } from 'https-proxy-agent'
const logger = require('../util/logger')('model-fetch')

export type ResponseResult = string | Buffer | { [name: string]: any }

export interface ProxyOptions {
  proxyUrl: string
  strictSSL?: boolean
}

function getSystemProxyURI(endpoint: UrlWithStringQuery): string {
  let env: string | null
  if (endpoint.protocol === 'http:') {
    env = process.env.HTTP_PROXY || process.env.http_proxy || null
  } else if (endpoint.protocol === 'https:') {
    env = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || null
  }
  let noProxy = process.env.NO_PROXY || process.env.no_proxy
  if (noProxy === '*') {
    env = null
  } else if (noProxy) {
    // canonicalize the hostname, so that 'oogle.com' won't match 'google.com'
    const hostname = endpoint.hostname.replace(/^\.*/, '.').toLowerCase()
    const port = endpoint.port || endpoint.protocol.startsWith('https') ? '443' : '80'
    const noProxyList = noProxy.split(',')
    for (let i = 0, len = noProxyList.length; i < len; i++) {
      let noProxyItem = noProxyList[i].trim().toLowerCase()
      // no_proxy can be granular at the port level, which complicates things a bit.
      if (noProxyItem.includes(':')) {
        let noProxyItemParts = noProxyItem.split(':', 2)
        let noProxyHost = noProxyItemParts[0].replace(/^\.*/, '.')
        let noProxyPort = noProxyItemParts[1]
        if (port === noProxyPort && hostname.endsWith(noProxyHost)) {
          env = null
          break
        }
      } else {
        noProxyItem = noProxyItem.replace(/^\.*/, '.')
        if (hostname.endsWith(noProxyItem)) {
          env = null
          break
        }
      }
    }
  }
  return env
}

export function getAgent(endpoint: UrlWithStringQuery, options: ProxyOptions): HttpsProxyAgent | HttpProxyAgent {
  let proxy = options.proxyUrl || getSystemProxyURI(endpoint)
  if (proxy) {
    if (!proxy.startsWith('http')) {
      proxy = 'http://' + proxy
    }
    const proxyEndpoint = parse(proxy)
    if (!/^https?:$/.test(proxyEndpoint.protocol)) {
      return null
    }
    let opts = {
      host: proxyEndpoint.hostname,
      port: Number(proxyEndpoint.port),
      auth: proxyEndpoint.auth,
      rejectUnauthorized: typeof options.strictSSL === 'boolean' ? options.strictSSL : true
    }
    logger.info(`Using proxy ${proxy} from ${options.proxyUrl ? 'configuration' : 'system environment'} for ${endpoint.hostname}:`)
    return endpoint.protocol === 'http:' ? createHttpProxyAgent(opts) : createHttpsProxyAgent(opts)
  }
  return null
}

export function resolveRequestOptions(url: string, options: FetchOptions = {}): any {
  let config = workspace.getConfiguration('http')
  let { data } = options
  let dataType = getDataType(data)
  let proxyOptions: ProxyOptions = {
    proxyUrl: config.get<string>('proxy', ''),
    strictSSL: config.get<boolean>('proxyStrictSSL', true)
  }
  if (options.query && !url.includes('?')) {
    url = `${url}?${stringify(options.query)}`
  }
  let endpoint = parse(url)
  let agent = getAgent(endpoint, proxyOptions)
  let opts: any = {
    method: options.method || 'GET',
    hostname: endpoint.hostname,
    port: endpoint.port ? parseInt(endpoint.port, 10) : (endpoint.protocol === 'https:' ? 443 : 80),
    path: endpoint.path,
    agent,
    rejectUnauthorized: proxyOptions.strictSSL,
    maxRedirects: 3,
    headers: Object.assign({
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64)',
      'Accept-Encoding': 'gzip, deflate'
    }, options.headers || {})
  }
  if (dataType == 'object') {
    opts.headers['Content-Type'] = 'application/json'
  } else if (dataType == 'string') {
    opts.headers['Content-Type'] = 'text/plain'
  }
  if (options.user && options.password) {
    opts.auth = options.user + ':' + options.password
  }
  if (options.timeout) {
    opts.timeout = options.timeout
  }
  return opts
}

function request(url: string, data: any, opts: any): Promise<ResponseResult> {
  let mod = url.startsWith('https:') ? https : http
  return new Promise<ResponseResult>((resolve, reject) => {
    const req = mod.request(opts, res => {
      let readable: Readable = res
      if ((res.statusCode >= 200 && res.statusCode < 300) || res.statusCode === 1223) {
        let headers = res.headers || {}
        let chunks: Buffer[] = []
        let contentType: string = headers['content-type'] || ''
        let contentEncoding: string = headers['content-encoding'] || ''
        if (contentEncoding === 'gzip') {
          const unzip = zlib.createGunzip()
          readable = res.pipe(unzip)
        } else if (contentEncoding === 'deflate') {
          let inflate = zlib.createInflate()
          res.pipe(inflate)
          readable = inflate
        }
        readable.on('data', chunk => {
          chunks.push(chunk)
        })
        readable.on('end', () => {
          let buf = Buffer.concat(chunks)
          if (contentType.startsWith('application/json')
            || contentType.startsWith('text/')) {
            let ms = contentType.match(/charset=(\S+)/)
            let encoding = ms ? ms[1] : 'utf8'
            let rawData = buf.toString(encoding)
            if (!contentType.includes('application/json')) {
              resolve(rawData)
            } else {
              try {
                const parsedData = JSON.parse(rawData)
                resolve(parsedData)
              } catch (e) {
                reject(new Error(`Parse response error: ${e}`))
              }
            }
          } else {
            resolve(buf)
          }
        })
        readable.on('error', err => {
          reject(new Error(`Unable to connect ${url}: ${err.message}`))
        })
      } else {
        reject(new Error(`Bad response from ${url}: ${res.statusCode}`))
      }
    })
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy(new Error(`Request timeout after ${opts.timeout}ms`))
    })
    if (data) {
      if (typeof data === 'string' || Buffer.isBuffer(data)) {
        req.write(data)
      } else {
        req.write(JSON.stringify(data))
      }
    }
    if (opts.timeout) {
      req.setTimeout(opts.timeout)
    }
    req.end()
  })
}

function getDataType(data: any): string {
  if (data === null) return 'null'
  if (data === undefined) return 'undefined'
  if (typeof data == 'string') return 'string'
  if (Buffer.isBuffer(data)) return 'buffer'
  if (Array.isArray(data) || objectLiteral(data)) return 'object'
  return 'unknown'
}

/**
 * Send request to server for response, supports:
 *
 * - Send json data and parse json response.
 * - Throw error for failed response statusCode.
 * - Timeout support (no timeout by default).
 * - Send buffer (as data) and receive data (as response).
 * - Proxy support from user configuration & environment.
 * - Redirect support, limited to 3.
 * - Response encoding support for gzip & deflate.
 */
export default function fetch(url: string, options: FetchOptions = {}): Promise<ResponseResult> {
  if (arguments.length > 2) {
    logger.error(`Bad fetch arguments:`, ...arguments)
    return Promise.reject(new Error(`Fetch API have changed to fetch(url, options)`))
  }
  let opts = resolveRequestOptions(url, options)
  return request(url, options.data, opts).catch(err => {
    logger.error(`Fetch error for ${url}:`, opts, err)
    if (opts.agent && opts.agent.proxy) {
      let { proxy } = opts.agent
      throw new Error(`Request failed using proxy ${proxy.host}: ${err.message}`)
    } else {
      throw err
    }
  })
}
