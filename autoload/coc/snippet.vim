let s:virtualedit = &virtualedit
let s:is_vim = !has('nvim')

" make a range to select mode
function! coc#snippet#range_select(lnum, col, len) abort
  let m = mode()
  let &virtualedit = 'onemore'
  if a:len == 0 && m !=# 'i'
    startinsert
  endif
  if a:len > 0 && m ==# 'i'
    stopinsert
  endif
  call timer_start(10, { -> s:start_select(a:lnum, a:col, a:len)})
endfunction

function! s:start_select(lnum, col, len)
  call cursor(a:lnum, a:col)
  if a:len > 0
    let m = a:len == 1 ? '' : (a:len - 1).'l'
    execute 'normal! v'.m. "\<C-g>"
    let &virtualedit = s:virtualedit
  endif
endfunction

function! coc#snippet#show_choices(lnum, col, len, values) abort
  let m = mode()
  let old = &virtualedit
  let &virtualedit = 'onemore'
  call cursor(a:lnum, a:col + a:len)
  if m !=# 'i' | startinsert | endif
  let g:coc#_context = {
        \ 'start': a:col - 1,
        \ 'candidates': map(a:values, '{"word": v:val}')
        \}
  let &virtualedit = old
  call timer_start(20, { -> coc#_do_complete()})
endfunction

function! coc#snippet#enable()
  let nextkey = get(g:, 'coc_snippet_next', '<C-j>')
  let prevkey = get(g:, 'coc_snippet_prev', '<C-k>')
  execute 'imap <buffer> <nowait> <silent>'.prevkey." <C-o>:call CocActionAsync('snippetPrev')<cr>"
  execute 'smap <buffer> <nowait> <silent>'.prevkey." <Esc>:call CocActionAsync('snippetPrev')<cr>"
  execute 'imap <buffer> <nowait> <silent>'.nextkey." <C-o>:call CocActionAsync('snippetNext')<cr>"
  execute 'smap <buffer> <nowait> <silent>'.nextkey." <Esc>:call CocActionAsync('snippetNext')<cr>"
endfunction

function! coc#snippet#disable()
  let nextkey = get(g:, 'coc_snippet_next', '<C-j>')
  let prevkey = get(g:, 'coc_snippet_prev', '<C-k>')
  silent! execute 'iunmap <buffer> <silent> '.prevkey
  silent! execute 'sunmap <buffer> <silent> '.prevkey
  silent! execute 'iunmap <buffer> <silent> '.nextkey
  silent! execute 'sunmap <buffer> <silent> '.nextkey
endfunction
