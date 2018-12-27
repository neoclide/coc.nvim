let s:is_vim = !has('nvim')

function! coc#snippet#range_select(lnum, col, len)
  call cursor(a:lnum, a:col)
  if a:len > 0
    let len = &selection ==# 'exclusive' ? a:len + 1: a:len
    let m = len == 1 ? '' : (len - 1).'l'
    execute 'normal! v'.m. "\<C-g>"
  endif
  silent doautocmd User CocJumpPlaceholder
endfunction

function! coc#snippet#show_choices(lnum, col, len, values) abort
  let m = mode()
  call cursor(a:lnum, a:col + a:len)
  if m !=# 'i' | startinsert | endif
  call timer_start(20, { -> coc#_do_complete(a:col - 1, a:values)})
endfunction

function! coc#snippet#enable()
  let b:coc_snippet_active = 1
  let nextkey = get(g:, 'coc_snippet_next', '<C-j>')
  let prevkey = get(g:, 'coc_snippet_prev', '<C-k>')
  nnoremap <buffer> <esc> :silent call CocActionAsync('snippetCancel')<cr>
  let method = s:is_vim ? 'CocAction' : 'CocActionAsync'
  execute 'imap <buffer> <nowait> <silent>'.prevkey." <C-o>:call ".method."('snippetPrev')<cr>"
  execute 'smap <buffer> <nowait> <silent>'.prevkey." <Esc>:call ".method."('snippetPrev')<cr>"
  execute 'imap <buffer> <nowait> <silent>'.nextkey." <C-o>:call ".method."('snippetNext')<cr>"
  execute 'smap <buffer> <nowait> <silent>'.nextkey." <Esc>:call ".method."('snippetNext')<cr>"
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
