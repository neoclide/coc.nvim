scriptencoding utf-8
let s:ns = coc#highlight#create_namespace('nextEdit')

function! coc#nextedit#available() abort
  return get(b:, 'coc_next_edit_state', 0) != 0
endfunction

function! coc#nextedit#visible() abort
  return get(b:, 'coc_next_edit_state', 0) == 2
endfunction

function! coc#nextedit#trigger(...) abort
  call CocActionAsync('nextEditTrigger', get(a:, 1, {}))
  return ''
endfunction

function! coc#nextedit#accept() abort
  if coc#nextedit#available()
    call CocActionAsync('nextEditAccept')
  endif
  return ''
endfunction

function! coc#nextedit#cancel() abort
  call coc#nextedit#clear()
  call CocActionAsync('nextEditCancel')
  return ''
endfunction

function! coc#nextedit#next() abort
  call CocActionAsync('nextEditNext')
  return ''
endfunction

function! coc#nextedit#prev() abort
  call CocActionAsync('nextEditPrev')
  return ''
endfunction

function! coc#nextedit#clear(...) abort
  let l:bufnr = get(a:, 1, bufnr('%'))
  call coc#compat#call('buf_clear_namespace', [l:bufnr, s:ns, 0, -1])
  call setbufvar(l:bufnr, 'coc_next_edit_state', 0)
endfunction
