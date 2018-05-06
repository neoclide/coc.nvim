import pify = require('pify')
import fs = require('fs')

export async function statAsync(filepath: string):Promise<fs.Stats|null> {
  let stat = null
  try {
    stat = await pify(fs.stat)(filepath)
  } catch (e) {} // tslint:disable-line
  return stat
}
