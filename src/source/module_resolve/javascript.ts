/**
 * Provide the function to find javscript module names
 */
import builtinModules = require('builtin-modules')
import {logger} from '../../util/logger'
import {CompleteOption, CompleteResult} from '../../types'
import * as fs from 'fs'
import path = require('path')
import pify = require('pify')
import findRoot = require('find-root')

export async function shouldResolve(opt: CompleteOption):Promise<boolean> {
  let {line, colnr} = opt
  let end = line.slice(colnr - 1)
  if (!/(['"]\))?;?$/.test(end)) return false
  let start = line.slice(0, colnr - 1)
  if (/require\(['"]\w+$/.test(start)) return true
  if (/^import/.test(line) && /from\s+['"]\w+$/.test(start)) return true
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
