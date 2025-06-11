scriptencoding utf-8
let s:is_vim = !has('nvim')
let s:map_next = 1
let s:map_prev = 1

function! coc#snippet#_select_mappings(bufnr)
  if !get(g:, 'coc_selectmode_mapping', 1)
    return
  endif

  redir => mappings
    silent! smap
  redir END

  for map in map(filter(split(mappings, '\n'),
        \ "v:val !~# '^s' && v:val !~# '^\\a*\\s*<\\S\\+>'"),
        \ "matchstr(v:val, '^\\a*\\s*\\zs\\S\\+')")
    silent! execute 'sunmap' map
    call coc#compat#buf_del_keymap(a:bufnr, 's', map)
  endfor

  " same behaviour of ultisnips
  snoremap <silent> <BS> <c-g>c
  snoremap <silent> <DEL> <c-g>c
  snoremap <silent> <c-h> <c-g>c
  snoremap <c-r> <c-g>"_c<c-r>
endfunction

function! coc#snippet#show_choices(lnum, col, position, input) abort
  call coc#snippet#move(a:position)
  call CocActionAsync('startCompletion', {
          \ 'source': '$words',
          \ 'col': a:col
          \ })
  redraw
endfunction

function! coc#snippet#enable(...)
  let bufnr = get(a:, 1, bufnr('%'))
  if getbufvar(bufnr, 'coc_snippet_active', 0) == 1
    return
  endif
  let complete = get(a:, 2, 0)
  call setbufvar(bufnr, 'coc_snippet_active', 1)
  call coc#snippet#_select_mappings(bufnr)
  let nextkey = get(g:, 'coc_snippet_next', '<C-j>')
  let prevkey = get(g:, 'coc_snippet_prev', '<C-k>')
  if maparg(nextkey, 'i') =~# 'snippet'
    let s:map_next = 0
  endif
  if maparg(prevkey, 'i') =~# 'snippet'
    let s:map_prev = 0
  endif
  if !empty(nextkey)
    if s:map_next
      call s:buf_add_keymap(bufnr, 'i', nextkey, "<Cmd>:call coc#snippet#jump(1, ".complete.")<cr>")
    endif
    call s:buf_add_keymap(bufnr, 's', nextkey, "<Cmd>:call coc#snippet#jump(1, ".complete.")<cr>")
  endif
  if !empty(prevkey)
    if s:map_prev
      call s:buf_add_keymap(bufnr, 'i', prevkey, "<Cmd>:call coc#snippet#jump(0, ".complete.")<cr>")
    endif
    call s:buf_add_keymap(bufnr, 's', prevkey, "<Cmd>:call coc#snippet#jump(0, ".complete.")<cr>")
  endif
endfunction

function! coc#snippet#disable(...)
  let bufnr = get(a:, 1, bufnr('%'))
  if getbufvar(bufnr, 'coc_snippet_active', 0) == 0
    return
  endif
  call setbufvar(bufnr, 'coc_snippet_active', 0)
  let nextkey = get(g:, 'coc_snippet_next', '<C-j>')
  let prevkey = get(g:, 'coc_snippet_prev', '<C-k>')
  if s:map_next
    call coc#compat#buf_del_keymap(bufnr, 'i', nextkey)
  endif
  if s:map_prev
    call coc#compat#buf_del_keymap(bufnr, 'i', prevkey)
  endif
  call coc#compat#buf_del_keymap(bufnr, 's', nextkey)
  call coc#compat#buf_del_keymap(bufnr, 's', prevkey)
endfunction

function! coc#snippet#prev() abort
  call coc#rpc#request('snippetPrev', [])
  return ''
endfunction

function! coc#snippet#next() abort
  call coc#rpc#request('snippetNext', [])
  return ''
endfunction

function! coc#snippet#jump(direction, complete) abort
  if a:direction == 1 && a:complete
    if pumvisible()
      let pre = exists('*complete_info') && complete_info()['selected'] == -1 ? "\<C-n>" : ''
      call feedkeys(pre."\<C-y>", 'in')
      return ''
    endif
    if coc#pum#visible()
      " Discard the return value, otherwise weird characters will be inserted
      call coc#pum#close('confirm')
      return ''
    endif
  endif
  call coc#pum#close()
  call coc#rpc#request(a:direction == 1 ? 'snippetNext' : 'snippetPrev', [])
  return ''
endfunction

function! coc#snippet#select(start, end, text) abort
  if coc#pum#visible()
    call coc#pum#close()
  endif
  if mode() ==? 's'
    call feedkeys("\<Esc>", 'in')
  endif
  if &selection ==# 'exclusive'
    let cursor = coc#snippet#to_cursor(a:start)
    call cursor([cursor[0], cursor[1]])
    let cmd = ''
    let cmd .= mode()[0] ==# 'i' ? "\<Esc>".(col('.') == 1 ? '' : 'l') : ''
    let cmd .= printf('v%s', strchars(a:text) . 'l')
    let cmd .= "\<C-g>"
  else
    let cursor = coc#snippet#to_cursor(a:end)
    call cursor([cursor[0], cursor[1] - 1])
    let len = strchars(a:text) - 1
    let cmd = ''
    let cmd .= mode()[0] ==# 'i' ? "\<Esc>".(col('.') == 1 ? '' : 'l') : ''
    let cmd .= printf('v%s', len > 0 ? len . 'h' : '')
    let cmd .= "o\<C-g>"
  endif
  if s:is_vim
    " Can't use 't' since the code of <esc> can be changed.
    call feedkeys(cmd, 'n')
  else
    call feedkeys(cmd, 'nt')
  endif
endfunction

function! coc#snippet#move(position) abort
  let m = mode()
  if m ==? 's'
    call feedkeys("\<Esc>", 'in')
  endif
  let pos = coc#snippet#to_cursor(a:position)
  call cursor(pos)
  if pos[1] > strlen(getline(pos[0]))
    startinsert!
  else
    startinsert
  endif
endfunction

function! coc#snippet#to_cursor(position) abort
  let line = getline(a:position.line + 1)
  if line is v:null
    return [a:position.line + 1, a:position.character + 1]
  endif
  return [a:position.line + 1, coc#string#byte_index(line, a:position.character) + 1]
endfunction

function! s:buf_add_keymap(bufnr, mode, lhs, rhs) abort
  let opts = {'nowait': v:true, 'silent': v:true}
  call coc#compat#buf_add_keymap(a:bufnr, a:mode, a:lhs, a:rhs, opts)
endfunction
