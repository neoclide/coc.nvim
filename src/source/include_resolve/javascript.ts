import {CompleteOption} from '../../types'

// resolve for `require('/xxx')` `import from '/xxx'`
export async function shouldResolve(opt: CompleteOption):Promise<boolean> {
  let {line, colnr} = opt
  let end = line.slice(colnr - 1)
  if (!/(['"]\))?;?$/.test(end)) return false
  let start = line.slice(0, colnr - 1)
  if (/require\(['"]\/[^\/\s]+$/.test(start)) return true
  if (/^import/.test(line) && /from\s+['"]\/[^\/\s]+$/.test(start)) return true
  return false
}
