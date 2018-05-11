if exists('did_complete_loaded') || v:version < 700
  finish
endif
let did_complete_loaded = 1

function! s:OnBuffer(event, bufnr)
  if s:IsInvalid(a:bufnr) | return | endif
  try
    execute 'call CompleteBuf'.a:event.'('.a:bufnr.')'
  catch /.*/
    call s:OnError()
    call s:Disable()
  endtry
endfunction

function! s:OnError()
  echohl Error
  echon '[complete.nvim] Vim error: ' .v:errmsg
  echon '[complete.nvim] Plugin disabled'
  echohl None
endfunction

function! s:IsInvalid(bufnr)
  let t = getbufvar(a:bufnr, '&buftype')
  if t ==# 'terminal'
        \|| t ==# 'nofile'
        \|| t ==# 'quickfix'
        \|| t ==# 'help'
    return 1
  endif
  return 0
endfun

function! s:Disable()
  augroup complete_nvim
    autocmd!
  augroup end
  echohl MoreMsg
    echon 'complete.nvim disabled'
  echohl None
  let g:complete_enabled = 0
endfunction

function! s:ToggleSource(name)
  if !s:CheckState() | return | endif
  let state = CompleteSourceToggle(a:name)
  if !empty(state)
    echohl MoreMsg
    echom '[complete.nvim] Source '.a:name. ' '.state
    echohl None
  endif
endfunction

function! s:RefreshSource(...)
  if !s:CheckState() | return | endif
  let name = get(a:, 1, '')
  let succeed = CompleteSourceRefresh(name)
  if succeed
    echohl MoreMsg
    echom '[complete.nvim] Source '.name. ' refreshed'
    echohl None
  endif
endfunction

function! s:CheckState()
  let enabled = get(g:, 'complete_enabled', 0)
  if !enabled
    echohl Error | echon '[complete.nvim] Service unavailable' | echohl None
  endif
  return enabled
endfunction

function! s:CompleteSourceNames(A, L, P)
  if !s:CheckState() | return | endif
  let items = CompleteSourceStat()
  return filter(map(items, 'v:val["name"]'), 'v:val =~ "^'.a:A.'"')
endfunction

function! s:Enable()
  augroup complete_nvim
    autocmd!
    autocmd BufUnload * call s:OnBuffer('Unload', +expand('<abuf>'))
    autocmd TextChanged,BufLeave * call s:OnBuffer('Change', +expand('<abuf>'))
    autocmd BufRead,BufWritePost * call s:OnBuffer('Change', +expand('<abuf>'))
  augroup end
  exec "highlight default CompleteChars guifg=white guibg=magenta ctermfg=white ctermbg=".(&t_Co < 256 ? "magenta" : "201")
  let g:complete_enabled = 1
endfunction

augroup complete_init
  autocmd!
  autocmd user CompleteNvimInit call s:Enable()
augroup end

inoremap <silent> <expr> <Plug>(complete_start) complete#start()
inoremap <silent> <Plug>_ <C-r>=complete#_complete()<CR>
command! -nargs=0 CompleteDisable :call s:Disable()
command! -nargs=0 CompleteEnable :call s:Enable()
command! -nargs=1 -complete=customlist,s:CompleteSourceNames CompleteToggle :call s:ToggleSource(<f-args>)
command! -nargs=? -complete=customlist,s:CompleteSourceNames CompleteRefresh :call s:RefreshSource(<f-args>)
