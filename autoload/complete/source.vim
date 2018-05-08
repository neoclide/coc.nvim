
function! complete#source#config(name, config) abort
  let chan_id = get(g:, 'complete_node_channel_id', 0)
  if !chan_id
    echohl Error
    echon '[complete.nvim] Service unavailable, config code may not called in autocmd group'
    echohl None
    return 
  endif
  call CompleteSourceConfig(a:name, a:config)
endfunction

function! complete#source#refresh(name, config) abort
  let chan_id = get(g:, 'complete_node_channel_id', 0)
  if !chan_id
    echohl Error
    echon '[complete.nvim] Service unavailable'
    echohl None
    return 
  endif
endfunction

