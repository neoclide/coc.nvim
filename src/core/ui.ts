import { Neovim } from '@chemzqm/neovim'
import { Position, Range } from 'vscode-languageserver-protocol'
import { ScreenPosition } from '../types'
import { byteLength } from '../util/string'

const isVim = process.env.VIM_NODE_RPC == '1'

export async function getCursorPosition(nvim: Neovim): Promise<Position> {
  // vim can't count utf16
  let [line, content] = await nvim.eval(`[line('.')-1, strpart(getline('.'), 0, col('.') - 1)]`) as [number, string]
  return Position.create(line, content.length)
}

/**
 * Prompt user for confirm, a float/popup window would be used when possible,
 * use vim's |confirm()| function as callback.
 *
 * @param title The prompt text.
 * @returns Result of confirm.
 */
export async function showPrompt(nvim: Neovim, title: string): Promise<boolean> {
  let res = await nvim.callAsync('coc#float#prompt_confirm', [title])
  return res == 1
}

/**
 * Move cursor to position.
 *
 * @param position LSP position.
 */
export async function moveTo(nvim: Neovim, position: Position, redraw: boolean): Promise<void> {
  await nvim.call('coc#cursor#move_to', [position.line, position.character])
  if (redraw) nvim.command('redraw', true)
}

/**
 * Get current cursor character offset in document,
 * length of line break would always be 1.
 *
 * @returns Character offset.
 */
export async function getOffset(nvim: Neovim): Promise<number> {
  return await nvim.call('coc#cursor#char_offset') as number
}

/**
 * Get screen position of current cursor(relative to editor),
 * both `row` and `col` are 0 based.
 *
 * @returns Cursor screen position.
 */
export async function getCursorScreenPosition(nvim: Neovim): Promise<ScreenPosition> {
  let [row, col] = await nvim.call('coc#cursor#screen_pos') as [number, number]
  return { row, col }
}

/**
 * Reveal message with highlight.
 */
export function showMessage(nvim: Neovim, msg: string, hl: 'MoreMsg' | 'Error' | 'ErrorMsg' | 'WarningMsg' = 'MoreMsg'): void {
  let method = isVim ? 'callTimer' : 'call'
  nvim[method]('coc#util#echo_messages', [hl, ('[coc.nvim] ' + msg).split('\n')], true)
}

/**
 * Mode could be 'char', 'line', 'cursor', 'v', 'V', '\x16'
 */
export async function getSelection(nvim: Neovim, mode: string): Promise<Range | null> {
  if (mode === 'line') {
    let line = await nvim.call('line', ['.'])
    return Range.create(line - 1, 0, line, 0)
  }
  if (mode === 'cursor') {
    let [line, character] = await nvim.eval("coc#cursor#position()") as [number, number]
    return Range.create(line, character, line, character)
  }
  let res = await nvim.call('coc#cursor#get_selection', [mode === 'char' ? 1 : 0])
  if (!res) return null
  return Range.create(res[0], res[1], res[2], res[3])
}

export async function selectRange(nvim: Neovim, range: Range): Promise<void> {
  let { start, end } = range
  let [line, endLine, ve, selection] = await nvim.eval(`[getline(${start.line + 1}),getline(${end.line + 1}), &virtualedit, &selection]`) as [string, string, string, string]
  let col = line ? byteLength(line.slice(0, start.character)) : 0
  let endCol = endLine ? byteLength(endLine.slice(0, end.character)) : 0
  let move_cmd = ''
  let resetVirtualEdit = false
  move_cmd += 'v'
  endCol = await nvim.eval(`virtcol([${end.line + 1}, ${endCol}])`) as number
  if (selection == 'inclusive') {
    if (end.character == 0) {
      move_cmd += `${end.line}G`
    } else {
      move_cmd += `${end.line + 1}G${endCol}|`
    }
  } else if (selection == 'old') {
    move_cmd += `${end.line + 1}G${endCol}|`
  } else {
    move_cmd += `${end.line + 1}G${endCol + 1}|`
  }
  col = await nvim.eval(`virtcol([${start.line + 1}, ${col}])`) as number
  move_cmd += `o${start.line + 1}G${col + 1}|o`
  nvim.pauseNotification()
  if (ve != 'onemore') {
    resetVirtualEdit = true
    nvim.setOption('virtualedit', 'onemore', true)
  }
  nvim.command(`noa call cursor(${start.line + 1},${col + (move_cmd == 'a' ? 0 : 1)})`, true)
  // nvim.call('eval', [`feedkeys("${move_cmd}", 'in')`], true)
  nvim.command(`normal! ${move_cmd}`, true)
  if (resetVirtualEdit) nvim.setOption('virtualedit', ve, true)
  if (isVim) nvim.command('redraw', true)
  await nvim.resumeNotification()
}
