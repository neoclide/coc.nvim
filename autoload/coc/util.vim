let s:root = expand('<sfile>:h:h:h')
let s:is_win = has('win32') || has('win64')
let s:is_vim = !has('nvim')

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

" get cursor position
function! coc#util#cursor()
  let pos = getcurpos()
  let content = pos[2] == 1 ? '' : getline('.')[0: pos[2] - 2]
  return [pos[1] - 1, strchars(content)]
endfunction

function! coc#util#close_win(id)
  if !has('nvim') && exists('*popup_close')
    call popup_close(a:id)
    return
  endif
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
  if s:is_vim
    if exists('*popup_close')
      call popup_close(get(g:, 'coc_popup_id', 0))
    endif
  else
    for winnr in range(1, winnr('$'))
      let popup = getwinvar(winnr, 'popup')
      if !empty(popup)
        exe winnr.'close!'
      endif
    endfor
  endif
endfunction

function! coc#util#version()
  let c = execute('silent version')
  return matchstr(c, 'NVIM v\zs[^\n-]*')
endfunction

function! coc#util#valid_state()
  if s:is_vim && mode() !=# 'n'
    return 0
  endif
  if get(g: , 'EasyMotion_loaded', 0)
    return EasyMotion#is_active() != 1
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
    echohl Error | echom '[coc.nvim] '.node.' is not executable, checkout https://nodejs.org/en/download/' | echohl None
    return
  endif
  let bundle = s:root.'/build/index.js'
  if filereadable(bundle) && !get(g:, 'coc_force_debug', 0)
    return [node] + get(g:, 'coc_node_args', ['--no-warnings']) + [s:root.'/build/index.js']
  endif
  let file = s:root.'/lib/attach.js'
  if !filereadable(file)
    if !filereadable(bundle)
      echohl Error | echom '[coc.nvim] javascript file not found, please compile the code or use release branch.' | echohl None
    else
      echohl Error | echom '[coc.nvim] compiled javascript file not found, remove let g:coc_force_debug = 1 in your vimrc.' | echohl None
    endif
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
  silent exe a:cmd
  if &l:filetype ==# ''
    filetype detect
  endif
  if s:is_vim
    redraw!
  endif
endfunction

function! coc#util#jump(cmd, filepath, ...) abort
  let file = fnamemodify(a:filepath, ":~:.")
  if a:cmd =~# '^tab'
    exe a:cmd.' '.fnameescape(file)
    if !empty(get(a:, 1, []))
      call cursor(a:1[0], a:1[1])
    endif
  else
    if !empty(get(a:, 1, []))
      exe a:cmd.' +call\ cursor('.a:1[0].','.a:1[1].')'.' '.fnameescape(file)
    else
      exe a:cmd.' '.fnameescape(file)
    endif
  endif
  if &l:filetype ==# ''
    filetype detect
  endif
  if s:is_vim
    redraw
  endif
endfunction

function! coc#util#jumpTo(line, character) abort
  let content = getline(a:line + 1)
  let pre = strcharpart(content, 0, a:character)
  let col = strlen(pre) + 1
  call cursor(a:line + 1, col)
  if s:is_vim
    redraw
  endif
endfunction

function! coc#util#echo_messages(hl, msgs)
  if empty(a:msgs) | return | endif
  if a:hl !~# 'Error' && (mode() !~# '\v^(i|n)$')
    return
  endif
  execute 'echohl '.a:hl
  let msgs = filter(copy(a:msgs), '!empty(v:val)')
  for msg in msgs
    echom msg
  endfor
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
        \ 'variables': s:variables(a:bufnr),
        \ 'fullpath': empty(bufname) ? '' : fnamemodify(bufname, ':p'),
        \ 'buftype': getbufvar(a:bufnr, '&buftype'),
        \ 'filetype': getbufvar(a:bufnr, '&filetype'),
        \ 'iskeyword': getbufvar(a:bufnr, '&iskeyword'),
        \ 'changedtick': getbufvar(a:bufnr, 'changedtick'),
        \ 'rootPatterns': getbufvar(a:bufnr, 'coc_root_patterns', v:null),
        \ 'additionalKeywords': getbufvar(a:bufnr, 'coc_additional_keywords', []),
        \}
endfunction

function! s:variables(bufnr) abort
  let info = getbufinfo({'bufnr':a:bufnr, 'variables': 1})
  let variables = copy(info[0]['variables'])
  for key in keys(variables)
    if key !~# '\v^coc'
      unlet variables[key]
    endif
  endfor
  return variables
endfunction

function! coc#util#root_patterns()
  return coc#rpc#request('rootPatterns', [bufnr('%')])
endfunction

function! coc#util#on_error(msg) abort
  echohl Error | echom '[coc.nvim] '.a:msg | echohl None
endfunction

function! coc#util#preview_info(info, ...) abort
  let filetype = get(a:, 1, 'markdown')
  pclose
  keepalt new +setlocal\ previewwindow|setlocal\ buftype=nofile|setlocal\ noswapfile|setlocal\ wrap [Document]
  setl bufhidden=wipe
  setl nobuflisted
  setl nospell
  exe 'setl filetype='.filetype
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
  let synname = synIDattr(synID(pos[1], l:start, 1),"name")
  if !synname
    let synname = ''
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
        \ 'synname': synname,
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
  let timeout = s:is_vim ? 10 : 0
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
  if s:is_vim && !exists('*term_start')
    echohl WarningMsg | echon "Your vim doesn't have termnial support!" | echohl None
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
        \ 'mode': mode(),
        \ 'floating': has('nvim') && exists('*nvim_open_win') ? v:true : v:false,
        \ 'extensionRoot': coc#util#extension_root(),
        \ 'watchExtensions': get(g:, 'coc_watch_extensions', []),
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
        \ 'isMacvim': has('gui_macvim') ? v:true : v:false,
        \ 'colorscheme': get(g:, 'colors_name', ''),
        \ 'workspaceFolders': get(g:, 'WorkspaceFolders', v:null),
        \ 'background': &background,
        \ 'runtimepath': &runtimepath,
        \ 'locationlist': get(g:,'coc_enable_locationlist', 1),
        \ 'progpath': v:progpath,
        \ 'textprop': has('textprop') && has('patch-8.1.1522') && !has('nvim') ? v:true : v:false,
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
    echohl Error | echom 'Failed to open '.a:url | echohl None
    return
  endif
endfunction

function! coc#util#install(...) abort
  let opts = get(a:, 1, {})
  if !isdirectory(s:root.'/src')
    echohl WarningMsg | echon '[coc.nvim] coc#util#install not needed for release branch.' | echohl None
    return
  endif
  let cmd = (s:is_win ? 'install.cmd' : './install.sh') . ' nightly'
  let cwd = getcwd()
  exe 'lcd '.s:root
  exe '!'.cmd
  exe 'lcd '.cwd
  call coc#rpc#restart()
endfunction

function! coc#util#do_complete(name, opt, cb) abort
  let handler = 'coc#source#'.a:name.'#complete'
  let l:Cb = {res -> a:cb(v:null, res)}
  let args = [a:opt, l:Cb]
  call call(handler, args)
endfunction

function! coc#util#extension_root() abort
  if !empty($COC_TEST)
    return s:root.'/src/__tests__/extensions'
  endif
  let dir = get(g:, 'coc_extension_root', '')
  if empty(dir)
    if s:is_win
      let dir = $HOME.'/AppData/Local/coc/extensions'
    else
      let dir = $HOME.'/.config/coc/extensions'
    endif
  endif
  return dir
endfunction

function! coc#util#update_extensions(...) abort
  let async = get(a:, 1, 0)
  if async
    call coc#rpc#notify('updateExtensions', [])
  else
    call coc#rpc#request('updateExtensions', [])
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
    exe 'doautocmd User '.a:name
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
    echohl Error | echom output | echohl None
    return
  endif
  return output
endfunction

function! coc#util#pclose()
  for i in range(1, winnr('$'))
    if getwinvar(i, '&previewwindow')
      pclose
      redraw
    endif
  endfor
endfunction

function! coc#util#init_virtual_hl()
  let names = ['Error', 'Warning', 'Info', 'Hint']
  for name in names
    if !hlexists('Coc'.name.'VirtualText')
      exe 'hi default link Coc'.name.'VirtualText Coc'.name.'Sign'
    endif
  endfor
endfunction

function! coc#util#set_buf_var(bufnr, name, val) abort
  if !bufloaded(a:bufnr) | return | endif
  call setbufvar(a:bufnr, a:name, a:val)
endfunction
