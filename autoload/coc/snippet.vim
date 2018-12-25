let s:is_vim = !has('nvim')

" make a range to select mode
function! coc#snippet#range_select(lnum, col, len) abort
  let m = mode()
  if s:is_vim
    if a:len > 0 && m =~# 'i'
      stopinsert
    elseif a:len == 0 && m !~# 'i'
      startinsert
    endif
  else
    if m !~# '^n'
      call feedkeys("\<esc>", 'in')
    endif
  endif
  call timer_start(20, { -> s:start_select(a:lnum, a:col, a:len)})
endfunction

function! s:start_select(lnum, col, len)
  call cursor(a:lnum, a:col)
  let ed = &virtualedit
  if a:len > 0
    let len = &selection ==# 'exclusive' ? a:len + 1: a:len
    let m = len == 1 ? '' : (len - 1).'l'
    execute 'normal! v'.m. "\<C-g>"
  elseif mode() !=# 'i'
    if strlen(getline('.')) + 1 == a:col && ed !=# 'onemore' && ed !=# 'all'
      call feedkeys("a", 'int')
    else
      call feedkeys("i", 'int')
    endif
  endif
  silent doautocmd User CocJumpPlaceholder
endfunction

function! coc#snippet#show_choices(lnum, col, len, values) abort
  let m = mode()
  call cursor(a:lnum, a:col + a:len)
  if m !=# 'i' | startinsert | endif
  call timer_start(20, { -> coc#_do_complete(a:col - 1, a:values)})
endfunction

function! coc#snippet#enable(...)
  let b:coc_snippet_active = 1
  let nextkey = get(g:, 'coc_snippet_next', '<C-j>')
  let prevkey = get(g:, 'coc_snippet_prev', '<C-k>')
  nnoremap <buffer> <esc> :silent call CocAction('snippetCancel')<cr>
  execute 'imap <buffer> <nowait> <silent>'.prevkey." <C-o>:call CocActionAsync('snippetPrev')<cr>"
  execute 'smap <buffer> <nowait> <silent>'.prevkey." <Esc>:call CocActionAsync('snippetPrev')<cr>"
  execute 'imap <buffer> <nowait> <silent>'.nextkey." <C-r>=<SID>SnippetNext(".get(a:, 1, 0).")<cr>"
  execute 'smap <buffer> <nowait> <silent>'.nextkey." <Esc>:call CocActionAsync('snippetNext')<cr>"
endfunction

function! s:SnippetNext(preferComplete)
  if a:preferComplete && pumvisible()
    return "\<c-y>"
  endif
  call CocActionAsync('snippetNext')
  return pumvisible() ? "\<c-y>" : ''
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
