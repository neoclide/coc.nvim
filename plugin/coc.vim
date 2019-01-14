if exists('g:did_coc_loaded') || v:version < 800
  finish
endif
if has('nvim') && !has('nvim-0.3.0') | finish | endif
if !has('nvim') && !has('patch-8.1.001') | finish | endif

let g:did_coc_loaded = 1
let g:coc_service_initialized = 0
let s:is_vim = !has('nvim')

if has('nvim')
  if get(g:, 'coc_start_at_startup', 1)
    call coc#rpc#start_server()
  endif
endif

function! CocAction(...) abort
  if !coc#rpc#ready()
    throw '[coc.nvim] service not started.'
  endif
  return coc#rpc#request('CocAction', a:000)
endfunction

function! CocActionAsync(...) abort
  return s:AsyncRequest('CocAction', a:000)
endfunction

function! CocRequest(...) abort
  if !coc#rpc#ready()
    throw '[coc.nvim] service not started.'
  endif
  return coc#rpc#request('sendRequest', a:000)
endfunction

function! CocLocations(id, method, ...) abort
  let args = [a:id, a:method] + copy(a:000)
  call coc#rpc#request('findLocations', args)
endfunction

function! CocRequestAsync(...)
  return s:AsyncRequest('sendRequest', a:000)
endfunction

function! s:AsyncRequest(name, args) abort
  let Cb = a:args[len(a:args) - 1]
  if type(Cb) == 2
    if !coc#rpc#ready()
      call Cb('service not started', v:null)
    else
      call coc#rpc#request_async(a:name, a:args[0:-2], Cb)
    endif
    return ''
  endif
  call coc#rpc#notify(a:name, a:args)
  return ''
endfunction

function! s:CommandList(...) abort
  if !coc#rpc#ready() | return '' | endif
  let list = coc#rpc#request('CommandList', a:000)
  return join(list, "\n")
endfunction

function! s:ExtensionList(...) abort
  if !coc#rpc#ready() | return '' | endif
  let list = map(CocAction('extensionStats'), 'v:val["id"]')
  return join(list, "\n")
endfunction

function! s:OpenConfig()
  let home = coc#util#get_config_home()
  execute 'edit '.home.'/coc-settings.json'
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

function! s:Autocmd(...) abort
  if !get(g:,'coc_workspace_initialized', 0) | return | endif
  call coc#rpc#notify('CocAutocmd', a:000)
endfunction

function! s:SyncAutocmd(...)
  if !get(g:,'coc_workspace_initialized', 0) | return | endif
  call coc#rpc#request('CocAutocmd', a:000)
endfunction

function! s:Enable()
  if get(g:, 'coc_enabled', 0) == 1
    return
  endif
  let g:coc_enabled = 1

  augroup coc_nvim
    autocmd!
    if get(g:,'coc_enable_locationlist', 1)
      autocmd User CocLocationsChange CocList --normal location
    endif
    if s:is_vim
      autocmd DirChanged       * call s:Autocmd('DirChanged', expand('<afile>'))
    else
      autocmd DirChanged       * call s:Autocmd('DirChanged', get(v:event, 'cwd', ''))
    endif
    autocmd BufWinLeave         * call s:Autocmd('BufWinLeave', +expand('<abuf>'), win_getid())
    autocmd BufWinEnter         * call s:Autocmd('BufWinEnter', +expand('<abuf>'), win_getid())
    autocmd FileType            * call s:Autocmd('FileType', expand('<amatch>'), +expand('<abuf>'))
    autocmd CompleteDone        * call s:Autocmd('CompleteDone', v:completed_item)
    " Must be sync to fix flicking on neovim
    autocmd InsertCharPre       * silent! call s:SyncAutocmd('InsertCharPre', v:char)
    " Must be sync to fix cursor disappear on vim
    if s:is_vim
      autocmd TextChangedP        * call s:SyncAutocmd('TextChangedP', +expand('<abuf>'))
    else
      autocmd TextChangedP        * call s:Autocmd('TextChangedP', +expand('<abuf>'))
    endif
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
    autocmd BufNewFile,BufReadPost, * call s:Autocmd('BufCreate', +expand('<abuf>'))
    autocmd BufUnload           * call s:SyncAutocmd('BufUnload', +expand('<abuf>'))
    autocmd BufWritePre         * call s:SyncAutocmd('BufWritePre', +expand('<abuf>'))
    autocmd FocusGained         * call s:Autocmd('FocusGained')
    autocmd VimLeavePre         * let g:coc_vim_leaving = 1
    autocmd BufReadCmd,FileReadCmd,SourceCmd list://* call coc#list#setup(expand('<amatch>'))
  augroup end
endfunction

hi default CocUnderline    cterm=underline gui=underline
hi default CocErrorSign    ctermfg=Red     guifg=#ff0000
hi default CocWarningSign  ctermfg=Brown   guifg=#ff922b
hi default CocInfoSign     ctermfg=Yellow  guifg=#fab005
hi default CocHintSign     ctermfg=Blue    guifg=#15aabf
hi default CocSelectedText ctermfg=Red     guifg=#fb4934
hi default CocCodeLens     ctermfg=Gray    guifg=#999999
hi default link CocErrorHighlight   CocUnderline
hi default link CocWarningHighlight CocUnderline
hi default link CocInfoHighlight    CocUnderline
hi default link CocHintHighlight    CocUnderline
hi default link CocListMode ModeMsg
hi default link CocListPath Comment

hi default CocHighlightText  guibg=#111111 ctermbg=223
hi default link CocHighlightRead  CocHighlightText
hi default link CocHighlightWrite CocHighlightText

function! s:FormatFromSelected(type)
  if !coc#rpc#ready() | return '' | endif
  call CocAction('formatSelected', a:type)
endfunction

function! s:CodeActionFromSelected(type)
  if !coc#rpc#ready() | return '' | endif
  call CocAction('codeAction', a:type)
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
  let g:coc_service_initialized = 1
  let extensions = get(g:, 'coc_local_extensions', [])
  call coc#rpc#notify('registExtensions', extensions)
endfunction

function! s:Notification(name, args)
  if get(g:, 'coc_service_initialized', 0)
    call coc#rpc#notify(a:name, a:args)
    return
  endif
  let name = a:name
  let args = a:args
  let c = 0
  while 1
    let c = c + 1
    if get(g:, 'coc_service_initialized', 0)
      call coc#rpc#notify(name, args)
      break
    endif
    if c == 50
      echohl Error | echon '[coc.nvim] service not started' | echohl None
    endif
    sleep 100m
  endw
endfunction

augroup coc_init
  autocmd!
  autocmd User     CocNvimInit call s:OnInit()
  autocmd VimEnter *           call s:OnVimEnter()
  if s:is_vim
    autocmd User NvimRpcInit
         \ if get(g:, 'coc_start_at_startup', 1)
         \|   call coc#rpc#start_server()
         \| endif
  endif
augroup end

command! -nargs=0 CocOpenLog    :call s:Notification('openLog',  [])
command! -nargs=0 CocInfo       :call s:Notification('showInfo', [])
command! -nargs=0 CocListResume :call s:Notification('listResume', [])
command! -nargs=0 CocPrev       :call s:Notification('listPrev', [])
command! -nargs=0 CocNext       :call s:Notification('listNext', [])
command! -nargs=0 CocDisable    :call s:Disable()
command! -nargs=0 CocEnable     :call s:Enable()
command! -nargs=0 CocConfig     :call s:OpenConfig()
command! -nargs=0 CocRestart    :call coc#rpc#restart()
command! -nargs=0 CocStart      :call coc#rpc#start_server()
command! -nargs=+ CocInstall    :call coc#util#install_extension(<q-args>)
command! -nargs=0 CocUpdate     :call coc#util#update()
command! -nargs=0 CocRebuild    :call coc#util#rebuild()
command! -nargs=* -complete=custom,coc#list#options  CocList    :call s:Notification('openList', [<f-args>])
command! -nargs=+ -complete=custom,s:ExtensionList  CocUninstall :call s:Notification('CocAction', ['uninstallExtension', <f-args>])
command! -nargs=* -complete=custom,s:CommandList CocCommand :call s:Notification('CocAction', ['runCommand', <f-args>])

call s:Enable()

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
nnoremap <Plug>(coc-declaration)         :<C-u>call CocActionAsync('jumpDeclaration')<CR>
nnoremap <Plug>(coc-implementation)      :<C-u>call CocActionAsync('jumpImplementation')<CR>
nnoremap <Plug>(coc-type-definition)     :<C-u>call CocActionAsync('jumpTypeDefinition')<CR>
nnoremap <Plug>(coc-references)          :<C-u>call CocActionAsync('jumpReferences')<CR>
nnoremap <Plug>(coc-openlink)            :<C-u>call CocActionAsync('openLink')<CR>
nnoremap <Plug>(coc-fix-current)         :<C-u>call CocActionAsync('doQuickfix')<CR>
inoremap <silent> <Plug>_                <C-r>=coc#_complete()<CR>
