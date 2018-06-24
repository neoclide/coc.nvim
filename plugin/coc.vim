if !has('nvim') || exists('did_coc_loaded') || v:version < 700
  finish
endif
let did_coc_loaded = 1

function! s:Autocmd(...)
  " care about normal buffer only
  if !empty(&buftype) | return | endif
  if !get(g:, 'coc_enabled', 0) | return | endif
  try
    call call('CocAutocmd', a:000)
  catch /^Vim\%((\a\+)\)\=:E117/
    call s:OnFuncUndefined()
  endtry
endfunction

function! s:OnFuncUndefined() abort
  call s:Disable()
  call coc#util#on_error('Disabled, try :UpdateRemotePlugins and restart!')
endfunction

function! s:Disable() abort
  if get(g:, 'coc_enabled', 0) == 0
    return
  endif
  augroup coc_nvim
    autocmd!
  augroup end
  echohl MoreMsg
    echom '[coc.nvim] Disabled'
  echohl None
  let g:coc_enabled = 0
endfunction

function! s:RefreshSource(...) abort
  if !s:CheckState() | return | endif
  let name = get(a:, 1, '')
  call CocAction('refreshSource', name)
  echohl MoreMsg
  echom '[coc.nvim] Source '.name. ' refreshed'
  echohl None
endfunction

function! s:CheckState() abort
  let enabled = get(g:, 'coc_enabled', 0)
  if !enabled
    call coc#util#on_error('Service disabled')
  endif
  return enabled
endfunction

function! s:CocSourceNames(A, L, P) abort
  if !s:CheckState() | return | endif
  let items = CocAction('sourceStat')
  return filter(map(items, 'v:val["name"]'), 'v:val =~ "^'.a:A.'"')
endfunction

function! s:Init(sync)
  let func = a:sync ? 'CocInitSync' : 'CocInitAsync'
  if a:sync
    echohl MoreMsg
    echom '[coc.nvim] Lazyload takes more time for initailize, consider disable lazyload'
    echohl None
  endif
  try
    execute 'call '.func.'()'
  catch /^Vim\%((\a\+)\)\=:E117/
    call coc#util#on_error('Initailize failed, try :UpdateRemotePlugins and restart')
  endtry
endfunction

function! s:Enable()
  if get(g:, 'coc_enabled', 0) == 1
    return
  endif

  highlight default CocErrorSign   guifg=#ff0000
  highlight default CocWarningSign guifg=#ff922b
  highlight default CocInfoSign    guifg=#fab005
  highlight default CocHintSign    guifg=#15aabf
  highlight default CocUnderline   term=underline gui=underline

  augroup coc_nvim
    autocmd!
    autocmd FileType            * call s:Autocmd('FileType', expand('<amatch>'))
    autocmd InsertCharPre       * call s:Autocmd('InsertCharPre', v:char)
    autocmd CompleteDone        * call s:Autocmd('CompleteDone', v:completed_item)
    autocmd TextChangedP        * call s:Autocmd('TextChangedP')
    autocmd TextChangedI        * call s:Autocmd('TextChangedI')
    autocmd InsertLeave         * call s:Autocmd('InsertLeave')
    autocmd InsertEnter         * call s:Autocmd('InsertEnter')
    autocmd BufLeave            * call s:Autocmd('BufLeave', +expand('<abuf>'))
    autocmd BufEnter            * call s:Autocmd('BufEnter', +expand('<abuf>'))
    autocmd BufUnload           * call s:Autocmd('BufUnload', +expand('<abuf>'))
    autocmd TextChanged         * call s:Autocmd('TextChanged', +expand('<abuf>'))
    autocmd BufNewFile,BufRead, * call s:Autocmd('BufCreate', +expand('<abuf>'))
    autocmd BufWritePre         * call s:Autocmd('BufWritePre', +expand('<abuf>'))
    autocmd BufWritePost        * call s:Autocmd('BufWritePost', +expand('<abuf>'))
    autocmd CursorMoved         * call s:Autocmd('CursorMoved')
    autocmd CursorMovedI        * call s:Autocmd('CursorMovedI')
  augroup end

  " same behaviour of ultisnips
  if get(g:, 'coc_selectmode_mapping', 1)
    snoremap <silent> <BS> <c-g>c
    snoremap <silent> <DEL> <c-g>c
    snoremap <silent> <c-h> <c-g>c
    snoremap <c-r> <c-g>"_c<c-r>
  endif

  command! -nargs=? -complete=customlist,s:CocSourceNames CocRefresh :call s:RefreshSource(<f-args>)
  command! -nargs=0 CocDisable :call s:Disable()
  command! -nargs=0 CocEnable :call s:Enable()
  let g:coc_enabled = 1
endfunction

augroup coc_init
  autocmd!
  autocmd user CocNvimInit call s:Enable()
augroup end

nnoremap <silent> <Plug>(coc-diagnostic-next) :call CocAction('diagnosticNext')<CR>
nnoremap <silent> <Plug>(coc-diagnostic-prev) :call CocAction('diagnosticPrevious')<CR>
nnoremap <silent> <Plug>(coc-definition)      :call CocAction('jumpDefinition')<CR>
nnoremap <silent> <Plug>(coc-implementation)  :call CocAction('jumpImplementation')<CR>
nnoremap <silent> <Plug>(coc-type-definition) :call CocAction('jumpTypeDefinition')<CR>
nnoremap <silent> <Plug>(coc-references)      :call CocAction('jumpReferences')<CR>
inoremap <silent> <Plug>_ <C-r>=coc#_complete()<CR>

if has('vim_starting')
  autocmd VimEnter * call s:Init(0)
else
  call s:Init(1)
endif
