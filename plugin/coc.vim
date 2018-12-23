if exists('g:did_coc_loaded') || v:version < 800
  finish
endif
if has('nvim') && !has('nvim-0.3.0') | finish | endif
if !has('nvim') && !has('patch-8.1.001') | finish | endif

let g:did_coc_loaded = 1
let g:rooter_patterns = get(g:, 'rooter_patterns', ['.vim/', '.git/', '.hg/', '.projections.json'])
let s:is_vim = !has('nvim')

if has('nvim')
  call coc#rpc#start_server()
endif

function! CocAction(...) abort
  if get(g:, 'coc_enabled', 0) == 0 | return | endif
  return coc#rpc#request('CocAction', a:000)
endfunction

function! CocActionAsync(...) abort
  return s:AsyncRequest('CocAction', a:000)
endfunction

function! CocRequest(...) abort
  if get(g:, 'coc_enabled', 0) == 0 | return | endif
  return coc#rpc#request('sendRequest', a:000)
endfunction

function! CocLocations(id, method, ...) abort
  if get(g:, 'coc_enabled', 0) == 0 | return | endif
  let args = [a:id, a:method] + copy(a:000)
  call coc#rpc#request('findLocations', args)
endfunction

function! CocRequestAsync(...)
  return s:AsyncRequest('sendRequest', a:000)
endfunction

function! s:AsyncRequest(name, args) abort
  if get(g:, 'coc_enabled', 0) == 0 | return | endif
  let Cb = a:args[len(a:args) - 1]
  if type(Cb) == 2
    call coc#rpc#request_async(a:name, a:args[0:-2], Cb)
    return ''
  endif
  call coc#rpc#notify(a:name, a:args)
  return ''
endfunction

function! s:CommandList(...) abort
  if get(g:, 'coc_enabled', 0) == 0 | return '' | endif
  let list = coc#rpc#request('CommandList', a:000)
  return join(list, "\n")
endfunction

function! s:ExtensionList(...) abort
  if get(g:, 'coc_enabled', 0) == 0 | return '' | endif
  let list = map(CocAction('extensionStats'), 'v:val["id"]')
  return join(list, "\n")
endfunction

function! s:OpenConfig()
  let home = coc#util#get_config_home()
  execute 'edit '.home.'/coc-settings.json'
endfunction

function! s:Autocmd(...) abort
  if !get(g:, 'coc_enabled', 0) | return | endif
  call coc#rpc#notify('CocAutocmd', a:000)
endfunction

function! s:SyncAutocmd(...)
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
    autocmd BufWinLeave         * call s:Autocmd('BufWinLeave', +expand('<abuf>'), win_getid())
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
    autocmd BufUnload           * call s:SyncAutocmd('BufUnload', +expand('<abuf>'))
    autocmd BufWritePre         * call s:SyncAutocmd('BufWritePre', +expand('<abuf>'))
    autocmd VimLeavePre         * let g:coc_vim_leaving = 1
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
  command! -nargs=0 CocOpenLog :call coc#rpc#notify('openLog', [])
  command! -nargs=0 CocInfo    :call coc#rpc#notify('showInfo', [])
  command! -nargs=* -complete=custom,s:CommandList CocCommand :call CocActionAsync('runCommand', <f-args>)
endfunction

hi default CocUnderline   cterm=underline gui=underline
hi default CocErrorSign   ctermfg=Red     guifg=#ff0000
hi default CocWarningSign ctermfg=Brown   guifg=#ff922b
hi default CocInfoSign    ctermfg=Yellow  guifg=#fab005
hi default CocHintSign    ctermfg=Blue    guifg=#15aabf
hi default CocCodeLens    ctermfg=Gray    guifg=#999999
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
  if s:is_vim
    call nvim#rpc#start_server()
  else
    " it's possible that client is not ready
    call coc#rpc#notify('VimEnter', [])
  endif
endfunction

function! s:OnInit()
  call s:Enable()
  if !s:is_vim
    call dictwatcheradd(g:, 'coc_enabled', function('s:StatChange'))
  endif
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

command! -nargs=0 CocConfig    :call s:OpenConfig()
command! -nargs=0 CocRestart   :call coc#rpc#restart()
command! -nargs=+ CocInstall   :call coc#util#install_extension(<q-args>)
command! -nargs=0 CocUpdate    :call coc#util#update()
command! -nargs=0 CocRebuild   :call coc#util#rebuild()
command! -nargs=1 -complete=custom,s:ExtensionList  CocUninstall :call CocActionAsync('uninstallExtension', <f-args>)

nnoremap <Plug>(coc-codelens-action)     :<C-u>call CocActionAsync('codeLensAction')<CR>
vnoremap <Plug>(coc-format-selected)     :<C-u>call CocActionAsync('formatSelected', visualmode())<CR>
vnoremap <Plug>(coc-codeaction-selected) :<C-u>call CocActionAsync('codeAction',     visualmode())<CR>
nnoremap <Plug>(coc-codeaction)          :<C-u>call CocActionAsync('codeAction',     '')<CR>
nnoremap <Plug>(coc-rename)              :<C-u>call CocActionAsync('rename')<CR>
nnoremap <Plug>(coc-format-selected)     :<C-u>set  operatorfunc=<SID>FormatFromSelected<CR>g@
nnoremap <Plug>(coc-codeaction-selected) :<C-u>set  operatorfunc=<SID>CodeActionFromSelected<CR>g@
nnoremap <Plug>(coc-format)              :<C-u>call CocActionAsync('format')<CR>
nnoremap <Plug>(coc-diagnostic-info)     :<C-u>call CocActionAsync('diagnosticInfo')<CR>
nnoremap <Plug>(coc-diagnostic-next)     :<C-u>call CocActionAsync('diagnosticNext')<CR>
nnoremap <Plug>(coc-diagnostic-prev)     :<C-u>call CocActionAsync('diagnosticPrevious')<CR>
nnoremap <Plug>(coc-definition)          :<C-u>call CocActionAsync('jumpDefinition')<CR>
nnoremap <Plug>(coc-implementation)      :<C-u>call CocActionAsync('jumpImplementation')<CR>
nnoremap <Plug>(coc-type-definition)     :<C-u>call CocActionAsync('jumpTypeDefinition')<CR>
nnoremap <Plug>(coc-references)          :<C-u>call CocActionAsync('jumpReferences')<CR>
nnoremap <Plug>(coc-openlink)            :<C-u>call CocActionAsync('openLink')<CR>
nnoremap <Plug>(coc-fix-current)         :<C-u>call CocActionAsync('doQuickfix')<CR>
inoremap <silent> <Plug>_                <C-r>=coc#_complete()<CR>
