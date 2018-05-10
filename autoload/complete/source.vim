function! complete#source#config(name, config) abort
  if !s:CheckState() | return | endif
  call CompleteSourceConfig(a:name, a:config)
endfunction

function! s:CheckState()
  let enabled = get(g:, 'complete_enabled', 0)
  if !enabled
    echohl Error
    echon '[complete.nvim] Service unavailable'
    echohl None
  endif
  return enabled
endfunction
