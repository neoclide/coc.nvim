scriptencoding utf-8
let s:is_vim = !has('nvim')

" first window id for bufnr
" builtin bufwinid returns window of current tab only
function! coc#compat#buf_win_id(bufnr) abort
  let info = filter(getwininfo(), 'v:val["bufnr"] =='.a:bufnr)
  if empty(info)
    return -1
  endif
  return info[0]['winid']
endfunction

function! coc#compat#buf_set_lines(bufnr, start, end, replacement) abort
  if !bufloaded(a:bufnr)
    return
  endif
  call coc#compat#call('buf_set_lines', [a:bufnr, a:start, a:end, 0, a:replacement])
endfunction

function! coc#compat#buf_line_count(bufnr) abort
  if !bufloaded(a:bufnr)
    return 0
  endif
  return coc#compat#call('buf_line_count', [a:bufnr])
endfunction

function! coc#compat#prepend_lines(bufnr, replacement) abort
  if bufloaded(a:bufnr)
    call appendbufline(a:bufnr, 0, a:replacement)
  endif
endfunction

function! coc#compat#win_is_valid(winid) abort
  return coc#compat#call('win_is_valid', [a:winid])
endfunction

function! coc#compat#clear_matches(winid) abort
  silent! call clearmatches(a:winid)
endfunction

function! coc#compat#matchaddpos(group, pos, priority, winid) abort
  let curr = win_getid()
  if curr == a:winid
    call matchaddpos(a:group, a:pos, a:priority, -1)
  else
    call matchaddpos(a:group, a:pos, a:priority, -1, {'window': a:winid})
  endif
endfunction

" hlGroup, pos, priority
function! coc#compat#matchaddgroups(winid, groups) abort
  for group in a:groups
    call matchaddpos(group['hlGroup'], [group['pos']], group['priority'], -1, {'window': a:winid})
  endfor
endfunction

" Delete var, not throw version.
function! coc#compat#del_var(name) abort
  if s:is_vim
    execute 'unlet! '.a:name
  else
    silent! call nvim_del_var(a:name)
  endif
endfunction

" Not throw version
function! coc#compat#buf_del_var(bufnr, name) abort
  if !bufloaded(a:bufnr)
    return
  endif
  try
    call coc#compat#call('buf_del_var', [a:bufnr, a:name])
  catch /not\ found/
    " ignore
  endtry
endfunction

" remove keymap for bufnr, not throw error
function! coc#compat#buf_del_keymap(bufnr, mode, lhs) abort
  if !bufloaded(a:bufnr)
    return
  endif
  try
    call coc#compat#call('buf_del_keymap', [a:bufnr, a:mode, a:lhs])
  catch /^Vim\%((\a\+)\)\=:E31/
    " ignore keymap doesn't exist
  endtry
endfunction

function! coc#compat#buf_add_keymap(bufnr, mode, lhs, rhs, opts) abort
  if !bufloaded(a:bufnr)
    return
  endif
  call coc#compat#call('buf_set_keymap', [a:bufnr, a:mode, a:lhs, a:rhs, a:opts])
endfunction

function! coc#compat#tabnr_id(tabnr) abort
  if s:is_vim
    return coc#api#TabNrId(a:tabnr)
  endif
  return nvim_list_tabpages()[a:tabnr - 1]
endfunction

" call api function on vim or neovim
function! coc#compat#call(fname, args) abort
  if s:is_vim
    return call('coc#api#' . toupper(a:fname[0]) . a:fname[1:], a:args)
  endif
  return call('nvim_' . a:fname, a:args)
endfunction

function! coc#compat#trim(str)
  return trim(a:str)
endfunction

" execute command or list of commands in window
function! coc#compat#win_execute(winid, command, ...) abort
  if a:winid < 0
    return
  endif
  let winid = a:winid == 0 ? win_getid() : a:winid
  keepalt call win_execute(winid, a:command, get(a:, 1, ''))
endfunction
" vim: set sw=2 ts=2 sts=2 et tw=78 foldlevel=0:
