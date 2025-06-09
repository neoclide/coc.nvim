scriptencoding utf-8
let s:is_vim = !has('nvim')
let s:inline_ns = coc#highlight#create_namespace('inlineSuggest')
let s:is_supported = has('patch-9.0.0185') || has('nvim-0.7')
let s:hl_group = 'CocInlineVirtualText'

function! coc#inline#visible() abort
  return coc#vtext#exists(bufnr('%'), s:inline_ns)
endfunction

function! coc#inline#trigger(...) abort
  call coc#inline#clear()
  call CocActionAsync('inlineTrigger', bufnr('%'), get(a:, 1))
  return ''
endfunction

function! coc#inline#cancel() abort
  call coc#inline#clear()
  call CocActionAsync('inlineCancel')
  return ''
endfunction

function! coc#inline#accept(...) abort
  if coc#inline#visible()
    call CocActionAsync('inlineAccept', bufnr('%'), get(a:, 1, 'all'))
  endif
  return ''
endfunction

function! coc#inline#next() abort
  if coc#inline#visible()
    call CocActionAsync('inlineNext', bufnr('%'))
  endif
  return ''
endfunction

function! coc#inline#prev() abort
  if coc#inline#visible()
    call CocActionAsync('inlinePrev', bufnr('%'))
  endif
  return ''
endfunction

function! coc#inline#clear(...) abort
  let bufnr = get(a:, 1, bufnr('%'))
  call coc#compat#call('buf_clear_namespace', [bufnr, s:inline_ns, 0, -1])
endfunction

function! coc#inline#_insert(bufnr, lineidx, col, text) abort
  if !s:is_supported || bufnr('%') != a:bufnr || mode() !~ '^i' || empty(a:text)
    return v:false
  endif
  call coc#inline#clear(a:bufnr)
  call coc#pum#clear_vtext()
  let option = {
      \ 'col': a:col,
      \ 'text_align': 'wrap',
      \ }
  let lines = split(a:text, '\n')
  let blocks = [[lines[0], s:hl_group]]
  if len(lines) > 1
    let option['virt_lines'] = map(lines[1:], {idx, line -> [[line, s:hl_group]]})
  endif
  call coc#vtext#add(a:bufnr, s:inline_ns, a:lineidx, blocks, option)
  return v:true
endfunction
