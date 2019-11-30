if exists('g:did_coc_loaded') || v:version < 800
  finish
endif
if has('nvim') && !has('nvim-0.3.0') | finish | endif
let g:did_coc_loaded = 1
let g:coc_service_initialized = 0
let s:is_win = has('win32') || has('win64')
let s:root = expand('<sfile>:h:h')
let s:is_vim = !has('nvim')
let s:is_gvim = get(v:, 'progname', '') ==# 'gvim'

if get(g:, 'coc_start_at_startup', 1) && !s:is_gvim
  call coc#rpc#start_server()
endif

function! CocAction(...) abort
  return coc#rpc#request('CocAction', a:000)
endfunction

function! CocHasProvider(name) abort
  return coc#rpc#request('hasProvider', [a:name])
endfunction

function! CocActionAsync(...) abort
  return s:AsyncRequest('CocAction', a:000)
endfunction

function! CocRequest(...) abort
  return coc#rpc#request('sendRequest', a:000)
endfunction

function! CocRegistNotification(id, method, cb) abort
  call coc#on_notify(a:id, a:method, a:cb)
endfunction

function! CocLocations(id, method, ...) abort
  let args = [a:id, a:method] + copy(a:000)
  call coc#rpc#request('findLocations', args)
endfunction

function! CocLocationsAsync(id, method, ...) abort
  let args = [a:id, a:method] + copy(a:000)
  call coc#rpc#notify('findLocations', args)
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
  let list = coc#rpc#request('CommandList', a:000)
  return join(list, "\n")
endfunction

function! s:ExtensionList(...) abort
  let stats = CocAction('extensionStats')
  call filter(stats, 'v:val["isLocal"] == v:false')
  let list = map(stats, 'v:val["id"]')
  return join(list, "\n")
endfunction

function! s:SearchOptions(...) abort
  let list = ['-e', '--regexp', '-F', '--fixed-strings', '-L', '--follow',
        \ '-g', '--glob', '--hidden', '--no-hidden', '--no-ignore-vcs',
        \ '--word-regexp', '-w', '--smart-case', '-S', '--no-config',
        \ '--line-regexp', '-x']
  return join(list, "\n")
endfunction

function! s:InstallOptions(...)abort
  let list = ['-terminal', '-sync']
  return join(list, "\n")
endfunction

function! s:OpenConfig()
  let home = coc#util#get_config_home()
  if !isdirectory(home)
    call mkdir(home, 'p')
  endif
  execute 'edit '.home.'/coc-settings.json'
endfunction

function! s:OpenLocalConfig()
  let currentDir = getcwd()
  let fsRootDir = fnamemodify($HOME, ":p:h:h:h")

  if currentDir == $HOME
    echom "Can't resolve local config from current working directory."
    return
  endif

  while isdirectory(currentDir) && !(currentDir ==# $HOME) && !(currentDir ==# fsRootDir)
    if isdirectory(currentDir.'/.vim')
      execute 'edit '.currentDir.'/.vim/coc-settings.json'
      return
    endif
    let currentDir = fnamemodify(currentDir, ':p:h:h')
  endwhile

  if coc#util#prompt_confirm("No local config detected, would you like to create .vim/coc-settings.json?")
    call mkdir('.vim', 'p')
    execute 'edit .vim/coc-settings.json'
  endif
endfunction

function! s:AddAnsiGroups() abort
  let color_map = {}
  let colors = ['#282828', '#cc241d', '#98971a', '#d79921', '#458588', '#b16286', '#689d6a', '#a89984', '#928374']
  let names = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'grey']
  for i in range(0, len(names) - 1)
    let name = names[i]
    if exists('g:terminal_ansi_colors')
      let color_map[name] = get(g:terminal_ansi_colors, i, colors[i])
    else
      let color_map[name] = get(g:, 'terminal_color_'.i, colors[i])
    endif
  endfor
  for name in keys(color_map)
    let foreground = toupper(name[0]).name[1:]
    let foregroundColor = color_map[name]
    for key in keys(color_map)
      let background = toupper(key[0]).key[1:]
      let backgroundColor = color_map[key]
      exe 'hi default CocList'.foreground.background.' guifg='.foregroundColor.' guibg='.backgroundColor
    endfor
    exe 'hi default CocListFg'.foreground. ' guifg='.foregroundColor
    exe 'hi default CocListBg'.foreground. ' guibg='.foregroundColor
  endfor
endfunction

function! s:CursorRangeFromSelected(type, ...) abort
  " add range by operator
  call coc#rpc#request('cursorsSelect', [bufnr('%'), 'operator', a:type])
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
  if get(g:, 'coc_service_initialized', 0)
    call coc#rpc#request('CocAutocmd', a:000)
  else
    call coc#rpc#notify('CocAutocmd', a:000)
  endif
endfunction

function! s:Enable()
  if get(g:, 'coc_enabled', 0) == 1
    return
  endif
  let g:coc_enabled = 1

  augroup coc_nvim
    autocmd!

    if exists('##MenuPopupChanged') && exists('*nvim_open_win')
      autocmd MenuPopupChanged *   call s:Autocmd('MenuPopupChanged', get(v:, 'event', {}), win_screenpos(winnr())[0] + winline() - 2)
    endif
    if exists('##CompleteChanged')
      autocmd CompleteChanged *   call s:Autocmd('MenuPopupChanged', get(v:, 'event', {}), win_screenpos(winnr())[0] + winline() - 2)
    endif
    if exists('##MenuPopupChanged') || exists('##CompleteChanged')
      autocmd CompleteDone      * call coc#util#close_popup()
    endif

    if coc#rpc#started()
      autocmd VimEnter            * call coc#rpc#notify('VimEnter', [])
    elseif get(g:, 'coc_start_at_startup', 1)
      autocmd VimEnter            * call coc#rpc#start_server()
    endif
    if s:is_vim
      if exists('##DirChanged')
        autocmd DirChanged        * call s:Autocmd('DirChanged', expand('<afile>'))
      endif
      if exists('##TerminalOpen')
        autocmd TerminalOpen      * call s:Autocmd('TermOpen', +expand('<abuf>'))
      endif
    else
      autocmd DirChanged        * call s:Autocmd('DirChanged', get(v:event, 'cwd', ''))
      autocmd TermOpen          * call s:Autocmd('TermOpen', +expand('<abuf>'))
      autocmd TermClose         * call s:Autocmd('TermClose', +expand('<abuf>'))
    endif
    autocmd WinLeave            * call coc#util#clearmatches(get(w:, 'coc_matchids', []))
    autocmd BufWinLeave         * call s:Autocmd('BufWinLeave', +expand('<abuf>'), win_getid())
    autocmd BufWinEnter         * call s:Autocmd('BufWinEnter', +expand('<abuf>'), win_getid())
    autocmd FileType            * call s:Autocmd('FileType', expand('<amatch>'), +expand('<abuf>'))
    autocmd CompleteDone        * call s:Autocmd('CompleteDone', get(v:, 'completed_item', {}))
    autocmd InsertCharPre       * call s:Autocmd('InsertCharPre', v:char)
    if exists('##TextChangedP')
      autocmd TextChangedP        * call s:Autocmd('TextChangedP', +expand('<abuf>'))
    endif
    autocmd TextChangedI        * call s:Autocmd('TextChangedI', +expand('<abuf>'))
    autocmd InsertLeave         * call s:Autocmd('InsertLeave', +expand('<abuf>'))
    autocmd InsertEnter         * call s:Autocmd('InsertEnter', +expand('<abuf>'))
    autocmd BufHidden           * call s:Autocmd('BufHidden', +expand('<abuf>'))
    autocmd BufEnter            * call s:Autocmd('BufEnter', +expand('<abuf>'))
    autocmd TextChanged         * call s:Autocmd('TextChanged', +expand('<abuf>'), getbufvar(+expand('<abuf>'), 'changedtick'))
    autocmd BufWritePost        * call s:Autocmd('BufWritePost', +expand('<abuf>'))
    autocmd CursorMoved         * call s:Autocmd('CursorMoved', +expand('<abuf>'), [line('.'), col('.')])
    autocmd CursorMovedI        * call s:Autocmd('CursorMovedI', +expand('<abuf>'), [line('.'), col('.')])
    autocmd CursorHold          * call s:Autocmd('CursorHold', +expand('<abuf>'))
    autocmd CursorHoldI         * call s:Autocmd('CursorHoldI', +expand('<abuf>'))
    autocmd BufNewFile,BufReadPost * call s:Autocmd('BufCreate', +expand('<abuf>'))
    autocmd BufUnload           * call s:SyncAutocmd('BufUnload', +expand('<abuf>'))
    autocmd BufWritePre         * call s:SyncAutocmd('BufWritePre', +expand('<abuf>'))
    autocmd FocusGained         * if mode() !~# '^c' | call s:Autocmd('FocusGained') | endif
    autocmd VimResized          * call s:Autocmd('VimResized', &columns, &lines)
    autocmd VimLeavePre         * let g:coc_vim_leaving = 1
    autocmd VimLeave            * call coc#rpc#stop()
    autocmd BufReadCmd,FileReadCmd,SourceCmd list://* call coc#list#setup(expand('<amatch>'))
    autocmd BufWriteCmd __coc_refactor__* :call coc#rpc#notify('saveRefactor', [+expand('<abuf>')])
  augroup end
endfunction

hi default CocUnderline    cterm=underline gui=underline
hi default CocErrorSign    ctermfg=Red     guifg=#ff0000
hi default CocWarningSign  ctermfg=Brown   guifg=#ff922b
hi default CocInfoSign     ctermfg=Yellow  guifg=#fab005
hi default CocHintSign     ctermfg=Blue    guifg=#15aabf
hi default CocSelectedText ctermfg=Red     guifg=#fb4934
hi default CocCodeLens     ctermfg=Gray    guifg=#999999
hi default link CocErrorFloat       CocErrorSign
hi default link CocWarningFloat     CocWarningSign
hi default link CocInfoFloat        CocInfoSign
hi default link CocHintFloat        CocHintSign
hi default link CocErrorHighlight   CocUnderline
hi default link CocWarningHighlight CocUnderline
hi default link CocInfoHighlight    CocUnderline
hi default link CocHintHighlight    CocUnderline
hi default link CocListMode ModeMsg
hi default link CocListPath Comment
hi default link CocHighlightText  CursorColumn
if has('nvim')
  hi default link CocFloating NormalFloat
else
  hi default link CocFloating Pmenu
endif


hi default link CocHoverRange     Search
hi default link CocCursorRange    Search
hi default link CocHighlightRead  CocHighlightText
hi default link CocHighlightWrite CocHighlightText

function! s:FormatFromSelected(type)
  call CocAction('formatSelected', a:type)
endfunction

function! s:CodeActionFromSelected(type)
  call CocAction('codeAction', a:type)
endfunction

function! s:ShowInfo()
  if coc#rpc#ready()
    call coc#rpc#notify('showInfo', [])
  else
    let lines = []
    echomsg 'coc.nvim service not started, checking environment...'
    let node = get(g:, 'coc_node_path', 'node')
    if !executable(node)
      call add(lines, 'Error: '.node.' is not executable!')
    else
      let output = trim(system(node . ' --version'))
      let ms = matchlist(output, 'v\(\d\+\).\(\d\+\).\(\d\+\)')
      if empty(ms) || str2nr(ms[1]) < 8 || (str2nr(ms[1]) == 8 && str2nr(ms[2]) < 10)
        call add(lines, 'Error: Node version '.output.' < 8.10.0, please upgrade node.js')
      endif
    endif
    " check bundle
    let file = s:root.'/lib/attach.js'
    if !filereadable(file)
      let file = s:root.'/build/index.js'
      if !filereadable(file)
        call add(lines, 'Error: javascript bundle not found, run :call coc#util#install() to fix.')
      endif
    endif
    if !empty(lines)
      belowright vnew
      setl filetype=nofile
      call setline(1, lines)
    else
      if get(g:, 'coc_start_at_startup',1)
        echohl MoreMsg | echon 'Start on startup is disabled, try :CocStart' | echohl None
      else
        echohl MoreMsg | echon 'Service stopped for some unknown reason, try :CocStart' | echohl None
      endif
    endif
  endif
endfunction

command! -nargs=0 CocInfo         :call s:ShowInfo()
command! -nargs=0 CocOpenLog      :call coc#rpc#notify('openLog',  [])
command! -nargs=0 CocListResume   :call coc#rpc#notify('listResume', [])
command! -nargs=0 CocPrev         :call coc#rpc#notify('listPrev', [])
command! -nargs=0 CocNext         :call coc#rpc#notify('listNext', [])
command! -nargs=0 CocDisable      :call s:Disable()
command! -nargs=0 CocEnable       :call s:Enable()
command! -nargs=0 CocConfig       :call s:OpenConfig()
command! -nargs=0 CocLocalConfig  :call s:OpenLocalConfig()
command! -nargs=0 CocRestart      :call coc#rpc#restart()
command! -nargs=0 CocStart        :call coc#rpc#start_server()
command! -nargs=0 CocRebuild      :call coc#util#rebuild()
command! -nargs=+ -complete=custom,s:SearchOptions  CocSearch    :call coc#rpc#notify('search', [<f-args>])
command! -nargs=+ -complete=custom,s:ExtensionList  CocUninstall :call coc#rpc#notify('CocAction', ['uninstallExtension', <f-args>])
command! -nargs=* -complete=custom,coc#list#options CocList      :call coc#rpc#notify('openList',  [<f-args>])
command! -nargs=* -complete=custom,s:CommandList -range CocCommand :call coc#rpc#notify('runCommand', [<f-args>])
command! -nargs=* -range CocAction :call coc#rpc#notify('codeActionRange', [<line1>, <line2>, <f-args>])
command! -nargs=* -range CocFix    :call coc#rpc#notify('codeActionRange', [<line1>, <line2>, 'quickfix'])
command! -nargs=0 CocUpdate       :call coc#util#update_extensions(1)
command! -nargs=0 -bar CocUpdateSync   :call coc#util#update_extensions()
command! -nargs=* -bar -complete=custom,s:InstallOptions CocInstall   :call coc#util#install_extension([<f-args>])

call s:Enable()
call s:AddAnsiGroups()

vnoremap <Plug>(coc-range-select)          :<C-u>call       CocAction('rangeSelect',     visualmode(), v:true)<CR>
vnoremap <Plug>(coc-range-select-backward) :<C-u>call       CocAction('rangeSelect',     visualmode(), v:false)<CR>
nnoremap <Plug>(coc-range-select)          :<C-u>call       CocAction('rangeSelect',     '', v:true)<CR>
nnoremap <Plug>(coc-codelens-action)       :<C-u>call       CocActionAsync('codeLensAction')<CR>
vnoremap <Plug>(coc-format-selected)       :<C-u>call       CocActionAsync('formatSelected',     visualmode())<CR>
vnoremap <Plug>(coc-codeaction-selected)   :<C-u>call       CocActionAsync('codeAction',         visualmode())<CR>
nnoremap <Plug>(coc-codeaction-selected)   :<C-u>set        operatorfunc=<SID>CodeActionFromSelected<CR>g@
nnoremap <Plug>(coc-codeaction)            :<C-u>call       CocActionAsync('codeAction',         '')<CR>
nnoremap <Plug>(coc-rename)                :<C-u>call       CocActionAsync('rename')<CR>
nnoremap <Plug>(coc-format-selected)       :<C-u>set        operatorfunc=<SID>FormatFromSelected<CR>g@
nnoremap <Plug>(coc-format)                :<C-u>call       CocActionAsync('format')<CR>
nnoremap <Plug>(coc-diagnostic-info)       :<C-u>call       CocActionAsync('diagnosticInfo')<CR>
nnoremap <Plug>(coc-diagnostic-next)       :<C-u>call       CocActionAsync('diagnosticNext')<CR>
nnoremap <Plug>(coc-diagnostic-prev)       :<C-u>call       CocActionAsync('diagnosticPrevious')<CR>
nnoremap <Plug>(coc-diagnostic-next-error) :<C-u>call       CocActionAsync('diagnosticNext',     'error')<CR>
nnoremap <Plug>(coc-diagnostic-prev-error) :<C-u>call       CocActionAsync('diagnosticPrevious', 'error')<CR>
nnoremap <Plug>(coc-definition)            :<C-u>call       CocAction('jumpDefinition')<CR>
nnoremap <Plug>(coc-declaration)           :<C-u>call       CocAction('jumpDeclaration')<CR>
nnoremap <Plug>(coc-implementation)        :<C-u>call       CocAction('jumpImplementation')<CR>
nnoremap <Plug>(coc-type-definition)       :<C-u>call       CocAction('jumpTypeDefinition')<CR>
nnoremap <Plug>(coc-references)            :<C-u>call       CocAction('jumpReferences')<CR>
nnoremap <Plug>(coc-openlink)              :<C-u>call       CocActionAsync('openLink')<CR>
nnoremap <Plug>(coc-fix-current)           :<C-u>call       CocActionAsync('doQuickfix')<CR>
nnoremap <Plug>(coc-float-hide)            :<C-u>call       coc#util#float_hide()<CR>
nnoremap <Plug>(coc-float-jump)            :<c-u>call       coc#util#float_jump()<cr>
nnoremap <Plug>(coc-command-repeat)        :<C-u>call       CocAction('repeatCommand')<CR>
nnoremap <Plug>(coc-refactor)              :<C-u>call       CocActionAsync('refactor')<CR>
inoremap <silent>                          <Plug>CocRefresh <C-r>=coc#_complete()<CR>

nnoremap <silent> <Plug>(coc-cursors-operator) :<C-u>set operatorfunc=<SID>CursorRangeFromSelected<CR>g@
vnoremap <silent> <Plug>(coc-cursors-range)    :<C-u>call coc#rpc#request('cursorsSelect', [bufnr('%'), 'range', visualmode()])<CR>
nnoremap <silent> <Plug>(coc-cursors-word)     :<C-u>call coc#rpc#request('cursorsSelect', [bufnr('%'), 'word', 'n'])<CR>
nnoremap <silent> <Plug>(coc-cursors-position) :<C-u>call coc#rpc#request('cursorsSelect', [bufnr('%'), 'position', 'n'])<CR>
vnoremap <silent> <Plug>(coc-funcobj-i)        :<C-U>call coc#rpc#request('selectFunction', [v:true, visualmode()])<CR>
vnoremap <silent> <Plug>(coc-funcobj-a)        :<C-U>call coc#rpc#request('selectFunction', [v:false, visualmode()])<CR>
onoremap <silent> <Plug>(coc-funcobj-i)        :<C-U>call coc#rpc#request('selectFunction', [v:true, ''])<CR>
onoremap <silent> <Plug>(coc-funcobj-a)        :<C-U>call coc#rpc#request('selectFunction', [v:false, ''])<CR>
