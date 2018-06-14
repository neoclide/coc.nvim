let g:coc#_context = {}

function! coc#refresh() abort
    return pumvisible() ? "\<c-e>\<c-r>=coc#start(1)\<CR>" : "\<c-r>=coc#start()\<CR>"
endfunction

function! coc#_set_context(start, items)
  let g:coc#_context = {
        \ 'start': a:start,
        \ 'candidates': a:items,
        \}
endfunction

function! coc#_complete() abort
  let items = get(g:coc#_context, 'candidates', [])
  if empty(items) | return '' | endif
  call complete(
        \ g:coc#_context.start + 1,
        \ items)
  return ''
endfunction

function! coc#_do_complete() abort
  call feedkeys("\<Plug>_", 'i')
endfunction

function! coc#_hide() abort
  if !pumvisible() | return | endif
  call feedkeys("\<C-e>", 'in')
endfunction

function! coc#_confirm() abort
  if !pumvisible() | return | endif
  call feedkeys("\<C-y>", 'in')
endfunction

function! coc#start(...)
  if !get(g:, 'coc_enabled', 0) 
    call coc#util#on_error('Service not running!')
    return ''
  endif
  let opt = coc#util#get_complete_option({
        \ 'reload': get(a:, 1, 0)
        \})
  call CocStart(opt)
  return ''
endfunction
