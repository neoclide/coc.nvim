import type { MessageSignature } from 'vscode-languageserver-protocol'
import { getTimestamp } from '../../logger'
import * as Is from '../../util/is'
import { inspect } from '../../util/node'
import { ResponseError } from '../../util/protocol'

export function getLocale(): string {
  const lang = process.env.LANG
  if (!lang) return 'en'
  return lang.split('.')[0]
}

export function toMethod(type: string | MessageSignature): string {
  return Is.string(type) ? type : type.method
}

export function currentTimeStamp(): string {
  return getTimestamp(new Date())
}

export function getTraceMessage(data: any): string {
  if (data.isLSPMessage && data.type) {
    return `[LSP   - ${currentTimeStamp()}] `
  }
  return `[Trace - ${currentTimeStamp()}] `
}

export function data2String(data: any, color = false): string {
  if (data instanceof ResponseError) {
    const responseError = data as ResponseError<any>
    return `  Message: ${responseError.message}\n  Code: ${responseError.code
      } ${responseError.data ? '\n' + responseError.data.toString() : ''}`
  }
  if (data instanceof Error) {
    if (Is.string(data.stack)) {
      return data.stack
    }
    return (data as Error).message
  }
  if (Is.string(data)) {
    return data
  }
  return inspect(data, false, null, color)
}

export function parseTraceData(data: any): string {
  if (typeof data !== 'string') return data2String(data)
  let prefixes = ['Params: ', 'Result: ']
  for (let prefix of prefixes) {
    if (data.startsWith(prefix)) {
      try {
        let obj = JSON.parse(data.slice(prefix.length))
        return prefix + data2String(obj, true)
      } catch (_e) {
        // ignore
        return data
      }
    }
  }
  return data
}
