scriptencoding utf-8
let s:root = expand('<sfile>:h:h:h')
let s:is_win = has('win32') || has('win64')
let s:is_vim = !has('nvim')
let s:vim_api_version = 34

function! coc#util#merge_winhl(curr, hls) abort
  let highlightMap = {}
  for parts in map(split(a:curr, ','), 'split(v:val, ":")')
    if len(parts) == 2
      let highlightMap[parts[0]] = parts[1]
    endif
  endfor
  for item in a:hls
    let highlightMap[item[0]] = item[1]
  endfor
  return join(map(items(highlightMap), 'v:val[0].":".v:val[1]'), ',')
endfunction

function! coc#util#api_version() abort
  return s:vim_api_version
endfunction

function! coc#util#semantic_hlgroups() abort
  let res = split(execute('hi'), "\n")
  let filtered = filter(res, "v:val =~# '^CocSem' && v:val !~# ' cleared$'")
  return map(filtered, "matchstr(v:val,'\\v^CocSem\\w+')")
endfunction

" get cursor position
function! coc#util#cursor()
  return [line('.') - 1, coc#string#character_length(strpart(getline('.'), 0, col('.') - 1))]
endfunction

function! coc#util#change_info() abort
  return {'lnum': line('.'), 'col': col('.'), 'line': getline('.'), 'changedtick': b:changedtick}
endfunction

function! coc#util#jumpTo(line, character) abort
  echohl WarningMsg | echon 'coc#util#jumpTo is deprecated, use coc#cursor#move_to instead.' | echohl None
  call coc#cursor#move_to(a:line, a:character)
endfunction

function! coc#util#root_patterns() abort
  return coc#rpc#request('rootPatterns', [bufnr('%')])
endfunction

function! coc#util#get_config(key) abort
  return coc#rpc#request('getConfig', [a:key])
endfunction

function! coc#util#open_terminal(opts) abort
  return coc#ui#open_terminal(a:opts)
endfunction

function! coc#util#synname() abort
  return synIDattr(synID(line('.'), col('.') - 1, 1), 'name')
endfunction

function! coc#util#setline(lnum, line)
  keepjumps call setline(a:lnum, a:line)
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
      \ 'lnum': winid == -1 ? -1 : coc#window#get_cursor(winid)[0],
      \ 'locationlist': locationlist
      \ }
endfunction

function! coc#util#open_file(cmd, file)
  execute a:cmd .' '.fnameescape(fnamemodify(a:file, ':~:.'))
  return bufnr('%')
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
      echohl Error | echom '[coc.nvim] build/index.js not found, please install dependencies and compile coc.nvim by: npm ci' | echohl None
    else
      echohl Error | echon '[coc.nvim] your coc.nvim is broken.' | echohl None
    endif
    return
  endif
  return [node] + get(g:, 'coc_node_args', ['--no-warnings']) + [s:root.'/build/index.js']
endfunction

function! coc#util#jump(cmd, filepath, ...) abort
  if a:cmd != 'pedit'
    silent! normal! m'
  endif
  let path = a:filepath
  if has('win32unix')
    let path = substitute(a:filepath, '\v\\', '/', 'g')
  endif
  let file = fnamemodify(path, ":~:.")
  if a:cmd ==# 'pedit'
    let extra = empty(get(a:, 1, [])) ? '' : '+'.(a:1[0] + 1)
    exe 'pedit '.extra.' '.fnameescape(file)
    return
  elseif a:cmd ==# 'drop'
    let dstbuf = bufadd(path)
    let binfo = getbufinfo(dstbuf)
    if len(binfo) == 1 && empty(binfo[0].windows)
      execute 'buffer '.dstbuf
      let &buflisted = 1
    else
      let saved = &wildignore
      set wildignore=
      execute 'drop '.fnameescape(file)
      execute 'set wildignore='.saved
    endif
  elseif a:cmd ==# 'edit' && bufloaded(file)
    exe 'b '.bufnr(file)
  else
    call s:safer_open(a:cmd, file)
  endif
  if !empty(get(a:, 1, []))
    let line = getline(a:1[0] + 1)
    let col = coc#string#byte_index(line, a:1[1]) + 1
    call cursor(a:1[0] + 1, col)
  endif
  if &filetype ==# ''
    filetype detect
  endif
  if s:is_vim
    redraw
  endif
endfunction

function! s:safer_open(cmd, file) abort
  " How to support :pedit and :drop?
  let is_supported_cmd = index(["edit", "split", "vsplit", "tabe"], a:cmd) >= 0

  " Use special handling only for URI.
  let looks_like_uri = match(a:file, "^.*://") >= 0

  if looks_like_uri && is_supported_cmd && has('win32') && exists('*bufadd')
    " Workaround a bug for Win32 paths.
    "
    " reference:
    " - https://github.com/vim/vim/issues/541
    " - https://github.com/neoclide/coc-java/issues/82
    " - https://github.com/vim-jp/issues/issues/6
    let buf = bufadd(a:file)
    if a:cmd != 'edit'
      " Open split, tab, etc. by a:cmd.
      execute a:cmd
    endif
    " Set current buffer to the file
    exe 'keepjumps buffer ' . buf
  else
    if a:cmd =~# 'drop'
      let saved = &wildignore
      set wildignore=
      execute a:cmd.' '.fnameescape(a:file)
      execute 'set wildignore='.saved
    else
      execute a:cmd.' '.fnameescape(a:file)
    endif
  endif
endfunction

function! coc#util#variables(bufnr) abort
  let info = getbufinfo(a:bufnr)
  let variables = empty(info) ? {} : copy(info[0]['variables'])
  for key in keys(variables)
    if key !~# '\v^coc'
      unlet variables[key]
    endif
  endfor
  return variables
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

function! coc#util#vim_info()
  return {
        \ 'root': s:root,
        \ 'apiversion': s:vim_api_version,
        \ 'mode': mode(),
        \ 'config': get(g:, 'coc_user_config', {}),
        \ 'floating': has('nvim') && exists('*nvim_open_win') ? v:true : v:false,
        \ 'extensionRoot': coc#util#extension_root(),
        \ 'globalExtensions': get(g:, 'coc_global_extensions', []),
        \ 'lines': &lines,
        \ 'columns': &columns,
        \ 'cmdheight': &cmdheight,
        \ 'pid': coc#util#getpid(),
        \ 'filetypeMap': get(g:, 'coc_filetype_map', {}),
        \ 'version': coc#util#version(),
        \ 'pumevent': 1,
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
        \ 'pumwidth': exists('&pumwidth') ? &pumwidth : 15,
        \ 'tabCount': tabpagenr('$'),
        \ 'updateHighlight': has('nvim-0.5.0') || has('textprop') ? v:true : v:false,
        \ 'vimCommands': get(g:, 'coc_vim_commands', []),
        \ 'sign': exists('*sign_place') && exists('*sign_unplace'),
        \ 'ambiguousIsNarrow': &ambiwidth ==# 'single' ? v:true : v:false,
        \ 'textprop': has('textprop') ? v:true : v:false,
        \ 'virtualText': has('nvim-0.5.0') || has('patch-9.0.0067') ? v:true : v:false,
        \ 'dialog': 1,
        \ 'semanticHighlights': coc#util#semantic_hlgroups()
        \}
endfunction

function! coc#util#all_state()
  return {
        \ 'bufnr': bufnr('%'),
        \ 'winid': win_getid(),
        \ 'bufnrs': map(getbufinfo({'bufloaded': 1}),'v:val["bufnr"]'),
        \ 'winids': map(getwininfo(),'v:val["winid"]'),
        \ }
endfunction

function! coc#util#install() abort
  call coc#ui#open_terminal({
        \ 'cwd': s:root,
        \ 'cmd': 'npm ci',
        \ 'autoclose': 0,
        \ })
endfunction

function! coc#util#extension_root() abort
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

function! coc#util#unmap(bufnr, keys) abort
  if bufnr('%') == a:bufnr
    for key in a:keys
      exe 'silent! nunmap <buffer> '.key
    endfor
  endif
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
  let bufnr = a:bufnr && bufloaded(a:bufnr) ? a:bufnr : bufnr('%')
  let tabsize = getbufvar(bufnr, '&shiftwidth')
  if tabsize == 0
    let tabsize = getbufvar(bufnr, '&tabstop')
  endif
  return {
      \ 'tabsize': tabsize,
      \ 'expandtab': getbufvar(bufnr, '&expandtab'),
      \ 'insertFinalNewline': getbufvar(bufnr, '&eol'),
      \ 'trimTrailingWhitespace': getbufvar(bufnr, 'coc_trim_trailing_whitespace', 0),
      \ 'trimFinalNewlines': getbufvar(bufnr, 'coc_trim_final_newlines', 0)
      \ }
endfunction

function! coc#util#get_editoroption(winid) abort
  let info = get(getwininfo(a:winid), 0, v:null)
  if empty(info) || coc#window#is_float(a:winid)
    return v:null
  endif
  let bufnr = info['bufnr']
  let buftype = getbufvar(bufnr, '&buftype')
  " avoid window for other purpose.
  if buftype !=# '' && buftype !=# 'acwrite'
    return v:null
  endif
  let tabSize = getbufvar(bufnr, '&shiftwidth')
  if tabSize == 0
    let tabSize = getbufvar(bufnr, '&tabstop')
  endif
  return {
        \ 'bufnr': bufnr,
        \ 'winid': a:winid,
        \ 'tabpageid': coc#util#tabnr_id(info['tabnr']),
        \ 'winnr': winnr(),
        \ 'visibleRanges': s:visible_ranges(a:winid),
        \ 'tabSize': tabSize,
        \ 'insertSpaces': getbufvar(bufnr, '&expandtab') ? v:true : v:false
        \ }
endfunction

function! coc#util#tabnr_id(tabnr) abort
  return s:is_vim ? coc#api#get_tabid(a:tabnr) : nvim_list_tabpages()[a:tabnr - 1]
endfunction

function! coc#util#get_loaded_bufs() abort
  return map(getbufinfo({'bufloaded': 1}),'v:val["bufnr"]')
endfunction

function! coc#util#editor_infos() abort
  let result = []
  for info in getwininfo()
    if !coc#window#is_float(info['winid'])
      let bufnr = info['bufnr']
      let buftype = getbufvar(bufnr, '&buftype')
      if buftype !=# '' && buftype !=# 'acwrite'
        continue
      endif
      let bufname = bufname(bufnr)
      call add(result, {
          \ 'winid': info['winid'],
          \ 'bufnr': bufnr,
          \ 'tabid': coc#util#tabnr_id(info['tabnr']),
          \ 'fullpath': empty(bufname) ? '' : fnamemodify(bufname, ':p'),
          \ })
    endif
  endfor
  return result
endfunction

function! coc#util#tabpages() abort
  if s:is_vim
    return coc#api#exec('list_tabpages', [])
  endif
  return nvim_list_tabpages()
endfunction

function! coc#util#getpid()
  if !has('win32unix')
    return getpid()
  endif
  let cmd = 'cat /proc/' . getpid() . '/winpid'
  return substitute(system(cmd), '\v\n', '', 'gi')
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

function! coc#util#get_bufoptions(bufnr, max) abort
  if !bufloaded(a:bufnr) | return v:null | endif
  let bufname = bufname(a:bufnr)
  let buftype = getbufvar(a:bufnr, '&buftype')
  let size = coc#util#bufsize(a:bufnr)
  let lines = v:null
  if getbufvar(a:bufnr, 'coc_enabled', 1)
        \ && (buftype == '' || buftype == 'acwrite' || getbufvar(a:bufnr, 'coc_force_attach', 0))
        \ && size != -2
        \ && size < a:max
    let lines = getbufline(a:bufnr, 1, '$')
  endif
  return {
        \ 'bufnr': a:bufnr,
        \ 'size': size,
        \ 'lines': lines,
        \ 'winid': bufwinid(a:bufnr),
        \ 'bufname': bufname,
        \ 'buftype': buftype,
        \ 'previewwindow': v:false,
        \ 'eol': getbufvar(a:bufnr, '&eol'),
        \ 'variables': coc#util#variables(a:bufnr),
        \ 'filetype': getbufvar(a:bufnr, '&filetype'),
        \ 'lisp': getbufvar(a:bufnr, '&lisp'),
        \ 'iskeyword': getbufvar(a:bufnr, '&iskeyword'),
        \ 'changedtick': getbufvar(a:bufnr, 'changedtick'),
        \ 'fullpath': empty(bufname) ? '' : fnamemodify(bufname, ':p'),
        \}
endfunction

function! coc#util#bufsize(bufnr) abort
  if bufnr('%') == a:bufnr
    return line2byte(line("$") + 1)
  endif
  let bufname = bufname(a:bufnr)
  if !getbufvar(a:bufnr, '&modified') && filereadable(bufname)
    return getfsize(bufname)
  endif
  return strlen(join(getbufline(a:bufnr, 1, '$'), '\n'))
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
  if get(g:, 'coc_node_env', '') ==# 'test'
    return $COC_DATA_HOME
  endif
  if !empty(get(g:, 'coc_data_home', ''))
    let dir = resolve(expand(g:coc_data_home))
  else
    if exists('$XDG_CONFIG_HOME') && isdirectory(resolve($XDG_CONFIG_HOME))
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
    call coc#notify#create(['creating coc.nvim data directory: '.dir], {
          \ 'borderhighlight': 'CocInfoSign',
          \ 'timeout': 5000,
          \ 'kind': 'info',
          \ })
    call mkdir(dir, "p", 0755)
  endif
  return dir
endfunction

function! coc#util#get_complete_option()
  let pos = getcurpos()
  let line = getline(pos[1])
  let input = matchstr(strpart(line, 0, pos[2] - 1), '\k*$')
  let col = pos[2] - strlen(input)
  let position = {
      \ 'line': line('.')-1,
      \ 'character': coc#string#character_length(strpart(getline('.'), 0, col('.') - 1))
      \ }
  let word = matchstr(strpart(line, col - 1), '^\k\+')
  let followWord = len(word) > 0 ? strcharpart(word, strchars(input)) : ''
  return {
        \ 'word': word,
        \ 'followWord': followWord,
        \ 'position': position,
        \ 'input': empty(input) ? '' : input,
        \ 'line': line,
        \ 'filetype': &filetype,
        \ 'filepath': expand('%:p'),
        \ 'bufnr': bufnr('%'),
        \ 'linenr': pos[1],
        \ 'colnr' : pos[2],
        \ 'col': col - 1,
        \ 'changedtick': b:changedtick,
        \}
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
function! coc#util#get_changeinfo(bufnr)
  if bufnr('%') == a:bufnr
    return {
          \ 'lnum': line('.'),
          \ 'line': getline('.'),
          \ 'changedtick': b:changedtick,
          \}
  endif
  let winid = bufwinid(a:bufnr)
  if winid != -1
    let ref = {}
    call win_execute(winid, 'let ref = {"lnum": line("."), "line": getline("."), "changedtick": b:changedtick}')
    return ref
  endif
  return v:null
endfunction

" Get the valid position from line, character of current buffer
function! coc#util#valid_position(line, character) abort
  let total = line('$') - 1
  if a:line > total
    return [total, 0]
  endif
  let max = max([0, coc#string#character_length(getline(a:line + 1)) - (mode() ==# 'n' ? 1 : 0)])
  return a:character > max ? [a:line, max] : [a:line, a:character]
endfunction

function! s:visible_ranges(winid) abort
  let info = getwininfo(a:winid)[0]
  let res = []
  if !has_key(info, 'topline') || !has_key(info, 'botline')
    return res
  endif
  let begin = 0
  let curr = info['topline']
  let max = info['botline']
  if win_getid() != a:winid
    return [[curr, max]]
  endif
  while curr <= max
    let closedend = foldclosedend(curr)
    if closedend == -1
      let begin = begin == 0 ? curr : begin
      if curr == max
        call add(res, [begin, curr])
      endif
      let curr = curr + 1
    else
      if begin != 0
        call add(res, [begin, curr - 1])
        let begin = closedend + 1
      endif
      let curr = closedend + 1
    endif
  endwhile
  return res
endfunction
