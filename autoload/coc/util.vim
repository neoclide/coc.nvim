let s:root = expand('<sfile>:h:h:h')
let s:is_win = has('win32') || has('win64')
let s:is_vim = !has('nvim')
let s:install_yarn = 0
let s:package_file = s:root.'/package.json'

let s:activate = ""
let s:quit = ""
if has("gui_macvim") && has('gui_running')
  let s:app = "MacVim"
elseif $TERM_PROGRAM ==# "Apple_Terminal"
  let s:app = "Terminal"
elseif $TERM_PROGRAM ==# "iTerm.app"
  let s:app = "iTerm"
elseif has('mac')
  let s:app = "System Events"
  let s:quit = "quit"
  let s:activate = 'activate'
endif

function! coc#util#has_preview()
  for i in range(1, winnr('$'))
    if getwinvar(i, '&previewwindow')
      return i
    endif
  endfor
  return 0
endfunction

function! coc#util#has_float()
  for i in range(1, winnr('$'))
    if getwinvar(i, 'float')
      return 1
    endif
  endfor
  return 0
endfunction

function! coc#util#get_float()
  for i in range(1, winnr('$'))
    if getwinvar(i, 'float')
      return win_getid(i)
    endif
  endfor
  return 0
endfunction

function! coc#util#float_hide()
  for i in range(1, winnr('$'))
    if getwinvar(i, 'float')
      let winid = win_getid(i)
      call coc#util#close_win(winid)
    endif
  endfor
endfunction

function! coc#util#float_jump()
  for i in range(1, winnr('$'))
    if getwinvar(i, 'float')
      exe i.'wincmd w'
      return
    endif
  endfor
endfunction

function! coc#util#float_scrollable()
  let winnr = winnr()
  for i in range(1, winnr('$'))
    if getwinvar(i, 'float')
      let wid = win_getid(i)
      let h = nvim_win_get_height(wid)
      let buf = nvim_win_get_buf(wid)
      let lineCount = nvim_buf_line_count(buf)
      return lineCount > h
    endif
  endfor
  return 0
endfunction

function! coc#util#float_scroll(forward)
  let key = a:forward ? "\<C-f>" : "\<C-b>"
  let winnr = winnr()
  for i in range(1, winnr('$'))
    if getwinvar(i, 'float')
      return i."\<C-w>w".key."\<C-w>p"
    endif
  endfor
  return ""
endfunction

function! coc#util#yarn_cmd()
  if executable('yarnpkg')
    return 'yarnpkg'
  endif
  if executable('yarn')
    return 'yarn'
  endif
  return ''
endfunction

" get cursor position
function! coc#util#cursor()
  let pos = getcurpos()
  let content = pos[2] == 1 ? '' : getline('.')[0: pos[2] - 2]
  return [pos[1] - 1, strchars(content)]
endfunction

function! coc#util#close_win(id)
  if exists('*nvim_win_close')
    if nvim_win_is_valid(a:id)
      call nvim_win_close(a:id, 1)
    endif
  else
    let winnr = win_id2win(a:id)
    if winnr > 0
      execute winnr.'close!'
    endif
  endif
endfunction

function! coc#util#win_position()
  let nr = winnr()
  let [row, col] = win_screenpos(nr)
  return [row + winline() - 2, col + wincol() - 2]
endfunction

function! coc#util#close_popup()
  for winnr in range(1, winnr('$'))
    let popup = getwinvar(winnr, 'popup')
    if !empty(popup)
      exe winnr.'close!'
    endif
  endfor
endfunction

function! coc#util#version()
  let c = execute('version')
  return matchstr(c, 'NVIM v\zs[^\n-]*')
endfunction

function! coc#util#valid_state()
  if s:is_vim && mode() !=# 'n'
    return 0
  endif
  if get(g: , 'EasyMotion_loaded', 0)
    let line = coc#util#echo_line()
    return line !~# 'Target key'
  endif
  return 1
endfunction

function! coc#util#open_file(cmd, file)
  let file = fnameescape(a:file)
  execute a:cmd .' '.file
endfunction

function! coc#util#platform()
  if s:is_win
    return 'windows'
  endif
  if has('mac') || has('macvim')
    return 'mac'
  endif
  return 'linux'
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
  let node = get(g:, 'coc_node_path', 'node')
  if !executable(node)
    echohl Error | echon '[coc.nvim] '.node.' is not executable' | echohl None
    return
  endif
  let file = s:root.'/build/index.js'
  if filereadable(file) && !get(g:, 'coc_force_debug', 0)
    return [node] + get(g:, 'coc_node_args', ['--no-warnings']) + [s:root.'/build/index.js']
  endif
  let file = s:root.'/lib/attach.js'
  if !filereadable(file)
    echohl Error | echon '[coc.nvim] compiled javascript file not found!' | echohl None
    return
  endif
  return [node] + get(g:, 'coc_node_args', ['--no-warnings']) + [s:root.'/bin/server.js']
endfunction

function! coc#util#echo_hover(msg)
  echohl MoreMsg
  echo a:msg
  echohl None
  let g:coc_last_hover_message = a:msg
endfunction

function! coc#util#execute(cmd)
  exe a:cmd
  if &l:filetype ==# ''
    filetype detect
  endif
  if s:is_vim
    redraw!
  endif
endfunction

function! coc#util#echo_messages(hl, msgs)
  if empty(a:msgs) | return | endif
  if pumvisible() | return | endif
  execute 'echohl '.a:hl
  let msgs = copy(a:msgs)
  for msg in msgs
    if !empty(msg)
      echom msg
    endif
  endfor
  echohl None
  redraw
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

function! coc#util#is_preview(bufnr)
  let wnr = bufwinnr(a:bufnr)
  if wnr == -1 | return 0 | endif
  return getwinvar(wnr, '&previewwindow')
endfunction

function! coc#util#get_bufoptions(bufnr) abort
  if !bufloaded(a:bufnr) | return v:null | endif
  let bufname = bufname(a:bufnr)
  return {
        \ 'bufname': bufname,
        \ 'eol': getbufvar(a:bufnr, '&eol'),
        \ 'fullpath': empty(bufname) ? '' : fnamemodify(bufname, ':p'),
        \ 'buftype': getbufvar(a:bufnr, '&buftype'),
        \ 'filetype': getbufvar(a:bufnr, '&filetype'),
        \ 'iskeyword': getbufvar(a:bufnr, '&iskeyword'),
        \ 'changedtick': getbufvar(a:bufnr, 'changedtick'),
        \ 'rootPatterns': getbufvar(a:bufnr, 'coc_root_patterns', v:null),
        \}
endfunction

function! coc#util#root_patterns()
  return coc#rpc#request('rootPatterns', [bufnr('%')])
endfunction

function! coc#util#on_error(msg) abort
  echohl Error | echom '[coc.nvim] '.a:msg | echohl None
endfunction

function! coc#util#preview_info(info, ...) abort
  pclose
  keepalt new +setlocal\ previewwindow|setlocal\ buftype=nofile|setlocal\ noswapfile|setlocal\ wrap [Document]
  setl bufhidden=wipe
  setl nobuflisted
  setl nospell
  setl filetype=markdown
  setl conceallevel=2
  setl nofoldenable
  let lines = a:info
  call append(0, lines)
  exe "normal! z" . len(lines) . "\<cr>"
  exe "normal! gg"
  wincmd p
endfunction

function! coc#util#get_config_home()
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

function! coc#util#get_input()
  let pos = getcurpos()
  let line = getline('.')
  let l:start = pos[2] - 1
  while l:start > 0 && line[l:start - 1] =~# '\k'
    let l:start -= 1
  endwhile
  return pos[2] == 1 ? '' : line[l:start : pos[2] - 2]
endfunction

function! coc#util#move_cursor(delta)
  let pos = getcurpos()
  call cursor(pos[1], pos[2] + a:delta)
endfunction

function! coc#util#get_complete_option()
  let disabled = get(b:, 'coc_suggest_disable', 0)
  if disabled | return | endif
  let blacklist = get(b:, 'coc_suggest_blacklist', [])
  let pos = getcurpos()
  let l:start = pos[2] - 1
  let line = getline(pos[1])
  for char in reverse(split(line[0: l:start - 1], '\zs'))
    if l:start > 0 && char =~# '\k'
      let l:start = l:start - strlen(char)
    else
      break
    endif
  endfor
  let input = pos[2] == 1 ? '' : line[l:start : pos[2] - 2]
  if !empty(blacklist) && index(blacklist, input) >= 0
    return
  endif
  return {
        \ 'word': matchstr(line[l:start : ], '^\k\+'),
        \ 'input': input,
        \ 'line': line,
        \ 'filetype': &filetype,
        \ 'filepath': expand('%:p'),
        \ 'bufnr': bufnr('%'),
        \ 'linenr': pos[1],
        \ 'colnr' : pos[2],
        \ 'col': l:start,
        \ 'synname': synIDattr(synID(pos[1], l:start, 1),"name"),
        \ 'blacklist': blacklist,
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
  let timeout = s:is_vim ? 500 : 0
  call timer_start(timeout, {-> s:Cb() })
endfunction

function! coc#util#add_matchids(ids)
  let w:coc_matchids = get(w:, 'coc_matchids', []) + a:ids
endfunction

function! coc#util#prompt_confirm(title)
  if exists('*confirm') && !s:is_vim
    let choice = confirm(a:title, "&Yes\n&No")
    return choice == 1
  else
    echohl MoreMsg
    echom a:title.' (y/n)'
    echohl None
    let confirm = nr2char(getchar())
    redraw!
    if !(confirm ==? "y" || confirm ==? "\r")
      echohl Moremsg | echo 'Cancelled.' | echohl None
      return 0
    end
    return 1
  endif
endfunction

function! coc#util#get_syntax_name(lnum, col)
  return synIDattr(synIDtrans(synID(a:lnum,a:col,1)),"name")
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

function! coc#util#unplace_signs(bufnr, sign_ids)
  if !bufloaded(a:bufnr) | return | endif
  for id in a:sign_ids
    execute 'silent! sign unplace '.id.' buffer='.a:bufnr
  endfor
endfunction

function! coc#util#setline(lnum, line)
  keepjumps call setline(a:lnum, a:line)
endfunction

" cmd, cwd
function! coc#util#open_terminal(opts) abort
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

function! coc#util#vim_info()
  return {
        \ 'mode': mode(),
        \ 'floating': exists('*nvim_open_win') ? v:true : v:false,
        \ 'extensionRoot': coc#util#extension_root(),
        \ 'watchExtensions': get(g:, 'coc_watch_extensions', []),
        \ 'globalExtensions': get(g:, 'coc_global_extensions', []),
        \ 'config': get(g:, 'coc_user_config', {}),
        \ 'pid': getpid(),
        \ 'columns': &columns,
        \ 'lines': &lines,
        \ 'cmdheight': &cmdheight,
        \ 'filetypeMap': get(g:, 'coc_filetype_map', {}),
        \ 'version': coc#util#version(),
        \ 'completeOpt': &completeopt,
        \ 'pumevent': exists('##MenuPopupChanged') || exists('##CompleteChanged'),
        \ 'isVim': has('nvim') ? v:false : v:true,
        \ 'isMacvim': has('gui_macvim') ? v:true : v:false,
        \ 'colorscheme': get(g:, 'colors_name', ''),
        \ 'workspaceFolders': get(g:, 'WorkspaceFolders', v:null),
        \ 'background': &background,
        \ 'runtimepath': &runtimepath,
        \}
endfunction

function! coc#util#highlight_options()
  return {
        \ 'colorscheme': get(g:, 'colors_name', ''),
        \ 'background': &background,
        \ 'runtimepath': &runtimepath,
        \}
endfunction

" used by vim
function! coc#util#get_content(bufnr)
  if !bufexists(a:bufnr) | return '' | endif
  return {
        \ 'content': join(getbufline(a:bufnr, 1, '$'), "\n"),
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

" show diff of current buffer
function! coc#util#diff_content(lines) abort
  let tmpfile = tempname()
  setl foldenable
  call writefile(a:lines, tmpfile)
  let ft = &filetype
  diffthis
  execute 'vs '.tmpfile
  execute 'setf ' . ft
  diffthis
  setl foldenable
endfunction

function! coc#util#clear_signs()
  let buflist = filter(range(1, bufnr('$')), 'buflisted(v:val)')
  for b in buflist
    let signIds = []
    let lines = split(execute('sign place buffer='.b), "\n")
    for line in lines
      let ms = matchlist(line, 'id=\(\d\+\)\s\+name=Coc')
      if len(ms) > 0
        call add(signIds, ms[1])
      endif
    endfor
    call coc#util#unplace_signs(b, signIds)
  endfor
endfunction

function! coc#util#clearmatches(ids)
  for id in a:ids
    try
      call matchdelete(id)
    catch /.*/
      " matches have been cleared in other ways,
    endtry
  endfor
  let exists = get(w:, 'coc_matchids', [])
  if !empty(exists)
    call filter(w:coc_matchids, 'index(a:ids, v:val) == -1')
  endif
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
    echohl Error | echon 'Failed to open '.a:url | echohl None
    return
  endif
endfunction

function! coc#util#install(...) abort
  let opts = get(a:, 1, {})
  let l:terminal = get(opts, 'terminal', 0)
  let tag = get(opts, 'tag', 0)
  let cmd = (s:is_win ? 'install.cmd' : './install.sh') . (tag ? '' : ' nightly')
  function! s:OnInstalled(status, ...) closure
    if a:status != 0 | return | endif
    call coc#rpc#restart()
  endfunction
  " install.cmd would always exited with code 0 with/without errors.
  if l:terminal
    call coc#util#open_terminal({
          \ 'cmd': cmd,
          \ 'autoclose': 1,
          \ 'cwd': s:root,
          \ 'Callback': funcref('s:OnInstalled')
          \})
    wincmd p
  else
    let cwd = getcwd()
    exe 'lcd '.s:root
    exe '!'.cmd
    exe 'lcd '.cwd
    call s:OnInstalled(0)
  endif
endfunction

" build coc from source code
function! coc#util#build()
  let yarncmd = coc#util#yarn_cmd()
  if empty(yarncmd)
    echohl Error | echom 'yarn not found in $PATH checkout https://yarnpkg.com/en/docs/install.' | echohl None
    return 0
  endif
  let cwd = getcwd()
  execute 'lcd '.s:root
  execute '!'.yarncmd.' install --frozen-lockfile'
  execute 'lcd '.cwd
  if s:is_win
    call coc#rpc#start_server()
  else
    call coc#rpc#restart()
  endif
endfunction

function! coc#util#do_complete(name, opt, cb) abort
  let handler = 'coc#source#'.a:name.'#complete'
  let l:Cb = {res -> a:cb(v:null, res)}
  let args = [a:opt, l:Cb]
  call call(handler, args)
endfunction

function! coc#util#extension_root() abort
  if s:is_win
    let dir = $HOME.'/AppData/Local/coc/extensions'
  else
    let dir = $HOME.'/.config/coc/extensions'
  endif
  return dir
endfunction

function! coc#util#update_extensions(...) abort
  let useTerminal = get(a:, 1, 0)
  let yarncmd = coc#util#yarn_cmd()
  if empty(yarncmd)
    echohl Error | echon '[coc.nvim] yarn command not found!' | echohl None
  endif
  let dir = coc#util#extension_root()
  if !isdirectory(dir)
    echohl Error | echon '[coc.nvim] extension root '.dir.' not found!' | echohl None
  endif
  if !useTerminal
    let cwd = getcwd()
    exe 'lcd '.dir
    exe '!'.yarncmd.' upgrade --latest --ignore-engines --ignore-scripts'
    exe 'lcd '.cwd
  else
    call coc#util#open_terminal({
          \ 'cmd': yarncmd.' upgrade --latest --ignore-engines --ignore-scripts',
          \ 'autoclose': 1,
          \ 'cwd': dir,
          \})
    wincmd p
  endif
endfunction

function! coc#util#install_extension(args) abort
  let yarncmd = coc#util#yarn_cmd()
  if empty(yarncmd)
    if get(s:, 'install_yarn', 0) == 0 && !s:is_win
      let s:install_yarn = 1
      echohl MoreMsg | echon 'Installing yarn' | echohl None
      exe '!curl --compressed -o- -L https://yarnpkg.com/install.sh | sh +m'
    else
      echohl Error | echon "[coc.nvim] yarn not found, visit https://yarnpkg.com/en/docs/install for installation." | echohl None
    endif
    return
  endif
  let names = join(filter(copy(a:args), 'v:val !~# "^-"'), ' ')
  if empty(names) | return | endif
  let useTerminal = index(a:args, '-sync') == -1
  let dir = coc#util#extension_root()
  let res = coc#util#init_extension_root(dir)
  if res == -1| return | endif
  if useTerminal
    function! s:OnExtensionInstalled(status, ...) closure
      if a:status == 0
        call coc#util#echo_messages('MoreMsg', ['extension '.names. ' installed!'])
        call coc#rpc#notify('CocInstalled', [names])
      else
        call coc#util#echo_messages('Error', ['install extensions '.names. ' failed!'])
      endif
    endfunction
    call coc#util#open_terminal({
          \ 'cwd': dir,
          \ 'cmd': yarncmd.' add '.names.' --ignore-engines --ignore-scripts',
          \ 'keepfocus': 1,
          \ 'Callback': funcref('s:OnExtensionInstalled'),
          \})
  else
    if $NODE_ENV ==# 'test'
      for name in split(names, ' ')
        call mkdir(dir . '/node_modules/'.name, 'p', 0700)
      endfor
    else
      let cwd = getcwd()
      exe 'lcd '.dir
      exe '!'.yarncmd.' add '.names . ' --ignore-engines --ignore-scripts'
      exe 'lcd '.cwd
    endif
  endif
endfunction

function! coc#util#init_extension_root(root) abort
  if !isdirectory(a:root)
    call mkdir(a:root, 'p')
    let file = a:root.'/package.json'
    let res = writefile(['{"dependencies":{}}'], file)
    if res == -1
      echohl Error | echon 'Create package.json failed: '.v:errmsg | echohl None
      return -1
    endif
  endif
  return 0
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

function! coc#util#update()
  let yarncmd = coc#util#yarn_cmd()
  if empty(yarncmd)
    echohl Error | echon "[coc.nvim] yarn not found, visit https://yarnpkg.com/en/docs/install for installation." | echohl None
    return
  endif
  let dir = coc#util#extension_root()
  if !isdirectory(dir) | return | endif
  function! s:OnUpdated(status, ...) closure
    if a:status == 0
      call coc#util#echo_messages('MoreMsg', ['coc extensions updated.'])
    endif
  endfunction
  call coc#util#open_terminal({
        \ 'cwd': dir,
        \ 'cmd': yarncmd.' upgrade --latest --ignore-engines',
        \ 'keepfocus': 1,
        \ 'Callback': funcref('s:OnUpdated'),
        \})
endfunction

" content of first echo line
function! coc#util#echo_line()
  let str = ''
  let line = &lines - (&cmdheight - 1)
  for i in range(1, &columns - 1)
    let nr = screenchar(line, i)
    let str = str . nr2char(nr)
  endfor
  return str
endfunction

" [r, g, b] ['255', '255', '255']
function! coc#util#pick_color(default_color)
  if has('mac')
    " This is the AppleScript magic:
    let s:ascrpt = ['-e "tell application \"' . s:app . '\""',
          \ '-e "' . s:activate . '"',
          \ "-e \"set AppleScript's text item delimiters to {\\\",\\\"}\"",
          \ '-e "set theColor to (choose color default color {' . str2nr(a:default_color[0])*256 . ", " . str2nr(a:default_color[1])*256 . ", " . str2nr(a:default_color[2])*256 . '}) as text"',
          \ '-e "' . s:quit . '"',
          \ '-e "end tell"',
          \ '-e "return theColor"']
    let res = system("osascript " . join(s:ascrpt, ' ') . " 2>/dev/null")
    return split(trim(res), ',')
  endif
  let default_color = printf('#%02x%02x%02x', a:default_color[0], a:default_color[1], a:default_color[2])
  let rgb = []
  if !has('python')
    echohl Error | echon 'python support required, checkout :echo has(''python'')' | echohl None
    return
  endif
  try
    execute 'py import gtk'
  catch /.*/
    echohl Error | echon 'python gtk module not found' | echohl None
    return
  endtry
python << endpython

import vim
import gtk, sys

# message strings
wnd_title_insert = "Insert a color"

csd = gtk.ColorSelectionDialog(wnd_title_insert)
cs = csd.colorsel

cs.set_current_color(gtk.gdk.color_parse(vim.eval("default_color")))

cs.set_current_alpha(65536)
cs.set_has_opacity_control(False)
cs.set_has_palette(int(vim.eval("s:display_palette")))

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
    echohl Error | echon output | echohl None
    return
  endif
  return output
endfunction
