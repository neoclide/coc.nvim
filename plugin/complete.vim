if exists('did_complete_loaded') || v:version < 700
  finish
endif
let did_complete_loaded = 1

let g:complete_auto_popup = get(g:, 'complete_auto_popup', 0)
let g:complete_lcn_file_types = get(g:, 'complete_lcn_file_types', [])

function! s:OnBufferRead(bufnr)
  if !!search('\%u0000', 'wn') | return 1 | endif
  if s:IsInvalid(a:bufnr) | return | endif
  if exists('*CompleteBufRead')
    call CompleteBufRead(a:bufnr)
  endif
endfunction

function! s:OnBufferChange(bufnr)
  if s:IsInvalid(a:bufnr) | return | endif
  if &paste != 0 | return | endif
  if exists('*CompleteBufChange')
    call CompleteBufChange(a:bufnr)
  endif
endfunction

function! s:OnBufferUnload(bufnr)
  if exists('*CompleteBufUnload')
    call CompleteBufUnload(a:bufnr)
  endif
endfunction

function! s:IsInvalid(bufnr)
  let t = getbufvar(a:bufnr, '&buftype')
  if t == 'terminal' || t == 'nofile' || t == 'quickfix'
    return 1
  endif
  return !buflisted(a:bufnr)
endfun

augroup complete_nvim
  autocmd!
  autocmd TextChanged,TextChangedI * call s:OnBufferChange(+expand('<abuf>'))
  autocmd BufRead,BufNewFile * call s:OnBufferRead(+expand('<abuf>'))
  autocmd BufUnload * call s:OnBufferUnload(+expand('<abuf>'))
augroup end

inoremap <silent> <expr> <Plug>(complete_start) complete#start()
inoremap <silent> <Plug>_ <C-r>=complete#_complete()<CR>
