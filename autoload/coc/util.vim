let s:root = expand('<sfile>:h:h:h')
let s:is_win = has('win32') || has('win64')
let s:is_vim = !has('nvim')
let s:install_yarn = 0
let s:package_file = s:root.'/package.json'
let g:coc_local_extensions = []

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

function! coc#util#version()
  let c = execute('version')
  return matchstr(c, 'NVIM v\zs[^\n-]*')
endfunction

function! coc#util#valid_state()
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

function! coc#util#regist_extension(folder)
  if index(g:coc_local_extensions, a:folder) == -1
    call add(g:coc_local_extensions, a:folder)
    if get(g:, 'coc_service_initialized', 0)
      call coc#rpc#notify('registExtensions', [a:folder])
    endif
  endif
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

function! coc#util#binary()
  let platform = coc#util#platform()
  if platform ==# 'windows'
    return s:root.'/build/coc-win.exe'
  elseif platform ==# 'mac'
    return s:root.'/build/coc-macos'
  endif
  return s:root.'/build/coc-linux'
endfunction

function! coc#util#job_command()
  let binary = coc#util#binary()
  if executable(binary) && !get(g:, 'coc_force_debug', 0)
    return [binary]
  endif
  let file = s:root.'/lib/attach.js'
  if !filereadable(file)
    echohl Error | echon '[coc.nvim] binary and build file not found' | echohl None
    return
  endif
  let node = get(g:, 'coc_node_path', 'node')
  if !executable(node)
    echohl Error | echon '[coc.nvim] '.node.' is not executable' | echohl None
    return
  endif
  return [node] + get(g:, 'coc_node_args', ['--no-warnings']) + [s:root.'/bin/server.js']
endfunction

function! coc#util#echo_hover(msg)
  echohl MoreMsg
  echo a:msg
  echohl None
endfunction

function! coc#util#execute(cmd)
  exe a:cmd
endfunction

function! coc#util#echo_messages(hl, msgs)
  if empty(a:msgs) | return | endif
  execute 'echohl '.a:hl
  let msgs = copy(a:msgs)
  if pumvisible()
    let msgs = msgs[0: 0]
  endif
  for msg in msgs
    if !empty(msg)
      echom msg
    endif
  endfor
  echohl None
  redraw
endfunction

function! coc#util#echo_lines(lines)
  let msg = join(a:lines, "\n")
  echo msg
endfunction

function! coc#util#is_preview(bufnr)
  let wnr = bufwinnr(a:bufnr)
  if wnr == -1 | return 0 | endif
  return getwinvar(wnr, '&previewwindow')
endfunction

function! coc#util#get_bufoptions(bufnr) abort
  if !bufloaded(a:bufnr) | return v:null| endif
  let bufname = bufname(a:bufnr)
  return {
        \ 'bufname': bufname,
        \ 'eol': getbufvar(a:bufnr, '&eol'),
        \ 'fullpath': fnamemodify(bufname, ':p'),
        \ 'buftype': getbufvar(a:bufnr, '&buftype'),
        \ 'filetype': getbufvar(a:bufnr, '&filetype'),
        \ 'iskeyword': getbufvar(a:bufnr, '&iskeyword'),
        \ 'changedtick': getbufvar(a:bufnr, 'changedtick'),
        \}
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
  let lines = split(a:info, "\n")
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
      return $VIM."/vimfiles"
    endif
    return $HOME.'/.vim'
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

function! coc#util#get_complete_option()
  let pos = getcurpos()
  let line = getline(pos[1])
  let l:start = pos[2] - 1
  while l:start > 0 && line[l:start - 1] =~# '\k'
    let l:start -= 1
  endwhile
  let input = pos[2] == 1 ? '' : line[l:start : pos[2] - 2]
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
        \ 'synname': synIDattr(synID(pos[1], l:start, 1),"name")
        \}
endfunction

function! coc#util#prompt_confirm(title)
  if exists('*confirm')
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
  let showcmd = &showcmd
  let ruler = &ruler
  noa set noruler
  noa set noshowcmd
  for i in range(len(a:signatures))
    call s:echo_signature(a:signatures[i])
    if i != len(a:signatures) - 1
      echon "\n"
    endif
  endfor
  if showcmd | noa set showcmd | endif
  if ruler | noa set ruler | endif
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
  for id in a:sign_ids
    execute 'sign unplace '.id.' buffer='.a:bufnr
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
        \ 'cwd': get(a:opts, 'cwd', ''),
        \ 'keepfocus': get(a:opts, 'keepfocus', 0),
        \ 'Callback': {status, bufnr, content -> a:cb(v:null, {'success': status == 0 ? v:true : v:false, 'bufnr': bufnr, 'content': content})}
        \}
  call coc#util#open_terminal(opts)
endfunction

function! coc#util#vim_info()
  return {
        \ 'namespaceSupport': exists('*nvim_create_namespace') ? v:true : v:false,
        \ 'virtualText': exists('*nvim_buf_set_virtual_text') ? v:true : v:false,
        \ 'filetypeMap': get(g:, 'coc_filetype_map', {}),
        \ 'version': coc#util#version(),
        \ 'completeOpt': &completeopt,
        \ 'isVim': has('nvim') ? v:false : v:true,
        \ 'isMacvim': has('gui_macvim') ? v:true : v:false,
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

function! coc#util#clearmatches(bufnr, ids)
  if bufnr('%') == a:bufnr
    for id in a:ids
      silent! call matchdelete(id)
    endfor
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

function! coc#util#install() abort
  let obj = json_decode(join(readfile(s:package_file)))
  let cmd = (s:is_win ? 'install.cmd' : './install.sh') . ' v'.obj['version']
  function! s:OnInstalled(status, ...) closure
    if a:status != 0 | return | endif
    if s:is_vim
      call coc#rpc#init_vim_rpc()
    else
      call coc#rpc#restart()
    endif
    let dir = coc#util#extension_root()
    if !isdirectory(dir) && empty(get(g:, 'coc_global_extensions', []))
      echohl WarningMsg | echom 'No extensions found' | echohl None
      call coc#util#open_url('https://github.com/neoclide/coc.nvim/wiki/Using-coc-extensions')
    endif
  endfunction
  " install.cmd would always exited with code 0 with/without errors.
  call coc#util#open_terminal({
        \ 'cmd': cmd,
        \ 'autoclose': 1,
        \ 'cwd': s:root,
        \ 'Callback': funcref('s:OnInstalled')
        \})
  wincmd p
endfunction

" build coc from source code
function! coc#util#build()
  if !executable('yarn')
    echohl Error | echom 'yarn not found in $PATH checkout https://yarnpkg.com/en/docs/install.' | echohl None
    return 0
  endif
  let cwd = getcwd()
  execute 'lcd '.s:root
  execute '!yarn install'
  execute 'lcd '.cwd
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

function! coc#util#install_extension(names) abort
  if !executable('yarn')
    if get(s:, 'install_yarn', 0) == 0 && !s:is_win
      let s:install_yarn = 1
      call coc#util#open_terminal({
            \ 'cmd': 'curl --compressed -o- -L https://yarnpkg.com/install.sh | sh',
            \ 'keepfocus': 1,
            \ 'Callback': { -> coc#util#install(a:names)},
            \})
    else
      echohl Error | echon "[coc.nvim] yarn not found, visit https://yarnpkg.com/en/docs/install for installation." | echohl None
    endif
    return
  endif
  let dir = coc#util#extension_root()
  let res = coc#util#init_extension_root(dir)
  if res == -1| return | endif
  function! s:OnExtensionInstalled(status, names) closure
    if a:status == 0
      call coc#util#echo_messages('MoreMsg', ['extension '.a:names. ' installed!'])
      call coc#rpc#notify('CocInstalled', [a:names])
    else
      call coc#util#echo_messages('Error', ['extension '.a:names. ' install failed!'])
    endif
  endfunction
  call coc#util#open_terminal({
        \ 'cwd': dir,
        \ 'cmd': 'yarn add '.a:names.' --ignore-engines',
        \ 'keepfocus': 1,
        \ 'Callback': {status -> s:OnExtensionInstalled(status, a:names)},
        \})
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
  if !executable('yarn')
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
        \ 'cmd': 'yarn upgrade --latest --ignore-engines',
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

function! coc#util#cc(index)
  call timer_start(60, { -> execute('cc! '.a:index)})
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
