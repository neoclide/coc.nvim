if has('nvim') | finish | endif

scriptencoding utf-8
let s:save_cpo = &cpo
set cpo&vim

let s:funcs = {}

function! s:buf_line_count(bufnr) abort
  if bufnr('%') == a:bufnr
    return line('$')
  endif
  let lines = getbufline(a:bufnr, 1, '$')
  return len(lines)
endfunction

function! s:switch_tab(tabnr)
pyx << EOF
tabnr = int(vim.eval('a:tabnr'))
tab = find(lambda x: x.number == tabnr, vim.tabpages)
EOF
endfunction

function! s:switch_buf(bufnr)
pyx << EOF
bufnr = int(vim.eval('a:bufnr'))
buf = find(lambda x: x.number == bufnr, vim.buffers)
EOF
endfunction

function! s:switch_win(win_id)
  let [tabnr, winnr] = win_id2tabwin(a:win_id)
  if tabnr == 0 | return | endif
pyx << EOF
tabnr = int(vim.eval('tabnr'))
wnr = int(vim.eval('winnr'))
tab = find(lambda x: x.number == tabnr, vim.tabpages)
win = find(lambda x: x.number == wnr, tab.windows)
EOF
  return 1
endfunction

function! s:funcs.feedkeys(keys, mode, escape_csi)
  call feedkeys(a:keys, a:mode)
endfunction

function! s:funcs.win_get_position(win_id) abort
  if !s:switch_win(a:win_id) | return v:null | endif
  return pyxeval('[win.row, win.col]')
endfunction

function! s:funcs.win_get_cursor(win_id) abort
  if !s:switch_win(a:win_id) | return v:null | endif
  return pyxeval('win.cursor')
endfunction

function! s:funcs.win_get_height(win_id) abort
  if !s:switch_win(a:win_id) | return v:null | endif
  return pyxeval('win.height')
endfunction

function! s:funcs.win_get_width(win_id) abort
  if !s:switch_win(a:win_id) | return v:null | endif
  return pyxeval('win.width')
endfunction

function! s:funcs.win_get_var(win_id, name) abort
  if !s:switch_win(a:win_id) | return v:null | endif
  return pyxeval('win.vars["'.a:name.'"]')
endfunction

function! s:funcs.win_set_width(win_id, width) abort
  if !s:switch_win(a:win_id) | return v:null | endif
  execute 'pyx win.width='.a:width
  redraw
endfunction

function! s:funcs.win_get_option(win_id, name) abort
  if !s:switch_win(a:win_id) | return v:null | endif
  return pyxeval('win.options["'.a:name.'"]')
endfunction

function! s:funcs.win_set_height(win_id, height) abort
  if !s:switch_win(a:win_id) | return v:null | endif
  execute 'pyx win.height='.a:height
  redraw
endfunction

function! s:funcs.win_set_option(win_id, name, value) abort
  if !s:switch_win(a:win_id) | return v:null | endif
  if type(a:value) == 0
    execute 'pyx win.options["'.a:name.'"] = '.a:value.
  else
    execute 'pyx win.options["'.a:name.'"] = vim.eval("a:value")'
  endif
endfunction

function! s:funcs.win_set_var(win_id, name, value) abort
  if !s:switch_win(a:win_id) | return v:null | endif
  if type(a:value) == 0
    execute 'pyx value = '.a:value
  else
    execute 'pyx value = vim.eval("a:value")'
  endif
  execute 'pyx win.vars["'.a:name.'"] = value'
endfunction

function! s:funcs.win_del_var(win_id, name) abort
  if !s:switch_win(a:win_id) | return v:null | endif
  execute 'pyx win.vars["'.a:name.'"] = None'
endfunction

function! s:funcs.win_is_valid(win_id) abort
  if !s:switch_win(a:win_id) | return v:null | endif
  return pyxeval('win.valid')
endfunction

function! s:funcs.win_get_number(win_id) abort
  if !s:switch_win(a:win_id) | return v:null | endif
  return pyxeval('win.number')
endfunction

function! s:funcs.win_set_cursor(win_id, pos) abort
  if !s:switch_win(a:win_id) | return v:null | endif
  let [lnum, col] = a:pos
  execute 'pyx win.cursor = ('.lnum.','.col.')'
endfunction

function! s:funcs.buf_is_valid(bufnr)
  if !bufexists(a:bufnr) | return 0 | endif
  call s:switch_buf(a:bufnr)
  return pyxeval('buf.valid')
endfunction

function! s:funcs.buf_get_mark(bufnr, name)
  if !bufexists(a:bufnr) | return 0 | endif
  call s:switch_buf(a:bufnr)
  return pyxeval('buf.mark(vim.eval("a:name"))')
endfunction

function! s:funcs.buf_line_count(bufnr) abort
  return s:buf_line_count(a:bufnr)
endfunction

function! s:funcs.buf_attach(...)
  " not supported
  return 0
endfunction

function! s:funcs.buf_detach()
  " not supported
  return 0
endfunction

function! s:funcs.buf_get_lines(bufnr, start, end, strict) abort
  let lines = getbufline(a:bufnr, 1, '$')
  let start = a:start < 0 ? a:start + 1 : a:start
  let end = a:end < 0 ? a:end + 1 : a:end
  if a:strict && end > len(lines)
    throw 'line number out of range: '. end
  endif
  return lines[start : end - 1]
endfunction

function! s:funcs.buf_set_lines(bufnr, start, end, strict, ...) abort
  let replacement = get(a:, 1, [])
  let lineCount = s:buf_line_count(a:bufnr)
  let startLnum = a:start >= 0 ? a:start + 1 : lineCount + a:start + 1
  let end = a:end >= 0 ? a:end : lineCount + a:end + 1
  let delCount = end - (startLnum - 1)
  " replace
  if delCount == len(replacement)
    call setbufline(a:bufnr, startLnum, replacement)
  elseif delCount > 0
    call deletebufline(a:bufnr, startLnum, startLnum + delCount - 1)
    let len = len(replacement)
    if len > 0
      if startLnum == 1
        call setbufline(a:bufnr, 1, replacement[0])
        if len > 1
          call appendbufline(a:bufnr, 1, replacement[1:])
        endif
      else
        call appendbufline(a:bufnr, startLnum - 1, replacement)
      endif
    endif
  elseif len(replacement) > 0
    " add lines
    call appendbufline(a:bufnr, startLnum - 1, replacement)
  endif
  redraw
endfunction

function! s:funcs.buf_set_name(bufnr, name) abort
pyx << EOF
name = vim.eval('a:name')
bufnr = int(vim.eval('a:bufnr'))
for b in vim.buffers:
  if b.number = bufnr:
    b.name = name
    break
EOF
endfunction

function! s:funcs.command(command) abort
  execute a:command
endfunction

function! s:funcs.set_current_dir(dir) abort
  execute 'cd '.a:dir
endfunction

function! s:funcs.set_var(name, value) abort
  execute 'let g:'.a:name.'= a:value'
endfunction

function! s:funcs.del_var(name) abort
  execute 'unlet g:'.a:name
endfunction

function! s:funcs.set_option(name, value) abort
  execute 'let &'.a:name.' = a:value'
endfunction

function! s:funcs.set_current_buf(bufnr) abort
  if !bufexists(a:bufnr) | return | endif
  execute 'buffer '.a:bufnr
endfunction

function! s:funcs.set_current_win(win_id) abort
  let [tabnr, winnr] = win_id2tabwin(a:win_id)
  if tabnr == 0 | return | endif
  execute 'normal! '.tabnr.'gt'
  execute winnr.' wincmd w'
endfunction

function! s:funcs.set_current_tabpage(tabnr) abort
  execute 'normal! '.a:tabnr.'gt'
endfunction

function! s:funcs.tabpage_list_wins(tabnr)
  call s:switch_tab(a:tabnr)
pyx << EOF
res = []
for w in tab.windows:
  winid = int(vim.eval('win_getid(%d,%d)' % (w.number, tab.number)))
  res.append(winid)
EOF
  return pyxeval('res')
endfunction

function! s:funcs.tabpage_get_var(tabnr, name)
  call s:switch_tab(a:tabnr)
  return pyxeval('tab.vars["'.a:name.'"]')
endfunction

function! s:funcs.tabpage_set_var(tabnr, name, value)
  call s:switch_tab(a:tabnr)
  if type(a:value) == 0
    execute 'pyx tab.vars["'.a:name.'"] = '.a:value
  else
    execute 'pyx tab.vars["'.a:name.'"] = vim.eval("a:value")'
  endif
endfunction

function! s:funcs.tabpage_del_var(tabnr, name)
  call s:switch_tab(a:tabnr)
  execute 'pyx tab.vars["'.a:name.'"] = None'
endfunction

function! s:funcs.tabpage_is_valid()
  call s:switch_tab(a:tabnr)
  return pyxeval('tab.valid')
endfunction

"Get the current window in a tabpage
function! s:funcs.tabpage_get_win(tabnr)
  call s:switch_tab(a:tabnr)
  let wnr = pyxeval('tab.window.number')
  return win_getid(wnr, a:tabnr)
endfunction

function! s:funcs.win_get_tabpage(win_id) abort
  if !s:switch_win(a:win_id) | return v:null | endif
  return pyxeval('win.tabpage.number')
endfunction

function! s:funcs.list_wins() abort
pyx << EOF
wins = []
for t in vim.tabpages:
  for w in t.windows:
    winid = int(vim.eval('win_getid(%d,%d)' % (w.number, t.number)))
    wins.append(winid)
EOF
  return pyxeval('wins')
endfunction

function! nvim#api#func_names() abort
pyx << EOF
def find(f, seq):
  for item in seq:
    if f(item):
      return item
  return None
EOF
  return keys(s:funcs)
endfunction

function! nvim#api#call(native, method, ...) abort
  let args = get(a:, 1, [])
  let err = v:null
  let res = v:null
  try
    if a:native
      let res = call(a:method, args)
    else
      let res = call(s:funcs[a:method], args)
    endif
  catch /.*/
    let err = v:exception
  endtry
  return [err, res]
endfunction

let &cpo = s:save_cpo
unlet s:save_cpo
