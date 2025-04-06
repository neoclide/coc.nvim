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
  if s:is_vim
    call coc#api#exec('buf_set_lines', [a:bufnr, a:start, a:end, 0, a:replacement])
  else
    call nvim_buf_set_lines(a:bufnr, a:start, a:end, 0, a:replacement)
  endif
endfunction

function! coc#compat#buf_line_count(bufnr) abort
  if !bufloaded(a:bufnr)
    return 0
  endif
  if exists('*nvim_buf_line_count')
    return nvim_buf_line_count(a:bufnr)
  endif
  let info = getbufinfo(a:bufnr)
  return empty(info) ? 0 : info[0]['linecount']
endfunction

function! coc#compat#prepend_lines(bufnr, replacement) abort
  if bufloaded(a:bufnr)
    call appendbufline(a:bufnr, 0, a:replacement)
  endif
endfunction

function! coc#compat#win_is_valid(winid) abort
  if exists('*nvim_win_is_valid')
    return nvim_win_is_valid(a:winid)
  endif
  return !empty(getwininfo(a:winid))
endfunction

function! coc#compat#clear_matches(winid) abort
  if !coc#compat#win_is_valid(a:winid)
    return
  endif
  call clearmatches(a:winid)
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
  if exists('*nvim_buf_del_var')
    silent! call nvim_buf_del_var(a:bufnr, a:name)
  else
    let bufvars = getbufvar(a:bufnr, '')
    if has_key(bufvars, a:name)
      call remove(bufvars, a:name)
    endif
  endif
endfunction

" remove keymap for bufnr, not throw error
function! coc#compat#buf_del_keymap(bufnr, mode, lhs) abort
  if !bufloaded(a:bufnr)
    return
  endif
  if s:is_vim
    try
      call coc#api#exec('buf_del_keymap', [a:bufnr, a:mode, a:lhs])
    catch /E31/
      " ignore keymap doesn't exist
    endtry
  else
    try
      call nvim_buf_del_keymap(a:bufnr, a:mode, a:lhs)
    catch /^Vim\%((\a\+)\)\=:E5555/
      " ignore keymap doesn't exist
    endtry
  endif
endfunction

function! coc#compat#buf_add_keymap(bufnr, mode, lhs, rhs, opts) abort
  if !bufloaded(a:bufnr)
    return
  endif
  if s:is_vim
    call coc#api#exec('buf_set_keymap', [a:bufnr, a:mode, a:lhs, a:rhs, a:opts])
  else
    call nvim_buf_set_keymap(a:bufnr, a:mode, a:lhs, a:rhs, a:opts)
  endif
endfunction

" execute command or list of commands in window
function! coc#compat#execute(winid, command, ...) abort
  if a:winid < 0
    return
  endif
  if type(a:command) == v:t_string
    keepalt call win_execute(a:winid, a:command, get(a:, 1, ''))
  elseif type(a:command) == v:t_list
    keepalt call win_execute(a:winid, join(a:command, "\n"), get(a:, 1, ''))
  endif
endfunc

function! coc#compat#trim(str)
  return trim(a:str)
endfunction
