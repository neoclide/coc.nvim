if exists('did_coc_loaded') || v:version < 700
  finish
endif
let did_coc_loaded = 1

function! s:OnBuffer(event, bufnr)
  if s:IsInvalid(a:bufnr) | return | endif
  try
    execute 'call CocBuf'.a:event.'('.a:bufnr.')'
  catch /.*/
    call s:OnError()
    call s:Disable()
  endtry
endfunction

function! s:OnError()
  echohl Error
  echon '[coc.nvim] Vim error: ' .v:errmsg
  echon '[coc.nvim] Plugin disabled'
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
  augroup coc_nvim
    autocmd!
  augroup end
  echohl MoreMsg
    echon '[coc.nvim] Disabled'
  echohl None
  let g:coc_enabled = 0
endfunction

function! s:ToggleSource(name)
  if !s:CheckState() | return | endif
  let state = CocSourceToggle(a:name)
  if !empty(state)
    echohl MoreMsg
    echom '[coc.nvim] Source '.a:name. ' '.state
    echohl None
  endif
endfunction

function! s:RefreshSource(...)
  if !s:CheckState() | return | endif
  let name = get(a:, 1, '')
  let succeed = CocSourceRefresh(name)
  if succeed
    echohl MoreMsg
    echom '[coc.nvim] Source '.name. ' refreshed'
    echohl None
  endif
endfunction

function! s:CheckState()
  let enabled = get(g:, 'coc_enabled', 0)
  if !enabled
    echohl Error | echon '[coc.nvim] Service disabled' | echohl None
  endif
  return enabled
endfunction

function! s:CocSourceNames(A, L, P)
  if !s:CheckState() | return | endif
  let items = CocSourceStat()
  return filter(map(items, 'v:val["name"]'), 'v:val =~ "^'.a:A.'"')
endfunction

function! s:Enable()
  augroup coc_nvim
    autocmd!
    autocmd BufUnload * call s:OnBuffer('Unload', +expand('<abuf>'))
    autocmd TextChanged,BufLeave * call s:OnBuffer('Change', +expand('<abuf>'))
    autocmd BufRead,BufWritePost * call s:OnBuffer('Change', +expand('<abuf>'))
  augroup end

  command! -nargs=1 -complete=customlist,s:CocSourceNames CocToggle :call s:ToggleSource(<f-args>)
  command! -nargs=? -complete=customlist,s:CocSourceNames CocRefresh :call s:RefreshSource(<f-args>)
  command! -nargs=0 CocDisable :call s:Disable()
  command! -nargs=0 CocEnable :call s:Enable()

  let guifg = get(g:, 'coc_chars_guifg', 'white')
  let guibg = get(g:, 'coc_chars_guibg', 'magenta')
  exec "highlight default CocChars guifg=".guifg." guibg=".guibg." ctermfg=white ctermbg=".(&t_Co < 256 ? "magenta" : "201")
  let g:coc_enabled = 1
endfunction

augroup coc_init
  autocmd!
  autocmd user CocNvimInit call s:Enable()
augroup end

inoremap <silent> <expr> <Plug>(coc_start) coc#start()
inoremap <silent> <Plug>_ <C-r>=coc#_complete()<CR>
