import fs from 'fs'
import path from 'path'

function exists(file: string): Promise<boolean> {
  return new Promise<boolean>((resolve, _reject) => {
    fs.exists(file, value => {
      resolve(value)
    })
  })
}

export async function findEslint(rootPath: string): Promise<string> {
  const platform = process.platform
  if (
    platform === 'win32' &&
    (await exists(path.join(rootPath, 'node_modules', '.bin', 'eslint.cmd')))
  ) {
    return path.join('.', 'node_modules', '.bin', 'eslint.cmd')
  } else if (
    (platform === 'linux' || platform === 'darwin') &&
    (await exists(path.join(rootPath, 'node_modules', '.bin', 'eslint')))
  ) {
    return path.join('.', 'node_modules', '.bin', 'eslint')
  } else {
    return 'eslint'
  }
}
