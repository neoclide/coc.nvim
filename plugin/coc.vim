if exists('g:did_coc_loaded') || v:version < 800
  finish
endif
if has('nvim') && !has('nvim-0.3.0') | finish | endif
if !has('nvim') && !has('patch-8.1.001') | finish | endif

let g:did_coc_loaded = 1
let s:is_vim = !has('nvim')

if s:is_vim
  call nvim#rpc#start_server()
else
  if $NODE_ENV !=# 'test' && $NVIM_LISTEN_ADDRESS !=# '/tmp/nvim'
    call coc#rpc#start_server()
  endif
endif

function! CocAction(...) abort
  if get(g:, 'coc_enabled', 0) == 0 | return | endif
  return coc#rpc#request('CocAction', a:000)
endfunction

function! CocActionAsync(...) abort
  return s:AsyncRequest('CocAction', a:000)
endfunction

function! s:CommandList(...) abort
  if get(g:, 'coc_enabled', 0) == 0 | return '' | endif
  let list = coc#rpc#request('CommandList', a:000)
  return join(list, "\n")
endfunction

function! CocRequest(...) abort
  if get(g:, 'coc_enabled', 0) == 0 | return | endif
  return coc#rpc#request('sendRequest', a:000)
endfunction

function! CocRequestAsync(...)
  return s:AsyncRequest('sendRequest', a:000)
endfunction

function! s:AsyncRequest(name, args) abort
  if get(g:, 'coc_enabled', 0) == 0 | return | endif
  let Cb = a:args[len(a:args) - 1]
  if type(Cb) != 2
    let Cb = {-> {}}
    let args = copy(a:args)
  else
    let args = copy(a:args)[0:-2]
  endif
  call coc#rpc#request_async(a:name, args, Cb)
  return ''
endfunction

function! s:OpenConfig()
  let home = coc#util#get_config_home()
  execute 'edit '.home.'/coc-settings.json'
endfunction

function! s:Autocmd(...) abort
  if !get(g:, 'coc_enabled', 0) | return | endif
  call coc#rpc#notify('CocAutocmd', a:000)
endfunction

function! s:SyncAutoCmd(...)
  if !get(g:, 'coc_enabled', 0) | return | endif
  call coc#rpc#request('CocAutocmd', a:000)
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
  let g:coc_enabled = 1

  augroup coc_nvim
    autocmd!
    if get(g:, 'coc_auto_copen', 1)
      autocmd User CocQuickfixChange :copen
    endif
    if s:is_vim
      autocmd DirChanged       * call s:Autocmd('DirChanged', expand('<afile>'))
    else
      autocmd DirChanged       * call s:Autocmd('DirChanged', get(v:event, 'cwd', ''))
    endif
    autocmd BufWinEnter         * call s:Autocmd('BufWinEnter', +expand('<abuf>'), win_getid())
    autocmd FileType            * call s:Autocmd('FileType', expand('<amatch>'), +expand('<abuf>'))
    autocmd InsertCharPre       * call s:Autocmd('InsertCharPre', v:char)
    autocmd CompleteDone        * call s:Autocmd('CompleteDone', v:completed_item)
    autocmd TextChangedP        * call s:Autocmd('TextChangedP', +expand('<abuf>'))
    autocmd TextChangedI        * call s:Autocmd('TextChangedI', +expand('<abuf>'))
    autocmd InsertLeave         * call s:Autocmd('InsertLeave')
    autocmd InsertEnter         * call s:Autocmd('InsertEnter')
    autocmd BufHidden           * call s:Autocmd('BufHidden', +expand('<abuf>'))
    autocmd BufEnter            * call s:Autocmd('BufEnter', +expand('<abuf>'))
    autocmd TextChanged         * call s:Autocmd('TextChanged', +expand('<abuf>'))
    autocmd BufWritePost        * call s:Autocmd('BufWritePost', +expand('<abuf>'))
    autocmd CursorMoved         * call s:Autocmd('CursorMoved', +expand('<abuf>'))
    autocmd CursorMovedI        * call s:Autocmd('CursorMovedI')
    autocmd CursorHold          * call s:Autocmd('CursorHold', +expand('<abuf>'))
    autocmd CursorHoldI         * call s:Autocmd('CursorHoldI', +expand('<abuf>'))
    autocmd OptionSet           iskeyword call s:Autocmd('OptionSet', expand('<amatch>'), v:option_old, v:option_new)
    autocmd OptionSet           completeopt call s:Autocmd('OptionSet', expand('<amatch>'), v:option_old, v:option_new)
    autocmd BufNewFile,BufReadPost, * call s:Autocmd('BufCreate', +expand('<abuf>'))
    autocmd BufUnload           * call s:SyncAutoCmd('BufUnload', +expand('<abuf>'))
    autocmd BufWritePre         * call s:SyncAutoCmd('BufWritePre', +expand('<abuf>'))
  augroup end

  " same behaviour of ultisnips
  if get(g:, 'coc_selectmode_mapping', 1) && !get(g:, 'did_plugin_ultisnips', 0)
    snoremap <silent> <BS> <c-g>c
    snoremap <silent> <DEL> <c-g>c
    snoremap <silent> <c-h> <c-g>c
    snoremap <c-r> <c-g>"_c<c-r>
  endif

  command! -nargs=0 CocDisable :call s:Disable()
  command! -nargs=0 CocEnable  :call s:Enable()
  command! -nargs=0 CocConfig  :call s:OpenConfig()
  command! -nargs=0 CocErrors  :call coc#rpc#show_error()
  command! -nargs=* -complete=custom,s:CommandList CocCommand :call CocActionAsync('runCommand', <f-args>)
endfunction

hi default CocErrorSign   guifg=#ff0000
hi default CocWarningSign guifg=#ff922b
hi default CocInfoSign    guifg=#fab005
hi default CocHintSign    guifg=#15aabf
hi default CocUnderline   cterm=underline gui=underline
hi default link CocErrorHighlight   CocUnderline
hi default link CocWarningHighlight CocUnderline
hi default link CocInfoHighlight    CocUnderline
hi default link CocHintHighlight    CocUnderline

hi default CocHighlightText  guibg=#111111 ctermbg=223
hi default link CocHighlightRead  CocHighlightText
hi default link CocHighlightWrite CocHighlightText

function! s:FormatFromSelected(type)
  call CocAction('formatSelected', a:type)
endfunction

function! s:CodeActionFromSelected(type)
  call CocAction('codeAction', a:type)
endfunction

function! s:StatChange(dict, key, val)
  return coc#rpc#request('CocAction', ['toggle', get(a:val, 'new', 0)])
endfunction

function! s:OnVimEnter()
  " it's possible that client is not ready
  call coc#rpc#notify('VimEnter', [])
  if s:is_vim && empty(nvim#rpc#get_script())
    call coc#util#install_node_rpc()
  endif
endfunction

function! s:OnInit()
  call s:Enable()
  call dictwatcheradd(g:, 'coc_enabled', function('s:StatChange'))
  let extensions = get(g:, 'coc_local_extensions', [])
  call coc#rpc#notify('registExtensions', extensions)
endfunction

augroup coc_init
  autocmd!
  autocmd User     CocNvimInit call s:OnInit()
  autocmd VimEnter *           call s:OnVimEnter()
  if s:is_vim
    autocmd User NvimRpcInit call coc#rpc#start_server()
  endif
augroup end

command! -nargs=0 CocRestart  :call coc#rpc#restart()
command! -nargs=+ CocInstall  :call coc#util#install_extension(<q-args>)
command! -nargs=0 CocUpdate   :call coc#util#update()
command! -nargs=0 CocRebuild  :call coc#util#rebuild()

vnoremap <Plug>(coc-format-selected)     :<C-u>call CocAction('formatSelected', visualmode())<CR>
vnoremap <Plug>(coc-codeaction-selected) :<C-u>call CocAction('codeAction',     visualmode())<CR>
nnoremap <Plug>(coc-codeaction)          :<C-u>call CocAction('codeAction',     '')<CR>
nnoremap <Plug>(coc-rename)              :<C-u>call CocAction('rename')<CR>
nnoremap <Plug>(coc-format-selected)     :<C-u>set  operatorfunc=<SID>FormatFromSelected<CR>g@
nnoremap <Plug>(coc-codeaction-selected) :<C-u>set  operatorfunc=<SID>CodeActionFromSelected<CR>g@
nnoremap <Plug>(coc-format)              :<C-u>call CocAction('format')<CR>
nnoremap <Plug>(coc-diagnostic-info)     :<C-u>call CocAction('diagnosticInfo')<CR>
nnoremap <Plug>(coc-diagnostic-next)     :<C-u>call CocAction('diagnosticNext')<CR>
nnoremap <Plug>(coc-diagnostic-prev)     :<C-u>call CocAction('diagnosticPrevious')<CR>
nnoremap <Plug>(coc-definition)          :<C-u>call CocAction('jumpDefinition')<CR>
nnoremap <Plug>(coc-implementation)      :<C-u>call CocAction('jumpImplementation')<CR>
nnoremap <Plug>(coc-type-definition)     :<C-u>call CocAction('jumpTypeDefinition')<CR>
nnoremap <Plug>(coc-references)          :<C-u>call CocAction('jumpReferences')<CR>
nnoremap <Plug>(coc-openlink)            :<C-u>call CocAction('openLink')<CR>
inoremap <silent> <Plug>_                <C-r>=coc#_complete()<CR>
inoremap <expr> <Plug>(coc-complete-custom)     coc#complete_custom()
