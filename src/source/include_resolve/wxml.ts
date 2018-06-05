import {CompleteOption} from '../../types'
import {byteSlice} from '../../util/string'

// resolve for `require('/xxx')` `import from '/xxx'`
export async function shouldResolve(opt: CompleteOption):Promise<boolean> {
  let {line, col} = opt
  let start = byteSlice(line, 0, col)
  if (/src=['"]\/$/.test(start)) return true
  return false
}
