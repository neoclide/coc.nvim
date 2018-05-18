if exists('did_coc_loaded') || v:version < 700
  finish
endif
let did_coc_loaded = 1

function! s:OnBuffer(type, bufnr, event) abort
  if s:IsInvalid(a:bufnr) | return | endif
  try
    execute 'call CocBuf'.a:type.'('.a:bufnr.',"'.a:event.'")'
  catch /^Vim\%((\a\+)\)\=:E117/
    call s:OnError()
  endtry
endfunction

function! s:OnError() abort
  echohl Error
  echom '[coc.nvim] Vim error, function not found'
  echohl None
  call s:Disable()
endfunction

function! s:IsInvalid(bufnr) abort
  let t = getbufvar(a:bufnr, '&buftype')
  if t ==# 'terminal'
        \|| t ==# 'nofile'
        \|| t ==# 'quickfix'
        \|| t ==# 'help'
    return 1
  endif
  return 0
endfun

function! s:Disable() abort
  augroup coc_nvim
    autocmd!
  augroup end
  echohl MoreMsg
    echon '[coc.nvim] Disabled'
  echohl None
  let g:coc_enabled = 0
endfunction

function! s:ToggleSource(name) abort
  if !s:CheckState() | return | endif
  let state = CocSourceToggle(a:name)
  if !empty(state)
    echohl MoreMsg
    echom '[coc.nvim] Source '.a:name. ' '.state
    echohl None
  endif
endfunction

function! s:RefreshSource(...) abort
  if !s:CheckState() | return | endif
  let name = get(a:, 1, '')
  let succeed = CocSourceRefresh(name)
  if succeed
    echohl MoreMsg
    echom '[coc.nvim] Source '.name. ' refreshed'
    echohl None
  endif
endfunction

function! s:CheckState() abort
  let enabled = get(g:, 'coc_enabled', 0)
  if !enabled
    echohl Error | echon '[coc.nvim] Service disabled' | echohl None
  endif
  return enabled
endfunction

function! s:CocSourceNames(A, L, P) abort
  if !s:CheckState() | return | endif
  let items = CocSourceStat()
  return filter(map(items, 'v:val["name"]'), 'v:val =~ "^'.a:A.'"')
endfunction

function! s:Init(sync)
  let func = a:sync ? 'CocInitSync' : 'CocInitAsync'
  if a:sync
    echohl MoreMsg
    echon '[coc.nvim] Lazyload takes more time for initailize, consider disable lazyload'
    echohl None
  endif
  try
    execute 'call '.func.'()'
  catch /^Vim\%((\a\+)\)\=:E117/
    echohl Error 
    echom '[coc.nvim] Unable to initailize, try :UpdateRemotePlugins and restart'
    echohl None
  endtry
endfunction

function! s:Enable()
  augroup coc_nvim
    autocmd!
    autocmd InsertCharPre *
          \ if !&paste && get(g:,'coc_enabled', 0)
          \|  call CocInsertCharPre(v:char) 
          \|endif
    autocmd CompleteDone *
          \ if get(g:,'coc_enabled', 0)
          \|  call CocCompleteDone(v:completed_item) 
          \|endif
    autocmd TextChangedP *
          \ if get(g:,'coc_enabled', 0)
          \|  call CocTextChangedP() 
          \|endif
    autocmd TextChangedI *
          \ if get(g:,'coc_enabled', 0)
          \|  call CocTextChangedI() 
          \|endif
    autocmd InsertLeave *
          \ if get(g:,'coc_enabled', 0)
          \|  call CocInsertLeave() 
          \|endif
    autocmd BufUnload * call s:OnBuffer('Unload', +expand('<abuf>'), 'BufUnload')
    autocmd BufLeave * call s:OnBuffer('Change', +expand('<abuf>'), 'BufLeave')
    autocmd TextChanged * if !&paste |call s:OnBuffer('Change', +expand('<abuf>'), 'TextChanged') | endif
    autocmd BufRead * call s:OnBuffer('Change', +expand('<abuf>'), 'BufRead')
    autocmd BufWritePost * call s:OnBuffer('Change', +expand('<abuf>'), 'BufWritePost')
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

if has('vim_starting')
  autocmd VimEnter * call s:Init(0)
else
  call s:Init(1)
endif
