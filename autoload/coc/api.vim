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
const keymap_arguments: list<string> = ['nowait', 'silent', 'script', 'expr', 'unique']
const known_types = ['Number', 'String', 'Funcref', 'List', 'Dictionary', 'Float', 'Boolean', 'None', 'Job', 'Channel', 'Blob']
# Boolean options of vim 9.1.1134
const boolean_options: list<string> = ['allowrevins', 'arabic', 'arabicshape', 'autochdir', 'autoindent', 'autoread', 'autoshelldir', 'autowrite', 'autowriteall', 'backup', 'balloonevalterm', 'binary', 'bomb', 'breakindent', 'buflisted', 'cdhome', 'cindent', 'compatible', 'confirm', 'copyindent', 'cursorbind', 'cursorcolumn', 'cursorline', 'delcombine', 'diff', 'digraph', 'edcompatible', 'emoji', 'endoffile', 'endofline', 'equalalways', 'errorbells', 'esckeys', 'expandtab', 'exrc', 'fileignorecase', 'fixendofline', 'foldenable', 'fsync', 'gdefault', 'hidden', 'hkmap', 'hkmapp', 'hlsearch', 'icon', 'ignorecase', 'imcmdline', 'imdisable', 'incsearch', 'infercase', 'insertmode', 'joinspaces', 'langnoremap', 'langremap', 'lazyredraw', 'linebreak', 'lisp', 'list', 'loadplugins', 'magic', 'modeline', 'modelineexpr', 'modifiable', 'modified', 'more', 'number', 'paste', 'preserveindent', 'previewwindow', 'prompt', 'readonly', 'relativenumber', 'remap', 'revins', 'rightleft', 'ruler', 'scrollbind', 'secure', 'shelltemp', 'shiftround', 'shortname', 'showcmd', 'showfulltag', 'showmatch', 'showmode', 'smartcase', 'smartindent', 'smarttab', 'smoothscroll', 'spell', 'splitbelow', 'splitright', 'startofline', 'swapfile', 'tagbsearch', 'tagrelative', 'tagstack', 'termbidi', 'termguicolors', 'terse', 'textauto', 'textmode', 'tildeop', 'timeout', 'title', 'ttimeout', 'ttybuiltin', 'ttyfast', 'undofile', 'visualbell', 'warn', 'weirdinvert', 'wildignorecase', 'wildmenu', 'winfixbuf', 'winfixheight', 'winfixwidth', 'wrap', 'wrapscan', 'write', 'writeany', 'writebackup', 'xtermcodes']

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
    throw 'Invalid buffer id: ' .. bufnr
  endif
enddef

# TextChanged and callback not fired when using channel on vim.
def OnTextChange(bufnr: number): void
  const event = mode() ==# 'i' ? 'TextChangedI' : 'TextChanged'
  execute 'doautocmd <nomodeline> ' .. event .. ' ' .. bufname(bufnr)
  listener_flush(bufnr)
enddef

# execute command for bufnr
def BufExecute(bufnr: number, cmds: list<string>, legacy: bool): void
  CheckBufnr(bufnr)
  var winid = get(win_findbuf(bufnr), 0, -1)
  var need_close: bool = v:false
  if winid == -1
    winid = CreatePopup(bufnr)
    need_close = v:true
  endif
  if legacy
    coc#compat#win_execute(winid, cmds, 'silent')
  else
    win_execute(winid, cmds, 'silent')
  endif
  if need_close
    noa popup_close(winid)
  endif
enddef

def CheckWinid(winid: number): void
  if winid < 0 || empty(getwininfo(winid)) == 1
    throw 'Invalid window id: ' .. winid
  endif
enddef

def IsPopup(winid: number): bool
  return index(popup_list(), winid) != -1
enddef

def TabIdNr(tid: number): number
  if tid == 0
    return tabpagenr()
  endif
  var result: any = v:null
  for nr in range(1, tabpagenr('$'))
    if gettabvar(nr, '__coc_tid', v:null) == tid
      result = nr
    endif
  endfor
  if type(result) == v:t_none
    throw 'Invalid tabpage id: ' .. string(tid)
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
  if empty(info) == 1
    throw 'Invalid window id: ' .. winid
  endif
  return info[0]['tabnr']
enddef

def BufLineCount(bufnr: number): number
  if bufnr == 0
    return line('$')
  endif
  const info = get(getbufinfo(bufnr), 0, v:null)
  if empty(info)
    throw "Invalid buffer id: " .. bufnr
  endif
  if info['loaded'] == 0
    return 0
  endif
  return info['linecount']
enddef

def Execute(cmd: string): void
  if cmd =~# '^echo'
    execute cmd
  else
    silent! execute cmd
  endif
enddef

def InspectType(v: any): string
  return get(known_types, type(v), 'Unknown')
enddef

def EscapeSpace(text: string): string
  return substitute(text, ' ', '<space>', 'g')
enddef

def CreateModePrefix(mode: string, opts: dict<any>): string
  if mode ==# '!'
    return 'map!'
  endif
  return get(opts, 'noremap', 0) ?  mode .. 'noremap' : mode .. 'map'
enddef

def CreateArguments(opts: dict<any>): string
  var arguments = ''
  for key in keys(opts)
    if !!type(opts[key]) && index(keymap_arguments, key) != -1
      arguments = arguments .. '<' .. key .. '>'
    endif
  endfor
  return arguments
enddef

def CheckOptionArgs(scope: string, win: number, buf: number): void
  if scope !=# 'global' && scope !=# 'local'
    throw "Invalid 'scope': expected 'local' or 'global'"
  endif
  if win != 0
    CheckWinid(win)
  endif
  if buf != 0
    CheckBufnr(buf)
  endif
enddef

def GeneratePropId(bufnr: number): number
  const max: number = get(buffer_id, bufnr, prop_offset)
  const id: number = max + 1
  buffer_id[bufnr] = id
  return id
enddef

export def GetNamespaceTypes(ns: number): list<string>
  return get(id_types, ns, [])
enddef

export def CreateType(ns: number, hl: string, opts: dict<any>): string
  const type: string = $'{hl}_{ns}'
  final types: list<string> = get(id_types, ns, [])
  if index(types, type) == -1
    add(types, type)
    id_types[ns] = types
    if empty(prop_type_get(type)) == 1
      final type_option: dict<any> = {'highlight': hl}
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

def OnBufferChange(bufnr: number, _start: number, _end: number, _added: number, bufchanges: list<any>): void
  final result: list<any> = []
  for item in bufchanges
    const start = item['lnum'] - 1
    # Delete lines
    if item['added'] < 0
      # include start line, which needed for undo
      const lines = getbufline(bufnr, item['lnum'])
      add(result, [start, 0 - item['added'] + 1, lines])
    # Add lines
    elseif item['added'] > 0
      const lines = getbufline(bufnr, item['lnum'], item['lnum'] + item['added'])
      add(result, [start, 1, lines])
    # Change lines
    else
      const lines = getbufline(bufnr, item['lnum'], item['end'] - 1)
      add(result, [start, item['end'] - item['lnum'], lines])
    endif
  endfor
  coc#rpc#notify('vim_buf_change_event', [bufnr, getbufvar(bufnr, 'changedtick'), result])
enddef

export def DetachListener(bufnr: number): bool
  const id: number = get(listener_map, bufnr, 0)
  if id != 0
    remove(listener_map, bufnr)
    const succeed = listener_remove(id)
    return succeed ? v:true : v:false
  endif
  return v:false
enddef

def ThrowOnError(): void
  if empty(v:errmsg) == 0
    const msg = v:errmsg
    v:errmsg = ''
    throw msg
  endif
enddef

def IgnoreOnError(expr: string): void
  if empty(v:errmsg) == 0 && v:errmsg =~# expr
    v:errmsg = ''
  endif
enddef
# }}"

# nvim client methods {{
export def Set_current_dir(dir: string): any
  execute 'cd ' .. fnameescape(dir)
  return v:null
enddef

export def Set_var(name: string, value: any): any
  g:[name] = value
  return v:null
enddef

export def Del_var(name: string): any
  if !has_key(g:, name)
    throw 'Key not found: ' .. name
  endif
  remove(g:, name)
  return v:null
enddef

export def Set_option(name: string, value: any): any
  if index(boolean_options, name) != -1
    if !!value
      execute 'set ' .. name
    else
      execute 'set no' .. name
    endif
  else
    execute $'set {name}=${value}'
  endif
  return v:null
enddef

export def Get_option(name: string): any
  return eval('&' .. name)
enddef

export def Set_current_buf(bufnr: number): any
  CheckBufnr(bufnr)
  execute 'buffer ' .. bufnr
  return v:null
enddef

export def Set_current_win(winid: number): any
  CheckWinid(winid)
  win_gotoid(winid)
  return v:null
enddef

export def Set_current_tabpage(tid: number): any
  const nr = TabIdNr(tid)
  execute $'normal! {nr}gt'
  return v:null
enddef

export def List_wins(): list<number>
  return map(getwininfo(), 'v:val["winid"]')
enddef

export def Call_atomic(calls: list<any>): list<any>
  final results: list<any> = []
  for i in range(len(calls))
    const key: string = calls[i][0]
    const name: string = toupper(key[5]) .. key[6 : ]
    try
      v:errmsg = ''
      const result = call(name, get(calls[i], 1, []))
      ThrowOnError()
      add(results, result)
    catch /.*/
      return [results, [i, $'VimException({InspectType(v:exception)})', $'{v:exception} on function coc#api#{name}']]
    endtry
  endfor
  return [results, v:null]
enddef

export def Set_client_info(..._): any
  # not supported
  return v:null
enddef

export def Subscribe(..._): any
  # not supported
  return v:null
enddef

export def Unsubscribe(..._): any
  # not supported
  return v:null
enddef

export def Call_function(method: string, args: list<any>): any
  return call(method, args)
enddef

export def Call_dict_function(dict: any, method: string, args: list<any>): any
  if type(dict) == v:t_string
    return call(method, args, coc#compat#eval(dict))
  endif
  return call(method, args, dict)
enddef

export def Command(command: string): any
  # command that could cause cursor vanish
  if command =~# '^\(echo\|redraw\|sign\)'
    timer_start(0, (..._) => Execute(command))
  else
    # Command could be using legacy syntax
    coc#compat#execute(command)
    # The error is set by python script, since vim not give error on python command failure
    if command =~# '^py'
      const err: string = get(g:, 'errmsg', '')
      if empty(err) == 0
        remove(g:, 'errmsg')
        throw 'Python error ' .. err
      endif
    endif
  endif
  return v:null
enddef

export def Eval(expr: string): any
  return coc#compat#eval(expr)
enddef

export def Get_api_info(): any
  # const names = func_names()
  const channel: any = coc#rpc#get_channel()
  if empty(channel) == 1
    throw 'Unable to get channel'
  endif
  return [ch_info(channel)['id'], {'functions': []}]
enddef

export def List_bufs(): list<number>
  return map(getbufinfo(), 'v:val["bufnr"]')
enddef

export def Feedkeys(keys: string, mode: string, escape_csi: any = v:false): any
  feedkeys(keys, mode)
  return v:null
enddef

export def List_runtime_paths(): list<string>
  return globpath(&runtimepath, '', 0, 1)
enddef

export def Command_output(cmd: string): string
  return trim(coc#compat#execute(cmd, 'silent'), "\r\n")
enddef

export def Exec(code: string, output: any): string
  if !!output
    return Command_output(code)
  endif
  Command(code)
  return ''
enddef

# Queues raw user-input, <" is special. To input a literal "<", send <LT>.
export def Input(keys: string): any
  const escaped: string = substitute(keys, '<', '\\<', 'g')
  feedkeys(eval($'"{escaped}"'), 'n')
  return v:null
enddef

export def Create_buf(listed: any, scratch: any): number
  const bufnr: number = bufadd('')
  setbufvar(bufnr, '&buflisted', listed ? 1 : 0)
  if !!scratch
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
  return v:null
enddef

export def Del_current_line(): any
  deletebufline('%', line('.'))
  OnTextChange(bufnr('%'))
  return v:null
enddef

export def Get_var(var: string): any
  return get(g:, var, v:null)
enddef

export def Get_vvar(var: string): any
  return eval('v:' .. var)
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
  return {'blocking': m =~# '^r' ? v:true : v:false, 'mode': m}
enddef

export def Strwidth(str: string): number
  return strwidth(str)
enddef

export def Out_write(str: string): any
  echon str
  timer_start(0, (..._) => Execute('redraw'))
  return v:null
enddef

export def Err_write(str: string): any
  # Not used
  return v:null
enddef

export def Err_writeln(str: string): any
  echohl ErrorMsg
  echom str
  echohl None
  timer_start(0, (..._) => Execute('redraw'))
  return v:null
enddef

export def Create_namespace(name: string): number
  if empty(name) == 1
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
  return deepcopy(namespace_cache)
enddef

export def Set_keymap(mode: string, lhs: string, rhs: string, opts: dict<any>): any
  const modekey: string = CreateModePrefix(mode, opts)
  const arguments: string = CreateArguments(opts)
  const escaped: string = empty(rhs) ? '<Nop>' : EscapeSpace(rhs)
  execute coc#compat#execute($'{modekey} {arguments} {EscapeSpace(lhs)} {escaped}')
  return v:null
enddef

export def Del_keymap(mode: string, lhs: string): any
  const escaped = substitute(lhs, ' ', '<space>', 'g')
  execute $'silent {mode}unmap {escaped}'
  IgnoreOnError('E31')
  return v:null
enddef

export def Set_option_value(name: string, value: any, opts: dict<any>): any
  const winid: number = get(opts, 'win', 0)
  const bufnr: number = get(opts, 'buf', 0)
  if has_key(opts, 'scope') && has_key(opts, 'buf')
    throw "Can't use both scope and buf"
  endif
  const scope: string = get(opts, 'scope', 'global')
  CheckOptionArgs(scope, winid, bufnr)
  if bufnr != 0
    Buf_set_option(bufnr, name, value)
  elseif winid != 0
    Win_set_option(winid, name, value)
  else
    if scope ==# 'global'
      Set_option(name, value)
    else
      Win_set_option(win_getid(), name, value)
      Buf_set_option(bufnr('%'), name, value)
    endif
  endif
  return v:null
enddef

export def Get_option_value(name: string, opts: dict<any> = {}): any
  const winid: number = get(opts, 'win', 0)
  const bufnr: number = get(opts, 'buf', 0)
  if has_key(opts, 'scope') && has_key(opts, 'buf')
    throw "Can't use both scope and buf"
  endif
  const scope: string = get(opts, 'scope', 'global')
  CheckOptionArgs(scope, winid, bufnr)
  var result: any = v:null
  if bufnr != 0
    result = Buf_get_option(bufnr, name)
  elseif winid != 0
    result = Win_get_option(winid, name)
  else
    if scope ==# 'global'
      result = eval('&' .. name)
    else
      result = gettabwinvar(tabpagenr(), 0, '&' .. name, v:null)
      if type(result) == v:t_none
        result = Buf_get_option(bufnr('%'), name)
      endif
    endif
  endif
  return result
enddef
# }}

# buffer methods {{
export def Buf_set_option(bufnr: number, name: string, val: any): any
  CheckBufnr(bufnr)
  setbufvar(bufnr, '&' .. name, val)
  return v:null
enddef

export def Buf_get_option(bufnr: number, name: string): any
  CheckBufnr(bufnr)
  return getbufvar(bufnr, '&' .. name)
enddef

export def Buf_get_changedtick(bufnr: number): number
  CheckBufnr(bufnr)
  return getbufvar(bufnr, 'changedtick')
enddef

export def Buf_is_valid(bufnr: number): bool
  return bufexists(bufnr)
enddef

export def Buf_is_loaded(bufnr: number): bool
  return bufloaded(bufnr)
enddef

export def Buf_get_mark(bufnr: number, name: string): list<number>
  CheckBufnr(bufnr)
  const marks: list<any> = getmarklist(bufnr)
  for item in marks
    if item['mark'] ==# $"'{name}"
      const pos: list<number> = item['pos']
      return [pos[1], pos[2] - 1]
    endif
  endfor
  return [0, 0]
enddef

export def Buf_add_highlight(bufnr: number, srcId: number, hlGroup: string, line: number, colStart: number, colEnd: number, propTypeOpts: dict<any> = {}): any
  CheckBufnr(bufnr)
  var sourceId: number
  if srcId == 0
    max_src_id += 1
    sourceId = max_src_id
  else
    sourceId = srcId
  endif
  const bufferNumber: number = bufnr == 0 ? bufnr('%') : bufnr
  Buf_add_highlight1(bufferNumber, sourceId, hlGroup, line, colStart, colEnd, propTypeOpts)
  return sourceId
enddef

# To be called directly for better performance
# 0 based line, colStart, colEnd, see `:h prop_type_add` for propTypeOpts
export def Buf_add_highlight1(bufnr: number, srcId: number, hlGroup: string, line: number, colStart: number, colEnd: number, propTypeOpts: dict<any> = {}): void
  const columnEnd: number = colEnd == -1 ? strlen(get(getbufline(bufnr, line + 1), 0, '')) + 1 : colEnd + 1
  if columnEnd < colStart + 1
    return
  endif
  const propType: string = CreateType(srcId, hlGroup, propTypeOpts)
  const propId: number = GeneratePropId(bufnr)
  try
    prop_add(line + 1, colStart + 1, {'bufnr': bufnr, 'type': propType, 'id': propId, 'end_col': columnEnd})
    IgnoreOnError('\(E967\|E964\)')
  catch /^Vim\%((\a\+)\)\=:\(E967\|E964\)/
    # ignore 967
  endtry
enddef

export def Buf_clear_namespace(id: number, srcId: number, startLine: number, endLine: number): any
  const bufnr = id == 0 ? bufnr('%') : id
  const start = startLine + 1
  const end = endLine == -1 ? BufLineCount(bufnr) : endLine
  if srcId == -1
    if has_key(buffer_id, bufnr)
      remove(buffer_id, bufnr)
    endif
    prop_clear(start, end, {'bufnr': bufnr})
  else
    const types = get(id_types, srcId, [])
    if empty(types) == 0
      try
        prop_remove({'bufnr': bufnr, 'all': v:true, 'types': types}, start, end)
        IgnoreOnError('E968')
      catch /^Vim\%((\a\+)\)\=:E968/
        # ignore 968
      endtry
    endif
  endif
  return v:null
enddef

export def Buf_line_count(bufnr: number): number
  return BufLineCount(bufnr)
enddef

export def Buf_attach(id: number = 0, ..._): bool
  const bufnr: number = id == 0 ? bufnr('%') : id
  # listener not removed on e!
  DetachListener(bufnr)
  const result = listener_add(OnBufferChange, bufnr)
  if result != 0
    listener_map[bufnr] = result
    return v:true
  endif
  return v:false
enddef

export def Buf_detach(id: number): bool
  const bufnr: number = id == 0 ? bufnr('%') : id
  return DetachListener(bufnr)
enddef

export def Buf_get_lines(id: number, start: number, end: number, strict: any = v:false): list<string>
  const bufnr: number = id == 0 ? bufnr('%') : id
  CheckBufnr(bufnr)
  const len = BufLineCount(bufnr)
  const s = start < 0 ? len + start + 2 : start + 1
  const e = end < 0 ? len + end + 1 : end
  if !!strict && e > len
    throw 'Index out of bounds ' .. end
  endif
  return getbufline(bufnr, s, e)
enddef

export def Buf_set_lines(id: number, start: number, end: number, strict: any, replacement: list<string> = []): any
  const bufnr: number = id == 0 ? bufnr('%') : id
  CheckBufnr(bufnr)
  const len = BufLineCount(bufnr)
  var startLnum = start < 0 ? len + start + 2 : start + 1
  var endLnum = end < 0 ? len + end + 1 : end
  if endLnum > len
    if !!strict
      throw 'Index out of bounds ' .. end
    else
      endLnum = len
    endif
  endif
  const delCount = endLnum - (startLnum - 1)
  const view = bufnr == bufnr('%') ? winsaveview() : v:null
  if delCount == len(replacement)
    setbufline(bufnr, startLnum, replacement)
  else
    if len(replacement) > 0
      appendbufline(bufnr, startLnum - 1, replacement)
    endif
    if delCount > 0
      startLnum += len(replacement)
      silent deletebufline(bufnr, startLnum, startLnum + delCount - 1)
    endif
  endif
  if type(view) != v:t_none
    winrestview(view)
  endif
  OnTextChange(bufnr)
  return v:null
enddef

export def Buf_set_name(id: number, name: string): any
  const bufnr: number = id == 0 ? bufnr('%') : id
  BufExecute(bufnr, ['silent noa 0file', $'file {fnameescape(name)}'], v:true)
  return v:null
enddef

export def Buf_get_name(id: number): string
  const bufnr: number = id == 0 ? bufnr('%') : id
  CheckBufnr(bufnr)
  return bufname(bufnr)
enddef

export def Buf_get_var(id: number, name: string): any
  const bufnr: number = id == 0 ? bufnr('%') : id
  CheckBufnr(bufnr)
  const dict: dict<any> = getbufvar(bufnr, '')
  if !has_key(dict, name)
    throw 'Key not found: ' .. name
  endif
  return dict[name]
enddef

export def Buf_set_var(id: number, name: string, val: any): any
  const bufnr: number = id == 0 ? bufnr('%') : id
  CheckBufnr(bufnr)
  setbufvar(bufnr, name, val)
  return v:null
enddef

export def Buf_del_var(id: number, name: string): any
  const bufnr: number = id == 0 ? bufnr('%') : id
  CheckBufnr(bufnr)
  final bufvars = getbufvar(bufnr, '')
  if !has_key(bufvars, name)
    throw 'Key not found: ' .. name
  endif
  remove(bufvars, name)
  return v:null
enddef

export def Buf_set_keymap(id: number, mode: string, lhs: string, rhs: string, opts: dict<any>): any
  const bufnr: number = id == 0 ? bufnr('%') : id
  const prefix = CreateModePrefix(mode, opts)
  const arguments = CreateArguments(opts)
  const escaped = empty(rhs) ? '<Nop>' : EscapeSpace(rhs)
  BufExecute(bufnr, [$'{prefix} {arguments}<buffer> {EscapeSpace(lhs)} {escaped}'], v:true)
  return v:null
enddef

export def Buf_del_keymap(id: number, mode: string, lhs: string): any
  const bufnr: number = id == 0 ? bufnr('%') : id
  const escaped = substitute(lhs, ' ', '<space>', 'g')
  BufExecute(bufnr, [$'silent! {mode}unmap <buffer> {escaped}'], v:false)
  return v:null
enddef
# }}

# window methods {{
export def Win_get_buf(id: number): number
  const winid = id == 0 ? win_getid() : id
  CheckWinid(winid)
  return winbufnr(winid)
enddef

export def Win_set_buf(id: number, bufnr: number): any
  const winid = id == 0 ? win_getid() : id
  CheckWinid(winid)
  CheckBufnr(bufnr)
  win_execute(winid, 'buffer ' .. bufnr)
  return v:null
enddef

export def Win_get_position(id: number): list<number>
  const winid = id == 0 ? win_getid() : id
  const [row, col] = win_screenpos(winid)
  if row == 0 && col == 0
    throw 'Invalid window ' .. winid
  endif
  return [row - 1, col - 1]
enddef

export def Win_set_height(id: number, height: number): any
  const winid = id == 0 ? win_getid() : id
  CheckWinid(winid)
  if IsPopup(winid)
    popup_move(winid, {'maxheight': height, 'minheight': height})
  else
    win_execute(winid, $'resize {height}')
  endif
  return v:null
enddef

export def Win_get_height(id: number): number
  const winid = id == 0 ? win_getid() : id
  CheckWinid(winid)
  if IsPopup(winid)
    return popup_getpos(winid)['height']
  endif
  return winheight(winid)
enddef

export def Win_set_width(id: number, width: number): any
  const winid = id == 0 ? win_getid() : id
  CheckWinid(winid)
  if IsPopup(winid)
    popup_move(winid, {'maxwidth': width, 'minwidth': width})
  else
    win_execute(winid, $'vertical resize {width}')
  endif
  return v:null
enddef

export def Win_get_width(id: number): number
  const winid = id == 0 ? win_getid() : id
  CheckWinid(winid)
  if IsPopup(winid)
    return popup_getpos(winid)['width']
  endif
  return winwidth(winid)
enddef

export def Win_set_cursor(id: number, pos: list<number>): any
  const winid = id == 0 ? win_getid() : id
  CheckWinid(winid)
  win_execute(winid, 'cursor(' .. pos[0] .. ', ' .. (pos[1] + 1) .. ')')
  return v:null
enddef

export def Win_get_cursor(id: number): list<number>
  const winid = id == 0 ? win_getid() : id
  CheckWinid(winid)
  const result = getcurpos(winid)
  if result[1] == 0
    return [1, 0]
  endif
  return [result[1], result[2] - 1]
enddef

export def Win_set_option(id: number, name: string, value: any): any
  const winid = id == 0 ? win_getid() : id
  const tabnr: number = WinTabnr(winid)
  const vars = gettabwinvar(tabnr, winid, '&')
  if !has_key(vars, name)
    throw $"Invalid option name: {name}"
  endif
  settabwinvar(tabnr, winid, $'&{name}', value)
  return v:null
enddef

export def Win_get_option(id: number, name: string, ..._): any
  const winid = id == 0 ? win_getid() : id
  const tabnr: number = WinTabnr(winid)
  const vars = gettabwinvar(tabnr, winid, '&')
  if !has_key(vars, name)
    throw $"Invalid option name: {name}"
  endif
  const result: any = gettabwinvar(tabnr, winid, '&' .. name)
  return result
enddef

export def Win_get_var(id: number, name: string, ..._): any
  const winid = id == 0 ? win_getid() : id
  const tabnr = WinTabnr(winid)
  const vars = gettabwinvar(tabnr, winid, '')
  if !has_key(vars, name)
    throw $'Key not found: {name}'
  endif
  return vars[name]
enddef

export def Win_set_var(id: number, name: string, value: any): any
  const winid = id == 0 ? win_getid() : id
  const tabnr = WinTabnr(winid)
  settabwinvar(tabnr, winid, name, value)
  return v:null
enddef

export def Win_del_var(id: number, name: string): any
  const winid = id == 0 ? win_getid() : id
  const tabnr = WinTabnr(winid)
  const vars = gettabwinvar(tabnr, winid, '')
  if !has_key(vars, name)
    throw $'Key not found: {name}'
  endif
  win_execute(winid, 'remove(w:, "' .. name .. '")')
  return v:null
enddef

export def Win_is_valid(id: number): bool
  const winid = id == 0 ? win_getid() : id
  return empty(getwininfo(winid)) == 0
enddef

export def Win_get_number(id: number): number
  const winid = id == 0 ? win_getid() : id
  # Not work for popup
  if IsPopup(winid)
    return 0
  endif
  CheckWinid(winid)
  const info = getwininfo(winid)
  return info[0]['winnr']
enddef

export def Win_get_tabpage(id: number): number
  const winid = id == 0 ? win_getid() : id
  const nr = WinTabnr(winid)
  return TabNrId(nr)
enddef

export def Win_close(id: number, force: bool = v:false): any
  const winid = id == 0 ? win_getid() : id
  CheckWinid(winid)
  if IsPopup(winid)
    popup_close(winid)
  else
    win_execute(winid, 'close' .. (force ? '!' : ''))
  endif
  return v:null
enddef
# }}

# tabpage methods {{
export def Tabpage_get_number(tid: number): number
  return TabIdNr(tid)
enddef

export def Tabpage_list_wins(tid: number): list<number>
  const nr = TabIdNr(tid)
  return gettabinfo(nr)[0]['windows']
enddef

export def Tabpage_get_var(tid: number, name: string): any
  const nr = TabIdNr(tid)
  const dict = gettabvar(nr, '')
  if !has_key(dict, name)
    throw $'Key not found: {name}'
  endif
  return dict[name]
enddef

export def Tabpage_set_var(tid: number, name: string, value: any): any
  const nr = TabIdNr(tid)
  settabvar(nr, name, value)
  return v:null
enddef

export def Tabpage_del_var(tid: number, name: string): any
  const nr = TabIdNr(tid)
  final dict = gettabvar(nr, '')
  if !has_key(dict, name)
    throw $'Key not found: {name}'
  endif
  remove(dict, name)
  return v:null
enddef

export def Tabpage_is_valid(tid: number): bool
  for nr in range(1, tabpagenr('$'))
    if gettabvar(nr, '__coc_tid', -1) == tid
      return v:true
    endif
  endfor
  return v:false
enddef

export def Tabpage_get_win(tid: number): number
  const nr = TabIdNr(tid)
  return win_getid(tabpagewinnr(nr), nr)
enddef
# }}

# Used by node-client request
export def Call(method: string, args: list<any>): list<any>
  var err: any = v:null
  var result: any = v:null
  try
    v:errmsg = ''
    result = call(method, args)
    listener_flush()
    ThrowOnError()
  catch /.*/
    err =  $'{v:exception} on request api "{method}" {json_encode(args)}'
    # vim9 return 0 for error on channel.
    result = v:null
  endtry
  return [err, result]
enddef

# Used by node-client notification
export def Notify(method: string, args: list<any>): any
  try
    v:errmsg = ''
    # vim throw error with return when vim9 function has no return value.
    if method ==# 'call_function'
      call(args[0], args[1])
    elseif method ==# 'call_dict_function'
      if type(args[0]) == v:t_string
        call(args[1], args[2], coc#compat#eval(args[0]))
      else
        call(args[1], args[2], args[0])
      endif
    else
      call(toupper(method[0]) .. method[1 : ], args)
    endif
    listener_flush()
    ThrowOnError()
  catch /.*/
    coc#rpc#notify('nvim_error_event', [0, $'{v:exception} on notify api "{method}" {json_encode(args)}'])
  endtry
  return v:null
enddef

export def Tabpage_ids(): void
  for nr in range(1, tabpagenr('$'))
    if gettabvar(nr, '__coc_tid', -1) == -1
      settabvar(nr, '__coc_tid', tab_id)
      tab_id += 1
    endif
  endfor
enddef

# Note: .. must be used
legacy execute "function! coc#api#call(method, args) abort\n  let err = v:null\n  let res = v:null\n  try\n    let res = call('coc#api#' .. toupper(a:method[0]) .. a:method[1:], a:args)\n  catch /.*/\n    let err = v:exception\n  endtry\n  return [err, res]\nendfunction"

defcompile
# vim: set sw=2 ts=2 sts=2 et tw=78 foldmarker={{,}} foldmethod=marker foldlevel=0:
