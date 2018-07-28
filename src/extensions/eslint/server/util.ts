import path from 'path'
import fs from 'fs'
import os from 'os'

export function getParentDirs(fullpath: string): string[] {
  let obj = path.parse(fullpath)
  if (!obj || !obj.root) return []
  let res = []
  let p = path.dirname(fullpath)
  while (p && p !== obj.root) {
    res.push(p)
    p = path.dirname(p)
  }
  return res
}

export function resolveRoot(root: string, subs: string[]): string | null {
  let home = os.homedir()
  let paths = getParentDirs(root)
  paths.unshift(root)
  for (let p of paths) {
    for (let sub of subs) {
      if (p == home) return null
      let d = path.join(p, sub)
      if (fs.existsSync(d)) return path.dirname(d)
    }
  }
  return root
}

export function resolveLocalConfig(directory:string): string {
  let names = ['.eslintrc.js',
    '.eslintrc.yaml',
    '.eslintrc.yml',
    '.eslintrc',
    '.eslintrc.json']
  return resolveRoot(directory, names)
}
