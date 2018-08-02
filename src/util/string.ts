
// nvim use utf8
export function byteLength(str:string):number {
  return Buffer.byteLength(str)
}

export function byteIndex(content:string, index:number):number {
  let s = content.slice(0, index)
  return Buffer.byteLength(s)
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

export function trimLast(content:string, character:string):string {
  let l = content.length
  if (content[l - 1] == character) {
    return content.slice(0, -1)
  }
  return content
}
