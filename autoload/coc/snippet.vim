
" make a range to select mode
function! coc#snippet#range_select(lnum, col, len)
  let m = mode()
  call cursor(a:lnum, a:col)
  if a:len == 0
    if m !=# 'i' | startinsert | endif
  else
    let move = a:len == 1 ? '' : a:len - 1 . 'l'
    if m ==# 'i'
      stopinsert
      execute 'normal! l'
    endif
    call timer_start(20, { -> execute('normal! v'.move."\<C-g>")})
  endif
endfunction

function! coc#snippet#enable()
  let nextkey = get(g:, 'coc_snippet_next', '<C-j>')
  let prevkey = get(g:, 'coc_snippet_previous', '<C-k>')
  execute 'nmap <buffer> <esc> '.":call CocAction('snippetCancel')<cr>"
  execute 'imap <buffer> <silent>'.prevkey." <Cmd>:call CocAction('snippetPrev')<cr>"
  execute 'smap <buffer> <silent>'.prevkey." <Esc>:call CocAction('snippetPrev')<cr>"
  execute 'imap <buffer> <silent>'.nextkey." <Cmd>:call CocAction('snippetNext')<cr>"
  execute 'smap <buffer> <silent>'.nextkey." <Esc>:call CocAction('snippetNext')<cr>"
endfunction

function! coc#snippet#disable()
  let nextkey = get(g:, 'coc_snippet_next', '<C-j>')
  let prevkey = get(g:, 'coc_snippet_previous', '<C-k>')
  silent execute 'nunmap <buffer> <esc>'
  silent execute 'iunmap <buffer> <silent> '.prevkey
  silent execute 'sunmap <buffer> <silent> '.prevkey
  silent execute 'iunmap <buffer> <silent> '.nextkey
  silent execute 'sunmap <buffer> <silent> '.nextkey
endfunction
