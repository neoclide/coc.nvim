if exists('did_complete_loaded') || v:version < 700
  finish
endif
let did_complete_loaded = 1

function! s:OnBufferChange(bufnr)
  if s:IsInvalid(a:bufnr) | return | endif
  if &paste != 0 | return | endif
  call CompleteBufChange(a:bufnr)
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

function! s:OnTextChangedI()
  call complete#start(1)
endfunction

function! s:InitAutocmds()
  augroup complete_nvim
    autocmd!
    autocmd TextChangedI * call complete#start(1)
    autocmd BufUnload * call CompleteBufUnload(+expand('<abuf>'))
    autocmd TextChanged,BufLeave * call s:OnBufferChange(+expand('<abuf>'))
    autocmd BufRead,BufWritePost * call s:OnBufferChange(+expand('<abuf>'))
  augroup end

  inoremap <silent> <expr> <Plug>(complete_start) complete#start()
  inoremap <silent> <Plug>_ <C-r>=complete#_complete()<CR>
endfunction

augroup complete_init
  autocmd!
  autocmd user CompleteNvimInit call s:InitAutocmds()
augroup end
