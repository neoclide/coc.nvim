let s:root = expand('<sfile>:h:h:h')
let s:is_win = has('win32') || has('win64')
let s:is_vim = !has('nvim')
let s:install_yarn = 0
let s:package_file = s:root.'/package.json'
let g:coc_local_extensions = []

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
    if get(g:, 'coc_enabled', 0)
      call coc#rpc#notify('registExtensions', [a:folder])
    endif
  endif
endfunction

function! coc#util#valid_buf(bufnr)
  if !bufloaded(a:bufnr) | return 0 | endif
  return getbufvar(a:bufnr, '&buftype') ==# ''
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
  if filereadable(binary) && !get(g:, 'coc_force_debug', 0)
    return [binary]
  endif
  let file = s:root.'/lib/attach.js'
  if filereadable(file)
    if executable('node')
      return ['node', s:root.'/bin/server.js']
    else
      echohl Error | echon 'node not found in $PATH' | echohl None
    endif
  endif
  echohl Error | echon '[coc.nvim] binary and build file not found' | echohl None
endfunction

function! coc#util#echo_messages(hl, msgs)
  if empty(a:msgs) | return | endif
  execute 'echohl '.a:hl
  for msg in a:msgs
    echom msg
  endfor
  echohl None
endfunction

function! coc#util#echo_lines(lines)
  let msg = join(a:lines, "\n")
  echo msg
endfunction

function! coc#util#get_fullpath(bufnr) abort
  let fname = bufname(a:bufnr)
  if empty(fname) | return '' | endif
  return fnamemodify(fname, ':p')
endfunction

function! coc#util#get_bufoptions(bufnr) abort
  return {
        \ 'fullpath': coc#util#get_fullpath(a:bufnr),
        \ 'buftype': getbufvar(a:bufnr, '&buftype'),
        \ 'filetype': getbufvar(a:bufnr, '&filetype'),
        \ 'iskeyword': getbufvar(a:bufnr, '&iskeyword'),
        \ 'changedtick': getbufvar(a:bufnr, 'changedtick'),
        \}
endfunction

function! coc#util#on_error(msg) abort
  echohl Error | echom '[coc.nvim] '.a:msg | echohl None
endfunction

" make function that only trigger once
function! coc#util#once(callback) abort
  function! Cb(...) dict
    if self.called == 1 | return | endif
    let self.called = 1
    call call(self.fn, a:000)
  endfunction

  let obj = {
        \'called': 0,
        \'fn': a:callback,
        \'callback': funcref('Cb'),
        \}
  return obj['callback']
endfunction

function! coc#util#get_listfile_command() abort
  if executable('rg')
    return 'rg --color never --files'
  endif
  if executable('ag')
    return 'ag --follow --nogroup --nocolor -g .'
  endif
  return ''
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

function! coc#util#get_complete_option(...)
  let opt = get(a:, 1, {})
  let pos = getcurpos()
  let line = getline('.')
  let l:start = pos[2] - 1
  while l:start > 0 && line[l:start - 1] =~# '\k'
    let l:start -= 1
  endwhile
  let input = pos[2] == 1 ? '' : line[l:start : pos[2] - 2]
  return extend({
        \ 'id': localtime(),
        \ 'changedtick': b:changedtick,
        \ 'word': matchstr(line[l:start : ], '^\k\+'),
        \ 'input': input,
        \ 'line': line,
        \ 'buftype': &buftype,
        \ 'filetype': &filetype,
        \ 'filepath': expand('%:p'),
        \ 'bufnr': bufnr('%'),
        \ 'linenr': pos[1],
        \ 'colnr' : pos[2],
        \ 'col': l:start,
        \ 'iskeyword': &iskeyword,
        \}, opt)
endfunction

function! coc#util#edit_file(filepath, ...)
  let cmd = get(a:, 1, 'edit')
  execute 'keepalt '.cmd.' '.fnameescape(a:filepath)
endfunction

function! coc#util#prompt_change(count)
  echohl MoreMsg
  echom a:count.' files will be changed. Confirm? (y/n)'
  echohl None
  let confirm = nr2char(getchar()) | redraw!
  if !(confirm ==? "y" || confirm ==? "\r")
    echohl Moremsg | echo 'Cancelled.' | echohl None
    return 0
  end
  return 1
endfunction

function! coc#util#prompt_confirm(title)
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
endfunction

function! coc#util#get_syntax_name(lnum, col)
  return synIDattr(synIDtrans(synID(a:lnum,a:col,1)),"name")
endfunction

function! coc#util#get_search(col) abort
  let line = getline('.')
  let curcol = col('.')
  if curcol <= a:col || mode() !~ '^i'
    return v:null
  endif
  if curcol == a:col + 1 | return '' | endif
  return line[a:col : curcol - 2]
endfunction

function! coc#util#echo_signature(activeParameter, activeSignature, signatures) abort
  let showcmd = &showcmd
  let ruler = &ruler
  let &showcmd = 0
  let &ruler = 0
  let arr = []
  let i = 0
  let activeParameter = get(a:, 'activeParameter', 0)
  for item in a:signatures
    let texts = []
    if type(a:activeSignature) == 0 && a:activeSignature == i
      call add(texts, {'text': item['label'], 'hl': 'Label'})
      call add(texts, {'text': '('})
      let params = get(item, 'parameters', [])
      let j = 0
      for param in params
        call add(texts, {
              \'text': param['label'],
              \'hl': j == activeParameter ? 'MoreMsg' : ''
              \})
        if j != len(params) - 1
          call add(texts, {'text': ', '})
        endif
        let j = j + 1
      endfor
      call add(texts, {'text': ')'})
      let arr = [texts] + arr
    else
      call add(texts, {'text': item['label'], 'hl': 'Label'})
      call add(texts, {'text': '('})
      let params = get(item, 'parameters', [])
      let text = join(map(params, 'v:val["label"]'), ',')
      call add(texts, {'text': text})
      call add(texts, {'text': ')'})
      call add(arr, texts)
    endif
    let i = i + 1
  endfor
  let arr = arr[0: &cmdheight - 1]
  for idx in range(len(arr))
    call s:echo_signatureItem(arr[idx])
    if idx != len(arr) - 1
      echon "\n"
    endif
  endfor
  let &showcmd = showcmd
  let &ruler = ruler
endfunction

function! s:echo_signatureItem(list)
  let w = &columns
  let cl = 0
  let idx = 0
  let outRange = 0
  for item in a:list
    if outRange | return | endif
    let text = substitute(get(item, 'text', ''), "'", "''", 'g')
    let l = len(text)
    let hl = get(item, 'hl', '')
    if !empty(hl) | execute 'echohl '.hl | endif
    if cl + l >= w - 1
      let end = l - 1 - (cl + l - w + 4)
      let text = text[0: end].'...'
      let outRange = 1
    elseif idx != l - 1 && cl + 4 >= w
      let end = l - 1 - (cl + 4 - w)
      let text = text[0: end].'...'
      let outRange = 1
    endif
    execute "echon '".text."'"
    if !empty(hl) | echohl None | endif
    let cl = cl + len(text)
    let idx = idx + 1
  endfor
endfunction

function! coc#util#unplace_signs(bufnr, sign_ids)
  for id in a:sign_ids
    execute 'sign unplace '.id.' buffer='.a:bufnr
  endfor
endfunction

function! s:codelens_jump() abort
  let lnum = matchstr(getline('.'), '^\d\+')
  if !empty(lnum)
    let wnr = bufwinnr(get(b:, 'bufnr', 0))
    if wnr != -1
      execute wnr.'wincmd w'
      execute 'normal! '.lnum.'G'
    endif
  endif
endfunction

function! coc#util#open_codelens()
  pclose
  execute &previewheight.'new +setlocal\ buftype=nofile [CodeLens]'
  setl noswapfile
  setl nowrap
  setl nonumber
  setl norelativenumber
  setl cursorline
  setl bufhidden=wipe
  setl nobuflisted
  setl nospell
  execute 'nnoremap <silent> <buffer> '.get(g:, 'coc_codelen_jump_key', '<CR>').' :call <SID>codelens_jump()<CR>'
  execute 'nnoremap <silent> <buffer> '.get(g:, 'coc_codelen_action_key', 'd').' :call CocAction("codeLensAction")<CR>'
  syntax clear
  syntax case match
  syntax match codelinesLine        /^.*$/
  syntax match codelinesLineNumbder /^\d\+/       contained nextgroup=codelinesAction containedin=codelinesLine
  syntax match codelinesAction      /\%x0c.*\%x0c/ contained containedin=codelinesLine contains=codelinesSepChar
  syntax match codelinesSepChar     /\%x0c/        conceal cchar=:
  hi def link codelinesLineNumbder Comment
  hi def link codelinesAction      MoreMsg
endfunction

" change content of current buffer
function! coc#util#buf_setlines(lines)
  let l:winview = winsaveview()
  let count = line('$')
  keepjumps call setline(1, a:lines)
  if count > len(a:lines)
    let lnum = len(a:lines) + 1
    execute 'keepjumps normal '.lnum.'G'
    keepjumps normal! dG
  endif
  call winrestview(l:winview)
endfunction

function! coc#util#setline(lnum, line)
  keepjumps call setline(a:lnum, a:line)
endfunction

" cmd, cwd
function! coc#util#open_terminal(opts) abort
  execute 'belowright 5new +setl\ buftype=nofile '
  setl buftype=nofile
  setl winfixheight
  setl norelativenumber
  setl nonumber
  setl bufhidden=wipe
  let cmd = get(a:opts, 'cmd', '')
  if empty(cmd)
    throw 'command required!'
  endif
  let cwd = get(a:opts, 'cwd', '')
  if !empty(cwd) | execute 'lcd '.cwd | endif
  let keepfocus = get(a:opts, 'keepfocus', 0)
  let bufnr = bufnr('%')
  let Callback = get(a:opts, 'Callback', v:null)
  if has('nvim')
    call termopen(cmd, {
          \ 'on_exit': function('s:OnExit', [bufnr, Callback]),
          \})
  else
    call term_start(cmd, {
          \ 'exit_cb': function('s:OnExit', [bufnr, Callback]),
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
        \ 'Callback': {status, bufnr, content -> a:cb(v:null, {'success': status == 0 ? v:true : v:false, 'bufnr': bufnr, 'content': content})}
        \}
  call coc#util#open_terminal(opts)
endfunction

function! s:OnExit(bufnr, Callback, job_id, status, ...)
  let content = join(getbufline(a:bufnr, 1, '$'), "\n")
  if a:status == 0
    execute 'silent! bd! '.a:bufnr
  endif
  if !empty(a:Callback)
    call call(a:Callback, [a:status, a:bufnr, content])
  endif
endfunction

function! coc#util#vim_info()
  return {
        \ 'completeOpt': &completeopt,
        \ 'isVim': has('nvim') ? v:false : v:true,
        \}
endfunction

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

" run command and get result on succeed
function! coc#util#run_command(opts)
  let cmd = get(a:opts, 'cmd', '')
  let id = get(a:opts, 'id', '')
  let timeout = get(a:opts, 'timeout', 60)
  let oldcwd = getcwd()
  let cwd = get(a:opts, 'cwd', '')
  if empty(cmd) | return | endif
  if !empty(cwd) | execute 'lcd '.cwd | endif
  if has('nvim')
    let jobid = jobstart(cmd, {
          \ 'stdout_buffered': 1,
          \ 'stderr_buffered': 1,
          \ 'on_stdout': {channel, data -> s:on_result(id, data)},
          \ 'on_stderr': {channel, data -> s:on_error(id, data)},
          \})
    if jobid <= 0
      echohl Error | echon 'Start job failed: '.cmd | echohl None
    endif
    call timer_start(timeout*1000, { -> execute('silent! call jobstop('.jobid.')')})
  else
    let job = job_start(cmd, {
          \ 'in_mode': 'raw',
          \ 'out_mode': 'raw',
          \ 'err_mode': 'raw',
          \ 'err_cb': {channel, data -> s:on_error(id, data)},
          \ 'out_cb': {channel, data -> s:on_result(id, data)},
          \})
    call timer_start(timeout*1000, { -> s:stop_job(job)})
  endif
  execute 'lcd '.oldcwd
endfunction

function! s:stop_job(job)
  if job_status(a:job) == 'run'
    call job_stop(a:job, 'kill')
  endif
endfunction

function! s:on_result(id, result)
  if type(a:result) == 3
    let msg = join(a:result, "\n")
  else
    let msg = a:result
  endif
  call coc#rpc#notify('JobResult', [a:id, msg])
endfunction

function! s:on_error(id, msgs)
  if type(a:msgs) == 1
    echohl Error | echon a:msgs | echohl None
  else
    for msg in a:msgs
      echohl Error | echon msg | echohl None
    endfor
  endif
  if !s:empty(a:msgs)
    call coc#rpc#notify('JobResult', [a:id, ''])
  endif
endfunction

function! s:empty(msgs)
  if empty(a:msgs) | return 1 | endif
  if len(a:msgs) == 1 && get(a:msgs, 1, '') ==# ''
    return 1
  endif
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

function! coc#util#clear()
  if !has('nvim')
    silent! call clearmatches()
  endif
endfunction

function! coc#util#clear_signs()
  let buflist = []
  for i in range(tabpagenr('$'))
    for n in tabpagebuflist(i + 1)
      if index(buflist, n) == -1
        call add(buflist, n)
      endif
    endfor
  endfor
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

function! coc#util#matchdelete(ids)
  for id in a:ids
    silent! call matchdelete(id)
  endfor
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

function! coc#util#module_folder(manager) abort
  let is_yarn = a:manager ==# 'yarn'
  let cmd = is_yarn ? 'yarn global dir' : 'npm --loglevel silent root -g'
  let lines = filter(systemlist(cmd), "v:val !=# ''")
  if v:shell_error || empty(lines)
    return ''
  endif
  let folder = lines[-1]
  if !isdirectory(folder)
    return ''
  endif
  return is_yarn ? folder . '/node_modules' : folder
endfunction

function! coc#util#install_node_rpc() abort
  let res = input('[coc.nvim] vim-node-rpc module not found, install? [y/n]')
  if res !=? 'y' | return | endif
  let cmd = ''
  let isLinux = !s:is_win && substitute(system('uname'), '\n', '', '') == 'Linux'
  if executable('npm')
    let cmd = (isLinux ? 'sudo ' : ' ').'npm i -g vim-node-rpc'
  else
    echohl Error | echon '[coc.nvim] executable "npm" not find in $PATH' | echohl None
    return
  endif
  call coc#util#open_terminal({
        \ 'cmd': cmd,
        \ 'Callback': function('s:rpc_installed')
        \ })
endfunction

function! coc#util#install()
  let obj = json_decode(readfile(s:package_file))
  let cmd = (s:is_win ? 'install.cmd' : './install.sh') . ' v'.obj['version']
  call coc#util#open_terminal({
        \ 'cmd': cmd,
        \ 'cwd': s:root,
        \ 'Callback': function('s:coc_installed')
        \})
  wincmd p
endfunction

function! s:coc_installed(status, ...)
  if a:status != 0 | return | endif
  if s:is_vim
    call coc#util#install_node_rpc()
  else
    call coc#rpc#restart()
  endif
  let dir = coc#util#extension_root()
  if !isdirectory(dir)
    echohl WarningMsg | echon 'No extensions found' | echohl None
    call coc#util#open_url('https://github.com/neoclide/coc.nvim/wiki/Using-coc-extensions')
  endif
endfunction

function! s:rpc_installed(status)
  if a:status == 0
    redraw!
    echohl MoreMsg | echon 'vim-node-rpc installed, starting rpc server.' | echohl None
    call nvim#rpc#start_server()
  endif
endfunction

function! coc#util#do_complete(name, opt, cb)
  let handler = 'coc#source#'.a:name.'#complete'
  let l:Cb = {res -> a:cb(v:null, res)}
  let args = [a:opt, l:Cb]
  call call(handler, args)
endfunction

function! coc#util#extension_root()
  if s:is_win
    let dir = $HOME.'/AppData/Local/coc/extensions'
  else
    let dir = $HOME.'/.config/coc/extensions'
  endif
  return dir
endfunction

function! coc#util#install_extension(names)
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
  if !isdirectory(dir)
    call mkdir(dir, 'p')
  endif
  let l:Cb = {status -> s:extension_installed(status, a:names)}
  call coc#util#open_terminal({
        \ 'cwd': dir,
        \ 'cmd': 'yarn add '.a:names,
        \ 'keepfocus': 1,
        \ 'Callback': l:Cb,
        \})
endfunction

function! s:extension_installed(status, name)
  if a:status == 0
    call coc#util#echo_messages('MoreMsg', ['extension '.a:name. ' installed!'])
    call coc#rpc#notify('CocInstalled', split(a:name, '\s\+'))
  else
    call coc#util#echo_messages('Error', ['extension '.a:name. ' install failed!'])
  endif
endfunction

function! coc#util#update()
  if !executable('yarn')
    echohl Error | echon "[coc.nvim] yarn not found, visit https://yarnpkg.com/en/docs/install for installation." | echohl None
    return
  endif
  let dir = coc#util#extension_root()
  if !isdirectory(dir) | return | endif
  let l:Cb = {status -> s:extension_updated(status)}
  call coc#util#open_terminal({
        \ 'cwd': dir,
        \ 'cmd': 'yarn upgrade --latest --ignore-engines',
        \ 'keepfocus': 1,
        \ 'Callback': l:Cb,
        \})
endfunction

function! s:extension_updated(status)
  if a:status == 0
    call coc#util#echo_messages('MoreMsg', ['coc extensions updated.'])
  endif
endfunction
