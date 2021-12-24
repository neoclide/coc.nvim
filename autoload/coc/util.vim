scriptencoding utf-8
let s:root = expand('<sfile>:h:h:h')
let s:is_win = has('win32') || has('win64')
let s:is_vim = !has('nvim')
let s:clear_match_by_id = has('nvim-0.5.0') || has('patch-8.1.1084')
let s:vim_api_version = 11
let s:activate = ""
let s:quit = ""

if has("gui_macvim") && has('gui_running')
  let s:app = "MacVim"
elseif $TERM_PROGRAM ==# "Apple_Terminal"
  let s:app = "Terminal"
elseif $TERM_PROGRAM ==# "iTerm.app"
  let s:app = "iTerm2"
elseif has('mac')
  let s:app = "System Events"
  let s:quit = "quit"
  let s:activate = 'activate'
endif

function! coc#util#api_version() abort
  return s:vim_api_version
endfunction

" get cursor position
function! coc#util#cursor()
  return [line('.') - 1, strchars(strpart(getline('.'), 0, col('.') - 1))]
endfunction

function! coc#util#has_preview()
  for i in range(1, winnr('$'))
    if getwinvar(i, '&previewwindow')
      return i
    endif
  endfor
  return 0
endfunction

function! coc#util#jumpTo(line, character) abort
  echohl WarningMsg | echon 'coc#util#jumpTo is deprecated, use coc#cursor#move_to instead.' | echohl None
  call coc#cursor#move_to(a:line, a:character)
endfunction

function! coc#util#path_replace_patterns() abort
  if has('win32unix') && exists('g:coc_cygqwin_path_prefixes')
    echohl WarningMsg 
    echon 'g:coc_cygqwin_path_prefixes is deprecated, use g:coc_uri_prefix_replace_patterns instead' 
    echohl None
    return g:coc_cygqwin_path_prefixes
  endif
  if exists('g:coc_uri_prefix_replace_patterns')
    return g:coc_uri_prefix_replace_patterns
  endif
  return v:null
endfunction

function! coc#util#version()
  if s:is_vim
    return string(v:versionlong)
  endif
  let c = execute('silent version')
  let lines = split(matchstr(c,  'NVIM v\zs[^\n-]*'))
  return lines[0]
endfunction

function! coc#util#check_refresh(bufnr)
  if !bufloaded(a:bufnr)
    return 0
  endif
  if getbufvar(a:bufnr, 'coc_diagnostic_disable', 0)
    return 0
  endif
  if get(g: , 'EasyMotion_loaded', 0)
    return EasyMotion#is_active() != 1
  endif
  return 1
endfunction

function! coc#util#diagnostic_info(bufnr, checkInsert) abort
  let checked = coc#util#check_refresh(a:bufnr)
  if !checked
    return v:null
  endif
  if a:checkInsert && mode() =~# '^i'
    return v:null
  endif
  let locationlist = ''
  let winid = -1
  for info in getwininfo()
    if info['bufnr'] == a:bufnr
      let winid = info['winid']
      let locationlist = get(getloclist(winid, {'title': 1}), 'title', '')
      break
    endif
  endfor
  return {
      \ 'bufnr': bufnr('%'),
      \ 'winid': winid,
      \ 'lnum': line('.'),
      \ 'locationlist': locationlist
      \ }
endfunction

function! coc#util#open_file(cmd, file)
  let file = fnameescape(a:file)
  execute a:cmd .' '.file
endfunction

function! coc#util#remote_fns(name)
  let fns = ['init', 'complete', 'should_complete', 'refresh', 'get_startcol', 'on_complete', 'on_enter']
  let res = []
  for fn in fns
    if exists('*coc#source#'.a:name.'#'.fn)
      call add(res, fn)
    endif
  endfor
  return res
endfunction

function! coc#util#job_command()
  if (has_key(g:, 'coc_node_path'))
    let node = expand(g:coc_node_path)
  else
    let node = $COC_NODE_PATH == '' ? 'node' : $COC_NODE_PATH
  endif
  if !executable(node)
    echohl Error | echom '[coc.nvim] "'.node.'" is not executable, checkout https://nodejs.org/en/download/' | echohl None
    return
  endif
  if !filereadable(s:root.'/build/index.js')
    if isdirectory(s:root.'/src')
      echohl Error | echom '[coc.nvim] build/index.js not found, please install dependencies and compile coc.nvim by: yarn install' | echohl None
    else
      echohl Error | echon '[coc.nvim] your coc.nvim is broken.' | echohl None
    endif
    return
  endif
  return [node] + get(g:, 'coc_node_args', ['--no-warnings']) + [s:root.'/build/index.js']
endfunction

function! coc#util#echo_hover(msg)
  echohl MoreMsg
  echo a:msg
  echohl None
  let g:coc_last_hover_message = a:msg
endfunction

function! coc#util#jump(cmd, filepath, ...) abort
  if a:cmd != 'pedit'
    silent! normal! m'
  endif
  let path = a:filepath
  if (has('win32unix'))
    let path = substitute(a:filepath, '\v\\', '/', 'g')
  endif
  let file = fnamemodify(path, ":~:.")
  if a:cmd == 'pedit'
    let extra = empty(get(a:, 1, [])) ? '' : '+'.(a:1[0] + 1)
    exe 'pedit '.extra.' '.fnameescape(file)
    return
  elseif a:cmd == 'drop' && exists('*bufadd')
    let dstbuf = bufadd(path)
    let binfo = getbufinfo(dstbuf)
    if len(binfo) == 1 && empty(binfo[0].windows)
      exec 'buffer '.dstbuf
      let &buflisted = 1
    else
      exec 'drop '.fnameescape(file)
    endif
  else
    exe a:cmd.' '.fnameescape(file)
  endif
  if !empty(get(a:, 1, []))
    let line = getline(a:1[0] + 1)
    " TODO need to use utf16 here
    let col = byteidx(line, a:1[1]) + 1
    if col == 0
      let col = 999
    endif
    call cursor(a:1[0] + 1, col)
  endif
  if &filetype ==# ''
    filetype detect
  endif
  if s:is_vim
    redraw
  endif
endfunction

function! coc#util#echo_messages(hl, msgs)
  if a:hl !~# 'Error' && (mode() !~# '\v^(i|n)$')
    return
  endif
  let msgs = filter(copy(a:msgs), '!empty(v:val)')
  if empty(msgs)
    return
  endif
  execute 'echohl '.a:hl
  echom a:msgs[0]
  redraw
  echo join(msgs, "\n")
  echohl None
endfunction

function! coc#util#echo_lines(lines)
  echo join(a:lines, "\n")
endfunction

function! coc#util#timer(method, args)
  call timer_start(0, { -> s:Call(a:method, a:args)})
endfunction

function! s:Call(method, args)
  try
    call call(a:method, a:args)
    redraw
  catch /.*/
    return 0
  endtry
endfunction

function! coc#util#get_bufoptions(bufnr, maxFileSize) abort
  if !bufloaded(a:bufnr) | return v:null | endif
  let bufname = bufname(a:bufnr)
  let buftype = getbufvar(a:bufnr, '&buftype')
  let winid = bufwinid(a:bufnr)
  let size = -1
  if bufnr('%') == a:bufnr
    let size = line2byte(line("$") + 1)
  elseif !empty(bufname)
    let size = getfsize(bufname)
  endif
  let lines = []
  if getbufvar(a:bufnr, 'coc_enabled', 1) && (buftype == '' || buftype == 'acwrite') && size < a:maxFileSize
    let lines = getbufline(a:bufnr, 1, '$')
  endif
  return {
        \ 'bufname': bufname,
        \ 'size': size,
        \ 'buftype': buftype,
        \ 'winid': winid,
        \ 'previewwindow': v:false,
        \ 'variables': s:variables(a:bufnr),
        \ 'fullpath': empty(bufname) ? '' : fnamemodify(bufname, ':p'),
        \ 'eol': getbufvar(a:bufnr, '&eol'),
        \ 'filetype': getbufvar(a:bufnr, '&filetype'),
        \ 'iskeyword': getbufvar(a:bufnr, '&iskeyword'),
        \ 'changedtick': getbufvar(a:bufnr, 'changedtick'),
        \ 'lines': lines,
        \}
endfunction

function! s:variables(bufnr) abort
  let info = getbufinfo(a:bufnr)
  let variables = empty(info) ? {} : copy(info[0]['variables'])
  for key in keys(variables)
    if key !~# '\v^coc'
      unlet variables[key]
    endif
  endfor
  return variables
endfunction

function! coc#util#root_patterns() abort
  return coc#rpc#request('rootPatterns', [bufnr('%')])
endfunction

function! coc#util#get_config(key) abort
  return coc#rpc#request('getConfig', [a:key])
endfunction

function! coc#util#preview_info(info, filetype, ...) abort
  pclose
  keepalt new +setlocal\ previewwindow|setlocal\ buftype=nofile|setlocal\ noswapfile|setlocal\ wrap [Document]
  setl bufhidden=wipe
  setl nobuflisted
  setl nospell
  exe 'setl filetype='.a:filetype
  setl conceallevel=0
  setl nofoldenable
  for command in a:000
    execute command
  endfor
  let lines = a:info
  call append(0, lines)
  exe "normal! z" . len(lines) . "\<cr>"
  exe "normal! gg"
  wincmd p
endfunction

function! coc#util#get_config_home()
  if !empty(get(g:, 'coc_config_home', ''))
      return resolve(expand(g:coc_config_home))
  endif
  if exists('$VIMCONFIG')
    return resolve($VIMCONFIG)
  endif
  if has('nvim')
    if exists('$XDG_CONFIG_HOME')
      return resolve($XDG_CONFIG_HOME."/nvim")
    endif
    if s:is_win
      return resolve($HOME.'/AppData/Local/nvim')
    endif
    return resolve($HOME.'/.config/nvim')
  else
    if s:is_win
      return resolve($HOME."/vimfiles")
    endif
    return resolve($HOME.'/.vim')
  endif
endfunction

function! coc#util#get_data_home()
  if !empty(get(g:, 'coc_data_home', ''))
    let dir = resolve(expand(g:coc_data_home))
  else
    if exists('$XDG_CONFIG_HOME')
      let dir = resolve($XDG_CONFIG_HOME."/coc")
    else
      if s:is_win
        let dir = resolve(expand('~/AppData/Local/coc'))
      else
        let dir = resolve(expand('~/.config/coc'))
      endif
    endif
  endif
  if !isdirectory(dir)
    echohl MoreMsg | echom '[coc.nvim] creating data directory: '.dir | echohl None
    call mkdir(dir, "p", 0755)
  endif
  return dir
endfunction

function! coc#util#get_input()
  let before = strpart(getline('.'), 0, col('.')-1)
  if len(before) == 0
    return ''
  endif
  return matchstr(before, '\k*$')
endfunction

function! coc#util#get_complete_option()
  let pos = getcurpos()
  let line = getline(pos[1])
  let input = matchstr(strpart(line, 0, pos[2] - 1), '\k*$')
  let col = pos[2] - strlen(input)
  let synname = synIDattr(synID(pos[1], col, 1), 'name')
  return {
        \ 'word': matchstr(strpart(line, col - 1), '^\k\+'),
        \ 'input': empty(input) ? '' : input,
        \ 'line': line,
        \ 'filetype': &filetype,
        \ 'filepath': expand('%:p'),
        \ 'bufnr': bufnr('%'),
        \ 'linenr': pos[1],
        \ 'colnr' : pos[2],
        \ 'col': col - 1,
        \ 'synname': synname,
        \ 'changedtick': b:changedtick,
        \ 'blacklist': get(b:, 'coc_suggest_blacklist', []),
        \ 'indentkeys': coc#util#get_indentkeys()
        \}
endfunction

function! coc#util#with_callback(method, args, cb)
  function! s:Cb() closure
    try
      let res = call(a:method, a:args)
      call a:cb(v:null, res)
    catch /.*/
      call a:cb(v:exception)
    endtry
  endfunction
  let timeout = s:is_vim ? 10 : 0
  call timer_start(timeout, {-> s:Cb() })
endfunction

function! coc#util#quickpick(title, items, cb) abort
  if exists('*popup_menu')
    function! s:QuickpickHandler(id, result) closure
      call a:cb(v:null, a:result)
    endfunction
    function! s:QuickpickFilter(id, key) closure
      for i in range(1, len(a:items))
        if a:key == string(i)
          call popup_close(a:id, i)
          return 1
        endif
      endfor
      " No shortcut, pass to generic filter
      return popup_filter_menu(a:id, a:key)
    endfunction
    try
      call popup_menu(a:items, {
        \ 'title': a:title,
        \ 'filter': function('s:QuickpickFilter'),
        \ 'callback': function('s:QuickpickHandler'),
        \ })
      redraw
    catch /.*/
      call a:cb(v:exception)
    endtry
  else
    let res = inputlist([a:title] + a:items)
    call a:cb(v:null, res)
  endif
endfunction

function! coc#util#echo_signatures(signatures) abort
  if pumvisible() | return | endif
  echo ""
  for i in range(len(a:signatures))
    call s:echo_signature(a:signatures[i])
    if i != len(a:signatures) - 1
      echon "\n"
    endif
  endfor
endfunction

function! s:echo_signature(parts)
  for part in a:parts
    let hl = get(part, 'type', 'Normal')
    let text = get(part, 'text', '')
    if !empty(text)
      execute 'echohl '.hl
      execute "echon '".substitute(text, "'", "''", 'g')."'"
      echohl None
    endif
  endfor
endfunction

function! coc#util#setline(lnum, line)
  keepjumps call setline(a:lnum, a:line)
endfunction

" cmd, cwd
function! coc#util#open_terminal(opts) abort
  if s:is_vim && !exists('*term_start')
    echohl WarningMsg | echon "Your vim doesn't have terminal support!" | echohl None
    return
  endif
  if get(a:opts, 'position', 'bottom') ==# 'bottom'
    let p = '5new'
  else
    let p = 'vnew'
  endif
  execute 'belowright '.p.' +setl\ buftype=nofile '
  setl buftype=nofile
  setl winfixheight
  setl norelativenumber
  setl nonumber
  setl bufhidden=wipe
  if exists('#User#CocTerminalOpen')
    exe 'doautocmd <nomodeline> User CocTerminalOpen'
  endif
  let cmd = get(a:opts, 'cmd', '')
  let autoclose = get(a:opts, 'autoclose', 1)
  if empty(cmd)
    throw 'command required!'
  endif
  let cwd = get(a:opts, 'cwd', getcwd())
  let keepfocus = get(a:opts, 'keepfocus', 0)
  let bufnr = bufnr('%')
  let Callback = get(a:opts, 'Callback', v:null)

  function! s:OnExit(status) closure
    let content = join(getbufline(bufnr, 1, '$'), "\n")
    if a:status == 0 && autoclose == 1
      execute 'silent! bd! '.bufnr
    endif
    if !empty(Callback)
      call call(Callback, [a:status, bufnr, content])
    endif
  endfunction

  if has('nvim')
    call termopen(cmd, {
          \ 'cwd': cwd,
          \ 'on_exit': {job, status -> s:OnExit(status)},
          \})
  else
    if s:is_win
      let cmd = 'cmd.exe /C "'.cmd.'"'
    endif
    call term_start(cmd, {
          \ 'cwd': cwd,
          \ 'exit_cb': {job, status -> s:OnExit(status)},
          \ 'curwin': 1,
          \})
  endif
  if keepfocus
    wincmd p
  endif
  return bufnr
endfunction

" run command in terminal
function! coc#util#run_terminal(opts, cb)
  let cmd = get(a:opts, 'cmd', '')
  if empty(cmd)
    return a:cb('command required for terminal')
  endif
  let opts = {
        \ 'cmd': cmd,
        \ 'cwd': get(a:opts, 'cwd', getcwd()),
        \ 'keepfocus': get(a:opts, 'keepfocus', 0),
        \ 'Callback': {status, bufnr, content -> a:cb(v:null, {'success': status == 0 ? v:true : v:false, 'bufnr': bufnr, 'content': content})}
        \}
  call coc#util#open_terminal(opts)
endfunction

function! coc#util#getpid()
  if !has('win32unix')
    return getpid()
  endif
  let cmd = 'cat /proc/' . getpid() . '/winpid'
  return substitute(system(cmd), '\v\n', '', 'gi')
endfunction

function! coc#util#vim_info()
  return {
        \ 'apiversion': s:vim_api_version,
        \ 'mode': mode(),
        \ 'floating': has('nvim') && exists('*nvim_open_win') ? v:true : v:false,
        \ 'extensionRoot': coc#util#extension_root(),
        \ 'globalExtensions': get(g:, 'coc_global_extensions', []),
        \ 'config': get(g:, 'coc_user_config', {}),
        \ 'pid': coc#util#getpid(),
        \ 'columns': &columns,
        \ 'lines': &lines,
        \ 'cmdheight': &cmdheight,
        \ 'filetypeMap': get(g:, 'coc_filetype_map', {}),
        \ 'version': coc#util#version(),
        \ 'completeOpt': &completeopt,
        \ 'pumevent': exists('##MenuPopupChanged') || exists('##CompleteChanged'),
        \ 'isVim': has('nvim') ? v:false : v:true,
        \ 'isCygwin': has('win32unix') ? v:true : v:false,
        \ 'isMacvim': has('gui_macvim') ? v:true : v:false,
        \ 'isiTerm': $TERM_PROGRAM ==# "iTerm.app",
        \ 'colorscheme': get(g:, 'colors_name', ''),
        \ 'workspaceFolders': get(g:, 'WorkspaceFolders', v:null),
        \ 'background': &background,
        \ 'runtimepath': join(globpath(&runtimepath, '', 0, 1), ','),
        \ 'locationlist': get(g:,'coc_enable_locationlist', 1),
        \ 'progpath': v:progpath,
        \ 'guicursor': &guicursor,
        \ 'updateHighlight': has('nvim-0.5.0') || exists('*prop_list') ? v:true : v:false,
        \ 'vimCommands': get(g:, 'coc_vim_commands', []),
        \ 'sign': exists('*sign_place') && exists('*sign_unplace'),
        \ 'textprop': has('textprop') && has('patch-8.1.1719') && !has('nvim') ? v:true : v:false,
        \ 'dialog': has('nvim-0.4.0') || has('patch-8.2.0750') ? v:true : v:false,
        \ 'disabledSources': get(g:, 'coc_sources_disable_map', {}),
        \}
endfunction

function! coc#util#highlight_options()
  return {
        \ 'colorscheme': get(g:, 'colors_name', ''),
        \ 'background': &background,
        \ 'runtimepath': join(globpath(&runtimepath, '', 0, 1), ','),
        \}
endfunction

function! coc#util#set_lines(bufnr, changedtick, original, replacement, start, end) abort
  if !bufloaded(a:bufnr)
    return
  endif
  if getbufvar(a:bufnr, 'changedtick') != a:changedtick && bufnr('%') == a:bufnr
    " try apply current line change
    let lnum = line('.')
    let idx = a:start - lnum + 1
    let previous = get(a:original, idx, 0)
    if type(previous) == 1
      let content = getline('.')
      if previous !=# content
        let diff = coc#helper#str_diff(content, previous, col('.'))
        let changed = get(a:replacement, idx, 0)
        if type(changed) == 1 && strcharpart(previous, 0, diff['end']) ==# strcharpart(changed, 0, diff['end'])
          let applied = coc#helper#str_apply(changed, diff)
          let replacement = copy(a:replacement)
          let replacement[idx] = applied
          call coc#compat#buf_set_lines(a:bufnr, a:start, a:end, replacement)
          return
        endif
      endif
    endif
  endif
  call coc#compat#buf_set_lines(a:bufnr, a:start, a:end, a:replacement)
endfunction

function! coc#util#change_lines(bufnr, list) abort
  if !bufloaded(a:bufnr) | return v:null | endif
  undojoin
  if exists('*setbufline')
    for [lnum, line] in a:list
      call setbufline(a:bufnr, lnum + 1, line)
    endfor
  elseif a:bufnr == bufnr('%')
    for [lnum, line] in a:list
      call setline(lnum + 1, line)
    endfor
  else
    let bufnr = bufnr('%')
    exe 'noa buffer '.a:bufnr
    for [lnum, line] in a:list
      call setline(lnum + 1, line)
    endfor
    exe 'noa buffer '.bufnr
  endif
endfunction


" used by vim
function! coc#util#get_buf_lines(bufnr, changedtick)
  if !bufloaded(a:bufnr) 
    return v:null
  endif
  let changedtick = getbufvar(a:bufnr, 'changedtick')
  if changedtick == a:changedtick
    return v:null
  endif
  return {
        \ 'lines': getbufline(a:bufnr, 1, '$'),
        \ 'changedtick': getbufvar(a:bufnr, 'changedtick')
        \ }
endfunction

" used for TextChangedI with InsertCharPre
function! coc#util#get_changeinfo()
  return {
        \ 'lnum': line('.'),
        \ 'line': getline('.'),
        \ 'changedtick': b:changedtick,
        \}
endfunction

function! coc#util#open_url(url)
  if has('mac') && executable('open')
    call system('open '.a:url)
    return
  endif
  if executable('xdg-open')
    call system('xdg-open '.a:url)
    return
  endif
  call system('cmd /c start "" /b '. substitute(a:url, '&', '^&', 'g'))
  if v:shell_error
    echohl Error | echom 'Failed to open '.a:url | echohl None
    return
  endif
endfunction

function! coc#util#install() abort
  let yarncmd = get(g:, 'coc_install_yarn_cmd', executable('yarnpkg') ? 'yarnpkg' : 'yarn')
  call coc#util#open_terminal({
        \ 'cwd': s:root,
        \ 'cmd': yarncmd.' install --frozen-lockfile --ignore-engines',
        \ 'autoclose': 0,
        \ })
endfunction

function! coc#util#do_complete(name, opt, cb) abort
  let handler = 'coc#source#'.a:name.'#complete'
  let l:Cb = {res -> a:cb(v:null, res)}
  let args = [a:opt, l:Cb]
  call call(handler, args)
endfunction

function! coc#util#extension_root() abort
  if get(g:, 'coc_node_env', '') ==# 'test'
    return s:root.'/src/__tests__/extensions'
  endif
  if !empty(get(g:, 'coc_extension_root', ''))
    echohl Error | echon 'g:coc_extension_root not used any more, use g:coc_data_home instead' | echohl None
  endif
  return coc#util#get_data_home().'/extensions'
endfunction

function! coc#util#update_extensions(...) abort
  let async = get(a:, 1, 0)
  if async
    call coc#rpc#notify('updateExtensions', [])
  else
    call coc#rpc#request('updateExtensions', [v:true])
  endif
endfunction

function! coc#util#install_extension(args) abort
  let names = filter(copy(a:args), 'v:val !~# "^-"')
  let isRequest = index(a:args, '-sync') != -1
  if isRequest
    call coc#rpc#request('installExtensions', names)
  else
    call coc#rpc#notify('installExtensions', names)
  endif
endfunction

function! coc#util#do_autocmd(name) abort
  if exists('#User#'.a:name)
    exe 'doautocmd <nomodeline> User '.a:name
  endif
endfunction

function! coc#util#rebuild()
  let dir = coc#util#extension_root()
  if !isdirectory(dir) | return | endif
  call coc#util#open_terminal({
        \ 'cwd': dir,
        \ 'cmd': 'npm rebuild',
        \ 'keepfocus': 1,
        \})
endfunction

" [r, g, b] ['255', '255', '255']
" return ['65535', '65535', '65535'] or return v:false to cancel
function! coc#util#pick_color(default_color)
  if has('mac')
    let default_color = map(a:default_color, {idx, val -> str2nr(val) * 65535 / 255 })
    " This is the AppleScript magic:
    let s:ascrpt = ['-e "tell application \"' . s:app . '\""',
          \ '-e "' . s:activate . '"',
          \ "-e \"set AppleScript's text item delimiters to {\\\",\\\"}\"",
          \ '-e "set theColor to (choose color default color {' . default_color[0] . ", " . default_color[1] . ", " . default_color[2] . '}) as text"',
          \ '-e "' . s:quit . '"',
          \ '-e "end tell"',
          \ '-e "return theColor"']
    let res = trim(system("osascript " . join(s:ascrpt, ' ') . " 2>/dev/null"))
    if empty(res)
      return v:false
    else
      return split(trim(res), ',')
    endif
  endif

  let hex_color = printf('#%02x%02x%02x', a:default_color[0], a:default_color[1], a:default_color[2])

  if has('unix')
    if executable('zenity')
      let res = trim(system('zenity --title="Select a color" --color-selection --color="' . hex_color . '" 2> /dev/null'))
      if empty(res)
        return v:false
      else
        " res format is rgb(255,255,255)
        return map(split(res[4:-2], ','), {idx, val -> string(str2nr(trim(val)) * 65535 / 255)})
      endif
    endif
  endif

  let rgb = v:false
  if !has('python')
    echohl Error | echom 'python support required, checkout :echo has(''python'')' | echohl None
    return
  endif
  try
    execute 'py import gtk'
  catch /.*/
    echohl Error | echom 'python gtk module not found' | echohl None
    return
  endtry
python << endpython

import vim
import gtk, sys

# message strings
wnd_title_insert = "Insert a color"

csd = gtk.ColorSelectionDialog(wnd_title_insert)
cs = csd.colorsel

cs.set_current_color(gtk.gdk.color_parse(vim.eval("hex_color")))

cs.set_current_alpha(65535)
cs.set_has_opacity_control(False)
# cs.set_has_palette(int(vim.eval("s:display_palette")))

if csd.run()==gtk.RESPONSE_OK:
    c = cs.get_current_color()
    s = [str(int(c.red)),',',str(int(c.green)),',',str(int(c.blue))]
    thecolor = ''.join(s)
    vim.command(":let rgb = split('%s',',')" % thecolor)

csd.destroy()

endpython
  return rgb
endfunction

function! coc#util#iterm_open(dir)
  return s:osascript(
      \ 'if application "iTerm2" is not running',
      \   'error',
      \ 'end if') && s:osascript(
      \ 'tell application "iTerm2"',
      \   'tell current window',
      \     'create tab with default profile',
      \     'tell current session',
      \       'write text "cd ' . a:dir . '"',
      \       'write text "clear"',
      \       'activate',
      \     'end tell',
      \   'end tell',
      \ 'end tell')
endfunction

function! s:osascript(...) abort
  let args = join(map(copy(a:000), '" -e ".shellescape(v:val)'), '')
  call  s:system('osascript'. args)
  return !v:shell_error
endfunction

function! s:system(cmd)
  let output = system(a:cmd)
  if v:shell_error && output !=# ""
    echohl Error | echom output | echohl None
    return
  endif
  return output
endfunction

function! coc#util#unmap(bufnr, keys) abort
  if bufnr('%') == a:bufnr
    for key in a:keys
      exe 'silent! nunmap <buffer> '.key
    endfor
  endif
endfunction

function! coc#util#open_files(files)
  let bufnrs = []
  " added on latest vim8
  if exists('*bufadd') && exists('*bufload')
    for file in a:files
      let file = fnamemodify(file, ':.')
      if bufloaded(file)
        call add(bufnrs, bufnr(file))
      else
        let bufnr = bufadd(file)
        call bufload(file)
        call add(bufnrs, bufnr)
        call setbufvar(bufnr, '&buflisted', 1)
      endif
    endfor
  else
    noa keepalt 1new +setl\ bufhidden=wipe
    for file in a:files
      let file = fnamemodify(file, ':.')
      execute 'noa edit +setl\ bufhidden=hide '.fnameescape(file)
      if &filetype ==# ''
        filetype detect
      endif
      call add(bufnrs, bufnr('%'))
    endfor
    noa close
  endif
  doautocmd BufEnter
  return bufnrs
endfunction

function! coc#util#refactor_foldlevel(lnum) abort
  if a:lnum <= 2 | return 0 | endif
  let line = getline(a:lnum)
  if line =~# '^\%u3000\s*$' | return 0 | endif
  return 1
endfunction

function! coc#util#refactor_fold_text(lnum) abort
  let range = ''
  let info = get(b:line_infos, a:lnum, [])
  if !empty(info)
    let range = info[0].':'.info[1]
  endif
  return trim(getline(a:lnum)[3:]).' '.range
endfunction

" get tabsize & expandtab option
function! coc#util#get_format_opts(bufnr) abort
  if a:bufnr && bufloaded(a:bufnr)
    let tabsize = getbufvar(a:bufnr, '&shiftwidth')
    if tabsize == 0
      let tabsize = getbufvar(a:bufnr, '&tabstop')
    endif
    return [tabsize, getbufvar(a:bufnr, '&expandtab')]
  endif
  let tabsize = &shiftwidth == 0 ? &tabstop : &shiftwidth
  return [tabsize, &expandtab]
endfunction

" Get indentkeys for indent on TextChangedP, consider = for word indent only.
function! coc#util#get_indentkeys() abort
  if empty(&indentexpr)
    return ''
  endif
  if &indentkeys !~# '='
    return ''
  endif
  return &indentkeys
endfunction
