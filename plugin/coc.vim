scriptencoding utf-8
let s:is_vim = !has('nvim')
let s:is_gvim = s:is_vim && has("gui_running")
if exists('g:did_coc_loaded') || v:version < 800
  finish
endif

function! s:checkVersion() abort
  let l:unsupported = 0
  if get(g:, 'coc_disable_startup_warning', 0) != 1
    if s:is_vim
      let l:unsupported = !has('patch-9.0.0438')
    else
      let l:unsupported = !has('nvim-0.8.0')
    endif

    if l:unsupported == 1
      echohl Error
      echom "coc.nvim requires at least Vim 9.0.0438 or Neovim 0.8.0, but you're using an older version."
      echom "Please upgrade your (neo)vim."
      echom "You can add this to your vimrc to avoid this message:"
      echom "    let g:coc_disable_startup_warning = 1"
      echom "Note that some features may error out or behave incorrectly."
      echom "Please do not report bugs unless you're using at least Vim 9.0.0438 or Neovim 0.8.0."
      echohl None
      sleep 2
    endif
  endif
endfunction

call s:checkVersion()

let g:did_coc_loaded = 1
let g:coc_service_initialized = 0
let s:root = expand('<sfile>:h:h')

if get(g:, 'coc_start_at_startup', 1) && !s:is_gvim
  call coc#rpc#start_server()
endif

function! CocTagFunc(pattern, flags, info) abort
  if a:flags !=# 'c'
    " use standard tag search
    return v:null
  endif
  return coc#rpc#request('getTagList', [])
endfunction

" Used by popup prompt on vim
function! CocPopupCallback(bufnr, arglist) abort
  if len(a:arglist) == 2
    if a:arglist[0] == 'confirm'
      call coc#rpc#notify('PromptInsert', [a:arglist[1], a:bufnr])
    elseif a:arglist[0] == 'exit'
      execute 'silent! bd! '.a:bufnr
      "call coc#rpc#notify('PromptUpdate', [a:arglist[1]])
    elseif a:arglist[0] == 'change'
      let text = a:arglist[1]
      let current = getbufvar(a:bufnr, 'current', '')
      if text !=# current
        call setbufvar(a:bufnr, 'current', text)
        let cursor = term_getcursor(a:bufnr)
        let info = {
              \ 'lnum': cursor[0],
              \ 'col': cursor[1],
              \ 'line': text,
              \ 'changedtick': 0
              \ }
        call coc#rpc#notify('CocAutocmd', ['TextChangedI', a:bufnr, info])
      endif
    elseif a:arglist[0] == 'send'
      call coc#rpc#notify('PromptKeyPress', [a:bufnr, a:arglist[1]])
    endif
  endif
endfunction

function! CocAction(name, ...) abort
  if !get(g:, 'coc_service_initialized', 0)
    throw 'coc.nvim not ready when invoke CocAction "'.a:name.'"'
  endif
  return coc#rpc#request(a:name, a:000)
endfunction

function! CocHasProvider(name, ...) abort
  let bufnr = empty(a:000) ? bufnr('%') : a:1
  return coc#rpc#request('hasProvider', [a:name, bufnr])
endfunction

function! CocActionAsync(name, ...) abort
  return s:AsyncRequest(a:name, a:000)
endfunction

function! CocRequest(...) abort
  return coc#rpc#request('sendRequest', a:000)
endfunction

function! CocNotify(...) abort
  return coc#rpc#request('sendNotification', a:000)
endfunction

function! CocRegisterNotification(id, method, cb) abort
  call coc#on_notify(a:id, a:method, a:cb)
endfunction

" Deprecated, use CocRegisterNotification instead
function! CocRegistNotification(id, method, cb) abort
  call coc#on_notify(a:id, a:method, a:cb)
endfunction

function! CocLocations(id, method, ...) abort
  let args = [a:id, a:method] + copy(a:000)
  return coc#rpc#request('findLocations', args)
endfunction

function! CocLocationsAsync(id, method, ...) abort
  let args = [a:id, a:method] + copy(a:000)
  return s:AsyncRequest('findLocations', args)
endfunction

function! CocRequestAsync(...)
  return s:AsyncRequest('sendRequest', a:000)
endfunction

function! s:AsyncRequest(name, args) abort
  let Cb = empty(a:args)? v:null : a:args[len(a:args) - 1]
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
  let list = coc#rpc#request('commandList', a:000)
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
        \ '--line-regexp', '--no-ignore', '-x']
  return join(list, "\n")
endfunction

function! s:LoadedExtensions(...) abort
  let list = CocAction('loadedExtensions')
  return join(list, "\n")
endfunction

function! s:InstallOptions(...)abort
  let list = ['-terminal', '-sync']
  return join(list, "\n")
endfunction

function! s:OpenConfig()
  let home = coc#util#get_config_home(1)
  if !isdirectory(home)
    echohl MoreMsg
    echom 'Config directory "'.home.'" does not exist, create? (y/n)'
    echohl None
    let confirm = nr2char(getchar())
    redraw!
    if !(confirm ==? "y" || confirm ==? "\r")
      return
    else
      call mkdir(home, 'p')
    end
  endif
  execute 'edit '.fnameescape(home.'/coc-settings.json')
  call coc#rpc#notify('checkJsonExtension', [])
endfunction

function! s:get_color(item, fallback) abort
  let t = type(a:item)
  if t == 1
    return a:item
  endif
  if t == 4
    let item = get(a:item, 'gui', {})
    let color = get(item, &background, a:fallback)
    return type(color) == 1 ? color : a:fallback
  endif
  return a:fallback
endfunction

function! s:AddAnsiGroups() abort
  let color_map = {}
  let colors = ['#282828', '#cc241d', '#98971a', '#d79921', '#458588', '#b16286', '#689d6a', '#a89984', '#928374']
  let names = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'grey']
  for i in range(0, len(names) - 1)
    let name = names[i]
    if exists('g:terminal_ansi_colors')
      let color_map[name] = s:get_color(get(g:terminal_ansi_colors, i, colors[i]), colors[i])
    else
      let color_map[name] = get(g:, 'terminal_color_'.i, colors[i])
    endif
  endfor
  try
    for name in keys(color_map)
      let foreground = toupper(name[0]).name[1:]
      let foregroundColor = color_map[name]
      for key in keys(color_map)
        let background = toupper(key[0]).key[1:]
        let backgroundColor = color_map[key]
        exe 'hi default CocList'.foreground.background.' guifg='.foregroundColor.' guibg='.backgroundColor
      endfor
      exe 'hi default CocListFg'.foreground. ' guifg='.foregroundColor. ' ctermfg='.foreground
      exe 'hi default CocListBg'.foreground. ' guibg='.foregroundColor. ' ctermbg='.foreground
    endfor
  catch /.*/
    " ignore invalid color
  endtry
endfunction

function! s:CreateHighlight(group, fg, bg) abort
  let cmd = coc#hlgroup#compose(a:fg, a:bg)
  if !empty(trim(cmd))
    exe 'hi default '.a:group.' '.cmd
  else
    exe 'hi default link '.a:group.' '.a:fg
  endif
endfunction

function! s:OpenDiagnostics(...) abort
  let height = get(a:, 1, 0)
  call coc#rpc#request('fillDiagnostics', [bufnr('%')])
  if height
    execute ':lopen '.height
   else
    lopen
  endif
endfunction

function! s:Disable() abort
  if get(g:, 'coc_enabled', 0) == 0
    return
  endif
  autocmd! coc_nvim
  call coc#rpc#notify('detach', [])
  echohl MoreMsg
    echom '[coc.nvim] Event disabled'
  echohl None
  let g:coc_enabled = 0
endfunction

function! s:Autocmd(...) abort
  if !get(g:, 'coc_workspace_initialized', 0)
    return
  endif
  call coc#rpc#notify('CocAutocmd', a:000)
endfunction

function! s:HandleBufEnter(bufnr) abort
  if s:is_vim
    call coc#api#Buf_flush(a:bufnr)
  endif
  call s:Autocmd('BufEnter', a:bufnr)
endfunction

function! s:HandleCharInsert(char, bufnr) abort
  call s:Autocmd('InsertCharPre', a:char, a:bufnr)
endfunction

function! s:HandleTextChangedI(event, bufnr) abort
  if s:is_vim
    " make sure lines event before changed event.
    call coc#api#Buf_flush(a:bufnr)
  endif
  call s:Autocmd(a:event, a:bufnr, coc#util#change_info())
endfunction

function! s:HandleTextChanged(bufnr) abort
  if s:is_vim
    " make sure lines event before changed event.
    call coc#api#Buf_flush(a:bufnr)
  endif
  call s:Autocmd('TextChanged', a:bufnr, getbufvar(a:bufnr, 'changedtick'))
endfunction

function! s:HandleInsertLeave(bufnr) abort
  call coc#pum#close()
  call s:Autocmd('InsertLeave', a:bufnr)
endfunction

function! s:HandleWinScrolled(winid, event) abort
  if getwinvar(a:winid, 'float', 0)
    call coc#float#nvim_scrollbar(a:winid)
  endif
  if !empty(a:event)
    let opt = get(a:event, 'all', {})
    if get(opt, 'topline', 0) == 0 && get(opt, 'height', 0) == 0
      " visible region not changed.
      return
    endif
    for key in keys(a:event)
      let winid = str2nr(key)
      if winid != 0
        let info = getwininfo(winid)
        if !empty(info)
          call s:Autocmd('WinScrolled', winid, info[0]['bufnr'], [info[0]['topline'], info[0]['botline']])
        endif
      endif
    endfor
  else
    " v:event not exists on old version vim9
    let info = getwininfo(a:winid)
    if !empty(info)
      call s:Autocmd('WinScrolled', a:winid, info[0]['bufnr'], [info[0]['topline'], info[0]['botline']])
    endif
  endif
endfunction

function! s:HandleWinClosed(winid) abort
  call coc#float#on_close(a:winid)
  call coc#notify#on_close(a:winid)
  call s:Autocmd('WinClosed', a:winid)
endfunction

function! s:SyncAutocmd(...)
  if !get(g:, 'coc_workspace_initialized', 0)
    return
  endif
  call coc#rpc#request('CocAutocmd', a:000)
endfunction

function! s:VimLeavePre() abort
  let g:coc_vim_leaving = 1
  call s:Autocmd('VimLeavePre')
  if s:is_vim && exists('$COC_NVIM_REMOTE_ADDRESS')
    " Helps to avoid connection error.
    call coc#rpc#close_connection()
    return
  endif
  if get(g:, 'coc_node_env', '') ==# 'test'
    return
  endif
  if s:is_vim
    call timer_start(1, { -> coc#client#kill('coc')})
  endif
endfunction

function! s:VimEnter() abort
  if coc#rpc#started()
    if !exists('$COC_NVIM_REMOTE_ADDRESS')
      call coc#rpc#notify('VimEnter', [join(coc#compat#list_runtime_paths(), ",")])
    endif
  elseif get(g:, 'coc_start_at_startup', 1)
    call coc#rpc#start_server()
  endif
  call s:Highlight()
endfunction

function! s:Enable(initialize)
  if get(g:, 'coc_enabled', 0) == 1
    return
  endif

  let g:coc_enabled = 1
  sign define CocCurrentLine linehl=CocMenuSel
  sign define CocListCurrent linehl=CocListLine
  sign define CocTreeSelected linehl=CocTreeSelected
  if s:is_vim
    call coc#api#Tabpage_ids()
  endif

  augroup coc_nvim
    autocmd!

    if !v:vim_did_enter
      autocmd VimEnter            * call s:VimEnter()
    else
      call s:Highlight()
    endif
    if s:is_vim
      if exists('##DirChanged')
        autocmd DirChanged        * call s:Autocmd('DirChanged', getcwd())
      endif
      if exists('##TerminalOpen')
        autocmd TerminalOpen      * call s:Autocmd('TermOpen', +expand('<abuf>'))
      endif
      autocmd CursorMoved         list:///* call coc#list#select(bufnr('%'), line('.'))
      autocmd TabNew              * call coc#api#Tabpage_ids()
    else
      autocmd DirChanged        * call s:Autocmd('DirChanged', get(v:event, 'cwd', ''))
      autocmd TermOpen          * call s:Autocmd('TermOpen', +expand('<abuf>'))
      autocmd WinEnter          * call coc#float#nvim_win_enter(win_getid())
    endif
    if exists('##CompleteChanged')
      autocmd CompleteChanged   * call timer_start(1, { -> execute('if pumvisible() | call coc#pum#close() | endif')})
    endif
    autocmd CursorHold          * call coc#float#check_related()
    if exists('##WinClosed')
      autocmd WinClosed         * call s:HandleWinClosed(+expand('<amatch>'))
    elseif exists('##TabEnter')
      autocmd TabEnter          * call coc#notify#reflow()
    endif
    if exists('##WinScrolled')
      autocmd WinScrolled         * call s:HandleWinScrolled(+expand('<amatch>'), v:event)
    endif
    autocmd ModeChanged         * call s:Autocmd('ModeChanged', v:event)
    autocmd TabNew              * call s:Autocmd('TabNew', coc#compat#tabnr_id(tabpagenr()))
    autocmd TabClosed           * call s:Autocmd('TabClosed', coc#compat#call('list_tabpages', []))
    autocmd WinLeave            * call s:Autocmd('WinLeave', win_getid())
    autocmd WinEnter            * call s:Autocmd('WinEnter', win_getid())
    autocmd BufWinLeave         * call s:Autocmd('BufWinLeave', +expand('<abuf>'), bufwinid(+expand('<abuf>')))
    autocmd BufWinEnter         * call s:Autocmd('BufWinEnter', +expand('<abuf>'), win_getid(), coc#window#visible_range(win_getid()))
    autocmd FileType            * call s:Autocmd('FileType', expand('<amatch>'), +expand('<abuf>'))
    autocmd InsertCharPre       * call s:HandleCharInsert(v:char, bufnr('%'))
    autocmd TextChangedP        * call s:HandleTextChangedI('TextChangedP', +expand('<abuf>'))
    autocmd TextChangedI        * call s:HandleTextChangedI('TextChangedI', +expand('<abuf>'))
    autocmd TextChanged         * call s:HandleTextChanged(+expand('<abuf>'))
    autocmd InsertLeave         * call s:HandleInsertLeave(+expand('<abuf>'))
    autocmd BufEnter            * call s:HandleBufEnter(+expand('<abuf>'))
    autocmd InsertEnter         * call s:Autocmd('InsertEnter', +expand('<abuf>'))
    autocmd BufHidden           * call s:Autocmd('BufHidden', +expand('<abuf>'))
    autocmd BufWritePost        * call s:Autocmd('BufWritePost', +expand('<abuf>'), getbufvar(+expand('<abuf>'), 'changedtick'))
    autocmd CursorMoved         * call s:Autocmd('CursorMoved', +expand('<abuf>'), [line('.'), col('.')])
    autocmd CursorMovedI        * call s:Autocmd('CursorMovedI', +expand('<abuf>'), [line('.'), col('.')])
    autocmd CursorHold          * call s:Autocmd('CursorHold', +expand('<abuf>'), [line('.'), col('.')], win_getid())
    autocmd CursorHoldI         * call s:Autocmd('CursorHoldI', +expand('<abuf>'), [line('.'), col('.')], win_getid())
    autocmd BufNewFile,BufReadPost * call s:Autocmd('BufCreate', +expand('<abuf>'))
    autocmd BufUnload           * call s:Autocmd('BufUnload', +expand('<abuf>'))
    autocmd BufWritePre         * call s:SyncAutocmd('BufWritePre', +expand('<abuf>'), bufname(+expand('<abuf>')), getbufvar(+expand('<abuf>'), 'changedtick'))
    autocmd FocusGained         * if mode() !~# '^c' | call s:Autocmd('FocusGained') | endif
    autocmd FocusLost           * call s:Autocmd('FocusLost')
    autocmd VimResized          * call s:Autocmd('VimResized', &columns, &lines)
    autocmd VimLeavePre         * call s:VimLeavePre()
    autocmd BufReadCmd,FileReadCmd,SourceCmd list://* call coc#list#setup(expand('<amatch>'))
    autocmd BufWriteCmd __coc_refactor__* :call coc#rpc#notify('saveRefactor', [+expand('<abuf>')])
    autocmd ColorScheme * call s:Highlight() | call s:Autocmd('ColorScheme')
  augroup end
  if a:initialize == 0
     call coc#rpc#request('attach', [])
     echohl MoreMsg
     echom '[coc.nvim] Event enabled'
     echohl None
  endif
endfunction

function! s:StaticHighlight() abort
  hi default CocSelectedText  ctermfg=Red     guifg=#fb4934 guibg=NONE
  hi default CocCodeLens      ctermfg=Gray    guifg=#999999 guibg=NONE
  hi default CocUnderline     term=underline cterm=underline gui=underline guisp=#ebdbb2
  hi default CocBold          term=bold cterm=bold gui=bold
  hi default CocItalic        term=italic cterm=italic gui=italic
  hi default CocStrikeThrough term=strikethrough cterm=strikethrough gui=strikethrough
  hi default CocMarkdownLink  ctermfg=Blue    guifg=#15aabf guibg=NONE
  hi default CocDisabled      guifg=#999999   ctermfg=gray
  hi default CocSearch        ctermfg=Blue    guifg=#15aabf guibg=NONE
  hi default CocLink          term=underline cterm=underline gui=underline guisp=#15aabf
  hi default link CocFloatActive         CocSearch
  hi default link CocFadeOut             Conceal
  hi default link CocMarkdownCode        markdownCode
  hi default link CocMarkdownHeader      markdownH1
  hi default link CocDeprecatedHighlight CocStrikeThrough
  hi default link CocUnusedHighlight     CocFadeOut
  hi default link CocListSearch          CocSearch
  hi default link CocListMode            ModeMsg
  hi default link CocListPath            Comment
  hi default link CocHighlightText       CursorColumn
  hi default link CocHoverRange          Search
  hi default link CocCursorRange         Search
  hi default link CocLinkedEditing       CocCursorRange
  hi default link CocHighlightRead       CocHighlightText
  hi default link CocHighlightWrite      CocHighlightText
  " Notification
  hi default CocNotificationProgress  ctermfg=Blue    guifg=#15aabf guibg=NONE
  hi default link CocNotificationButton  CocUnderline
  hi default link CocNotificationKey     Comment
  hi default link CocNotificationError   CocErrorFloat
  hi default link CocNotificationWarning CocWarningFloat
  hi default link CocNotificationInfo    CocInfoFloat
  " Snippet
  hi default link CocSnippetVisual       Visual
  " Tree view highlights
  hi default link CocTreeTitle       Title
  hi default link CocTreeDescription Comment
  hi default link CocTreeOpenClose   CocBold
  hi default link CocTreeSelected    CursorLine
  hi default link CocSelectedRange   CocHighlightText
  " Symbol highlights
  hi default link CocSymbolDefault       MoreMsg
  "Pum
  hi default link CocPumSearch           CocSearch
  hi default link CocPumDetail           Comment
  hi default link CocPumMenu             CocFloating
  hi default link CocPumShortcut         Comment
  hi default link CocPumDeprecated       CocStrikeThrough
  hi default CocVirtualText             ctermfg=12 guifg=#504945
  hi default link CocPumVirtualText        CocVirtualText
  hi default link CocInputBoxVirtualText   CocVirtualText
  hi default link CocFloatDividingLine     CocVirtualText
  if &t_Co == 256
    hi def CocInlineVirtualText guifg=#808080 ctermfg=244
  else
    hi def CocInlineVirtualText guifg=#808080 ctermfg=12
  endif
  hi def link CocInlineAnnotation MoreMsg
endfunction

call s:StaticHighlight()
call s:AddAnsiGroups()

function! s:Highlight() abort
  let normalFloat = s:is_vim ? 'Pmenu' : 'NormalFloat'
  if coc#hlgroup#get_contrast('Normal', normalFloat) > 2.0
    exe 'hi default CocFloating '.coc#hlgroup#create_bg_command('Normal', &background ==# 'dark' ? -30 : 30)
    exe 'hi default CocMenuSel '.coc#hlgroup#create_bg_command('CocFloating', &background ==# 'dark' ? -20 : 20)
    exe 'hi default CocFloatThumb '.coc#hlgroup#create_bg_command('CocFloating', &background ==# 'dark' ? -40 : 40)
    hi default link CocFloatSbar CocFloating
  else
    exe 'hi default link CocFloating '.normalFloat
    if coc#hlgroup#get_contrast('CocFloating', 'PmenuSel') > 2.0
      exe 'hi default CocMenuSel '.coc#hlgroup#create_bg_command('CocFloating', &background ==# 'dark' ? -30 : 30)
    else
      exe 'hi default CocMenuSel '.coc#hlgroup#get_hl_command(synIDtrans(hlID('PmenuSel')), 'bg', '237', '#13354A')
    endif
    hi default link CocFloatThumb        PmenuThumb
    hi default link CocFloatSbar         PmenuSbar
  endif
  exe 'hi default link CocFloatBorder ' .. (hlexists('FloatBorder') ? 'FloatBorder' : 'CocFloating')
  if coc#hlgroup#get_contrast('Normal', 'CursorLine') < 1.3
    " Avoid color too close
    exe 'hi default CocListLine '.coc#hlgroup#create_bg_command('Normal', &background ==# 'dark' ? -20 : 20)
  else
    hi default link CocListLine            CursorLine
  endif

  if !s:is_vim
    hi default CocCursorTransparent gui=strikethrough blend=100
  endif

  let sign_colors = {
      \ 'Error': ['Red', '#ff0000'],
      \ 'Warn': ['Brown', '#ff922b'],
      \ 'Info': ['Yellow', '#fab005'],
      \ 'Hint': ['Blue', '#15aabf']
      \ }
  for name in ['Error', 'Warning', 'Info', 'Hint']
    let suffix = name ==# 'Warning' ? 'Warn' : name
    if hlexists('DiagnosticUnderline'.suffix)
      exe 'hi default link Coc'.name.'Highlight DiagnosticUnderline'.suffix
    else
      exe 'hi default link Coc'.name.'Highlight CocUnderline'
    endif
    if hlexists('DiagnosticSign'.suffix)
      exe 'hi default link Coc'.name.'Sign DiagnosticSign'.suffix
    else
      exe 'hi default Coc'.name.'Sign ctermfg='.sign_colors[suffix][0].' guifg='.sign_colors[suffix][1]
    endif
    if hlexists('DiagnosticVirtualText'.suffix)
      exe 'hi default link Coc'.name.'VirtualText DiagnosticVirtualText'.suffix
    else
      call s:CreateHighlight('Coc'.name.'VirtualText', 'Coc'.name.'Sign', 'Normal')
    endif
    if hlexists('Diagnostic'.suffix)
      exe 'hi default link Coc'.name.'Float Diagnostic'.suffix
    else
      call s:CreateHighlight('Coc'.name.'Float', 'Coc'.name.'Sign', 'CocFloating')
    endif
  endfor

  call s:CreateHighlight('CocInlayHint', 'CocHintSign', 'SignColumn')
  for name in ['Parameter', 'Type']
    exe 'hi default link CocInlayHint'.name.' CocInlayHint'
  endfor

  if get(g:, 'coc_default_semantic_highlight_groups', 1)
    let hlMap = {
        \ 'TypeNamespace': ['@module', 'Include'],
        \ 'TypeType': ['@type', 'Type'],
        \ 'TypeClass': ['@constructor', 'Special'],
        \ 'TypeEnum': ['@type', 'Type'],
        \ 'TypeInterface': ['@type', 'Type'],
        \ 'TypeStruct': ['@structure', 'Identifier'],
        \ 'TypeTypeParameter': ['@variable.parameter', 'Identifier'],
        \ 'TypeParameter': ['@variable.parameter', 'Identifier'],
        \ 'TypeVariable': ['@variable', 'Identifier'],
        \ 'TypeProperty': ['@property', 'Identifier'],
        \ 'TypeEnumMember': ['@property', 'Constant'],
        \ 'TypeEvent': ['@keyword', 'Keyword'],
        \ 'TypeFunction': ['@function', 'Function'],
        \ 'TypeMethod': ['@function.method', 'Function'],
        \ 'TypeMacro': ['@constant.macro', 'Define'],
        \ 'TypeKeyword': ['@keyword', 'Keyword'],
        \ 'TypeModifier': ['@keyword.storage', 'StorageClass'],
        \ 'TypeComment': ['@comment', 'Comment'],
        \ 'TypeString': ['@string', 'String'],
        \ 'TypeNumber': ['@number', 'Number'],
        \ 'TypeBoolean': ['@boolean', 'Boolean'],
        \ 'TypeRegexp': ['@string.regexp', 'String'],
        \ 'TypeOperator': ['@operator', 'Operator'],
        \ 'TypeDecorator': ['@string.special.symbol', 'Identifier'],
        \ 'ModDeprecated': ['@markup.strikethrough', 'CocDeprecatedHighlight']
        \ }
    for [key, value] in items(hlMap)
      let ts = get(value, 0, '')
      let fallback = get(value, 1, '')
      execute 'hi default link CocSem'.key.' '.(coc#hlgroup#valid(ts) ? ts : fallback)
    endfor
  endif
  let symbolMap = {
      \ 'Keyword': ['@keyword', 'Keyword'],
      \ 'Namespace': ['@module', 'Include'],
      \ 'Class': ['@constructor', 'Special'],
      \ 'Method': ['@method', 'Function'],
      \ 'Property': ['@property', 'Identifier'],
      \ 'Text': ['@text', 'CocSymbolDefault'],
      \ 'Unit': ['@unit', 'CocSymbolDefault'],
      \ 'Value': ['@value', 'CocSymbolDefault'],
      \ 'Snippet': ['@snippet', 'CocSymbolDefault'],
      \ 'Color': ['@color', 'Float'],
      \ 'Reference': ['@text.reference', 'Constant'],
      \ 'Folder': ['@folder', 'CocSymbolDefault'],
      \ 'File': ['@file', 'Statement'],
      \ 'Module': ['@module', 'Statement'],
      \ 'Package': ['@package', 'Statement'],
      \ 'Field': ['@variable.member', 'Identifier'],
      \ 'Constructor': ['@constructor', 'Special'],
      \ 'Enum': ['@type', 'CocSymbolDefault'],
      \ 'Interface': ['@type', 'CocSymbolDefault'],
      \ 'Function': ['@function', 'Function'],
      \ 'Variable': ['@variable.builtin', 'Special'],
      \ 'Constant': ['@constant', 'Constant'],
      \ 'String': ['@string', 'String'],
      \ 'Number': ['@number', 'Number'],
      \ 'Boolean': ['@boolean', 'Boolean'],
      \ 'Array': ['@array', 'CocSymbolDefault'],
      \ 'Object': ['@object', 'CocSymbolDefault'],
      \ 'Key': ['@key', 'Identifier'],
      \ 'Null': ['@null', 'Type'],
      \ 'EnumMember': ['@property', 'Identifier'],
      \ 'Struct': ['@structure', 'Keyword'],
      \ 'Event': ['@constant', 'Constant'],
      \ 'Operator': ['@operator', 'Operator'],
      \ 'TypeParameter': ['@variable.parameter', 'Identifier'],
      \ }
  for [key, value] in items(symbolMap)
    let hlGroup = coc#hlgroup#valid(value[0]) ? value[0] : get(value, 1, 'CocSymbolDefault')
    if hlexists(hlGroup)
      execute 'hi default CocSymbol'.key.' '.coc#hlgroup#get_hl_command(synIDtrans(hlID(hlGroup)), 'fg', '223', '#ebdbb2')
    endif
  endfor
endfunction

function! s:ShowInfo()
  if coc#rpc#ready()
    call coc#rpc#notify('showInfo', [])
  else
    let lines = []
    echomsg 'coc.nvim service not started, checking environment...'
    let node = get(g:, 'coc_node_path', $COC_NODE_PATH == '' ? 'node' : $COC_NODE_PATH)
    if !executable(node)
      call add(lines, 'Error: '.node.' is not executable!')
    else
      let output = trim(system(node . ' --version'))
      let ms = matchlist(output, 'v\(\d\+\).\(\d\+\).\(\d\+\)')
      if empty(ms) || str2nr(ms[1]) < 16 || (str2nr(ms[1]) == 16 && str2nr(ms[2]) < 18)
        call add(lines, 'Error: Node version '.output.' < 16.18.0, please upgrade node.js')
      endif
    endif
    " check bundle
    let file = s:root.'/build/index.js'
    if !filereadable(file)
      call add(lines, 'Error: javascript bundle not found, please compile code of coc.nvim by esbuild.')
    endif
    if !empty(lines)
      botright vnew
      setl filetype=nofile
      call setline(1, lines)
    else
      if get(g:, 'coc_start_at_startup',1)
        echohl MoreMsg | echon 'Service stopped for some unknown reason, try :CocStart' | echohl None
      else
        echohl MoreMsg | echon 'Start on startup is disabled, try :CocStart' | echohl None
      endif
    endif
  endif
endfunction

function! s:CursorRangeFromSelected(type, ...) abort
  " add range by operator
  call coc#rpc#request('cursorsSelect', [bufnr('%'), 'operator', a:type])
endfunction

function! s:FormatFromSelected(type)
  call CocActionAsync('formatSelected', a:type)
endfunction

function! s:CodeActionFromSelected(type)
  call CocActionAsync('codeAction', a:type)
endfunction

function! s:CodeActionRefactorFromSelected(type)
  call CocActionAsync('codeAction', a:type, ['refactor'] ,v:true)
endfunction

command! -nargs=0 CocOutline      :call coc#rpc#notify('showOutline', [])
command! -nargs=? CocDiagnostics  :call s:OpenDiagnostics(<f-args>)
command! -nargs=0 CocInfo         :call s:ShowInfo()
command! -nargs=0 CocOpenLog      :call coc#rpc#notify('openLog',  [])
command! -nargs=0 CocDisable      :call s:Disable()
command! -nargs=0 CocEnable       :call s:Enable(0)
command! -nargs=0 CocConfig       :call s:OpenConfig()
command! -nargs=0 CocLocalConfig  :call coc#rpc#notify('openLocalConfig', [])
command! -nargs=0 CocRestart      :call coc#rpc#restart()
command! -nargs=0 CocStart        :call coc#rpc#start_server()
command! -nargs=0 CocPrintErrors  :call coc#rpc#show_errors()
command! -nargs=1 -complete=custom,s:LoadedExtensions  CocWatch    :call coc#rpc#notify('watchExtension', [<f-args>])
command! -nargs=+ -complete=custom,s:SearchOptions  CocSearch    :call coc#rpc#notify('search', [<f-args>])
command! -nargs=+ -complete=custom,s:ExtensionList  CocUninstall :call CocActionAsync('uninstallExtension', <f-args>)
command! -nargs=* -complete=custom,s:CommandList -range CocCommand :call coc#rpc#notify('runCommand', [<f-args>])
command! -nargs=* -complete=custom,coc#list#options CocList      :call coc#rpc#notify('openList',  [<f-args>])
command! -nargs=? -complete=custom,coc#list#names CocListResume   :call coc#rpc#notify('listResume', [<f-args>])
command! -nargs=? -complete=custom,coc#list#names CocListCancel   :call coc#rpc#notify('listCancel', [])
command! -nargs=? -complete=custom,coc#list#names CocPrev         :call coc#rpc#notify('listPrev', [<f-args>])
command! -nargs=? -complete=custom,coc#list#names CocNext         :call coc#rpc#notify('listNext', [<f-args>])
command! -nargs=? -complete=custom,coc#list#names CocFirst        :call coc#rpc#notify('listFirst', [<f-args>])
command! -nargs=? -complete=custom,coc#list#names CocLast         :call coc#rpc#notify('listLast', [<f-args>])
command! -nargs=0 CocUpdate       :call coc#util#update_extensions(1)
command! -nargs=0 -bar CocUpdateSync   :call coc#util#update_extensions()
command! -nargs=* -bar -complete=custom,s:InstallOptions CocInstall   :call coc#util#install_extension([<f-args>])

call s:Enable(1)
augroup coc_dynamic_autocmd
  autocmd!
augroup END
augroup coc_dynamic_content
  autocmd!
augroup END
augroup coc_dynamic_option
  autocmd!
augroup END

" Default key-mappings for completion
if empty(mapcheck('<C-n>', 'i'))
  inoremap <silent><expr> <C-n> coc#pum#visible() ? coc#pum#next(1) : coc#inline#visible() ? coc#inline#next() : "\<C-n>"
endif
if empty(mapcheck('<C-p>', 'i'))
  inoremap <silent><expr> <C-p> coc#pum#visible() ? coc#pum#prev(1) : coc#inline#visible() ? coc#inline#prev() : "\<C-p>"
endif
if empty(mapcheck('<down>', 'i'))
  inoremap <silent><expr> <down> coc#pum#visible() ? coc#pum#next(0) : coc#inline#visible() ? coc#inline#next() :"\<down>"
endif
if empty(mapcheck('<up>', 'i'))
  inoremap <silent><expr> <up> coc#pum#visible() ? coc#pum#prev(0) : coc#inline#visible() ? coc#inline#prev() :"\<up>"
endif
if empty(mapcheck('<C-e>', 'i'))
  inoremap <silent><expr> <C-e> coc#pum#visible() ? coc#pum#cancel() : coc#inline#visible() ? coc#inline#cancel() : "\<C-e>"
endif
if empty(mapcheck('<C-y>', 'i'))
  inoremap <silent><expr> <C-y> coc#pum#visible() ? coc#pum#confirm() : coc#inline#visible() ? coc#inline#accept() :"\<C-y>"
endif
if empty(mapcheck('<PageDown>', 'i'))
  inoremap <silent><expr> <PageDown> coc#pum#visible() ? coc#pum#scroll(1) : "\<PageDown>"
endif
if empty(mapcheck('<PageUp>', 'i'))
  inoremap <silent><expr> <PageUp> coc#pum#visible() ? coc#pum#scroll(0) : "\<PageUp>"
endif

vnoremap <silent> <Plug>(coc-range-select)          :<C-u>call       CocActionAsync('rangeSelect',     visualmode(), v:true)<CR>
vnoremap <silent> <Plug>(coc-range-select-backward) :<C-u>call       CocActionAsync('rangeSelect',     visualmode(), v:false)<CR>
nnoremap <Plug>(coc-range-select)                   :<C-u>call       CocActionAsync('rangeSelect',     '', v:true)<CR>
nnoremap <Plug>(coc-codelens-action)                :<C-u>call       CocActionAsync('codeLensAction')<CR>
vnoremap <silent> <Plug>(coc-format-selected)       :<C-u>call       CocActionAsync('formatSelected', visualmode())<CR>
vnoremap <silent> <Plug>(coc-codeaction-selected)   :<C-u>call       CocActionAsync('codeAction', visualmode())<CR>
vnoremap <Plug>(coc-codeaction-refactor-selected)   :<C-u>call       CocActionAsync('codeAction', visualmode(), ['refactor'], v:true)<CR>
nnoremap <Plug>(coc-codeaction-selected)            :<C-u>set        operatorfunc=<SID>CodeActionFromSelected<CR>g@
nnoremap <Plug>(coc-codeaction-refactor-selected)   :<C-u>set        operatorfunc=<SID>CodeActionRefactorFromSelected<CR>g@
nnoremap <Plug>(coc-codeaction)                     :<C-u>call       CocActionAsync('codeAction', '')<CR>
nnoremap <Plug>(coc-codeaction-line)                :<C-u>call       CocActionAsync('codeAction', 'currline')<CR>
nnoremap <Plug>(coc-codeaction-cursor)              :<C-u>call       CocActionAsync('codeAction', 'cursor')<CR>
nnoremap <Plug>(coc-codeaction-refactor)            :<C-u>call       CocActionAsync('codeAction', 'cursor', ['refactor'], v:true)<CR>
nnoremap <Plug>(coc-codeaction-source)              :<C-u>call       CocActionAsync('codeAction', '', ['source'], v:true)<CR>
nnoremap <silent> <Plug>(coc-rename)                :<C-u>call       CocActionAsync('rename')<CR>
nnoremap <silent> <Plug>(coc-format-selected)       :<C-u>set        operatorfunc=<SID>FormatFromSelected<CR>g@
nnoremap <silent> <Plug>(coc-format)                :<C-u>call       CocActionAsync('format')<CR>
nnoremap <silent> <Plug>(coc-diagnostic-info)       :<C-u>call       CocActionAsync('diagnosticInfo')<CR>
nnoremap <silent> <Plug>(coc-diagnostic-next)       :<C-u>call       CocActionAsync('diagnosticNext')<CR>
nnoremap <silent> <Plug>(coc-diagnostic-prev)       :<C-u>call       CocActionAsync('diagnosticPrevious')<CR>
nnoremap <silent> <Plug>(coc-diagnostic-next-error) :<C-u>call       CocActionAsync('diagnosticNext',     'error')<CR>
nnoremap <silent> <Plug>(coc-diagnostic-prev-error) :<C-u>call       CocActionAsync('diagnosticPrevious', 'error')<CR>
nnoremap <silent> <Plug>(coc-definition)            :<C-u>call       CocActionAsync('jumpDefinition')<CR>
nnoremap <silent> <Plug>(coc-declaration)           :<C-u>call       CocActionAsync('jumpDeclaration')<CR>
nnoremap <silent> <Plug>(coc-implementation)        :<C-u>call       CocActionAsync('jumpImplementation')<CR>
nnoremap <silent> <Plug>(coc-type-definition)       :<C-u>call       CocActionAsync('jumpTypeDefinition')<CR>
nnoremap <silent> <Plug>(coc-references)            :<C-u>call       CocActionAsync('jumpReferences')<CR>
nnoremap <silent> <Plug>(coc-references-used)       :<C-u>call       CocActionAsync('jumpUsed')<CR>
nnoremap <silent> <Plug>(coc-openlink)              :<C-u>call       CocActionAsync('openLink')<CR>
nnoremap <silent> <Plug>(coc-fix-current)           :<C-u>call       CocActionAsync('doQuickfix')<CR>
nnoremap <silent> <Plug>(coc-float-hide)            :<C-u>call       coc#float#close_all()<CR>
nnoremap <silent> <Plug>(coc-float-jump)            :<c-u>call       coc#float#jump()<cr>
nnoremap <silent> <Plug>(coc-command-repeat)        :<C-u>call       CocAction('repeatCommand')<CR>
nnoremap <silent> <Plug>(coc-refactor)              :<C-u>call       CocActionAsync('refactor')<CR>

nnoremap <silent> <Plug>(coc-cursors-operator) :<C-u>set operatorfunc=<SID>CursorRangeFromSelected<CR>g@
vnoremap <silent> <Plug>(coc-cursors-range)    :<C-u>call CocAction('cursorsSelect', bufnr('%'), 'range', visualmode())<CR>
nnoremap <silent> <Plug>(coc-cursors-word)     :<C-u>call CocAction('cursorsSelect', bufnr('%'), 'word', 'n')<CR>
nnoremap <silent> <Plug>(coc-cursors-position) :<C-u>call CocAction('cursorsSelect', bufnr('%'), 'position', 'n')<CR>

vnoremap <silent> <Plug>(coc-funcobj-i)        :<C-U>call CocAction('selectSymbolRange', v:true, visualmode(), ['Method', 'Function'])<CR>
vnoremap <silent> <Plug>(coc-funcobj-a)        :<C-U>call CocAction('selectSymbolRange', v:false, visualmode(), ['Method', 'Function'])<CR>
onoremap <silent> <Plug>(coc-funcobj-i)        :<C-U>call CocAction('selectSymbolRange', v:true, '', ['Method', 'Function'])<CR>
onoremap <silent> <Plug>(coc-funcobj-a)        :<C-U>call CocAction('selectSymbolRange', v:false, '', ['Method', 'Function'])<CR>

vnoremap <silent> <Plug>(coc-classobj-i)       :<C-U>call CocAction('selectSymbolRange', v:true, visualmode(), ['Interface', 'Struct', 'Class'])<CR>
vnoremap <silent> <Plug>(coc-classobj-a)       :<C-U>call CocAction('selectSymbolRange', v:false, visualmode(), ['Interface', 'Struct', 'Class'])<CR>
onoremap <silent> <Plug>(coc-classobj-i)       :<C-U>call CocAction('selectSymbolRange', v:true, '', ['Interface', 'Struct', 'Class'])<CR>
onoremap <silent> <Plug>(coc-classobj-a)       :<C-U>call CocAction('selectSymbolRange', v:false, '', ['Interface', 'Struct', 'Class'])<CR>
