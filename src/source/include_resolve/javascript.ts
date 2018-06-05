import {CompleteOption} from '../../types'
import {byteSlice} from '../../util/string'

// resolve for `require('/xxx')` `import from '/xxx'`
export async function shouldResolve(opt: CompleteOption):Promise<boolean> {
  let {line, colnr} = opt
  let end = byteSlice(line, colnr - 1)
  if (!/(['"]\))?;?$/.test(end)) return false
  let start = byteSlice(line, 0, colnr - 1)
  if (/require\(['"]\/(\w|@|-)+$/.test(start)) return true
  if (/^\s*\}?\s*from\s*['"]\/(\w|@|-)+$/.test(start)) return true
  if (/^import/.test(line) && /from\s+['"]\/[^\/\s]+$/.test(start)) return true
  return false
}
