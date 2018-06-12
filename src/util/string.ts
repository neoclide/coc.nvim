
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

export function isWord(character:string):boolean {
  let code = character.charCodeAt(0)
  if (code > 128) return false
  if (code == 95) return true
  if (code >= 48 && code <= 57) return true
  if (code >= 65 && code <= 90) return true
  if (code >= 97 && code <= 122) return true
  return false
}
