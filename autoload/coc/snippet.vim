let s:is_vim = !has('nvim')

function! coc#snippet#_select_mappings()
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
    silent! execute 'sunmap <buffer>' map
  endfor

  " same behaviour of ultisnips
  snoremap <silent> <BS> <c-g>c
  snoremap <silent> <DEL> <c-g>c
  snoremap <silent> <c-h> <c-g>c
  snoremap <c-r> <c-g>"_c<c-r>
endfunction

function! coc#snippet#range_select(lnum, col, len)
  call cursor(a:lnum, a:col)
  if a:len > 0
    let len = &selection ==# 'exclusive' ? a:len + 1: a:len
    let m = len == 1 ? '' : (len - 1).'l'
    execute 'normal! v'.m. "\<C-g>"
  endif
  redraw
  silent doautocmd User CocJumpPlaceholder
endfunction

function! coc#snippet#show_choices(lnum, col, len, values) abort
  let m = mode()
  call cursor(a:lnum, a:col + a:len)
  if m !=# 'i' | startinsert | endif
  call timer_start(20, { -> coc#_do_complete(a:col - 1, a:values)})
  redraw
endfunction

function! coc#snippet#_expr(action)
  if get(g:, 'coc_prefer_complete', 0)
    return pumvisible() ? "\<c-y>" : "\<c-r>=coc#rpc#request('".a:action."', [])\<CR>"
  endif
  return pumvisible() ? "\<c-y>\<c-r>=coc#rpc#request('".a:action."', [])\<CR>" : "\<c-r>=coc#rpc#request('".a:action."', [])\<CR>"
endfunction

function! coc#snippet#enable()
  let b:coc_snippet_active = 1
  call coc#snippet#_select_mappings()
  let nextkey = get(g:, 'coc_snippet_next', '<C-j>')
  let prevkey = get(g:, 'coc_snippet_prev', '<C-k>')
  nnoremap <buffer> <silent> <esc> :call coc#rpc#request('snippetCancel', [])<cr>
  execute 'imap <buffer> <nowait><expr> <silent>'.prevkey." coc#snippet#_expr('snippetPrev')"
  execute 'smap <buffer> <nowait> <silent>'.prevkey." <Esc>:call coc#rpc#request('snippetPrev', [])<cr>"
  execute 'imap <buffer> <nowait><expr> <silent>'.nextkey." coc#snippet#_expr('snippetNext')"
  execute 'smap <buffer> <nowait> <silent>'.nextkey." <Esc>:call coc#rpc#request('snippetNext', [])<cr>"
endfunction

function! coc#snippet#disable()
  if get(b:, 'coc_snippet_active', 0) == 0
    return
  endif
  let b:coc_snippet_active = 0
  let nextkey = get(g:, 'coc_snippet_next', '<C-j>')
  let prevkey = get(g:, 'coc_snippet_prev', '<C-k>')
  silent! nunmap <buffer> <esc>
  silent! execute 'iunmap <buffer> <silent> '.prevkey
  silent! execute 'sunmap <buffer> <silent> '.prevkey
  silent! execute 'iunmap <buffer> <silent> '.nextkey
  silent! execute 'sunmap <buffer> <silent> '.nextkey
endfunction
