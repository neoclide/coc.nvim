scriptencoding utf-8
let s:is_vim = !has('nvim')
let n10 = has('nvim-0.10')
let s:inline_ns = coc#highlight#create_namespace('inlineSuggest')

function! coc#inline#visible() abort
  return coc#vtext#exists(bufnr('%'), s:inline_ns)
endfunction

function! coc#inline#trigger(...) abort
  call coc#pum#close()
  call CocActionAsync('inlineTrigger', [bufnr('%'), get(a:, 1)])
  return ''
endfunction

function! coc#inline#cancel() abort
  call coc#inline#clear()
  call CocAction('inlineCancel', [])
  return ''
endfunction

function! coc#inline#accept() abort
  if coc#inline#visible()
    call coc#inline#clear()
    call CocAction('inlineAccept', [bufnr('%')])
  endif
  return ''
endfunction

function! coc#inline#next() abort
  call CocAction('inlineNext', [bufnr('%')])
  return ''
endfunction

function! coc#inline#prev() abort
  call CocAction('inlinePrev', [bufnr('%')])
  return ''
endfunction

function! coc#inline#clear() abort
  call coc#compat#call('buf_clear_namespace', [bufnr('%'), s:inline_ns, 0, -1])
endfunction
