
/**
 * For faster convert character index to byte index
 */
export default function bytes(text: string, max?: number): (characterIndex: number) => number {
  max = max ?? text.length
  let arr = new Uint8Array(max)
  let ascii = true
  for (let i = 0; i < max; i++) {
    let l = Buffer.from(text[i], 'utf8').byteLength
    if (l > 1) ascii = false
    arr[i] = l
  }
  return characterIndex => {
    if (characterIndex === 0) return 0
    if (ascii) return Math.min(characterIndex, max)
    let res = 0
    for (let i = 0; i < Math.min(characterIndex, max); i++) {
      res += arr[i]
    }
    return res
  }
}
