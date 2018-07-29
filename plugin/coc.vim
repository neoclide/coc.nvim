if exists('g:did_coc_loaded') || v:version < 800
  finish
endif
let s:save_cpo = &cpo
set cpo&vim
let g:did_coc_loaded = 1
let s:is_vim = !has('nvim')

if has('nvim') && !has('nvim-0.3.0')
  echohl Error | echon '[coc.nvim] coc requires neovim >= 0.3.0 to work' | echohl None
  finish
endif
if !has('nvim') && !has('patch-8.1.001')
  echohl Error | echon '[coc.nvim] coc requires vim >= 8.1 to work' | echohl None
  finish
endif

if s:is_vim
  call nvim#rpc#start_server()
else
  call coc#rpc#start_server()
endif

function! CocAction(...) abort
  if get(g:, 'coc_enabled', 0) == 0
    echohl Error
    echon "[coc.nvim] Can't run '".a:1."', service not avaiable!"
    echohl None
    return
  endif
  return coc#rpc#request('CocAction', a:000)
endfunction

function! s:OpenConfig()
  let home = coc#util#get_config_home()
  execute 'edit '.home.'/coc-settings.json'
endfunction

function! s:Autocmd(...) abort
  " care about normal buffer only
  if !get(g:, 'coc_enabled', 0) | return | endif
  call coc#rpc#notify('CocAutocmd', a:000)
endfunction

" This should be sync
function! s:BufWritePre(bufnr)
  if !get(g:, 'coc_enabled', 0) | return | endif
  if getbufvar(a:bufnr, '&buftype') !=# '' | return | endif
  call coc#rpc#request('BufWritePre', [a:bufnr])
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

function! s:CocSourceNames(A, L, P) abort
  if !s:CheckState() | return | endif
  let items = CocAction('sourceStat')
  return filter(map(items, 'v:val["name"]'), 'v:val =~ "^'.a:A.'"')
endfunction

function! s:CheckState() abort
  let enabled = get(g:, 'coc_enabled', 0)
  if !enabled
    call coc#util#on_error('Service disabled')
  endif
  return enabled
endfunction

function! s:Enable()
  if get(g:, 'coc_enabled', 0) == 1
    return
  endif

  augroup coc_nvim
    autocmd!
    autocmd FileType            * call s:Autocmd('FileType', expand('<amatch>'))
    autocmd InsertCharPre       * call s:Autocmd('InsertCharPre', v:char)
    autocmd CompleteDone        * call s:Autocmd('CompleteDone', v:completed_item)
    autocmd TextChangedP        * call s:Autocmd('TextChangedP')
    autocmd TextChangedI        * call s:Autocmd('TextChangedI', +expand('<abuf>'))
    autocmd InsertLeave         * call s:Autocmd('InsertLeave')
    autocmd InsertEnter         * call s:Autocmd('InsertEnter')
    autocmd BufHidden           * call s:Autocmd('BufHidden', +expand('<abuf>'))
    autocmd BufLeave            * call s:Autocmd('BufLeave', +expand('<abuf>'))
    autocmd BufEnter            * call s:Autocmd('BufEnter', +expand('<abuf>'))
    autocmd BufUnload           * call s:Autocmd('BufUnload', +expand('<abuf>'))
    autocmd TextChanged         * call s:Autocmd('TextChanged', +expand('<abuf>'))
    autocmd BufNewFile,BufReadPost, * call s:Autocmd('BufCreate', +expand('<abuf>'))
    autocmd BufWritePost        * call s:Autocmd('BufWritePost', +expand('<abuf>'))
    autocmd CursorMoved         * call s:Autocmd('CursorMoved')
    autocmd CursorMovedI        * call s:Autocmd('CursorMovedI')
    autocmd BufWritePre         * call s:BufWritePre(+expand('<abuf>'))
    autocmd OptionSet completeopt call CocAction('setOption', 'completeopt', v:option_new)
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
  command! -nargs=0 CocConfig :call s:OpenConfig()
  let g:coc_enabled = 1
endfunction

highlight default CocErrorSign   guifg=#ff0000
highlight default CocWarningSign guifg=#ff922b
highlight default CocInfoSign    guifg=#fab005
highlight default CocHintSign    guifg=#15aabf
highlight default CocUnderline   term=underline gui=undercurl

function! s:FormatFromSelected(type)
  call CocAction('formatSelected', a:type)
endfunction

function! s:CodeActionFromSelected(type)
  call CocAction('codeAction', a:type)
endfunction

augroup coc_init
  autocmd!
  autocmd User CocNvimInit call s:Enable()
  " it's possible that client is not ready
  autocmd VimEnter * call coc#rpc#notify('VimEnter', [])
  if s:is_vim
    autocmd User NvimRpcInit call coc#rpc#start_server()
    if empty(nvim#rpc#get_script())
      autocmd VimEnter * call coc#util#terminal_install()
    endif
  endif
augroup end

vnoremap <Plug>(coc-format-selected)     :<C-u>call CocAction('formatSelected', visualmode())<CR>
vnoremap <Plug>(coc-codeaction-selected) :<C-u>call CocAction('codeAction',     visualmode())<CR>
nnoremap <Plug>(coc-codeaction)          :<C-u>call CocAction('codeAction',     '')<CR>
nnoremap <Plug>(coc-rename)              :<C-u>call CocAction('rename')<CR>
nnoremap <Plug>(coc-format-selected)     :<C-u>set  operatorfunc=<SID>FormatFromSelected<CR>g@
nnoremap <Plug>(coc-codeaction-selected) :<C-u>set  operatorfunc=<SID>CodeActionFromSelected<CR>g@
nnoremap <Plug>(coc-format)              :<C-u>call CocAction('format')<CR>
nnoremap <Plug>(coc-diagnostic-next)     :<C-u>call CocAction('diagnosticNext')<CR>
nnoremap <Plug>(coc-diagnostic-prev)     :<C-u>call CocAction('diagnosticPrevious')<CR>
nnoremap <Plug>(coc-definition)          :<C-u>call CocAction('jumpDefinition')<CR>
nnoremap <Plug>(coc-implementation)      :<C-u>call CocAction('jumpImplementation')<CR>
nnoremap <Plug>(coc-type-definition)     :<C-u>call CocAction('jumpTypeDefinition')<CR>
nnoremap <Plug>(coc-references)          :<C-u>call CocAction('jumpReferences')<CR>
inoremap <silent>                        <Plug>_    <C-r>=coc#_complete()<CR>

let &cpo = s:save_cpo
unlet s:save_cpo
