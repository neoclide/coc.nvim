
" Get single window by window variable
function! coc#window#find(key, val) abort
  for i in range(1, winnr('$'))
    let res = getwinvar(i, a:key)
    if res == a:val
      return win_getid(i)
    endif
  endfor
  return -1
endfunction

" Make sure window exists
function! coc#window#gotoid(winid) abort
  noa let res = win_gotoid(a:winid)
  if res == 0
    throw 'Invalid window number'
  endif
endfunction

" Avoid autocmd & errors
function! coc#window#close(winid) abort
  if empty(a:winid) || a:winid == -1
    return
  endif
  if exists('*win_execute') || has('nvim')
    call coc#compat#execute(a:winid, 'close!', 'silent!')
  else
    let curr = win_getid()
    if curr == a:winid
      noa silent! close!
    else
      let res = win_gotoid(a:winid)
      if res
        noa silent! close!
        noa call win_gotoid(curr)
      endif
    endif
  endif
endfunction
