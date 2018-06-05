
// nvim use utf8
export function byteLength(str:string):number {
  let buf = Buffer.from(str, 'utf8')
  return buf.length
}

export function byteIndex(content:string, index:number):number {
  let s = content.slice(0, index)
  return byteLength(s)
}

export function unicodeIndex(content:string, index:number):number {
  return byteSlice(content, 0, index).length
}

export function byteSlice(content:string, start:number, end?:number):string {
  let buf = Buffer.from(content, 'utf8')
  return buf.slice(start, end).toString('utf8')
}
