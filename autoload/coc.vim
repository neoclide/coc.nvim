let g:coc#_context = {}
let g:coc_user_config = {}
let g:coc_global_extensions = []

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

function! coc#_complete_with(start, items)
  let g:coc#_context = {
        \ 'start': a:start,
        \ 'candidates': a:items,
        \}
  call feedkeys("\<Plug>_", 'i')
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
    return ''
  endif
  let opt = coc#util#get_complete_option()
  call extend(opt, {
        \ 'reload': get(a:, 1, 0),
        \})
  call CocAction('startCompletion', opt)
  return ''
endfunction

" used for statusline
function! coc#status()
  let info = get(b:, 'coc_diagnostic_info', {})
  let msgs = []
  if get(info, 'error', 0)
    call add(msgs, '❌ ' . info['error'])
  endif
  if get(info, 'warning', 0)
    call add(msgs, '⚠️ ' . info['warning'])
  endif
  return join(msgs, ' ') . ' ' . get(g:, 'coc_status', '')
endfunction

function! coc#config(section, value)
  let g:coc_user_config[a:section] = a:value
  call coc#rpc#notify('updateConfig', [a:section, a:value])
endfunction

function! coc#add_extension(...)
  if a:0 == 0 | return | endif
  call extend(g:coc_global_extensions, a:000)
  if get(g:, 'coc_enabled', 0)
    call coc#rpc#notify('addExtensions', [])
  endif
endfunction
