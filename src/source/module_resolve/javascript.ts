/**
 * Provide the function to find javscript module names
 */
import builtinModules = require('builtin-modules')
import {CompleteOption} from '../../types'
import * as fs from 'fs'
import path = require('path')
import pify = require('pify')
import findRoot = require('find-root')
import {unicodeIndex} from '../../util/string'

export async function shouldResolve(opt: CompleteOption):Promise<boolean> {
  let {line, colnr} = opt
  let uidx = unicodeIndex(line, colnr - 1)
  let end = line.slice(uidx)
  if (!/(['"]\))?;?$/.test(end)) return false
  let start = line.slice(0, uidx)
  if (/require\(['"](\w|-|@)+$/.test(start)) return true
  if (/\s+from\s+['"](\w|-|@)+$/.test(start)) return true
  return false
}

export async function resolve(opt: CompleteOption):Promise<string[]> {
  let {filepath} = opt
  let cwd = path.dirname(filepath)
  let root
  try {
    root = findRoot(cwd)
  } catch (e) {} // tslint:disable-line
  if (root) {
    let content = await pify(fs.readFile)(path.join(root, 'package.json'), 'utf8')
    try {
      let obj = JSON.parse(content)
      let modules = Object.keys(obj.dependencies || {})
      return modules.concat(builtinModules)
    } catch (e) {} // tslint:disable-line
  }
  return builtinModules
}
