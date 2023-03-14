" ============================================================================
" Description: Client api used by vim8
" Author: Qiming Zhao <chemzqm@gmail.com>
" Licence: Anti 996 licence
" Last Modified: 2022-12-20
" ============================================================================
if has('nvim')
  finish
endif

scriptencoding utf-8
let s:funcs = {}
let s:prop_offset = get(g:, 'coc_text_prop_offset', 1000)
let s:namespace_id = 1
let s:namespace_cache = {}
let s:max_src_id = 1000
" bufnr => max textprop id
let s:buffer_id = {}
" srcId => list of types
let s:id_types = {}
let s:tab_id = 1
let s:keymap_arguments = ['nowait', 'silent', 'script', 'expr', 'unique']

" helper {{
" Create a window with bufnr for execute win_execute
function! s:create_popup(bufnr) abort
  noa let id = popup_create(1, {
      \ 'line': 1,
      \ 'col': &columns,
      \ 'maxwidth': 1,
      \ 'maxheight': 1,
      \ })
  call popup_hide(id)
  return id
endfunction

function! s:check_bufnr(bufnr) abort
  if !bufloaded(a:bufnr)
    throw 'Invalid buffer id: '.a:bufnr
  endif
endfunction

" TextChanged not fired when using channel on vim.
function! s:on_textchange(bufnr) abort
  let event = mode() ==# 'i' ? 'TextChangedI' : 'TextChanged'
  exe 'doautocmd <nomodeline> '.event.' '.bufname(a:bufnr)
endfunction

" execute command for bufnr
function! s:buf_execute(bufnr, cmds) abort
  call s:check_bufnr(a:bufnr)
  let winid = get(win_findbuf(a:bufnr), 0, -1)
  let close = 0
  if winid == -1
    let winid = s:create_popup(a:bufnr)
    let close = 1
  endif
  for cmd in a:cmds
    call win_execute(winid, cmd, 'silent')
  endfor
  if close
    noa call popup_close(winid)
  endif
endfunction

function! s:check_winid(winid) abort
  if empty(getwininfo(a:winid)) && empty(popup_getpos(a:winid))
    throw 'Invalid window id: '.a:winid
  endif
endfunction

function! s:is_popup(winid) abort
  try
    return !empty(popup_getpos(a:winid))
  catch /^Vim\%((\a\+)\)\=:E993/
    return 0
  endtry
endfunction

function! s:tabid_nr(tid) abort
  for nr in range(1, tabpagenr('$'))
    if gettabvar(nr, '__tid', v:null) is a:tid
      return nr
    endif
  endfor
  throw 'Invalid tabpage id: '.a:tid
endfunction

function! s:tabnr_id(nr) abort
  let tid = gettabvar(a:nr, '__tid', -1)
  if tid == -1
    let tid = s:tab_id
    call settabvar(a:nr, '__tid', tid)
    let s:tab_id = s:tab_id + 1
  endif
  return tid
endfunction

function! s:generate_id(bufnr) abort
  let max = get(s:buffer_id, a:bufnr, s:prop_offset)
  let id = max + 1
  let s:buffer_id[a:bufnr] = id
  return id
endfunction

function! s:win_execute(winid, cmd, ...) abort
  let ref = get(a:000, 0, v:null)
  let cmd = ref is v:null ? a:cmd : 'let ref["out"] = ' . a:cmd
  call win_execute(a:winid, cmd)
endfunction

function! s:win_tabnr(winid) abort
  let ref = {}
  call win_execute(a:winid, 'let ref["out"] = tabpagenr()')
  let tabnr = get(ref, 'out', -1)
  if tabnr == -1
    throw 'Invalid window id: '.a:winid
  endif
  return tabnr
endfunction

function! s:buf_line_count(bufnr) abort
  if bufnr('%') == a:bufnr
    return line('$')
  endif
  if exists('*getbufinfo')
    let info = getbufinfo(a:bufnr)
    if empty(info)
      return 0
    endif
    " vim 8.1 has getbufinfo but no linecount
    if has_key(info[0], 'linecount')
      return info[0]['linecount']
    endif
  endif
  return len(getbufline(a:bufnr, 1, '$'))
endfunction

function! s:execute(cmd)
  if a:cmd =~# '^echo'
    execute a:cmd
  else
    silent! execute a:cmd
  endif
endfunction

function s:inspect_type(v) abort
  let types = ['Number', 'String', 'Funcref', 'List', 'Dictionary', 'Float', 'Boolean', 'Null']
  return get(types, type(a:v), 'Unknown')
endfunction

function! s:escape_space(text) abort
  return substitute(a:text, ' ', '<space>', 'g')
endfunction

function! s:create_mode_prefix(mode, opts) abort
  if a:mode ==# '!'
    return 'map!'
  endif
  return get(a:opts, 'noremap', 0) ?  a:mode . 'noremap' : a:mode . 'map'
endfunction

function! s:create_arguments(opts) abort
  let arguments = ''
  for key in keys(a:opts)
    if a:opts[key] && index(s:keymap_arguments, key) != -1
      let arguments .= '<'.key.'>'
    endif
  endfor
  return arguments
endfunction
" }}"

" nvim client methods {{
function! s:funcs.set_current_dir(dir) abort
  execute 'cd '.fnameescape(a:dir)
  return v:null
endfunction

function! s:funcs.set_var(name, value) abort
  execute 'let g:'.a:name.'= a:value'
  return v:null
endfunction

function! s:funcs.del_var(name) abort
  if !has_key(g:, a:name)
    throw 'Key not found: '.a:name
  endif
  execute 'unlet g:'.a:name
  return v:null
endfunction

function! s:funcs.set_option(name, value) abort
  execute 'let &'.a:name.' = a:value'
  return v:null
endfunction

function! s:funcs.get_option(name)
  return eval('&'.a:name)
endfunction

function! s:funcs.set_current_buf(bufnr) abort
  call s:check_bufnr(a:bufnr)
  execute 'buffer '.a:bufnr
  return v:null
endfunction

function! s:funcs.set_current_win(winid) abort
  call s:win_tabnr(a:winid)
  call win_gotoid(a:winid)
  return v:null
endfunction

function! s:funcs.set_current_tabpage(tid) abort
  let nr = s:tabid_nr(a:tid)
  execute 'normal! '.nr.'gt'
  return v:null
endfunction

function! s:funcs.list_wins() abort
  return map(getwininfo(), 'v:val["winid"]')
endfunction

function! s:funcs.call_atomic(calls)
  let results = []
  for i in range(len(a:calls))
    let [key, arglist] = a:calls[i]
    let name = key[5:]
    try
      call add(results, call(s:funcs[name], arglist))
    catch /.*/
      return [results, [i, "VimException(".s:inspect_type(v:exception).")", v:exception . ' on function "'.name.'"']]
    endtry
  endfor
  return [results, v:null]
endfunction

function! s:funcs.set_client_info(...) abort
  " not supported
  return v:null
endfunction

function! s:funcs.subscribe(...) abort
  " not supported
  return v:null
endfunction

function! s:funcs.unsubscribe(...) abort
  " not supported
  return v:null
endfunction

function! s:funcs.call_function(method, args) abort
  return call(a:method, a:args)
endfunction

function! s:funcs.call_dict_function(dict, method, args) abort
  if type(a:dict) == v:t_string
    return call(a:method, a:args, eval(a:dict))
  endif
  return call(a:method, a:args, a:dict)
endfunction

function! s:funcs.command(command) abort
  " command that could cause cursor vanish
  if a:command =~# '^echo' || a:command =~# '^redraw' || a:command =~# '^sign place'
    call timer_start(0, {-> s:execute(a:command)})
  else
    execute a:command
    let err = get(g:, 'errmsg', '')
    " get error from python script run.
    if !empty(err)
      unlet g:errmsg
      throw err
    endif
  endif
endfunction

function! s:funcs.eval(expr) abort
  return eval(a:expr)
endfunction

function! s:funcs.get_api_info()
  let names = coc#api#func_names()
  let channel = coc#rpc#get_channel()
  if empty(channel)
    throw 'Unable to get channel'
  endif
  return [ch_info(channel)['id'], {'functions': map(names, '{"name": "nvim_".v:val}')}]
endfunction

function! s:funcs.list_bufs()
  return map(getbufinfo(), 'v:val["bufnr"]')
endfunction

function! s:funcs.feedkeys(keys, mode, escape_csi)
  call feedkeys(a:keys, a:mode)
  return v:null
endfunction

function! s:funcs.list_runtime_paths()
  return globpath(&runtimepath, '', 0, 1)
endfunction

function! s:funcs.command_output(cmd)
  return execute(a:cmd)
endfunction

function! s:funcs.exec(code, output) abort
  let cmds = split(a:code, '\n')
  if a:output
    return substitute(execute(cmds, 'silent!'), '^\n', '', '')
  endif
  call execute(cmds)
  return v:null
endfunction

" Queues raw user-input, <" is special. To input a literal "<", send <LT>.
function! s:funcs.input(keys) abort
  let escaped = substitute(a:keys, '<', '\\<', 'g')
  call feedkeys(eval('"'.escaped.'"'), 't')
  return v:null
endfunction

function! s:funcs.create_buf(listed, scratch) abort
  let bufnr = bufadd('')
  call setbufvar(bufnr, '&buflisted', a:listed ? 1 : 0)
  if a:scratch
    call setbufvar(bufnr, '&modeline', 0)
    call setbufvar(bufnr, '&buftype', 'nofile')
    call setbufvar(bufnr, '&swapfile', 0)
  endif
  call bufload(bufnr)
  return bufnr
endfunction

function! s:funcs.get_current_line()
  return getline('.')
endfunction

function! s:funcs.set_current_line(line)
  call setline('.', a:line)
  call s:on_textchange(bufnr('%'))
  return v:null
endfunction

function! s:funcs.del_current_line()
  call deletebufline('%', line('.'))
  call s:on_textchange(bufnr('%'))
  return v:null
endfunction

function! s:funcs.get_var(var)
  return get(g:, a:var, v:null)
endfunction

function! s:funcs.get_vvar(var)
  return get(v:, a:var, v:null)
endfunction

function! s:funcs.get_current_buf()
  return bufnr('%')
endfunction

function! s:funcs.get_current_win()
  return win_getid()
endfunction

function! s:funcs.get_current_tabpage()
  return s:tabnr_id(tabpagenr())
endfunction

function! s:funcs.list_tabpages()
  let ids = []
  for nr in range(1, tabpagenr('$'))
    call add(ids, s:tabnr_id(nr))
  endfor
  return ids
endfunction

function! s:funcs.get_mode()
  let m = mode()
  return {'blocking': m ==# 'r' ? v:true : v:false, 'mode': m}
endfunction

function! s:funcs.strwidth(str)
  return strwidth(a:str)
endfunction

function! s:funcs.out_write(str)
  echon a:str
  call timer_start(0, {-> s:execute('redraw')})
endfunction

function! s:funcs.err_write(str)
  "echoerr a:str
endfunction

function! s:funcs.err_writeln(str)
  echohl ErrorMsg
  echom a:str
  echohl None
  call timer_start(0, {-> s:execute('redraw')})
endfunction

function! s:funcs.create_namespace(name) abort
  if empty(a:name)
    let id = s:namespace_id
    let s:namespace_id = s:namespace_id + 1
    return id
  endif
  let id = get(s:namespace_cache, a:name, 0)
  if !id
    let id = s:namespace_id
    let s:namespace_id = s:namespace_id + 1
    let s:namespace_cache[a:name] = id
  endif
  return id
endfunction

function! s:funcs.set_keymap(mode, lhs, rhs, opts) abort
  let modekey = s:create_mode_prefix(a:mode, a:opts)
  let arguments = s:create_arguments(a:opts)
  let lhs = s:escape_space(a:lhs)
  let rhs = empty(a:rhs) ? '<Nop>' : s:escape_space(a:rhs)
  let cmd = modekey . ' ' . arguments .' '.lhs. ' '.rhs
  execute cmd
  return v:null
endfunction

function! s:funcs.del_keymap(mode, lhs) abort
  let lhs = substitute(a:lhs, ' ', '<space>', 'g')
  execute 'silent '.a:mode.'unmap '.lhs
  return v:null
endfunction
" }}

" buffer methods {{
function! s:funcs.buf_set_option(bufnr, name, val)
  let val = a:val
  if val is v:true
    let val = 1
  elseif val is v:false
    let val = 0
  endif
  call setbufvar(a:bufnr, '&'.a:name, val)
  return v:null
endfunction

function! s:funcs.buf_get_option(bufnr, name)
  call s:check_bufnr(a:bufnr)
  return getbufvar(a:bufnr, '&'.a:name)
endfunction

function! s:funcs.buf_get_changedtick(bufnr)
  return getbufvar(a:bufnr, 'changedtick')
endfunction

function! s:funcs.buf_is_valid(bufnr)
  return bufexists(a:bufnr) ? v:true : v:false
endfunction

function! s:funcs.buf_is_loaded(bufnr)
  return bufloaded(a:bufnr) ? v:true : v:false
endfunction

function! s:funcs.buf_get_mark(bufnr, name)
  if a:bufnr != 0 && a:bufnr != bufnr('%')
    throw 'buf_get_mark support current buffer only'
  endif
  return [line("'" . a:name), col("'" . a:name) - 1]
endfunction

function! s:funcs.buf_add_highlight(bufnr, srcId, hlGroup, line, colStart, colEnd, ...) abort
  if a:srcId == 0
    let srcId = s:max_src_id + 1
    let s:max_src_id = srcId
  else
    let srcId = a:srcId
  endif
  let bufnr = a:bufnr == 0 ? bufnr('%') : a:bufnr
  let type = srcId == -1 ? a:hlGroup : a:hlGroup.'_'.srcId
  let types = get(s:id_types, srcId, [])
  if index(types, type) == -1
    call add(types, type)
    let s:id_types[srcId] = types
    if empty(prop_type_get(type))
      call prop_type_add(type, extend({'highlight': a:hlGroup}, get(a:, 1, {})))
    endif
  endif
  let end = a:colEnd == -1 ? strlen(get(getbufline(bufnr, a:line + 1), 0, '')) + 1 : a:colEnd + 1
  if end < a:colStart + 1
    return
  endif
  let id = s:generate_id(a:bufnr)
  try
    call prop_add(a:line + 1, a:colStart + 1, {'bufnr': bufnr, 'type': type, 'id': id, 'end_col': end})
  catch /^Vim\%((\a\+)\)\=:E967/
    " ignore 967
  endtry
  if a:srcId == 0
    " return generated srcId
    return srcId
  endif
  return v:null
endfunction

function! s:funcs.buf_clear_namespace(bufnr, srcId, startLine, endLine) abort
  let bufnr = a:bufnr == 0 ? bufnr('%') : a:bufnr
  let start = a:startLine + 1
  let end = a:endLine == -1 ? len(getbufline(bufnr, 1, '$')) : a:endLine
  if a:srcId == -1
    if has_key(s:buffer_id, a:bufnr)
      unlet s:buffer_id[a:bufnr]
    endif
    call prop_clear(start, end, {'bufnr' : bufnr})
  else
    for type in get(s:id_types, a:srcId, [])
      try
        call prop_remove({'bufnr': bufnr, 'all': 1, 'type': type}, start, end)
      catch /^Vim\%((\a\+)\)\=:E968/
        " ignore 968
      endtry
    endfor
  endif
  return v:null
endfunction

function! s:funcs.buf_line_count(bufnr) abort
  call s:check_bufnr(a:bufnr)
  return s:buf_line_count(a:bufnr)
endfunction

function! s:funcs.buf_attach(...)
  " not supported
  return 1
endfunction

function! s:funcs.buf_detach()
  " not supported
  return 1
endfunction

function! s:funcs.buf_get_lines(bufnr, start, end, strict) abort
  call s:check_bufnr(a:bufnr)
  let len = s:buf_line_count(a:bufnr)
  let start = a:start < 0 ? len + a:start + 2 : a:start + 1
  let end = a:end < 0 ? len + a:end + 1 : a:end
  if a:strict && end > len
    throw 'Index out of bounds '. end
  endif
  return getbufline(a:bufnr, start, end)
endfunction

function! s:funcs.buf_set_lines(bufnr, start, end, strict, ...) abort
  call s:check_bufnr(a:bufnr)
  let bufnr = a:bufnr == 0 ? bufnr('%') : a:bufnr
  let len = s:buf_line_count(bufnr)
  let startLnum = a:start < 0 ? len + a:start + 2 : a:start + 1
  let endLnum = a:end < 0 ? len + a:end + 1 : a:end
  if endLnum > len
    if a:strict
      throw 'Index out of bounds '. end
    else
      let endLnum = len
    endif
  endif
  let delCount = endLnum - (startLnum - 1)
  let view = bufnr == bufnr('%') ? winsaveview() : v:null
  let replacement = get(a:, 1, [])
  if delCount == len(replacement)
    call setbufline(bufnr, startLnum, replacement)
  else
    if len(replacement)
      call appendbufline(bufnr, startLnum - 1, replacement)
    endif
    if delCount
      let start = startLnum + len(replacement)
      silent call deletebufline(bufnr, start, start + delCount - 1)
    endif
  endif
  if view isnot v:null
    call winrestview(view)
  endif
  call s:on_textchange(a:bufnr)
  return v:null
endfunction

function! s:funcs.buf_set_name(bufnr, name) abort
  call s:check_bufnr(a:bufnr)
  call s:buf_execute(a:bufnr, [
      \ 'noa 0f',
      \ 'file '.fnameescape(a:name)
      \ ])
  return v:null
endfunction

function! s:funcs.buf_get_name(bufnr)
  call s:check_bufnr(a:bufnr)
  return bufname(a:bufnr)
endfunction

function! s:funcs.buf_get_var(bufnr, name)
  call s:check_bufnr(a:bufnr)
  if !has_key(getbufvar(a:bufnr, ''), a:name)
    throw 'Key not found: '.a:name
  endif
  return getbufvar(a:bufnr, a:name)
endfunction

function! s:funcs.buf_set_var(bufnr, name, val)
  call s:check_bufnr(a:bufnr)
  call setbufvar(a:bufnr, a:name, a:val)
  return v:null
endfunction

function! s:funcs.buf_del_var(bufnr, name)
  call s:check_bufnr(a:bufnr)
  let bufvars = getbufvar(a:bufnr, '')
  call remove(bufvars, a:name)
  return v:null
endfunction

function! s:funcs.buf_set_keymap(bufnr, mode, lhs, rhs, opts) abort
  let modekey = s:create_mode_prefix(a:mode, a:opts)
  let arguments = s:create_arguments(a:opts)
  let lhs = s:escape_space(a:lhs)
  let rhs = empty(a:rhs) ? '<Nop>' : s:escape_space(a:rhs)
  let cmd = modekey . ' ' . arguments .'<buffer> '.lhs. ' '.rhs
  if bufnr('%') == a:bufnr || a:bufnr == 0
    execute cmd
  else
    call s:buf_execute(a:bufnr, [cmd])
  endif
  return v:null
endfunction

function! s:funcs.buf_del_keymap(bufnr, mode, lhs) abort
  let lhs = substitute(a:lhs, ' ', '<space>', 'g')
  let cmd = 'silent '.a:mode.'unmap <buffer> '.lhs
  if bufnr('%') == a:bufnr || a:bufnr == 0
    execute cmd
  else
    call s:buf_execute(a:bufnr, [cmd])
  endif
  return v:null
endfunction
" }}

" window methods {{
function! s:funcs.win_get_buf(winid)
  call s:check_winid(a:winid)
  return winbufnr(a:winid)
endfunction

function! s:funcs.win_set_buf(winid, bufnr) abort
  call s:check_winid(a:winid)
  call s:check_bufnr(a:bufnr)
  call s:win_execute(a:winid, 'buffer '.a:bufnr)
  return v:null
endfunction

function! s:funcs.win_get_position(winid) abort
  let [row, col] = win_screenpos(a:winid)
  if row == 0 && col == 0
    throw 'Invalid window '.a:winid
  endif
  return [row - 1, col - 1]
endfunction

function! s:funcs.win_set_height(winid, height) abort
  call s:check_winid(a:winid)
  if s:is_popup(a:winid)
    call popup_move(a:winid, {'maxheight': a:height, 'minheight': a:height})
  else
    call s:win_execute(a:winid, 'resize '.a:height)
  endif
  return v:null
endfunction

function! s:funcs.win_get_height(winid) abort
  call s:check_winid(a:winid)
  if s:is_popup(a:winid)
    return popup_getpos(a:winid)['height']
  endif
  return winheight(a:winid)
endfunction

function! s:funcs.win_set_width(winid, width) abort
  call s:check_winid(a:winid)
  if s:is_popup(a:winid)
    call popup_move(a:winid, {'maxwidth': a:width, 'minwidth': a:width})
  else
    call s:win_execute(a:winid, 'vertical resize '.a:width)
  endif
  return v:null
endfunction

function! s:funcs.win_get_width(winid) abort
  call s:check_winid(a:winid)
  if s:is_popup(a:winid)
    return popup_getpos(a:winid)['width']
  endif
  return winwidth(a:winid)
endfunction

function! s:funcs.win_set_cursor(winid, pos) abort
  call s:check_winid(a:winid)
  let [line, col] = a:pos
  call s:win_execute(a:winid, 'call cursor('.line.','.(col + 1).')')
  return v:null
endfunction

function! s:funcs.win_get_cursor(winid) abort
  call s:check_winid(a:winid)
  let ref = {}
  call s:win_execute(a:winid, "[line('.'), col('.')-1]", ref)
  return get(ref, 'out', [1, 0])
endfunction

function! s:funcs.win_set_option(winid, name, value) abort
  let tabnr = s:win_tabnr(a:winid)
  let val = a:value
  if val is v:true
    let val = 1
  elseif val is v:false
    let val = 0
  endif
  call settabwinvar(tabnr, a:winid, '&'.a:name, val)
  return v:null
endfunction

function! s:funcs.win_get_option(winid, name, ...) abort
  let tabnr = s:win_tabnr(a:winid)
  let result = gettabwinvar(tabnr, a:winid, '&'.a:name, get(a:, 1, v:null))
  if result is v:null
    throw "Invalid option name: '".a:name."'"
  endif
  return result
endfunction

function! s:funcs.win_get_var(winid, name, ...) abort
  let tabnr = s:win_tabnr(a:winid)
  return gettabwinvar(tabnr, a:winid, a:name, get(a:, 1, v:null))
endfunction

function! s:funcs.win_set_var(winid, name, value) abort
  let tabnr = s:win_tabnr(a:winid)
  call settabwinvar(tabnr, a:winid, a:name, a:value)
  return v:null
endfunction

function! s:funcs.win_del_var(winid, name) abort
  call s:check_winid(a:winid)
  call win_execute(a:winid, 'unlet! w:'.a:name)
  return v:null
endfunction

function! s:funcs.win_is_valid(winid) abort
  let invalid = empty(getwininfo(a:winid)) && empty(popup_getpos(a:winid))
  return invalid ? v:false : v:true
endfunction

" Not work for popup
function! s:funcs.win_get_number(winid) abort
  if s:is_popup(a:winid)
    return 0
  endif
  let info = getwininfo(a:winid)
  if empty(info)
    throw 'Invalid window id '.a:winid
  endif
  return info[0]['winnr']
endfunction

function! s:funcs.win_get_tabpage(winid) abort
  let nr = s:win_tabnr(a:winid)
  return s:tabnr_id(nr)
endfunction

function! s:funcs.win_close(winid, ...) abort
  call s:check_winid(a:winid)
  let force = get(a:, 1, 0)
  if s:is_popup(a:winid)
    call popup_close(a:winid)
  else
    call s:win_execute(a:winid, 'close'.(force ? '!' : ''))
  endif
  return v:null
endfunction
" }}

" tabpage methods {{
function! s:funcs.tabpage_get_number(tid)
  return s:tabid_nr(a:tid)
endfunction

function! s:funcs.tabpage_list_wins(tid)
  let nr = s:tabid_nr(a:tid)
  return gettabinfo(nr)[0]['windows']
endfunction

function! s:funcs.tabpage_get_var(tid, name)
  let nr = s:tabid_nr(a:tid)
  return gettabvar(nr, a:name, v:null)
endfunction

function! s:funcs.tabpage_set_var(tid, name, value)
  let nr = s:tabid_nr(a:tid)
  call settabvar(nr, a:name, a:value)
  return v:null
endfunction

function! s:funcs.tabpage_del_var(tid, name)
  let nr = s:tabid_nr(a:tid)
  call settabvar(nr, a:name, v:null)
  return v:null
endfunction

function! s:funcs.tabpage_is_valid(tid)
  for nr in range(1, tabpagenr('$'))
    if gettabvar(nr, '__tid', -1) == a:tid
      return v:true
    endif
  endfor
  return v:false
endfunction

function! s:funcs.tabpage_get_win(tid)
  let nr = s:tabid_nr(a:tid)
  return win_getid(tabpagewinnr(nr), nr)
endfunction
" }}

function! coc#api#get_types(srcId) abort
  return get(s:id_types, a:srcId, [])
endfunction

function! coc#api#get_id_types() abort
  return s:id_types
endfunction

function! coc#api#create_type(srcId, hlGroup, opts) abort
  let type = a:hlGroup.'_'.a:srcId
  let types = get(s:id_types, a:srcId, [])
  if index(types, type) == -1
    call add(types, type)
    let s:id_types[a:srcId] = types
    let combine = get(a:opts, 'hl_mode', 'combine') ==# 'combine'
    call prop_type_add(type, {'highlight': a:hlGroup, 'combine': combine})
  endif
  return type
endfunction

function! coc#api#func_names() abort
  return keys(s:funcs)
endfunction

function! coc#api#call(method, args) abort
  let err = v:null
  let res = v:null
  try
    let res = call(s:funcs[a:method], a:args)
  catch /.*/
    let err = v:exception .' on api "'.a:method.'" '.json_encode(a:args)
  endtry
  return [err, res]
endfunction

function! coc#api#exec(method, args) abort
  return call(s:funcs[a:method], a:args)
endfunction

function! coc#api#notify(method, args) abort
  try
    call call(s:funcs[a:method], a:args)
  catch /.*/
    call coc#rpc#notify('nvim_error_event', [0, v:exception.' on api "'.a:method.'" '.json_encode(a:args)])
  endtry
endfunction

" create id for all tabpages
function! coc#api#tabpage_ids() abort
  for nr in range(1, tabpagenr('$'))
    if gettabvar(nr, '__tid', -1) == -1
      call settabvar(nr, '__tid', s:tab_id)
      let s:tab_id = s:tab_id + 1
    endif
  endfor
endfunction

function! coc#api#get_tabid(nr) abort
  return s:tabnr_id(a:nr)
endfunction
" vim: set sw=2 ts=2 sts=2 et tw=78 foldmarker={{,}} foldmethod=marker foldlevel=0:
