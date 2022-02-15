import events, { InsertChange } from '../events'
const logger = require('../util/logger')('completion-util')

export async function waitInsertEvent(): Promise<string | undefined> {
  let res = await events.race(['InsertLeave', 'CursorMovedI', 'MenuPopupChanged', 'TextChangedI', 'InsertCharPre'], 300)
  return res?.name
}

export async function waitTextChangedI(): Promise<InsertChange | undefined> {
  let res = await events.race(['InsertCharPre', 'CursorMoved', 'InsertLeave', 'TextChangedI'], 300)
  if (!res || res.name !== 'TextChangedI') return
  return res.args[1] as InsertChange
}

export function shouldIndent(indentkeys = '', pretext: string): boolean {
  if (!indentkeys) return false
  for (let part of indentkeys.split(',')) {
    if (part.indexOf('=') > -1) {
      let [pre, post] = part.split('=')
      let word = post.startsWith('~') ? post.slice(1) : post
      if (pretext.length < word.length ||
        (pretext.length > word.length && !/^\s/.test(pretext.slice(-word.length - 1)))) {
        continue
      }
      let matched = post.startsWith('~') ? pretext.toLowerCase().endsWith(word) : pretext.endsWith(word)
      if (!matched) {
        continue
      }
      if (pre == '') {
        return true
      }
      if (pre == '0' && (pretext.length == word.length || /^\s*$/.test(pretext.slice(0, pretext.length - word.length)))) {
        return true
      }
    }
  }
  return false
}
