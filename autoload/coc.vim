let g:coc#_context = {}

function! coc#refresh() abort
    return pumvisible() ? "\<c-e>\<c-r>=coc#start(1)\<CR>" : "\<c-r>=coc#start()\<CR>"
endfunction

function! coc#complete_custom() abort
    return pumvisible() ? "\<c-e>\<c-r>=coc#start(1, 1)\<CR>" : "\<c-r>=coc#start(0, 1)\<CR>"
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

function! coc#_select() abort
  if !pumvisible() | return | endif
  call feedkeys("\<C-y>", 'in')
endfunction

function! coc#start(...)
  if !get(g:, 'coc_enabled', 0) 
    call coc#util#on_error('Service not running!')
    return ''
  endif
  let opt = coc#util#get_complete_option({
        \ 'reload': get(a:, 1, 0),
        \ 'custom': get(a:, 2, 0),
        \})
  call CocAction('startCompletion', opt)
  return ''
endfunction

" used for statusline
function! coc#status()
  let info = get(b:, 'coc_diagnostic_info', {})
  if empty(info) | return '' | endif
  let msgs = []
  if get(info, 'error', 0)
    call add(msgs, '❌ ' . info['error'])
  endif
  if get(info, 'warning', 0)
    call add(msgs, '⚠️ ' . info['warning'])
  endif
  return join(msgs, ' ')
endfunction
