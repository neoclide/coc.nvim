" Related to float window create
let s:is_vim = !has('nvim')
let s:borderchars = get(g:, 'coc_borderchars', ['─', '│', '─', '│', '┌', '┐', '┘', '└'])
let s:borderjoinchars = get(g:, 'coc_border_joinchars', ['┬', '┤', '┴', '├'])
let s:prompt_win_width = get(g:, 'coc_prompt_win_width', 32)
let s:scrollbar_ns = exists('*nvim_create_namespace') ?  nvim_create_namespace('coc-scrollbar') : 0
" winvar: border array of numbers,  button boolean 

" detect if there's float window/popup created by coc.nvim
function! coc#float#has_float() abort
  if s:is_vim
    if !exists('*popup_list')
      return 0
    endif
    let arr = filter(popup_list(), 'getwinvar(v:val,"float",0)&&popup_getpos(v:val)["visible"]')
    return !empty(arr)
  endif
  for i in range(1, winnr('$'))
    if getwinvar(i, 'float')
      return 1
    endif
  endfor
  return 0
endfunction

function! coc#float#close_all() abort
  if !has('nvim') && exists('*popup_clear')
    call popup_clear()
    return
  endif
  let winids = coc#float#get_float_win_list()
  for id in winids
    call coc#float#close(id)
  endfor
endfunction

function! coc#float#jump() abort
  if s:is_vim
    return
  endif
  let winids = coc#float#get_float_win_list()
  if !empty(winids)
    call win_gotoid(winids[0])
  endif
endfunction

function! coc#float#get_float_mode(lines, config) abort
  let allowSelection = get(a:config, 'allowSelection', 0)
  let pumAlignTop = get(a:config, 'pumAlignTop', 0)
  let mode = mode()
  let checked = (mode == 's' && allowSelection) || index(['i', 'n', 'ic'], mode) != -1
  if !checked
    return v:null
  endif
  if !s:is_vim && mode ==# 'i'
    " helps to fix undo issue, don't know why.
    call feedkeys("\<C-g>u", 'n')
  endif
  let dimension = coc#float#get_config_cursor(a:lines, a:config)
  if empty(dimension)
    return v:null
  endif
  if pumvisible() && ((pumAlignTop && dimension['row'] <0)|| (!pumAlignTop && dimension['row'] > 0))
    return v:null
  endif
  return [mode, bufnr('%'), [line('.'), col('.')], dimension]
endfunction

" create/reuse float window for config position, config including:
" - line: line count relative to cursor, nagetive number means abover cursor.
" - col: column count relative to cursor, nagetive number means left of cursor.
" - width: content width without border and title.
" - height: content height without border and title.
" - title: (optional) title.
" - border: (optional) border as number list, like [1, 1, 1 ,1].
" - cursorline: (optional) enable cursorline when is 1.
" - autohide: (optional) window should be closed on CursorMoved when is 1.
" - highlight: (optional) highlight of window, default to 'CocFloating'
" - borderhighlight: (optional) should be array for border highlights,
"   highlight all borders with first value.
" - close: (optional) show close button when is 1.
" - buttons: (optional) array of button text for create buttons at bottom.
function! coc#float#create_float_win(winid, bufnr, config) abort
  call coc#float#close_auto_hide_wins(a:winid)
  " use exists
  if a:winid && coc#float#valid(a:winid)
    if s:is_vim
      let [line, col] = s:popup_position(a:config)
      call popup_move(a:winid, {
            \ 'line': line,
            \ 'col': col,
            \ 'minwidth': a:config['width'],
            \ 'minheight': a:config['height'],
            \ 'maxwidth': a:config['width'],
            \ 'maxheight': a:config['height'],
            \ })
      let opts = {
            \ 'firstline': 1,
            \ 'cursorline': get(a:config, 'cursorline', 0),
            \ 'title': get(a:config, 'title', ''),
            \ }
      if !s:empty_border(get(a:config, 'border', []))
        let opts['border'] = a:config['border']
      endif
      call popup_setoptions(a:winid, opts)
      let related = []
      call coc#float#vim_buttons(a:winid, a:config, related)
      call setwinvar(winid, 'related', related)
      return [a:winid, winbufnr(a:winid)]
    else
      let config = s:convert_config_nvim(a:config)
      call nvim_win_set_config(a:winid, config)
      call nvim_win_set_cursor(a:winid, [1, 0])
      call coc#float#nvim_create_related(a:winid, config, a:config)
      return [a:winid, winbufnr(a:winid)]
    endif
  endif
  let winid = 0
  if s:is_vim
    let [line, col] = s:popup_position(a:config)
    let bufnr = coc#float#create_float_buf(a:bufnr)
    let title = get(a:config, 'title', '')
    let buttons = get(a:config, 'buttons', [])
    let opts = {
          \ 'title': title,
          \ 'line': line,
          \ 'col': col,
          \ 'firstline': 1,
          \ 'padding': empty(title) ?  [0, 1, 0, 1] : [0, 0, 0, 0],
          \ 'borderchars': s:borderchars,
          \ 'highlight': get(a:config, 'highlight',  'CocFloating'),
          \ 'fixed': 1,
          \ 'cursorline': get(a:config, 'cursorline', 0),
          \ 'minwidth': a:config['width'],
          \ 'minheight': a:config['height'],
          \ 'maxwidth': a:config['width'],
          \ 'maxheight': a:config['height']
          \ }
    if get(a:config, 'close', 0)
      let opts['close'] = 'button'
    endif
    if !empty(get(a:config, 'borderhighlight', []))
      let opts['borderhighlight'] = a:config['borderhighlight']
    endif
    if !s:empty_border(get(a:config, 'border', []))
      let opts['border'] = a:config['border']
    endif
    let winid = popup_create(bufnr, opts)
    if winid == 0
      return []
    endif
    let related = []
    call coc#float#vim_buttons(winid, a:config, related)
    call setwinvar(winid, 'related', related)
    if has("patch-8.1.2281")
      call setwinvar(winid, '&showbreak', 'NONE')
    endif
  else
    let config = s:convert_config_nvim(a:config)
    let bufnr = coc#float#create_float_buf(a:bufnr)
    let winid = nvim_open_win(bufnr, 0, config)
    if winid == 0
      return []
    endif
    let hlgroup = get(a:config, 'highlight', 'CocFloating')
    call setwinvar(winid, '&winhl', 'Normal:'.hlgroup.',NormalNC:'.hlgroup.',FoldColumn:'.hlgroup.',CursorLine:CocMenuSel')
    call setwinvar(winid, '&signcolumn', 'no')
    " no left border
    if s:empty_border(get(a:config, 'border', [])) || a:config['border'][3] == 0
      call setwinvar(winid, '&foldcolumn', 1)
    endif
    call coc#float#nvim_create_related(winid, config, a:config)
  endif
  if has('nvim')
    call nvim_win_set_cursor(winid, [1, 0])
    " change cursorline option affects vim's own highlight
    call setwinvar(winid, '&cursorline', get(a:config, 'cursorline', 0))
    call setwinvar(winid, 'border', get(a:config, 'border', []))
  endif
  if get(a:config, 'autohide', 0)
    call setwinvar(winid, 'autohide', 1)
  endif
  if s:is_vim || has('nvim-0.5.0')
    call setwinvar(winid, '&scrolloff', 0)
  endif
  call setwinvar(winid, '&list', 0)
  call setwinvar(winid, '&number', 0)
  call setwinvar(winid, '&relativenumber', 0)
  call setwinvar(winid, '&cursorcolumn', 0)
  call setwinvar(winid, '&colorcolumn', 0)
  call setwinvar(winid, 'float', 1)
  call setwinvar(winid, '&wrap', 1)
  call setwinvar(winid, '&linebreak', 1)
  call setwinvar(winid, '&conceallevel', 2)
  let g:coc_last_float_win = winid
  call coc#util#do_autocmd('CocOpenFloat')
  return [winid, winbufnr(winid)]
endfunction

function! coc#float#valid(winid) abort
  if a:winid == 0
    return 0
  endif
  if s:is_vim
    return s:popup_visible(a:winid)
  endif
  if exists('*nvim_win_is_valid') && nvim_win_is_valid(a:winid)
    return 1
  endif
  return 0
endfunction

" create buffer for popup/float window
function! coc#float#create_float_buf(bufnr) abort
  " reuse buffer cause error on vim8
  if a:bufnr && bufloaded(a:bufnr)
    return a:bufnr
  endif
  if s:is_vim
    noa let bufnr = bufadd('')
    noa call bufload(bufnr)
  else
    noa let bufnr = nvim_create_buf(v:false, v:true)
  endif
  " Don't use popup filetype, it would crash on reuse!
  call setbufvar(bufnr, '&buftype', 'nofile')
  call setbufvar(bufnr, '&bufhidden', 'hide')
  call setbufvar(bufnr, '&swapfile', 0)
  call setbufvar(bufnr, '&undolevels', -1)
  return bufnr
endfunction

" border window for neovim, content config with border
function! coc#float#nvim_border_win(currwin, config, border, title, hasbtn, related) abort
  let bufnr = 0
  let winid = a:currwin && nvim_win_is_valid(a:currwin) ? a:currwin : 0
  if winid
    let bufnr = winbufnr(a:currwin)
  else
    let bufnr = s:create_tmp_buf()
  endif
  let row = a:border[0] ? a:config['row'] - 1 : a:config['row']
  let col = a:border[3] ? a:config['col'] - 1 : a:config['col']
  let width = a:config['width'] + a:border[1] + a:border[3]
  let height = a:config['height'] + a:border[0] + a:border[2] + (a:hasbtn ? 2 : 0)
  let lines = coc#float#create_border_lines(a:border, a:title, a:config['width'], a:config['height'], a:hasbtn)
  call nvim_buf_set_lines(bufnr, 0, -1, v:false, lines)
  let opt = {
        \ 'relative': a:config['relative'],
        \ 'width': width,
        \ 'height': height,
        \ 'row': row,
        \ 'col': col,
        \ 'focusable': v:false,
        \ 'style': 'minimal',
        \ }
  if winid == 0
    let winid = nvim_open_win(bufnr, 0, opt)
  else
    call nvim_win_set_config(winid, opt)
  endif
  if !winid
    return
  endif
  call setwinvar(winid, 'kind', 'border')
  call add(a:related, winid)
endfunction

function! coc#float#create_border_lines(border, title, width, height, hasbtn) abort
  let list = []
  if a:border[0]
    let top = (a:border[3] ?  s:borderchars[4]: '')
          \.repeat(s:borderchars[0], a:width)
          \.(a:border[1] ? s:borderchars[5] : '')
    if !empty(a:title)
      let top = coc#helper#str_compose(top, 1, a:title.' ')
    endif
    call add(list, top)
  endif
  let mid = (a:border[3] ?  s:borderchars[3]: '')
        \.repeat(' ', a:width)
        \.(a:border[1] ? s:borderchars[1] : '')
  call extend(list, repeat([mid], a:height + (a:hasbtn ? 2 : 0)))
  if a:hasbtn
    let list[len(list) - 2] = (a:border[3] ?  s:borderjoinchars[3]: '')
        \.repeat(' ', a:width)
        \.(a:border[1] ? s:borderjoinchars[1] : '')
  endif
  if a:border[2]
    let bot = (a:border[3] ?  s:borderchars[7]: '')
          \.repeat(s:borderchars[2], a:width)
          \.(a:border[1] ? s:borderchars[6] : '')
    call add(list, bot)
  endif
  return list
endfunction

" Create float window for input, neovim only since vim doesn't support focus
function! coc#float#create_prompt_win(title, default) abort
  call coc#float#close_auto_hide_wins()
  let bufnr = s:create_tmp_buf([a:default])
  " Calculate col
  let curr = win_screenpos(winnr())[1] + wincol() - 2
  let width = min([max([strdisplaywidth(a:title) + 2, s:prompt_win_width]), &columns - 2])
  if width == &columns - 2
    let col = 0 - curr
  else
    let col = curr + width <= &columns - 2 ? 0 : &columns - s:prompt_win_width
  endif
  let res = coc#float#create_float_win(0, bufnr, {
        \ 'relative': 'cursor',
        \ 'row': 0,
        \ 'col': col - 1,
        \ 'width': width,
        \ 'height': 1,
        \ 'style': 'minimal',
        \ 'border': [1,1,1,1],
        \ 'prompt': 1,
        \ 'title': a:title,
        \ })
  if empty(res) || res[0] == 0
    return
  endif
  let winid = res[0]
  call win_gotoid(winid)
  inoremap <buffer> <C-a> <Home>
  inoremap <buffer><expr><C-e> pumvisible() ? "\<C-e>" : "\<End>"
  exe 'inoremap <silent><buffer> <esc> <C-r>=coc#float#close_i('.winid.')<CR><esc>'
  exe 'nnoremap <silent><buffer> <esc> :call coc#float#close('.winid.')<CR>'
  exe 'inoremap <expr><nowait><buffer> <cr> "\<c-r>=coc#float#prompt_insert('.winid.')\<cr>\<esc>"'
  call feedkeys('A', 'in')
  return [bufnr, winid]
endfunction

function! coc#float#close_i(winid) abort
  call coc#float#close(a:winid)
  return ''
endfunction

function! coc#float#prompt_insert(winid) abort
  let text = getline('.')
  let bufnr = winbufnr(a:winid)
  call coc#rpc#notify('PromptInsert',[text, bufnr])
  call timer_start(50, { -> coc#float#close(a:winid)})
  return ''
endfunction

" Position of cursor relative to editor
function! s:win_position() abort
  let nr = winnr()
  let [row, col] = win_screenpos(nr)
  return [row + winline() - 2, col + wincol() - 2]
endfunction

" get popup position for vim8 based on config of neovim float window
function! s:popup_position(config) abort
  let relative = get(a:config, 'relative', 'editor')
  if relative ==# 'cursor'
    return [s:popup_cursor(a:config['row']), s:popup_cursor(a:config['col'])]
  endif
  return [a:config['row'] + 1, a:config['col'] + 1]
endfunction

function! s:popup_cursor(n) abort
  if a:n == 0
    return 'cursor'
  endif
  if a:n < 0
    return 'cursor'.a:n
  endif
  return 'cursor+'.a:n
endfunction

" Close float window by id
function! coc#float#close(winid) abort
  if !coc#float#valid(a:winid)
    return 0
  endif
  call coc#float#close_related(a:winid)
  call s:close_win(a:winid)
  return 1
endfunction

" Float window id on current tab.
" return 0 if not found
function! coc#float#get_float_win() abort
  if has('nvim')
    for i in range(1, winnr('$'))
      let id = win_getid(i)
      let config = nvim_win_get_config(id)
      if (!empty(config) && config['focusable'] == v:true && !empty(config['relative']))
        if !getwinvar(id, 'button', 0)
          return id
        endif
      endif
    endfor
  elseif exists('*popup_list')
    let arr = filter(popup_list(), 'popup_getpos(v:val)["visible"]')
    if !empty(arr)
      return arr[0]
    endif
  endif
  return 0
endfunction

function! coc#float#get_float_win_list() abort
  if s:is_vim && exists('*popup_list')
    return filter(popup_list(), 'popup_getpos(v:val)["visible"]')
  elseif has('nvim') && exists('*nvim_win_get_config')
    let res = []
    for i in range(1, winnr('$'))
      let id = win_getid(i)
      let config = nvim_win_get_config(id)
      " ignore border & button window
      if (!empty(config) && !empty(config['relative']) && !getwinvar(id, 'target_winid', 0))
        call add(res, id)
      endif
    endfor
    return res
  endif
  return []
endfunction

" Check if a float window is scrollable
function! coc#float#scrollable(winid) abort
  let bufnr = winbufnr(a:winid)
  if bufnr == -1
    return 0
  endif
  if s:is_vim
    let pos = popup_getpos(a:winid)
    if get(popup_getoptions(a:winid), 'scrollbar', 0)
      return get(pos, 'scrollbar', 0)
    endif
    let ch = coc#float#content_height(bufnr, pos['core_width'], getwinvar(a:winid, '&wrap'))
    return ch > pos['core_height']
  else
    let height = nvim_win_get_height(a:winid)
    let width = nvim_win_get_width(a:winid)
    if width > 1 && getwinvar(a:winid, '&foldcolumn', 0)
      " since we use foldcolumn for left pading
      let width = width - 1
    endif
    let ch = coc#float#content_height(bufnr, width, getwinvar(a:winid, '&wrap'))
    return ch > height
  endif
endfunction

function! coc#float#has_scroll() abort
  let win_ids = filter(coc#float#get_float_win_list(), 'coc#float#scrollable(v:val)')
  return !empty(win_ids)
endfunction

function! coc#float#scroll(forward, ...)
  if !has('nvim-0.4.3') && !has('patch-8.2.0750')
    throw 'coc#float#scroll() requires nvim >= 0.4.3 or vim >= 8.2.0750'
  endif
  let amount = get(a:, 1, 0)
  let win_ids = filter(coc#float#get_float_win_list(), 'coc#float#scrollable(v:val)')
  if empty(win_ids)
    return ''
  endif
  if has('nvim')
    call timer_start(10, { -> s:scroll_nvim(win_ids, a:forward, amount)})
  else
    call timer_start(10, { -> s:scroll_vim(win_ids, a:forward, amount)})
  endif
  return mode() =~ '^i' ? "" : "\<Ignore>"
endfunction

function! s:scroll_nvim(win_ids, forward, amount) abort
  let curr = win_getid()
  for id in a:win_ids
    if nvim_win_is_valid(id)
      let wrapped = 0
      let width = nvim_win_get_width(id)
      if getwinvar(id, '&wrap', 0)
        if width > 1 && getwinvar(id, '&foldcolumn', 0)
          let width = width - 1
        endif
        for line in nvim_buf_get_lines(winbufnr(id), 0, -1, v:false)
          if strdisplaywidth(line) > width
            let wrapped = 1
            break
          endif
        endfor
      endif
      noa call win_gotoid(id)
      let height = nvim_win_get_height(id)
      let firstline = line('w0')
      let lastline = line('w$')
      let linecount = line('$')
      let delta = a:amount ? a:amount : max([1, height - 1])
      if a:forward
        if lastline == linecount && strdisplaywidth(line('$')) <= width
          continue
        endif
        if !a:amount && firstline != lastline
          execute 'noa normal! Lzt'
        else
          execute 'noa normal! H'.delta.'jzt'
        endif
        let lnum = line('.')
        while lnum < linecount && line('w0') == firstline && line('w$') == lastline
          execute 'noa normal! jzt'
          let lnum = lnum + 1
        endwhile
      else
        if !a:amount && firstline != lastline
          execute 'noa normal! Hzb'
        else
          execute 'noa normal! L'.delta.'kzb'
        endif
        let lnum = line('.')
        while lnum > 1 && line('w0') == firstline && line('w$') == lastline
          execute 'noa normal! kzb'
          let lnum = lnum - 1
        endwhile
      endif
      call coc#float#nvim_scrollbar(id)
    endif
  endfor
  noa call win_gotoid(curr)
  redraw
endfunction

function! s:scroll_vim(win_ids, forward, amount) abort
  for id in a:win_ids
    if s:popup_visible(id)
      let pos = popup_getpos(id)
      let bufnr = winbufnr(id)
      let linecount = get(getbufinfo(bufnr)[0], 'linecount', 0)
      " for forward use last line (or last line + 1) as first line
      if a:forward
        if pos['firstline'] == pos['lastline']
          call popup_setoptions(id, {'firstline': min([pos['firstline'] + 1, linecount])})
        else
          if pos['lastline'] == linecount
            let win_width = pos['core_width']
            let text = getbufline(bufnr, '$')[0]
            if strdisplaywidth(text) <= win_width
              " last line shown
              return
            endif
          endif
          let lnum = a:amount ? min([linecount, pos['firstline'] + a:amount]) : pos['lastline']
          call popup_setoptions(id, {'firstline': lnum})
        endif
      else
        if pos['firstline'] == 1
          call win_execute(id, 'normal! gg0')
          return
        endif
        " we could only change firstline
        " iterate lines before last lines to fill content height - 1
        let total_height = a:amount ? min([a:amount, pos['core_height']]) : pos['core_height'] - 1
        if total_height == 0
          call popup_setoptions(id, {'firstline': pos['firstline'] - 1})
        else
          let lines = getbufline(bufnr, 1, '$')
          let curr = pos['firstline'] - 1
          let width = pos['core_width']
          let used = 0
          while v:true
            if curr == 1
              break
            endif
            let w = max([1, strdisplaywidth(lines[curr - 1])])
            let used += float2nr(ceil(str2float(string(w))/width))
            if used > total_height
              let curr = curr == pos['firstline'] -1 ? curr : curr + 1
              break
            elseif used == total_height
              break
            endif
            let curr = curr - 1
          endwhile
          call popup_setoptions(id, {'firstline': curr})
        endif
      endif
    endif
  endfor
  redraw
endfunction

function! s:popup_visible(id) abort
  let pos = popup_getpos(a:id)
  if !empty(pos) && get(pos, 'visible', 0)
    return 1
  endif
  return 0
endfunction

function! s:convert_config_nvim(config) abort
  let valids = ['relative', 'win', 'anchor', 'width', 'height', 'bufpos', 'col', 'row', 'focusable', 'style']
  let result = coc#helper#dict_pick(a:config, valids)
  let border = get(a:config, 'border', [])
  if !s:empty_border(border)
    if result['relative'] ==# 'cursor' && result['row'] < 0
      " move top when has bottom border
      if get(border, 2, 0)
        let result['row'] = result['row'] - 1
      endif
    else
      " move down when has top border
      if get(border, 0, 0) && !get(a:config, 'prompt', 0)
        let result['row'] = result['row'] + 1
      endif
    endif
    " move right when has left border
    if get(border, 3, 0)
      let result['col'] = result['col'] + 1
    endif
    let result['width'] = result['width'] + 1 - get(border,3, 0)
  else
    let result['width'] = result['width'] + 1
  endif
  return result
endfunction

" Close windows that could auto hide
function! coc#float#close_auto_hide_wins(...) abort
  let winids = coc#float#get_float_win_list()
  let except = get(a:, 1, 0)
  for id in winids
    if except && id == except
      continue
    endif
    if getwinvar(id, 'autohide', 0)
      call coc#float#close(id)
    endif
  endfor
endfunction

" neovim only
function! coc#float#nvim_close_btn(config, winid, border, related) abort
  let config = {
        \ 'relative': a:config['relative'],
        \ 'width': 1,
        \ 'height': 1,
        \ 'row': get(a:border, 0, 0) ? a:config['row'] - 1 : a:config['row'],
        \ 'col': a:config['col'] + a:config['width'],
        \ 'focusable': v:true,
        \ 'style': 'minimal',
        \ }
  let bufnr = s:create_tmp_buf(['X'])
  let winid = nvim_open_win(bufnr, 0, config)
  if winid
    call s:nvim_create_keymap(winid)
    call setwinvar(winid, 'kind', 'close')
    call add(a:related, winid)
  endif
endfunction

" Create padding window by config of current window & border config
function! coc#float#nvim_right_pad(config, related) abort
  let config = {
        \ 'relative': a:config['relative'],
        \ 'width': 1,
        \ 'height': a:config['height'],
        \ 'row': a:config['row'],
        \ 'col': a:config['col'] + a:config['width'],
        \ 'focusable': v:false,
        \ 'style': 'minimal',
        \ }
  let bufnr = s:create_tmp_buf(repeat([' '], a:config['height']))
  let winid = nvim_open_win(bufnr, 0, config)
  if winid
    call setwinvar(winid, 'kind', 'pad')
    call add(a:related, winid)
  endif
endfunction

function! coc#float#content_height(bufnr, width, wrap) abort
  if !bufloaded(a:bufnr)
    return 0
  endif
  if !a:wrap
    return has('nvim') ? nvim_buf_line_count(a:bufnr) : len(getbufline(a:bufnr, 1, '$'))
  endif
  let lines = has('nvim') ? nvim_buf_get_lines(a:bufnr, 0, -1, 0) : getbufline(a:bufnr, 1, '$')
  let total = 0
  for line in lines
    let dw = max([1, strdisplaywidth(line)])
    let total += float2nr(ceil(str2float(string(dw))/a:width))
  endfor
  return total
endfunction

function! s:add_related(winid, target) abort
  let arr = getwinvar(a:target, 'related', [])
  if index(arr, a:winid) >= 0
    return
  endif
  call add(arr, a:winid)
  call setwinvar(a:target, 'related', arr)
endfunction

function! coc#float#nvim_refresh_scrollbar(winid) abort
  let id = coc#float#get_related(a:winid, 'scrollbar')
  if id && nvim_win_is_valid(id)
    call coc#float#nvim_scrollbar(a:winid)
  endif
endfunction

" Close related windows
function! coc#float#close_related(winid) abort
  if a:winid == 0
    return
  endif
  let winids = getwinvar(a:winid, 'related', [])
  for id in winids
    if s:is_vim
      noa call popup_close(id)
    elseif nvim_win_is_valid(id)
      noa call nvim_win_close(id, 1)
    endif
  endfor
endfunction

function! coc#float#nvim_create_related(winid, config, opts) abort
  let related = []
  let border = get(a:opts, 'border', [])
  let highlights = get(a:opts, 'borderhighlight', [])
  let borderhighlight = get(highlights, 0, v:null)
  let title = get(a:opts, 'title', '')
  let hlgroup = get(a:opts, 'highlight', 'CocFloating')
  let buttons = get(a:opts, 'buttons', [])
  let pad = empty(border) || get(border, 1, 0) == 0
  let borderwin = 0
  let ids = getwinvar(a:winid, 'related', [])
  if !empty(ids)
    for id in ids
      if !s:empty_border(border) && getwinvar(id, 'kind', '') == 'border'
        let borderwin = id
      else
        call s:close_win(id)
      endif
    endfor
  endif
  if get(a:opts, 'close', 0)
    call coc#float#nvim_close_btn(a:config, a:winid, border, related)
  endif
  if !empty(buttons)
    call coc#float#nvim_buttons(a:config, buttons, get(border, 2, 0), pad, related)
  endif
  if !s:empty_border(border)
    call coc#float#nvim_border_win(borderwin, a:config, border, title, !empty(buttons), related)
  endif
  " Check right border
  if pad
    call coc#float#nvim_right_pad(a:config, related)
  endif
  for id in related
    let kind = getwinvar(id, 'kind', '')
    if (kind == 'border' || kind == 'close') && !empty(borderhighlight)
      let hlgroup = borderhighlight
    endif
    call setwinvar(id, '&winhl', 'Normal:'.hlgroup.',NormalNC:'.hlgroup)
    call setwinvar(id, 'target_winid', a:winid)
  endfor
  call setwinvar(a:winid, 'related', related)
endfunction

" Create or refresh scrollbar for winid
" Need called on create, config, buffer change, scrolled
function! coc#float#nvim_scrollbar(winid) abort
  if !has('nvim-0.4.3') || !coc#float#valid(a:winid) || getwinvar(a:winid, 'target_winid', 0)
    return
  endif
  " needed for correct getwininfo
  redraw
  let config = nvim_win_get_config(a:winid)
  let [row, column] = nvim_win_get_position(a:winid)
  let width = nvim_win_get_width(a:winid)
  let height = nvim_win_get_height(a:winid)
  let bufnr = winbufnr(a:winid)
  let cw = getwinvar(a:winid, '&foldcolumn', 0) ? width - 1 : width
  let ch = coc#float#content_height(bufnr, cw, getwinvar(a:winid, '&wrap'))
  let closewin = coc#float#get_related(a:winid, 'close')
  let border = getwinvar(a:winid, 'border', [])
  let move_down = closewin && !get(border, 0, 0)
  if move_down
    let height = height - 1
  endif
  let id = coc#float#get_related(a:winid, 'scrollbar')
  if ch <= height || height <= 0
    " no scrollbar, remove exists
    if id
      call s:close_win(id)
    endif
    return
  endif
  if id
    let sbuf = winbufnr(id)
  else
    let sbuf = s:create_tmp_buf()
  endif
  call nvim_buf_set_lines(sbuf, 0, -1, v:false, repeat([' '], height))
  let opts = {
        \ 'row': move_down ? row + 1 : row,
        \ 'col': column + width,
        \ 'relative': 'editor',
        \ 'width': 1,
        \ 'height': height,
        \ 'focusable': v:false,
        \ 'style': 'minimal',
        \ }
  if id
    call nvim_win_set_config(id, opts)
  else
    let id = nvim_open_win(sbuf, 0 , opts)
    if id == 0
      return
    endif
    call setwinvar(id, 'kind', 'scrollbar')
    call setwinvar(id, 'target_winid', a:winid)
  endif
  let thumb_height = max([1, float2nr(floor(height * (height + 0.0)/ch))])
  let wininfo = getwininfo(a:winid)[0]
  let start = 0
  if wininfo['topline'] != 1
    let firstline = wininfo['topline']
    let lastline = wininfo['botline']
    let linecount = nvim_buf_line_count(winbufnr(a:winid))
    if lastline >= linecount
      let start = height - thumb_height
    else
      let start = max([1, float2nr(round((height - thumb_height + 0.0)*(firstline - 1.0)/(ch - height)))])
    endif
  endif
  " add highlights
  call nvim_buf_clear_namespace(sbuf, s:scrollbar_ns, 0, -1)
  for idx in range(0, height - 1)
    if idx >= start && idx < start + thumb_height
      call nvim_buf_add_highlight(sbuf, s:scrollbar_ns, 'PmenuThumb', idx, 0, 1)
    else
      call nvim_buf_add_highlight(sbuf, s:scrollbar_ns, 'PmenuSbar', idx, 0, 1)
    endif
  endfor
  call s:add_related(id, a:winid)
endfunction

" Close related windows if target window is not visible.
function! coc#float#check_related() abort
  let invalids = []
  if s:is_vim
    if !exists('*popup_list')
      return
    endif
    for id in popup_list()
      let target = getwinvar(id, 'target_winid', 0)
      if target && !s:popup_visible(target)
        call add(invalids, id)
      endif
    endfor
  else
    for i in range(1, winnr('$'))
      let id = win_getid(i)
      let target = getwinvar(id, 'target_winid', 0)
      if target && !nvim_win_is_valid(target)
        call add(invalids, id)
      endif
    endfor
  endif
  for id in invalids
    call s:close_win(id)
  endfor
endfunction

" Scroll float in any mode (neovim only)
" Only really useful for visual mode scroll, where coc#float#scroll
" is not yet implemented
function! coc#float#nvim_scroll(forward, ...)
  let float = coc#float#get_float_win()
  if !float | return '' | endif
  let buf = nvim_win_get_buf(float)
  let buf_height = nvim_buf_line_count(buf)
  let win_height = nvim_win_get_height(float)
  if buf_height < win_height | return '' | endif
  let pos = nvim_win_get_cursor(float)
  let scrolloff = getwinvar(float, '&scrolloff', 0)
  let scrolloff = scrolloff*2 < win_height ? scrolloff : 0
  let amount = (a:forward == 1 ? 1 : -1) * get(a:, 1, max([1, win_height/2]))
  let last_amount = getwinvar(float, 'coc_float_nvim_scroll_last_amount', 0)
  if amount > 0
    if pos[0] == 1
      let pos[0] += amount + win_height - scrolloff*1 - 1
    elseif last_amount > 0
      let pos[0] += amount
    else
      let pos[0] += amount + win_height - scrolloff*2 - 1
    endif
    let pos[0] = pos[0] < buf_height - scrolloff ? pos[0] : buf_height
  elseif amount < 0
    if pos[0] == buf_height
      let pos[0] += amount - win_height + scrolloff*1 + 1
    elseif last_amount < 0
      let pos[0] += amount
    else
      let pos[0] += amount - win_height + scrolloff*2 + 1
    endif
    let pos[0] = pos[0] > scrolloff ? pos[0] : 1
  endif
  call setwinvar(float, 'coc_float_nvim_scroll_last_amount', amount)
  call nvim_win_set_cursor(float, pos)
  call timer_start(10, { -> coc#float#nvim_scrollbar(float) })
  return ''
endfunction

" Dimension of window with lines relative to cursor
" Width & height excludes border & padding
function! coc#float#get_config_cursor(lines, config) abort
  let preferTop = get(a:config, 'preferTop', 0)
  let title = get(a:config, 'title', '')
  let border = get(a:config, 'border', [0, 0, 0, 0])
  if s:empty_border(border) && len(title)
    let border = [1, 1, 1, 1]
  endif
  let bh = get(border, 0, 0) + get(border, 2, 0)
  let vh = &lines - &cmdheight - 1
  if vh <= 0
    return v:null
  endif
  let maxWidth = min([get(a:config, 'maxWidth', 80), &columns - 1])
  if maxWidth < 3
    return v:null
  endif
  let maxHeight = min([get(a:config, 'maxHeight', 80), vh])
  let ch = 0
  let width = min([40, strdisplaywidth(title)]) + 3
  for line in a:lines
    let dw = max([1, strdisplaywidth(line)])
    let width = max([width, dw + 2])
    let ch += float2nr(ceil(str2float(string(dw))/(maxWidth - 2)))
  endfor
  let width = min([maxWidth, width])
  let [lineIdx, colIdx] = s:win_position()
  " How much we should move left
  let offsetX = min([get(a:config, 'offsetX', 0), colIdx])
  let showTop = 0
  let hb = vh - lineIdx -1
  if lineIdx > bh + 2 && (preferTop || (lineIdx > hb && hb < ch + bh))
    let showTop = 1
  endif
  let height =  min([maxHeight, ch + bh, showTop ? lineIdx - 1 : hb])
  if height <= bh
    return v:null
  endif
  let col = - max([offsetX, colIdx - (&columns - 1 - width)])
  let row = showTop ? - height : 1
  return {
        \ 'row': row,
        \ 'col': col,
        \ 'width': width - 2,
        \ 'height': height - bh
        \ }
endfunction

function! coc#float#get_config_pum(lines, pumconfig, maxwidth) abort
  if !pumvisible()
    return v:null
  endif
  let pw = a:pumconfig['width'] + get(a:pumconfig, 'scrollbar', 0)
  let rp = &columns - a:pumconfig['col'] - pw
  let showRight = a:pumconfig['col'] > rp ? 0 : 1
  let maxWidth = showRight ? min([rp - 1, a:maxwidth]) : min([a:pumconfig['col'] - 1, a:maxwidth])
  let maxHeight = &lines - a:pumconfig['row'] - &cmdheight - 1
  if maxWidth <= 2 || maxHeight < 1
    return v:null
  endif
  let ch = 0
  let width = 0
  for line in a:lines
    let dw = max([1, strdisplaywidth(line)])
    let width = max([width, dw + 2])
    let ch += float2nr(ceil(str2float(string(dw))/(maxWidth - 2)))
  endfor
  let width = min([maxWidth, width])
  let height = min([maxHeight, ch])
  return {
    \ 'col': showRight ? a:pumconfig['col'] + pw : a:pumconfig['col'] - width - 1,
    \ 'row': a:pumconfig['row'],
    \ 'height': height,
    \ 'width': width - 2 + (s:is_vim && ch > height ? -1 : 0),
    \ 'relative': 'editor'
    \ }
endfunction

function! s:empty_border(border) abort
  if empty(a:border)
    return 1
  endif
  if a:border[0] == 0 && a:border[1] == 0 && a:border[2] == 0 && a:border[3] == 0
    return 1
  endif
  return 0
endfunction

" Show float window/popup for user confirm.
function! coc#float#prompt_confirm(title, cb) abort
  if s:is_vim && exists('*popup_dialog')
    try
      call popup_dialog(a:title. ' (y/n)?', {
        \ 'highlight': 'Normal',
        \ 'filter': 'popup_filter_yesno',
        \ 'callback': {id, res -> a:cb(v:null, res)},
        \ 'borderchars': ['─', '│', '─', '│', '┌', '┐', '┘', '└'],
        \ 'borderhighlight': ['MoreMsg']
        \ })
    catch /.*/
      call a:cb(v:exception)
    endtry
    return
  endif
  if has('nvim-0.4.3')
    let text = ' '. a:title . ' (y/n)? '
    let bufnr = s:create_tmp_buf([text])
    let maxWidth = min([78, &columns - 2])
    let width = min([maxWidth, strdisplaywidth(text)])
    let maxHeight = &lines - &cmdheight - 1
    let height = min([maxHeight, float2nr(ceil(str2float(string(strdisplaywidth(text)))/width))])
    let arr =  coc#float#create_float_win(0, bufnr, {
          \ 'col': &columns/2 - width/2 - 1,
          \ 'row': maxHeight/2 - height/2 - 1,
          \ 'width': width,
          \ 'height': height,
          \ 'border': [1,1,1,1],
          \ 'focusable': v:false,
          \ 'relative': 'editor',
          \ 'highlight': 'Normal',
          \ 'borderhighlight': ['MoreMsg'],
          \ 'style': 'minimal',
          \ })
    if empty(arr)
      call a:cb('Window create failed!')
      return
    endif
    let winid = arr[0]
    let res = 0
    redraw
    " same result as vim
    while 1
      let key = nr2char(getchar())
      if key == "\<C-c>"
        let res = -1
        break
      elseif key == "\<esc>" || key == 'n' || key == 'N'
        let res = 0
        break
      elseif key == 'y' || key == 'Y'
        let res = 1
        break
      endif
    endw
    call coc#float#close(winid)
    call a:cb(v:null, res)
    " use relative editor since neovim doesn't support center position
  elseif exists('*confirm')
    let choice = confirm(a:title, "&Yes\n&No")
    call a:cb(v:null, choice == 1)
  else
    echohl MoreMsg
    echom a:title.' (y/n)'
    echohl None
    let confirm = nr2char(getchar())
    redraw!
    if !(confirm ==? "y" || confirm ==? "\r")
      echohl Moremsg | echo 'Cancelled.' | echohl None
      return 0
      call a:cb(v:null, 0)
    end
    call a:cb(v:null, 1)
  endif
endfunction

" Create buttons popup on vim
function! coc#float#vim_buttons(winid, config, related) abort
  if !has('patch-8.2.0750')
    return
  endif
  let winid = coc#float#get_related(a:winid, 'buttons')
  let btns = get(a:config, 'buttons', [])
  if empty(btns)
    if winid
      call s:close_win(winid)
      " fix padding
      let opts = popup_getoptions(a:winid)
      let padding = get(opts, 'padding', v:null)
      if !empty(padding)
        let padding[2] = padding[2] - 2
      endif
      call popup_setoptions(a:winid, {'padding': padding})
    endif
    return
  endif
  let border = get(a:config, 'border', v:null)
  if !winid
    " adjusting popup padding
    let opts = popup_getoptions(a:winid)
    let padding = get(opts, 'padding', v:null)
    if type(padding) == 7
      let padding = [0, 0, 2, 0]
    elseif len(padding) == 0
      let padding = [1, 1, 3, 1]
    else
      let padding[2] = padding[2] + 2
    endif
    call popup_setoptions(a:winid, {'padding': padding})
  endif
  let pos = popup_getpos(a:winid)
  let bw = empty(border) ? 0 : get(border, 1, 0) + get(border, 3, 0)
  let borderbottom = empty(border) ? 0 : get(border, 2, 0)
  let borderleft = empty(border) ? 0 : get(border, 3, 0)
  let width = pos['width'] - bw + get(pos, 'scrollbar', 0)
  let bufnr = s:create_btns_buffer(winid ? winbufnr(winid): 0,width, btns, borderbottom)
  let height = 2 + (borderbottom ? 1 : 0)
  let keys = s:gen_filter_keys(getbufline(bufnr, 2)[0])
  let options = {
        \ 'filter': {id, key -> coc#float#vim_filter(id, key, keys[1])},
        \ 'highlight': get(opts, 'highlight', 'CocFloating')
        \ }
  let config = {
        \ 'line': pos['line'] + pos['height'] - height,
        \ 'col': pos['col'] + borderleft,
        \ 'minwidth': width,
        \ 'minheight': height,
        \ 'maxwidth': width,
        \ 'maxheight': height,
        \ }
  if winid != 0
    call popup_move(winid, config)
    call popup_setoptions(winid, options)
    call win_execute(winid, 'call clearmatches()')
  else
    let options = extend({
          \ 'filtermode': 'nvi',
          \ 'padding': [0, 0, 0, 0],
          \ 'fixed': 1,
          \ 'zindex': 99,
          \ }, options)
    call extend(options, config)
    let winid = popup_create(bufnr, options)
  endif
  if winid != 0
    call setwinvar(winid, 'kind', 'buttons')
    call setwinvar(winid, 'target_winid', a:winid)
    call add(a:related, winid)
    call matchaddpos('MoreMsg', map(keys[0], "[2,v:val]"), 99, -1, {'window': winid})
  endif
endfunction

" draw buttons window for window with config
function! coc#float#nvim_buttons(config, buttons, borderbottom, pad, related) abort
  let width = a:config['width'] + (a:pad ? 1 : 0)
  let bufnr = s:create_btns_buffer(0, width, a:buttons, a:borderbottom)
  let winid = nvim_open_win(bufnr, 0, {
    \ 'row': a:config['row'] + a:config['height'],
    \ 'col': a:config['col'],
    \ 'width': width,
    \ 'height': 2 + (a:borderbottom ? 1 : 0),
    \ 'relative': a:config['relative'],
    \ 'focusable': 1,
    \ 'style': 'minimal',
    \ })
  if winid
    call setwinvar(winid, 'kind', 'buttons')
    call add(a:related, winid)
    call s:nvim_create_keymap(winid)
  endif
endfunction

function! coc#float#nvim_float_click() abort
  let kind = getwinvar(win_getid(), 'kind', '')
  if kind == 'buttons'
    if line('.') != 2
      return
    endif
    let vw = strdisplaywidth(strpart(getline('.'), 0, col('.') - 1))
    let vcols = getbufvar(bufnr('%'), 'vcols', [])
    if index(vcols, vw) >= 0
      return
    endif
    let idx = 0
    if !empty(vcols)
      let filtered = filter(vcols, 'v:val < vw')
      let idx = idx + len(filtered)
    endif
    let winid = win_getid()
    let target = getwinvar(winid, 'target_winid', 0)
    if target
      call coc#rpc#notify('FloatBtnClick', [winbufnr(target), idx])
      call coc#float#close(target)
    endif
  elseif kind == 'close'
    let target = getwinvar(win_getid(), 'target_winid', 0)
    call coc#float#close(target)
  endif
endfunction

" Add <LeftRelease> mapping if necessary
function! coc#float#nvim_win_enter(winid) abort
  let kind = getwinvar(a:winid, 'kind', '')
  if kind == 'buttons' || kind == 'close'
    if empty(maparg('<LeftRelease>', 'n'))
      nnoremap <buffer><silent> <LeftRelease> :call coc#float#nvim_float_click()<CR>
    endif
  endif
endfunction

function! coc#float#vim_filter(winid, key, keys) abort
  let key = tolower(a:key)
  let idx = index(a:keys, key)
  let target = getwinvar(a:winid, 'target_winid', 0)
  if target && idx >= 0
    call coc#rpc#notify('FloatBtnClick', [winbufnr(target), idx])
    call coc#float#close(target)
    return 1
  endif
  return 0
endfunction

" Create dialog at center
function! coc#float#create_dialog(lines, config) abort
  " dialog always have borders
  let title = get(a:config, 'title', '')
  let buttons = get(a:config, 'buttons', [])
  let highlight = get(a:config, 'highlight', 'CocFloating')
  let borderhighlight = get(a:config, 'borderhighlight', [highlight])
  let maxheight = min([get(a:config, 'maxheight', 78), &lines - &cmdheight - 6])
  let maxwidth = min([get(a:config, 'maxwidth', 78), &columns - 2])
  let close = get(a:config, 'close', 1)
  let minwidth = 0
  if !empty(buttons)
    let minwidth = len(buttons)*3 - 1
    for txt in buttons
      let minwidth = minwidth + strdisplaywidth(txt)
    endfor
  endif
  if maxheight <= 0 || maxwidth <= 0 || minwidth > maxwidth
    throw 'Not enough spaces for dialog'
  endif
  let ch = 0
  let width = min([strdisplaywidth(title) + 1, maxwidth])
  for line in a:lines
    let dw = max([1, strdisplaywidth(line)])
    if dw < maxwidth && dw > width
      let width = dw
    elseif dw > maxwidth
      let width = maxwidth
    endif
    let ch += float2nr(ceil(str2float(string(dw))/maxwidth))
  endfor
  let width = max([minwidth, width])
  let height = min([ch ,maxheight])
  let opts = {
    \ 'relative': 'editor',
    \ 'col': &columns/2 - (width + 2)/2,
    \ 'row': &lines/2 - (height + 4)/2,
    \ 'width': width,
    \ 'height': height,
    \ 'border': [1,1,1,1],
    \ 'title': title,
    \ 'close': close,
    \ 'highlight': highlight,
    \ 'buttons': buttons,
    \ 'borderhighlight': borderhighlight,
    \ }
  let bufnr = s:create_tmp_buf(a:lines)
  let res =  coc#float#create_float_win(0, bufnr, opts)
  if res[0] && has('nvim')
    call coc#float#nvim_scrollbar(res[0])
  endif
  return res
endfunction

function! coc#float#get_related(winid, kind) abort
  for winid in getwinvar(a:winid, 'related', [])
    if getwinvar(winid, 'kind', '') ==# a:kind
      return winid
    endif
  endfor
  return 0
endfunction

" Create temporarily buffer with optional lines
function! s:create_tmp_buf(...) abort
  if s:is_vim
    noa let bufnr = bufadd('')
    noa call bufload(bufnr)
  else
    noa let bufnr = nvim_create_buf(v:false, v:true)
  endif
  call setbufvar(bufnr, '&buftype', 'nofile')
  call setbufvar(bufnr, '&bufhidden', 'wipe')
  call setbufvar(bufnr, '&swapfile', 0)
  call setbufvar(bufnr, '&undolevels', -1)
  let lines = get(a:, 1, [])
  if !empty(lines)
    if s:is_vim
      call setbufline(bufnr, 1, lines)
    else
      call nvim_buf_set_lines(bufnr, 0, -1, v:false, lines)
    endif
  endif
  return bufnr
endfunction

function! s:create_btns_buffer(bufnr, width, buttons, borderbottom) abort
  let n = len(a:buttons)
  let spaces = a:width - n + 1
  let tw = 0
  for txt in a:buttons
    let tw += strdisplaywidth(txt)
  endfor
  if spaces < tw
    throw 'window is too small for buttons.'
  endif
  let ds = (spaces - tw)/n
  let dl = ds/2
  let dr = ds%2 == 0 ? ds/2 : ds/2 + 1
  let btnline = ''
  let idxes = []
  for idx in range(0, n - 1)
    let txt = toupper(a:buttons[idx][0]).a:buttons[idx][1:]
    let btnline .= repeat(' ', dl).txt.repeat(' ', dr)
    if idx != n - 1
      call add(idxes, strdisplaywidth(btnline))
      let btnline .= '│'
    endif
  endfor
  let lines = [repeat('─', a:width), btnline]
  if a:borderbottom
    call add(lines, repeat('─', a:width))
  endif
  for idx in idxes
    let lines[0] = strcharpart(lines[0], 0, idx).s:borderjoinchars[0].strcharpart(lines[0], idx + 1)
    if a:borderbottom
      let lines[2] = strcharpart(lines[0], 0, idx).s:borderjoinchars[2].strcharpart(lines[0], idx + 1)
    endif
  endfor
  let bufnr = a:bufnr && bufloaded(a:bufnr) ? a:bufnr : s:create_tmp_buf()
  call setbufvar(bufnr, 'vcols', idxes)
  if s:is_vim
    call setbufline(bufnr, 1, lines)
  else
    call nvim_buf_set_lines(bufnr, 0, -1, v:false, lines)
  endif
  return bufnr
endfunction

function! s:gen_filter_keys(line) abort
  let cols = []
  let used = []
  let next = 1
  for idx in  range(0, strchars(a:line) - 1)
    let ch = strcharpart(a:line, idx, 1)
    let nr = char2nr(ch)
    if next
      if (nr >= 65 && nr <= 90) || (nr >= 97 && nr <= 122)
        let lc = tolower(ch)
        if index(used, lc) < 0 && empty(maparg(lc, 'n'))
          let col = len(strcharpart(a:line, 0, idx)) + 1
          call add(used, lc)
          call add(cols, col)
          let next = 0
        endif
      endif
    else
      if ch == '│'
        let next = 1
      endif
    endif
  endfor
  return [cols, used]
endfunction

function! s:close_win(winid) abort
  if a:winid == 0
    return
  endif
  " vim not throw for none exists winid
  if s:is_vim
    call popup_close(a:winid)
  else
    if nvim_win_is_valid(a:winid)
      call nvim_win_close(a:winid, 1)
    endif
  endif
endfunction

function! s:nvim_create_keymap(winid) abort
  let curr = win_getid()
  " nvim should support win_execute so we don't break visual mode.
  let m = mode()
  if m == 'n' || m == 'i' || m == 'ic'
    noa call win_gotoid(a:winid)
    nnoremap <buffer><silent> <LeftRelease> :call coc#float#nvim_float_click()<CR>
    noa call win_gotoid(curr)
  endif
endfunction
