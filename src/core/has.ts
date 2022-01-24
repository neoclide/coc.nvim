import { Env } from '../types'
import semver from 'semver'

export default function has(env: Env, feature) {
  if (!feature.startsWith('nvim-') && !feature.startsWith('patch-')) {
    throw new Error('Feature param could only starts with nvim and patch')
  }
  if (!env.isVim && feature.startsWith('patch-')) {
    return false
  }
  if (env.isVim && feature.startsWith('nvim-')) {
    return false
  }
  if (env.isVim) {
    let [_, major, minor, patch] = env.version.match(/^(\d)(\d{2})(\d+)$/)
    let version = `${major}.${parseInt(minor, 10)}.${parseInt(patch, 10)}`
    return semver.gte(version, feature.slice(6))
  }
  return semver.gte(env.version, feature.slice(5))
}
