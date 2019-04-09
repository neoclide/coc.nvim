
// nvim use utf8
export function byteLength(str: string): number {
  return Buffer.byteLength(str)
}

export function upperFirst(str: string): string {
  return str ? str[0].toUpperCase() + str.slice(1) : ''
}

export function byteIndex(content: string, index: number): number {
  let s = content.slice(0, index)
  return Buffer.byteLength(s)
}

export function indexOf(str: string, ch: string, count = 1): number {
  let curr = 0
  for (let i = 0; i < str.length; i++) {
    if (str[i] == ch) {
      curr = curr + 1
      if (curr == count) {
        return i
      }
    }
  }
  return -1
}

export function characterIndex(content: string, byteIndex: number): number {
  let buf = Buffer.from(content, 'utf8')
  return buf.slice(0, byteIndex).toString('utf8').length
}

export function byteSlice(content: string, start: number, end?: number): string {
  let buf = Buffer.from(content, 'utf8')
  return buf.slice(start, end).toString('utf8')
}

export function isWord(character: string): boolean {
  let code = character.charCodeAt(0)
  if (code > 128) return false
  if (code == 95) return true
  if (code >= 48 && code <= 57) return true
  if (code >= 65 && code <= 90) return true
  if (code >= 97 && code <= 122) return true
  return false
}

export function isTriggerCharacter(character: string): boolean {
  if (!character) return false
  let code = character.charCodeAt(0)
  if (code > 128) return false
  if (code >= 65 && code <= 90) return false
  if (code >= 97 && code <= 122) return false
  return true
}

export function resolveVariables(str: string, variables: { [key: string]: string }): string {
  const regexp = /\$\{(.*?)\}/g
  return str.replace(regexp, (match: string, name: string) => {
    const newValue = variables[name]
    if (typeof newValue === 'string') {
      return newValue
    }
    return match
  })
}
