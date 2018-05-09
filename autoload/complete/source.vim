
function! s:checkService() abort
  let chan_id = get(g:, 'complete_node_channel_id', 0)
  if !chan_id
    echohl Error
    echon '[complete.nvim] Service unavailable'
    echohl None
    return 0
  endif
  return 1
endfunction

function! complete#source#config(name, config) abort
  if !s:checkService() | return | endif
  call CompleteSourceConfig(a:name, a:config)
endfunction

function! complete#source#refresh(...) abort
  if !s:checkService() | return | endif
  let name = get(a:, 1, '')
  call CompleteSourceRefresh(name)
  echohl MoreMsg
  echom '[complete.nvim] Source '.name. ' refreshed'
  echohl None
endfunction

function! complete#source#toggle(name) abort
  if !s:checkService() | return | endif
  let state = CompleteSourceToggle(a:name)
  echohl MoreMsg
  echom '[complete.nvim] Source '.a:name. ' '.state
  echohl None
endfunction
