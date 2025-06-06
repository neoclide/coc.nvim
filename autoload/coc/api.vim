if has('nvim')
  finish
endif
vim9script
scriptencoding utf-8

var namespace_id: number = 1
final namespace_cache: dict<any> = {}
var max_src_id: number = 1000
# bufnr => max textprop id
final buffer_id: dict<any> = {}
# srcId => list of types
final id_types: dict<any> = {}
var tab_id: number = 1
final listener_map: dict<any> = {}
const prop_offset: number = get(g:, 'coc_text_prop_offset', 1000)
const keymap_arguments: list<string> = ['nowait', 'silent', 'script', 'expr', 'unique', 'special']
const known_types = ['Number', 'String', 'Funcref', 'List', 'Dictionary', 'Float', 'Boolean', 'None', 'Job', 'Channel', 'Blob']
const scopes = ['global', 'local']
# Boolean options of vim 9.1.1134
const boolean_options: list<string> = ['allowrevins', 'arabic', 'arabicshape', 'autochdir', 'autoindent', 'autoread', 'autoshelldir', 'autowrite', 'autowriteall', 'backup', 'balloonevalterm', 'binary', 'bomb', 'breakindent', 'buflisted', 'cdhome', 'cindent', 'compatible', 'confirm', 'copyindent', 'cursorbind', 'cursorcolumn', 'cursorline', 'delcombine', 'diff', 'digraph', 'edcompatible', 'emoji', 'endoffile', 'endofline', 'equalalways', 'errorbells', 'esckeys', 'expandtab', 'exrc', 'fileignorecase', 'fixendofline', 'foldenable', 'fsync', 'gdefault', 'hidden', 'hkmap', 'hkmapp', 'hlsearch', 'icon', 'ignorecase', 'imcmdline', 'imdisable', 'incsearch', 'infercase', 'insertmode', 'joinspaces', 'langnoremap', 'langremap', 'lazyredraw', 'linebreak', 'lisp', 'list', 'loadplugins', 'magic', 'modeline', 'modelineexpr', 'modifiable', 'modified', 'more', 'number', 'paste', 'preserveindent', 'previewwindow', 'prompt', 'readonly', 'relativenumber', 'remap', 'revins', 'rightleft', 'ruler', 'scrollbind', 'secure', 'shelltemp', 'shiftround', 'shortname', 'showcmd', 'showfulltag', 'showmatch', 'showmode', 'smartcase', 'smartindent', 'smarttab', 'smoothscroll', 'spell', 'splitbelow', 'splitright', 'startofline', 'swapfile', 'tagbsearch', 'tagrelative', 'tagstack', 'termbidi', 'termguicolors', 'terse', 'textauto', 'textmode', 'tildeop', 'timeout', 'title', 'ttimeout', 'ttybuiltin', 'ttyfast', 'undofile', 'visualbell', 'warn', 'weirdinvert', 'wildignorecase', 'wildmenu', 'winfixbuf', 'winfixheight', 'winfixwidth', 'wrap', 'wrapscan', 'write', 'writeany', 'writebackup', 'xtermcodes']
const window_options = keys(getwinvar(0, '&'))
const buffer_options = keys(getbufvar(bufnr('%'), '&'))
var group_id: number = 1
# id => name
final groups_map: dict<any> = {}
var autocmd_id: number = 1
final autocmds_map: dict<any> = {}

const API_FUNCTIONS = [
  'eval',
  'command',
  'feedkeys',
  'command_output',
  'exec',
  'input',
  'create_buf',
  'strwidth',
  'out_write',
  'err_write',
  'err_writeln',
  'set_option',
  'set_var',
  'set_keymap',
  'set_option_value',
  'set_current_line',
  'set_current_dir',
  'set_current_buf',
  'set_current_win',
  'set_current_tabpage',
  'get_option',
  'get_api_info',
  'get_current_line',
  'get_var',
  'get_vvar',
  'get_current_buf',
  'get_current_win',
  'get_current_tabpage',
  'get_mode',
  'get_namespaces',
  'get_option_value',
  'del_var',
  'del_keymap',
  'del_current_line',
  'del_autocmd',
  'list_wins',
  'list_bufs',
  'list_runtime_paths',
  'list_tabpages',
  'call_atomic',
  'call_function',
  'call_dict_function',
  'create_namespace',
  'create_augroup',
  'create_autocmd',
  'buf_set_option',
  'buf_get_option',
  'buf_get_changedtick',
  'buf_is_valid',
  'buf_is_loaded',
  'buf_get_mark',
  'buf_add_highlight',
  'buf_clear_namespace',
  'buf_line_count',
  'buf_attach',
  'buf_detach',
  'buf_get_lines',
  'buf_set_lines',
  'buf_set_name',
  'buf_get_name',
  'buf_get_var',
  'buf_set_var',
  'buf_del_var',
  'buf_set_keymap',
  'buf_del_keymap',
  'win_get_buf',
  'win_set_buf',
  'win_get_position',
  'win_set_height',
  'win_get_height',
  'win_set_width',
  'win_get_width',
  'win_set_cursor',
  'win_get_cursor',
  'win_set_option',
  'win_get_option',
  'win_get_var',
  'win_set_var',
  'win_del_var',
  'win_is_valid',
  'win_get_number',
  'win_get_tabpage',
  'win_close',
  'tabpage_get_number',
  'tabpage_list_wins',
  'tabpage_get_var',
  'tabpage_set_var',
  'tabpage_del_var',
  'tabpage_is_valid',
  'tabpage_get_win',
]

# helper {{
# Create a window with bufnr for execute win_execute
def CreatePopup(bufnr: number): number
  noa const id = popup_create(bufnr, {
      \ 'line': 1,
      \ 'col': &columns,
      \ 'maxwidth': 1,
      \ 'maxheight': 1,
      \ })
  popup_hide(id)
  return id
enddef

def CheckBufnr(bufnr: number): void
  if bufnr != 0 && !bufexists(bufnr)
    throw $'Invalid buffer id: {bufnr}'
  endif
enddef

def CheckWinid(winid: number): void
  if winid != 0 && empty(getwininfo(winid))
    throw $'Invalid window id: {winid}'
  endif
enddef

def GetValidBufnr(id: number): number
  if id == 0
    return bufnr('%')
  endif
  if !bufexists(id)
    throw $'Invalid buffer id: {id}'
  endif
  return id
enddef

def GetValidWinid(id: number): number
  if id == 0
    return win_getid()
  endif
  if empty(getwininfo(id))
    throw $'Invalid window id: {id}'
  endif
  return id
enddef

def CheckKey(dict: dict<any>, key: string): void
  if !has_key(dict, key)
    throw $'Key not found: {key}'
  endif
enddef

# TextChanged and callback not fired when using channel on vim.
export def OnTextChange(bufnr: number): void
  const event = mode() ==# 'i' ? 'TextChangedI' : 'TextChanged'
  if bufnr('%') == bufnr
    coc#compat#execute($'doautocmd <nomodeline> {event}')
  else
    BufExecute(bufnr, [$'legacy doautocmd <nomodeline> {event}'])
  endif
enddef

def Pick(target: dict<any>, source: dict<any>, keys: list<string>): void
  for key in keys
    if has_key(source, key)
      target[key] = source[key]
    endif
  endfor
enddef

# execute command for bufnr
export def BufExecute(bufnr: number, cmds: list<string>, silent = 'silent'): void
  var winid = get(win_findbuf(bufnr), 0, -1)
  var need_close: bool = false
  if winid == -1
    winid = CreatePopup(bufnr)
    need_close = true
  endif
  win_execute(winid, cmds, silent)
  if need_close
    noa popup_close(winid)
  endif
enddef

def BufLineCount(bufnr: number): number
  const info = get(getbufinfo(bufnr), 0, null)
  if empty(info)
    throw $'Invalid buffer id: {bufnr}'
  endif
  return info.loaded == 0 ? 0 : info.linecount
enddef

def IsPopup(winid: number): bool
  return index(popup_list(), winid) != -1
enddef

def TabIdNr(tid: number): number
  if tid == 0
    return tabpagenr()
  endif
  var result: any = null
  for nr in range(1, tabpagenr('$'))
    if gettabvar(nr, '__coc_tid', null) == tid
      result = nr
    endif
  endfor
  if result == null
    throw $'Invalid tabpage id: {tid}'
  endif
  return result
enddef

export def TabNrId(nr: number): number
  var tid = gettabvar(nr, '__coc_tid', -1)
  if tid == -1
    tid = tab_id
    settabvar(nr, '__coc_tid', tid)
    tab_id += 1
  endif
  return tid
enddef

def WinTabnr(winid: number): number
  const info = getwininfo(winid)
  if empty(info)
    throw $'Invalid window id: {winid}'
  endif
  return info[0]['tabnr']
enddef

def DeferExecute(cmd: string): void
  def RunExecute(): void
    if cmd =~# '^redraw'
      if index(['c', 'r'], mode()) == -1
        execute cmd
      endif
    elseif cmd =~# '^echo'
      execute cmd
    else
      silent! execute $'legacy {cmd}'
    endif
  enddef
  timer_start(0, (..._) => RunExecute())
enddef

def InspectType(val: any): string
  return get(known_types, type(val), 'Unknown')
enddef

def EscapeSpace(text: string): string
  return substitute(text, ' ', '<space>', 'g')
enddef

# See :h option-backslash
def EscapeOptionValue(value: any): string
  if type(value) == v:t_string
    return substitute(value, '\( \|\\\)', '\\\1', 'g')
  endif
  return string(value)
enddef

# Check the type like nvim, currently bool option only
def CheckOptionValue(name: string, value: any): void
  if index(boolean_options, name) != -1 && type(value) != v:t_bool
    throw $"Invalid value for option '{name}': expected boolean, got {tolower(InspectType(value))} {value}"
  endif
enddef

def CheckScopeOption(opts: dict<any>): void
  if has_key(opts, 'scope') && has_key(opts, 'buf')
    throw "Can't use both scope and buf"
  endif
  if has_key(opts, 'buf') && has_key(opts, 'win')
    throw "Can't use both buf and win"
  endif
  if has_key(opts, 'scope') && index(scopes, opts.scope) == -1
    throw "Invalid 'scope': expected 'local' or 'global'"
  endif
  if has_key(opts, 'buf') && type(opts.buf) != v:t_number
    throw $"Invalid 'buf': expected Number, got {InspectType(opts.buf)}"
  endif
  if has_key(opts, 'win') && type(opts.win) != v:t_number
    throw $"Invalid 'win': expected Number, got {InspectType(opts.win)}"
  endif
enddef

def CreateModePrefix(mode: string, opts: dict<any>): string
  if mode ==# '!'
    return 'map!'
  endif
  return get(opts, 'noremap', 0) ?  $'{mode}noremap' : $'{mode}map'
enddef

def CreateArguments(opts: dict<any>): string
  var arguments = ''
  for key in keys(opts)
    if opts[key] == true && index(keymap_arguments, key) != -1
      arguments ..= $'<{key}>'
    endif
  endfor
  return arguments
enddef

export def GeneratePropId(bufnr: number): number
  const max: number = get(buffer_id, bufnr, prop_offset)
  const id: number = max + 1
  buffer_id[bufnr] = id
  return id
enddef

export def GetNamespaceTypes(ns: number): list<string>
  if ns == -1
    return values(id_types)->flattennew(1)
  endif
  return get(id_types, ns, [])
enddef

export def CreateType(ns: number, hl: string, opts: dict<any>): string
  const type: string = $'{hl}_{ns}'
  final types: list<string> = get(id_types, ns, [])
  if index(types, type) == -1
    add(types, type)
    id_types[ns] = types
    if empty(prop_type_get(type))
      final type_option: dict<any> = {'highlight': hl}
      if !hlexists(hl)
        execute $'highlight default {hl} ctermfg=NONE'
      endif
      const hl_mode: string = get(opts, 'hl_mode', 'combine')
      if hl_mode !=# 'combine'
        type_option['override'] = 1
        type_option['combine'] = 0
      endif
      # vim not throw for unknown properties
      prop_type_add(type, extend(type_option, opts))
    endif
  endif
  return type
enddef

def OnBufferChange(bufnr: number, start: number, end: number, added: number, bufchanges: list<any>): void
  coc#rpc#notify('vim_buf_change_event', [bufnr, getbufvar(bufnr, 'changedtick'), start - 1, end - 1, getbufline(bufnr, start, end + added - 1)])
enddef

export def DetachListener(bufnr: number): bool
  const id: number = get(listener_map, bufnr, 0)
  if id != 0
    remove(listener_map, bufnr)
    return listener_remove(id) != 0
  endif
  return false
enddef

# echo single line message with highlight
export def EchoHl(message: string, hl: string): void
  const escaped = substitute(message, "'", "''", 'g')
  DeferExecute($"echohl {hl} | echo '{escaped}' | echohl None")
enddef

def ChangeBufferLines(bufnr: number, start_row: number, start_col: number, end_row: number, end_col: number, replacement: list<string>): void
  const lines = getbufline(bufnr, start_row + 1, end_row + 1)
  const total = len(lines)
  final new_lines = []
  const before = strpart(lines[0], 0, start_col)
  const after = strpart(lines[total - 1], end_col)
  const last = len(replacement) - 1
  for idx in range(0, last)
    var line = replacement[idx]
    if idx == 0
      line = before .. line
    endif
    if idx == last
      line = line .. after
    endif
    new_lines->add(line)
  endfor
  const del = end_row - (start_row - 1)
  if del == last + 1
    setbufline(bufnr, start_row + 1, new_lines)
  else
    if len(new_lines) > 0
      appendbufline(bufnr, start_row, new_lines)
    endif
    if del > 0
      const lnum = start_row + len(new_lines) + 1
      deletebufline(bufnr, lnum, lnum + del - 1)
    endif
  endif
enddef

# make sure inserted space first.
def SortProp(a: dict<any>, b: dict<any>): number
  if a.col != b.col
    return a.col > b.col ? 1 : -1
  endif
  if has_key(a, 'text') && has_key(b, 'text')
    return a.text ==# ' ' ? -1 : 1
  endif
  return 0
enddef

def ReplaceBufLines(bufnr: number, start_row: number, end_row: number, replacement: list<string>): void
  if start_row != end_row
    deletebufline(bufnr, start_row + 1, end_row)
  endif
  if !empty(replacement)
    const new_lines = replacement[0 : -2]
    if !empty(new_lines)
      appendbufline(bufnr, start_row, new_lines)
    endif
  endif
enddef

# Change buffer texts with text properties keeped.
export def SetBufferText(bufnr: number, start_row: number, start_col: number, end_row: number, end_col: number, replacement: list<string>): void
  # Improve speed for replace lines
  if start_col == 0 && end_col == 0 && (empty(replacement) || replacement[len(replacement) - 1] == '')
    ReplaceBufLines(bufnr, start_row, end_row, replacement)
  else
    const lines = getbufline(bufnr, start_row + 1, end_row + 1)
    final new_props = []
    const props = prop_list(start_row + 1, {
      'bufnr': bufnr,
      'end_lnum': end_row + 1
    })
    const total = len(props)
    const replace = empty(replacement) ? [''] : replacement
    if total > 0
      var idx = 0
      while idx != total
        const prop = props[idx]
        if !prop.start || !prop.end || has_key(prop, 'text_align')
          idx += 1
          continue
        endif
        if prop.lnum > start_row + 1 || prop.col + get(prop, 'length', 0) > start_col + 1
          break
        endif
        new_props->add(prop)
        idx += 1
      endwhile
      const rl = len(replace)
      if idx != total
        # new - old
        const line_delta = start_row + rl - 1 - end_row
        var col_delta = 0
        if rl > 1
          col_delta = strlen(replace[rl - 1]) - end_col
        else
          col_delta = start_col + strlen(replace[0]) - end_col
        endif
        while idx != total
          var prop = props[idx]
          if prop.lnum < end_row + 1 || prop.col < end_col + 1 || !prop.start || !prop.end || has_key(prop, 'text_align')
            idx += 1
            continue
          endif
          if prop.lnum > end_row + 1
            break
          endif
          prop = copy(prop)
          prop.lnum += line_delta
          prop.col += col_delta
          new_props->add(prop)
          idx += 1
        endwhile
      endif
    endif
    ChangeBufferLines(bufnr, start_row, start_col, end_row, end_col, replace)
    for prop in sort(new_props, SortProp)
      const has_text = has_key(prop, 'text')
      const id = get(prop, 'id', -1)
      if id < 0 && !has_text
        # prop.id < 0 should be vtext, but text not exists on old vim, can't handle
        continue
      endif
      final opts = {'bufnr': bufnr, 'type': prop.type}
      if id > 0
        opts.id = prop.id
        opts.length = get(prop, 'length', 0)
      else
        Pick(opts, prop, ['text', 'text_wrap'])
      endif
      prop_add(prop.lnum, prop.col, opts)
    endfor
  endif
enddef

# Change lines only
export def SetBufferLines(bufnr: number, start_line: number, end_line: number, replacement: list<string>): void
  const delCount = end_line - (start_line - 1)
  const total = len(replacement)
  if delCount == total
    const currentLines = getbufline(bufnr, start_line, start_line + delCount)
    for idx in range(0, delCount - 1)
      if currentLines[idx] !=# replacement[idx]
        setbufline(bufnr, start_line + idx, replacement[idx])
      endif
    endfor
  else
    if total > 0
      appendbufline(bufnr, start_line - 1, replacement)
    endif
    if delCount > 0
      const start = start_line + total
      silent deletebufline(bufnr, start, start + delCount - 1)
    endif
  endif
enddef
# }}"

# nvim client methods {{
export def Set_current_dir(dir: string): any
  execute $'legacy cd {fnameescape(dir)}'
  return null
enddef

export def Set_var(name: string, value: any): any
  g:[name] = value
  return null
enddef

export def Del_var(name: string): any
  CheckKey(g:, name)
  remove(g:, name)
  return null
enddef

export def Set_option(name: string, value: any, local: bool = false): any
  CheckOptionValue(name, value)
  if index(boolean_options, name) != -1
    if value
      execute $'legacy set{local ? 'l' : ''} {name}'
    else
      execute $'legacy set{local ? 'l' : ''} no{name}'
    endif
  else
    execute $"legacy set{local ? 'l' : ''} {name}={EscapeOptionValue(value)}"
  endif
  return null
enddef

export def Get_option(name: string): any
  return eval($'&{name}')
enddef

export def Set_current_buf(bufnr: number): any
  CheckBufnr(bufnr)
  # autocmd could fail when not use legacy.
  execute $'legacy buffer {bufnr}'
  return null
enddef

export def Set_current_win(winid: number): any
  CheckWinid(winid)
  win_gotoid(winid)
  return null
enddef

export def Set_current_tabpage(tid: number): any
  const nr = TabIdNr(tid)
  execute $'legacy normal! {nr}gt'
  return null
enddef

export def List_wins(): list<number>
  return getwininfo()->map((_, info) => info.winid)
enddef

export def Call_atomic(calls: list<any>): list<any>
  final results: list<any> = []
  for i in range(len(calls))
    const key: string = calls[i][0]
    const name: string = $"{toupper(key[5])}{strpart(key, 6)}"
    try
      const result = call(name, get(calls[i], 1, []))
      add(results, result)
    catch /.*/
      return [results, [i, $'VimException({InspectType(v:exception)})', $'{v:exception} on function coc#api#{name}']]
    endtry
  endfor
  return [results, null]
enddef

export def Set_client_info(..._): any
  # not supported
  return null
enddef

export def Subscribe(..._): any
  # not supported
  return null
enddef

export def Unsubscribe(..._): any
  # not supported
  return null
enddef

# Not return on notification for possible void function call.
export def Call_function(method: string, args: list<any>, notify: bool = false): any
  if method ==# 'execute'
    return call('coc#compat#execute', args)
  elseif method ==# 'eval'
    return Eval(args[0])
  elseif method ==# 'win_execute'
    return call('coc#compat#win_execute', args)
  elseif !notify
    return call(method, args)
  endif
  call call(method, args)
  return null
enddef

export def Call_dict_function(dict: any, method: string, args: list<any>): any
  if type(dict) == v:t_string
    return call(method, args, Eval(dict))
  endif
  return call(method, args, dict)
enddef

# Use the legacy eval, could be called by Call
export function Eval(expr) abort
  legacy return coc#compat#eval(a:expr)
endfunction

export def Command(command: string): any
  # command that could cause cursor vanish
  if command =~# '^\(echo\|redraw\|sign\)'
    DeferExecute(command)
  else
    # Use legacy command not work for command like autocmd
    coc#compat#execute(command)
    # The error is set by python script, since vim not give error on python command failure
    if strpart(command, 0, 2) ==# 'py'
      const errmsg: string = get(g:, 'errmsg', '')
      if !empty(errmsg)
        remove(g:, 'errmsg')
        throw $'Python error {errmsg}'
      endif
    endif
  endif
  return null
enddef

export def Get_api_info(): any
  const functions: list<string> = map(copy(API_FUNCTIONS), (_, val) => $'nvim_{val}')
  const channel: any = coc#rpc#get_channel()
  if empty(channel)
    throw 'Unable to get channel'
  endif
  return [ch_info(channel)['id'], {'functions': functions}]
enddef

export def List_bufs(): list<number>
  return getbufinfo()->map((_, info) => info.bufnr)
enddef

export def Feedkeys(keys: string, mode: string, escape_csi: any = false): any
  feedkeys(keys, mode)
  return null
enddef

export def List_runtime_paths(): list<string>
  return map(globpath(&runtimepath, '', 0, 1), (_, val) => coc#util#win32unix_to_node(val))
enddef

export def Command_output(cmd: string): string
  const output = coc#compat#execute(cmd, 'silent')
  # The same as nvim.
  if cmd =~# '^echo'
    return trim(output, "\r\n")
  endif
  return output
enddef

export def Exec(code: string, output: bool): string
  if output
    return Command_output(code)
  endif
  coc#compat#execute(code)
  return ''
enddef

# Queues raw user-input, <" is special. To input a literal "<", send <LT>.
export def Input(keys: string): any
  const escaped: string = substitute(keys, '<', '\\<', 'g')
  feedkeys(eval($'"{escaped}"'), 'n')
  return null
enddef

export def Create_buf(listed: bool, scratch: bool): number
  const bufnr: number = bufadd('')
  setbufvar(bufnr, '&buflisted', listed ? 1 : 0)
  if scratch
    setbufvar(bufnr, '&modeline', 0)
    setbufvar(bufnr, '&buftype', 'nofile')
    setbufvar(bufnr, '&swapfile', 0)
  endif
  bufload(bufnr)
  return bufnr
enddef

export def Get_current_line(): string
  return getline('.')
enddef

export def Set_current_line(line: string): any
  setline('.', line)
  OnTextChange(bufnr('%'))
  return null
enddef

export def Del_current_line(): any
  deletebufline('%', line('.'))
  OnTextChange(bufnr('%'))
  return null
enddef

export def Get_var(var: string): any
  CheckKey(g:, var)
  return g:[var]
enddef

export def Get_vvar(var: string): any
  return eval($'v:{var}')
enddef

export def Get_current_buf(): number
  return bufnr('%')
enddef

export def Get_current_win(): number
  return win_getid()
enddef

export def Get_current_tabpage(): number
  return TabNrId(tabpagenr())
enddef

export def List_tabpages(): list<number>
  final ids = []
  for nr in range(1, tabpagenr('$'))
    add(ids, TabNrId(nr))
  endfor
  return ids
enddef

export def Get_mode(): dict<any>
  const m: string = mode()
  return {'blocking': m =~# '^r' ? true : false, 'mode': m}
enddef

export def Strwidth(str: string): number
  return strwidth(str)
enddef

export def Out_write(str: string): any
  echon str
  DeferExecute('redraw')
  return null
enddef

export def Err_write(str: string): any
  # Err_write texts are cached by node-client
  return null
enddef

export def Err_writeln(str: string): any
  echohl ErrorMsg
  echom str
  echohl None
  DeferExecute('redraw')
  return null
enddef

export def Create_namespace(name: string): number
  if empty(name)
    const id = namespace_id
    namespace_id += 1
    return id
  endif
  var id = get(namespace_cache, name, 0)
  if id == 0
    id = namespace_id
    namespace_id += 1
    namespace_cache[name] = id
  endif
  return id
enddef

export def Get_namespaces(): dict<any>
  return copy(namespace_cache)
enddef

export def Set_keymap(mode: string, lhs: string, rhs: string, opts: dict<any>): any
  const modekey: string = CreateModePrefix(mode, opts)
  const arguments: string = CreateArguments(opts)
  const escaped: string = empty(rhs) ? '<Nop>' : EscapeSpace(rhs)
  coc#compat#execute($'{modekey} {arguments} {EscapeSpace(lhs)} {escaped}')
  return null
enddef

export def Del_keymap(mode: string, lhs: string): any
  const escaped = substitute(lhs, ' ', '<space>', 'g')
  execute $'legacy silent {mode}unmap {escaped}'
  return null
enddef

export def Set_option_value(name: string, value: any, opts: dict<any>): any
  CheckScopeOption(opts)
  const winid: number = get(opts, 'win', -1)
  const bufnr: number = get(opts, 'buf', -1)
  const scope: string = get(opts, 'scope', 'global')
  if bufnr != -1
    Buf_set_option(bufnr, name, value)
  elseif winid != -1
    Win_set_option(winid, name, value)
  else
    if scope ==# 'global'
      Set_option(name, value)
    else
      Set_option(name, value, true)
    endif
  endif
  return null
enddef

export def Get_option_value(name: string, opts: dict<any> = {}): any
  CheckScopeOption(opts)
  const winid: number = get(opts, 'win', -1)
  const bufnr: number = get(opts, 'buf', -1)
  const scope: string = get(opts, 'scope', 'global')
  var result: any = null
  if bufnr != -1
    result = Buf_get_option(bufnr, name)
  elseif winid != -1
    result = Win_get_option(winid, name)
  else
    if scope ==# 'global'
      result = eval($'&{name}')
    else
      result = gettabwinvar(tabpagenr(), 0, '&' .. name, null)
      if result == null
        result = Buf_get_option(bufnr('%'), name)
      endif
    endif
  endif
  return result
enddef

export def Create_augroup(name: string, option: dict<any> = {}): number
  const clear: bool = get(option, 'clear', true)
  if clear
    execute $'augroup {name} | autocmd! | augroup END'
  else
    execute $'augroup {name} | augroup END'
  endif
  const id = group_id
  groups_map[id] = name
  group_id += 1
  return id
enddef

export def Create_autocmd(event: any, option: dict<any> = {}): number
  final opt: dict<any> = { event: event }
  if has_key(option, 'group')
    if type(option.group) == v:t_number
      if !has_key(groups_map, option.group)
        throw $'Invalid group {option.group}'
      endif
      opt.group = groups_map[option.group]
    elseif type(option.group) == v:t_string
      opt.group = option.group
    else
      throw $'Invalid group {option.group}'
    endif
  endif
  if get(option, 'nested', false) == true
    opt.nested = true
  endif
  if get(option, 'once', false) == true
    opt.once = true
  endif
  if has_key(option, 'pattern')
    opt.pattern = option.pattern
  else
    # nvim add it automatically
    opt.pattern = '*'
  endif
  if has_key(option, 'buffer')
    opt.bufnr = option.buffer
  endif
  if has_key(option, 'command')
    opt.cmd = $'legacy {option.command}'
  endif
  call autocmd_add([extend({'replace': get(option, 'replace', false)}, opt)])
  const id = autocmd_id
  autocmds_map[id] = opt
  autocmd_id += 1
  return id
enddef

export def Del_autocmd(id: number): bool
  if !has_key(autocmds_map, id)
    return true
  endif
  final opt: dict<any> = autocmds_map[id]
  # vim add autocmd when cmd exists
  remove(opt, 'cmd')
  remove(autocmds_map, id)
  return autocmd_delete([opt])
enddef
# }}

# buffer methods {{
export def Buf_set_option(id: number, name: string, value: any): any
  const bufnr = GetValidBufnr(id)
  CheckOptionValue(name, value)
  if index(buffer_options, name) == -1
    throw $"Invalid buffer option name: {name}"
  endif
  setbufvar(bufnr, $'&{name}', value)
  return null
enddef

export def Buf_get_option(id: number, name: string): any
  const bufnr = GetValidBufnr(id)
  if index(buffer_options, name) == -1
    throw $"Invalid buffer option name: {name}"
  endif
  return getbufvar(bufnr, $'&{name}')
enddef

export def Buf_get_changedtick(id: number): number
  const bufnr = GetValidBufnr(id)
  return getbufvar(bufnr, 'changedtick')
enddef

export def Buf_is_valid(bufnr: number): bool
  return bufexists(bufnr)
enddef

export def Buf_is_loaded(bufnr: number): bool
  return bufloaded(bufnr)
enddef

export def Buf_get_mark(id: number, name: string): list<number>
  const bufnr = GetValidBufnr(id)
  const marks: list<any> = getmarklist(bufnr)
  for item in marks
    if item['mark'] ==# $"'{name}"
      const pos: list<number> = item['pos']
      return [pos[1], pos[2] - 1]
    endif
  endfor
  return [0, 0]
enddef

export def Buf_add_highlight(id: number, srcId: number, hlGroup: string, line: number, colStart: number, colEnd: number, propTypeOpts: dict<any> = {}): any
  const bufnr = GetValidBufnr(id)
  var sourceId: number
  if srcId == 0
    max_src_id += 1
    sourceId = max_src_id
  else
    sourceId = srcId
  endif
  Buf_add_highlight1(bufnr, sourceId, hlGroup, line, colStart, colEnd, propTypeOpts)
  return sourceId
enddef

# To be called directly for better performance
# 0 based line, colStart, colEnd, see `:h prop_type_add` for propTypeOpts
export def Buf_add_highlight1(bufnr: number, srcId: number, hlGroup: string, line: number, colStart: number, colEnd: number, propTypeOpts: dict<any> = {}): void
  const columnEnd: number = colEnd == -1 ? strlen(get(getbufline(bufnr, line + 1), 0, '')) + 1 : colEnd + 1
  if columnEnd <= colStart
    return
  endif
  const propType: string = CreateType(srcId, hlGroup, propTypeOpts)
  const propId: number = GeneratePropId(bufnr)
  try
    prop_add(line + 1, colStart + 1, {'bufnr': bufnr, 'type': propType, 'id': propId, 'end_col': columnEnd})
  catch /^Vim\%((\a\+)\)\=:\(E967\|E964\)/
    # ignore 967
  endtry
enddef

export def Buf_clear_namespace(id: number, srcId: number, startLine: number, endLine: number): any
  const bufnr = GetValidBufnr(id)
  const start = startLine + 1
  const end = endLine == -1 ? BufLineCount(bufnr) : endLine
  if srcId == -1
    if has_key(buffer_id, bufnr)
      remove(buffer_id, bufnr)
    endif
    prop_clear(start, end, {'bufnr': bufnr})
  else
    const types = get(id_types, srcId, [])
    if !empty(types)
      try
        prop_remove({'bufnr': bufnr, 'all': true, 'types': types}, start, end)
      catch /^Vim\%((\a\+)\)\=:E968/
        # ignore 968
      endtry
    endif
  endif
  return null
enddef

export def Buf_line_count(bufnr: number): number
  if bufnr == 0
    return line('$')
  endif
  return BufLineCount(bufnr)
enddef

export def Buf_attach(id: number = 0, ..._): bool
  const bufnr = GetValidBufnr(id)
  # listener not removed on e!
  DetachListener(bufnr)
  const result = listener_add(OnBufferChange, bufnr)
  if result != 0
    listener_map[bufnr] = result
    return true
  endif
  return false
enddef

export def Buf_detach(id: number): bool
  const bufnr = GetValidBufnr(id)
  return DetachListener(bufnr)
enddef

export def Buf_flush(id: any): void
  if type(id) == v:t_number && has_key(listener_map, id)
    listener_flush(id)
  endif
enddef

export def Buf_get_lines(id: number, start: number, end: number, strict: bool = false): list<string>
  const bufnr = GetValidBufnr(id)
  const len = BufLineCount(bufnr)
  const s = start < 0 ? len + start + 2 : start + 1
  const e = end < 0 ? len + end + 1 : end
  if strict && e > len
    throw $'Index out of bounds {end}'
  endif
  return getbufline(bufnr, s, e)
enddef

export def Buf_set_lines(id: number, start: number, end: number, strict: bool = false, replacement: list<string> = []): any
  const bufnr = GetValidBufnr(id)
  const len = BufLineCount(bufnr)
  const startLnum = start < 0 ? len + start + 2 : start + 1
  var endLnum = end < 0 ? len + end + 1 : end
  if endLnum > len
    if strict
      throw $'Index out of bounds {end}'
    else
      endLnum = len
    endif
  endif
  const view = bufnr == bufnr('%') ? winsaveview() : null
  SetBufferLines(bufnr, startLnum, endLnum, replacement)
  if view != null
    winrestview(view)
  endif
  OnTextChange(bufnr)
  return null
enddef

export def Buf_set_name(id: number, name: string): any
  const bufnr = GetValidBufnr(id)
  BufExecute(bufnr, ['legacy silent noa 0file', $'legacy file {fnameescape(name)}'])
  return null
enddef

export def Buf_get_name(id: number): string
  return GetValidBufnr(id)->bufname()
enddef

export def Buf_get_var(id: number, name: string): any
  const bufnr = GetValidBufnr(id)
  const dict: dict<any> = getbufvar(bufnr, '')
  CheckKey(dict, name)
  return dict[name]
enddef

export def Buf_set_var(id: number, name: string, val: any): any
  const bufnr = GetValidBufnr(id)
  setbufvar(bufnr, name, val)
  return null
enddef

export def Buf_del_var(id: number, name: string): any
  const bufnr = GetValidBufnr(id)
  final bufvars = getbufvar(bufnr, '')
  CheckKey(bufvars, name)
  remove(bufvars, name)
  return null
enddef

export def Buf_set_keymap(id: number, mode: string, lhs: string, rhs: string, opts: dict<any>): any
  const bufnr = GetValidBufnr(id)
  const prefix = CreateModePrefix(mode, opts)
  const arguments = CreateArguments(opts)
  const escaped = empty(rhs) ? '<Nop>' : EscapeSpace(rhs)
  BufExecute(bufnr, [$'legacy {prefix} {arguments}<buffer> {EscapeSpace(lhs)} {escaped}'])
  return null
enddef

export def Buf_del_keymap(id: number, mode: string, lhs: string): any
  const bufnr = GetValidBufnr(id)
  const escaped = substitute(lhs, ' ', '<space>', 'g')
  BufExecute(bufnr, [$'legacy silent {mode}unmap <buffer> {escaped}'])
  return null
enddef

export def Buf_set_text(id: number, start_row: number, start_col: number, end_row: number, end_col: number, replacement: list<string>): void
  const bufnr = GetValidBufnr(id)
  const len = BufLineCount(bufnr)
  if start_row >= len
    throw $'Start row out of bounds {start_row}'
  endif
  if end_row >= len
    throw $'End row out of bounds {end_row}'
  endif
  SetBufferText(bufnr, start_row, start_col, end_row, end_col, replacement)
enddef
# }}

# window methods {{
export def Win_get_buf(id: number): number
  return GetValidWinid(id)->winbufnr()
enddef

export def Win_set_buf(id: number, bufnr: number): any
  const winid = GetValidWinid(id)
  CheckBufnr(bufnr)
  win_execute(winid, $'legacy buffer {bufnr}')
  return null
enddef

export def Win_get_position(id: number): list<number>
  const winid = GetValidWinid(id)
  const [row, col] = win_screenpos(winid)
  if row == 0 && col == 0
    throw $'Invalid window {winid}'
  endif
  return [row - 1, col - 1]
enddef

export def Win_set_height(id: number, height: number): any
  const winid = GetValidWinid(id)
  if IsPopup(winid)
    popup_move(winid, {'maxheight': height, 'minheight': height})
  else
    win_execute(winid, $'legacy resize {height}')
  endif
  return null
enddef

export def Win_get_height(id: number): number
  const winid = GetValidWinid(id)
  if IsPopup(winid)
    return popup_getpos(winid)['height']
  endif
  return winheight(winid)
enddef

export def Win_set_width(id: number, width: number): any
  const winid = GetValidWinid(id)
  if IsPopup(winid)
    popup_move(winid, {'maxwidth': width, 'minwidth': width})
  else
    win_execute(winid, $'legacy vertical resize {width}')
  endif
  return null
enddef

export def Win_get_width(id: number): number
  const winid = GetValidWinid(id)
  if IsPopup(winid)
    return popup_getpos(winid)['width']
  endif
  return winwidth(winid)
enddef

export def Win_set_cursor(id: number, pos: list<number>): any
  const winid = GetValidWinid(id)
  win_execute(winid, $'cursor({pos[0]}, {pos[1] + 1})')
  return null
enddef

export def Win_get_cursor(id: number): list<number>
  const winid = GetValidWinid(id)
  const result = getcurpos(winid)
  if result[1] == 0
    return [1, 0]
  endif
  return [result[1], result[2] - 1]
enddef

export def Win_set_option(id: number, name: string, value: any): any
  const winid = GetValidWinid(id)
  CheckOptionValue(name, value)
  const tabnr = WinTabnr(winid)
  if index(window_options, name) == -1
    throw $"Invalid window option name: {name}"
  endif
  settabwinvar(tabnr, winid, $'&{name}', value)
  return null
enddef

export def Win_get_option(id: number, name: string, ..._): any
  const winid = GetValidWinid(id)
  const tabnr = WinTabnr(winid)
  if index(window_options, name) == -1
    throw $"Invalid window option name: {name}"
  endif
  return gettabwinvar(tabnr, winid, '&' .. name)
enddef

export def Win_get_var(id: number, name: string, ..._): any
  const winid = GetValidWinid(id)
  const tabnr = WinTabnr(winid)
  const vars = gettabwinvar(tabnr, winid, '')
  CheckKey(vars, name)
  return get(vars, name, null)
enddef

export def Win_set_var(id: number, name: string, value: any): any
  const winid = GetValidWinid(id)
  const tabnr = WinTabnr(winid)
  settabwinvar(tabnr, winid, name, value)
  return null
enddef

export def Win_del_var(id: number, name: string): any
  const winid = GetValidWinid(id)
  const tabnr = WinTabnr(winid)
  const vars: dict<any> = gettabwinvar(tabnr, winid, '')
  CheckKey(vars, name)
  win_execute(winid, 'remove(w:, "' .. name .. '")')
  return null
enddef

export def Win_is_valid(id: number): bool
  const winid = id == 0 ? win_getid() : id
  return empty(getwininfo(winid)) == 0
enddef

export def Win_get_number(id: number): number
  const winid = GetValidWinid(id)
  const info = getwininfo(winid)
  # Note: vim return 0 for popup
  return info[0]['winnr']
enddef

# Not work for popup since vim gives 0 for tabnr
export def Win_get_tabpage(id: number): number
  return GetValidWinid(id)->WinTabnr()->TabNrId()
enddef

export def Win_close(id: number, force: bool = false): any
  const winid = GetValidWinid(id)
  if IsPopup(winid)
    popup_close(winid)
  else
    win_execute(winid, $'legacy close{force ? '!' : ''}')
  endif
  return null
enddef
# }}

# tabpage methods {{
export def Tabpage_get_number(tid: number): number
  return TabIdNr(tid)
enddef

export def Tabpage_list_wins(tid: number): list<number>
  return TabIdNr(tid)->gettabinfo()[0].windows
enddef

export def Tabpage_get_var(tid: number, name: string): any
  const nr = TabIdNr(tid)
  const dict = gettabvar(nr, '')
  CheckKey(dict, name)
  return get(dict, name, null)
enddef

export def Tabpage_set_var(tid: number, name: string, value: any): any
  const nr = TabIdNr(tid)
  settabvar(nr, name, value)
  return null
enddef

export def Tabpage_del_var(tid: number, name: string): any
  const nr = TabIdNr(tid)
  final dict = gettabvar(nr, '')
  CheckKey(dict, name)
  remove(dict, name)
  return null
enddef

export def Tabpage_is_valid(tid: number): bool
  for nr in range(1, tabpagenr('$'))
    if gettabvar(nr, '__coc_tid', -1) == tid
      return true
    endif
  endfor
  return false
enddef

export def Tabpage_get_win(tid: number): number
  const nr = TabIdNr(tid)
  return win_getid(tabpagewinnr(nr), nr)
enddef

export def Tabpage_ids(): void
  for nr in range(1, tabpagenr('$'))
    if gettabvar(nr, '__coc_tid', -1) == -1
      settabvar(nr, '__coc_tid', tab_id)
      tab_id += 1
    endif
  endfor
enddef
# }}

# Used by node-client request, function needed to catch error
# Must use coc#api# prefix to avoid call global function
export function Call(method, args) abort
  let err = v:null
  let result = v:null
  try
    let result = call($'coc#api#{toupper(a:method[0])}{strpart(a:method, 1)}', a:args)
    call coc#api#Buf_flush(bufnr('%'))
  catch /.*/
    let err =  v:exception .. " - on request \"" .. a:method .. "\" \n" .. v:throwpoint
    let result = v:null
  endtry
  return [err, result]
endfunction

# Used by node-client notification, function needed to catch error
export function Notify(method, args) abort
  try
    if a:method ==# 'call_function'
      call coc#api#Call_function(a:args[0], a:args[1], v:true)
    else
      let fname = $'coc#api#{toupper(a:method[0])}{strpart(a:method, 1)}'
      call call(fname, a:args)
    endif
    call coc#api#Buf_flush(bufnr('%'))
  catch /.*/
    call coc#rpc#notify('nvim_error_event', [0, v:exception .. " - on notification \"" .. a:method .. "\" \n" .. v:throwpoint])
  endtry
  return v:null
endfunction

# Could be called by other plugin
const call_function =<< trim END
  function! coc#api#call(method, args) abort
    return coc#api#Call(a:method, a:args)
  endfunction
END

execute $'legacy execute "{join(call_function, '\n')}"'

defcompile
# vim: set sw=2 ts=2 sts=2 et tw=78 foldmarker={{,}} foldmethod=marker foldlevel=0:
