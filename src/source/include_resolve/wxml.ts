import {CompleteOption} from '../../types'

// resolve for `require('/xxx')` `import from '/xxx'`
export async function shouldResolve(opt: CompleteOption):Promise<boolean> {
  let {line, colnr} = opt
  let start = line.slice(0, colnr - 1)
  if (/src=['"]\/[^\/\s]+$/.test(start)) return true
  return false
}
