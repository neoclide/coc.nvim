scriptencoding utf-8
" Related to float window create
let s:is_vim = !has('nvim')
let s:root = expand('<sfile>:h:h:h')
let s:progresschars = get(g:, 'coc_progress_chars', ['░', '▇'])
let s:borderchars = get(g:, 'coc_borderchars', ['─', '│', '─', '│', '┌', '┐', '┘', '└'])
let s:borderjoinchars = get(g:, 'coc_border_joinchars', ['┬', '┤', '┴', '├'])
let s:prompt_win_width = get(g:, 'coc_prompt_win_width', 32)
let s:prompt_win_bufnr = 0
let s:float_supported = exists('*nvim_open_win') || has('patch-8.1.1719')
let s:popup_list_api = exists('*popup_list')
" Popup ids, used when popup_list() not exists
let s:popup_list = []
" winvar: border array of numbers,  button boolean

" Check visible float/popup exists.
function! coc#float#has_float(...) abort
  return len(coc#float#get_float_win_list(get(a:, 1, 0))) > 0
endfunction

function! coc#float#close_all(...) abort
  let winids = coc#float#get_float_win_list(get(a:, 1, 0))
  for id in winids
    try
      call coc#float#close(id)
    catch /E5555:/
      " ignore
    endtry
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

" create or config float window, returns [winid, bufnr], config including:
" - relative:  could be 'editor' 'cursor'
" - row: line count relative to editor/cursor, nagetive number means abover cursor.
" - col: column count relative to editor/cursor, nagetive number means left of cursor.
" - width: content width without border and title.
" - height: content height without border and title.
" - lines: (optional) lines to insert, default to v:null.
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
  let lines = get(a:config, 'lines', v:null)
  let bufnr = coc#float#create_buf(a:bufnr, lines, 'hide')
  " use exists
  if a:winid && coc#float#valid(a:winid)
    if s:is_vim
      let [line, col] = s:popup_position(a:config)
      let opts = {
            \ 'firstline': 1,
            \ 'line': line,
            \ 'col': col,
            \ 'minwidth': a:config['width'],
            \ 'minheight': a:config['height'],
            \ 'maxwidth': a:config['width'],
            \ 'maxheight': a:config['height'],
            \ 'cursorline': get(a:config, 'cursorline', 0),
            \ 'title': get(a:config, 'title', ''),
            \ }
      if !s:empty_border(get(a:config, 'border', []))
        let opts['border'] = a:config['border']
      endif
      call popup_setoptions(a:winid, opts)
      call coc#float#vim_buttons(a:winid, a:config)
      return [a:winid, winbufnr(a:winid)]
    else
      let config = s:convert_config_nvim(a:config)
      call nvim_win_set_buf(a:winid, bufnr)
      call nvim_win_set_config(a:winid, config)
      call nvim_win_set_cursor(a:winid, [1, 0])
      call coc#float#nvim_create_related(a:winid, config, a:config)
      return [a:winid, bufnr]
    endif
  endif
  let winid = 0
  if s:is_vim
    let [line, col] = s:popup_position(a:config)
    let title = get(a:config, 'title', '')
    let buttons = get(a:config, 'buttons', [])
    let hlgroup = get(a:config, 'highlight',  'CocFloating')
    let opts = {
          \ 'title': title,
          \ 'line': line,
          \ 'col': col,
          \ 'fixed': 1,
          \ 'padding': empty(title) ?  [0, 1, 0, 1] : [0, 0, 0, 0],
          \ 'borderchars': s:borderchars,
          \ 'highlight': hlgroup,
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
      let opts['borderhighlight'] = map(a:config['borderhighlight'], 'coc#highlight#compose_hlgroup(v:val,"'.hlgroup.'")')
    endif
    if !s:empty_border(get(a:config, 'border', []))
      let opts['border'] = a:config['border']
    endif
    let winid = popup_create(bufnr, opts)
    if !s:popup_list_api
      call add(s:popup_list, winid)
    endif
    if winid == 0
      return []
    endif
    call coc#float#vim_buttons(winid, a:config)
    if has("patch-8.1.2281")
      call setwinvar(winid, '&showbreak', 'NONE')
    endif
  else
    let config = s:convert_config_nvim(a:config)
    noa let winid = nvim_open_win(bufnr, 0, config)
    if winid == 0
      return []
    endif
    let hlgroup = get(a:config, 'highlight', 'CocFloating')
    call setwinvar(winid, '&winhl', 'Normal:'.hlgroup.',NormalNC:'.hlgroup.',FoldColumn:'.hlgroup)
    call setwinvar(winid, '&signcolumn', 'no')
    call setwinvar(winid, '&foldenable', 0)
    " cursorline highlight not work on old neovim
    call setwinvar(winid, '&cursorline', 0)
    call setwinvar(winid, 'border', get(a:config, 'border', []))
    " no left border
    if s:empty_border(get(a:config, 'border', [])) || a:config['border'][3] == 0
      call setwinvar(winid, '&foldcolumn', 1)
    else
      call setwinvar(winid, '&foldcolumn', 0)
    endif
    call nvim_win_set_cursor(winid, [1, 0])
    call coc#float#nvim_create_related(winid, config, a:config)
  endif
  if get(a:config, 'autohide', 0)
    call setwinvar(winid, 'autohide', 1)
  endif
  if s:is_vim || has('nvim-0.5.0')
    call setwinvar(winid, '&scrolloff', 0)
  endif
  call setwinvar(winid, 'float', 1)
  call setwinvar(winid, '&list', 0)
  call setwinvar(winid, '&number', 0)
  call setwinvar(winid, '&relativenumber', 0)
  call setwinvar(winid, '&cursorcolumn', 0)
  call setwinvar(winid, '&colorcolumn', 0)
  call setwinvar(winid, '&wrap', 1)
  call setwinvar(winid, '&linebreak', 1)
  call setwinvar(winid, '&conceallevel', 0)
  let g:coc_last_float_win = winid
  call coc#util#do_autocmd('CocOpenFloat')
  return [winid, bufnr]
endfunction

function! coc#float#valid(winid) abort
  if a:winid <= 0
    return 0
  endif
  if has('nvim')
    return nvim_win_is_valid(a:winid) ? 1 : 0
  endif
  return s:popup_visible(a:winid)
endfunction

function! coc#float#nvim_create_related(winid, config, opts) abort
  let related = getwinvar(a:winid, 'related', [])
  let exists = !empty(related)
  let border = get(a:opts, 'border', [])
  let highlights = get(a:opts, 'borderhighlight', [])
  let hlgroup = get(a:opts, 'highlight', 'CocFloating')
  let borderhighlight = type(highlights) == 1 ? highlights : get(highlights, 0, 'CocFloating')
  let borderhighlight =  coc#highlight#compose_hlgroup(borderhighlight, hlgroup)
  let title = get(a:opts, 'title', '')
  let buttons = get(a:opts, 'buttons', [])
  let pad = empty(border) || get(border, 1, 0) == 0
  if get(a:opts, 'close', 0)
    call coc#float#nvim_close_btn(a:config, a:winid, border, borderhighlight, related)
  elseif exists
    call coc#float#close_related(a:winid, 'close')
  endif
  if !empty(buttons)
    call coc#float#nvim_buttons(a:config, a:winid, buttons, get(border, 2, 0), pad, hlgroup, borderhighlight, related)
  elseif exists
    call coc#float#close_related(a:winid, 'buttons')
  endif
  if !s:empty_border(border)
    call coc#float#nvim_border_win(a:config, a:winid, border, title, !empty(buttons), borderhighlight, related)
  elseif exists
    call coc#float#close_related(a:winid, 'border')
  endif
  " Check right border
  if pad
    call coc#float#nvim_right_pad(a:config, a:winid, hlgroup, related)
  elseif exists
    call coc#float#close_related(a:winid, 'pad')
  endif
  call setwinvar(a:winid, 'related', filter(related, 'nvim_win_is_valid(v:val)'))
endfunction

" border window for neovim, content config with border
function! coc#float#nvim_border_win(config, winid, border, title, hasbtn, hlgroup, related) abort
  let winid = coc#float#get_related(a:winid, 'border')
  let row = a:border[0] ? a:config['row'] - 1 : a:config['row']
  let col = a:border[3] ? a:config['col'] - 1 : a:config['col']
  let width = a:config['width'] + a:border[1] + a:border[3]
  let height = a:config['height'] + a:border[0] + a:border[2] + (a:hasbtn ? 2 : 0)
  let lines = coc#float#create_border_lines(a:border, a:title, a:config['width'], a:config['height'], a:hasbtn)
  let bufnr = winid ? winbufnr(winid) : 0
  let bufnr = coc#float#create_buf(bufnr, lines)
  let opt = {
        \ 'relative': a:config['relative'],
        \ 'width': width,
        \ 'height': height,
        \ 'row': row,
        \ 'col': col,
        \ 'focusable': v:false,
        \ 'style': 'minimal',
        \ }
  if winid
    call nvim_win_set_config(winid, opt)
    call setwinvar(winid, '&winhl', 'Normal:'.a:hlgroup.',NormalNC:'.a:hlgroup)
  else
    noa let winid = nvim_open_win(bufnr, 0, opt)
    if winid
      call setwinvar(winid, '&winhl', 'Normal:'.a:hlgroup.',NormalNC:'.a:hlgroup)
      call setwinvar(winid, 'target_winid', a:winid)
      call setwinvar(winid, 'kind', 'border')
      call add(a:related, winid)
    endif
  endif
endfunction

" neovim only
function! coc#float#nvim_close_btn(config, winid, border, hlgroup, related) abort
  let winid = coc#float#get_related(a:winid, 'close')
  let config = {
        \ 'relative': a:config['relative'],
        \ 'width': 1,
        \ 'height': 1,
        \ 'row': get(a:border, 0, 0) ? a:config['row'] - 1 : a:config['row'],
        \ 'col': a:config['col'] + a:config['width'],
        \ 'focusable': v:true,
        \ 'style': 'minimal',
        \ }
  if winid
    call nvim_win_set_config(winid, config)
  else
    let bufnr = coc#float#create_buf(0, ['X'])
    noa let winid = nvim_open_win(bufnr, 0, config)
    if winid
      call setwinvar(winid, '&winhl', 'Normal:'.a:hlgroup.',NormalNC:'.a:hlgroup)
      call setwinvar(winid, 'target_winid', a:winid)
      call setwinvar(winid, 'kind', 'close')
      call add(a:related, winid)
    endif
    call s:nvim_create_keymap(winid)
  endif
endfunction

" Create padding window by config of current window & border config
function! coc#float#nvim_right_pad(config, winid, hlgroup, related) abort
  let winid = coc#float#get_related(a:winid, 'pad')
  let bufnr = 0
  let config = {
        \ 'relative': a:config['relative'],
        \ 'width': 1,
        \ 'height': a:config['height'],
        \ 'row': a:config['row'],
        \ 'col': a:config['col'] + a:config['width'],
        \ 'focusable': v:false,
        \ 'style': 'minimal',
        \ }
  if winid && nvim_win_is_valid(winid)
    let bufnr = nvim_win_get_buf(winid)
    noa call nvim_win_close(winid, 1)
  endif
  let bufnr = coc#float#create_buf(bufnr, repeat([''], a:config['height']))
  noa let winid = nvim_open_win(bufnr, 0, config)
  if winid
    " minimal not work
    if !has('nvim-0.4.3')
      call setwinvar(winid, '&colorcolumn', 0)
      call setwinvar(winid, '&number', 0)
      call setwinvar(winid, '&relativenumber', 0)
      call setwinvar(winid, '&foldcolumn', 0)
      call setwinvar(winid, '&signcolumn', 0)
    endif
    call setwinvar(winid, '&winhl', 'Normal:'.a:hlgroup.',NormalNC:'.a:hlgroup)
    call setwinvar(winid, 'target_winid', a:winid)
    call setwinvar(winid, 'kind', 'pad')
    call add(a:related, winid)
  endif
endfunction

" draw buttons window for window with config
function! coc#float#nvim_buttons(config, winid, buttons, borderbottom, pad, hlgroup, borderhighlight, related) abort
  let winid = coc#float#get_related(a:winid, 'buttons')
  let width = a:config['width'] + (a:pad ? 1 : 0)
  let config = {
        \ 'row': a:config['row'] + a:config['height'],
        \ 'col': a:config['col'],
        \ 'width': width,
        \ 'height': 2 + (a:borderbottom ? 1 : 0),
        \ 'relative': a:config['relative'],
        \ 'focusable': 1,
        \ 'style': 'minimal',
        \ }
  if winid
    let bufnr = winbufnr(winid)
    call s:create_btns_buffer(bufnr, width, a:buttons, a:borderbottom)
    call nvim_win_set_config(winid, config)
  else
    let bufnr = s:create_btns_buffer(0, width, a:buttons, a:borderbottom)
    noa let winid = nvim_open_win(bufnr, 0, config)
    if winid
      call setwinvar(winid, '&winhl', 'Normal:'.a:hlgroup.',NormalNC:'.a:hlgroup)
      call setwinvar(winid, 'target_winid', a:winid)
      call setwinvar(winid, 'kind', 'buttons')
      call add(a:related, winid)
      call s:nvim_create_keymap(winid)
    endif
  endif
  if bufnr && a:hlgroup != a:borderhighlight
    call nvim_buf_clear_namespace(bufnr, -1, 0, -1)
    call nvim_buf_add_highlight(bufnr, 1, a:borderhighlight, 0, 0, -1)
    if a:borderbottom
      call nvim_buf_add_highlight(bufnr, 1, a:borderhighlight, 2, 0, -1)
    endif
    let vcols = getbufvar(bufnr, 'vcols', [])
    " TODO need change vol to col
    for col in vcols
      call nvim_buf_add_highlight(bufnr, 1, a:borderhighlight, 1, col, col + 3)
    endfor
  endif
endfunction

" Create or refresh scrollbar for winid
" Need called on create, config, buffer change, scrolled
function! coc#float#nvim_scrollbar(winid) abort
  if !has('nvim-0.4.0') || !coc#float#valid(a:winid) || getwinvar(a:winid, 'target_winid', 0)
    return
  endif
  let config = nvim_win_get_config(a:winid)
  let [row, column] = nvim_win_get_position(a:winid)
  let relative = 'editor'
  if row == 0 && column == 0
    " fix bad value when ext_multigrid is enabled. https://github.com/neovim/neovim/issues/11935
    let [row, column] = [config.row, config.col]
    let relative = config.relative
  endif
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
  call coc#float#close_related(a:winid, 'pad')
  let sbuf = id ? winbufnr(id) : 0
  let sbuf = coc#float#create_buf(sbuf, repeat([' '], height))
  let opts = {
        \ 'row': move_down ? row + 1 : row,
        \ 'col': column + width,
        \ 'relative': relative,
        \ 'width': 1,
        \ 'height': height,
        \ 'focusable': v:false,
        \ 'style': 'minimal',
        \ }
  if id
    call nvim_win_set_config(id, opts)
  else
    noa let id = nvim_open_win(sbuf, 0 , opts)
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
    " needed for correct getwininfo
    let firstline = wininfo['topline']
    let lastline = s:nvim_get_botline(firstline, height, cw, bufnr)
    let linecount = nvim_buf_line_count(winbufnr(a:winid))
    if lastline >= linecount
      let start = height - thumb_height
    else
      let start = max([1, float2nr(round((height - thumb_height + 0.0)*(firstline - 1.0)/(ch - height)))])
    endif
  endif
  " add highlights
  call nvim_buf_clear_namespace(sbuf, -1, 0, -1)
  for idx in range(0, height - 1)
    if idx >= start && idx < start + thumb_height
      call nvim_buf_add_highlight(sbuf, -1, 'PmenuThumb', idx, 0, 1)
    else
      call nvim_buf_add_highlight(sbuf, -1, 'PmenuSbar', idx, 0, 1)
    endif
  endfor
  call s:add_related(id, a:winid)
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

" Get config, convert lines, create window, add highlights
function! coc#float#create_cursor_float(winid, bufnr, lines, config) abort
  if !s:float_supported
    return v:null
  endif
  if s:is_blocking()
    return v:null
  endif
  let pumAlignTop = get(a:config, 'pumAlignTop', 0)
  let modes = get(a:config, 'modes', ['n', 'i', 'ic', 's'])
  let mode = mode()
  let currbuf = bufnr('%')
  let pos = [line('.'), col('.')]
  if index(modes, mode) == -1
    return v:null
  endif
  if has('nvim') && mode ==# 'i'
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
  let width = dimension['width']
  let lines = map(a:lines, {_, s -> s =~# '^—' ? repeat('—', width) : s})
  let config = extend(extend({'lines': lines, 'relative': 'cursor'}, a:config), dimension)
  call coc#float#close_auto_hide_wins(a:winid)
  let res = coc#float#create_float_win(a:winid, a:bufnr, config)
  if empty(res)
    return v:null
  endif
  let alignTop = dimension['row'] < 0
  let winid = res[0]
  let bufnr = res[1]
  call coc#highlight#add_highlights(winid, get(a:config, 'codes', []), get(a:config, 'highlights', []))
  redraw
  if has('nvim')
    call coc#float#nvim_scrollbar(winid)
  endif
  return [currbuf, pos, winid, bufnr, alignTop]
endfunction

" Create float window for input
function! coc#float#create_prompt_win(title, default, opts) abort
  call coc#float#close_auto_hide_wins()
  " Calculate col
  let curr = win_screenpos(winnr())[1] + wincol() - 2
  let width = coc#helper#min(max([strdisplaywidth(a:default) + 2, s:prompt_win_width]), &columns - 2)
  if width == &columns - 2
    let col = 0 - curr
  else
    let col = curr + width <= &columns - 2 ? 0 : &columns - s:prompt_win_width
  endif
  let [lineIdx, colIdx] = coc#util#cursor_pos()
  let bufnr = 0
  if has('nvim')
    let bufnr = s:prompt_win_bufnr
  else
    execute 'hi link CocPopupTerminal '.get(a:opts, 'highlight', 'CocFloating')
    let node =  expand(get(g:, 'coc_node_path', 'node'))
    let bufnr = term_start([node, s:root . '/bin/prompt.js', a:default], {
          \ 'term_highlight': 'CocPopupTerminal',
          \ 'hidden': 1,
          \ 'term_finish': 'close'
          \ })
    call term_setapi(bufnr, "Coc")
  endif
  let res = coc#float#create_float_win(0, bufnr, {
        \ 'relative': 'cursor',
        \ 'row': lineIdx == 0 ? 1 : 0,
        \ 'col': colIdx == 0 ? 0 : col - 1,
        \ 'width': width,
        \ 'height': 1,
        \ 'style': 'minimal',
        \ 'border': [1,1,1,1],
        \ 'prompt': 1,
        \ 'title': a:title,
        \ 'lines': s:is_vim ? v:null : [a:default],
        \ 'highlight': get(a:opts, 'highlight', 'CocFloating'),
        \ 'borderhighlight': [get(a:opts, 'borderhighlight', 'CocFloating')],
        \ })
  if empty(res) || res[0] == 0
    return
  endif
  let winid = res[0]
  let bufnr = res[1]
  if has('nvim')
    let s:prompt_win_bufnr = res[1]
    execute 'sign unplace 6 buffer='.s:prompt_win_bufnr
    call nvim_set_current_win(winid)
    inoremap <buffer> <C-a> <Home>
    inoremap <buffer><expr><C-e> pumvisible() ? "\<C-e>" : "\<End>"
    exe 'inoremap <silent><buffer> <esc> <C-r>=coc#float#close_i('.winid.')<CR><esc>'
    exe 'nnoremap <silent><buffer> <esc> :call coc#float#close('.winid.')<CR>'
    exe 'inoremap <silent><expr><nowait><buffer> <cr> "\<C-r>=coc#float#prompt_insert(getline(''.''))\<cr>\<esc>"'
    call feedkeys('A', 'in')
  endif
  return [bufnr, winid]
endfunction

function! coc#float#close_i(winid) abort
  call coc#float#close(a:winid)
  return ''
endfunction

function! coc#float#prompt_insert(text) abort
  call coc#rpc#notify('PromptInsert', [a:text])
  return ''
endfunction

" Close float window by id
function! coc#float#close(winid) abort
  call coc#float#close_related(a:winid)
  call s:close_win(a:winid)
  return 1
endfunction

" Float window id on current tab.
" return 0 if not found, used by test only
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
  else
    let ids = s:popup_list_api ?  popup_list() : s:popup_list
    return get(filter(ids, 's:popup_visible(v:val)'), 0, 0)
  endif
  return 0
endfunction

function! coc#float#get_float_win_list(...) abort
  let res = []
  let all = get(a:, 1, 0)
  if s:is_vim
    if s:popup_list_api
      return filter(popup_list(), 'popup_getpos(v:val)["visible"]'.(all ? '' : '&& getwinvar(v:val, "float", 0)'))
    endif
    return filter(s:popup_list, 's:popup_visible(v:val)')
  elseif has('nvim') && exists('*nvim_win_get_config')
    let res = []
    for i in range(1, winnr('$'))
      let id = win_getid(i)
      let config = nvim_win_get_config(id)
      if empty(config) || empty(config['relative'])
        continue
      endif
      " ignore border & button window & others
      if !all && !getwinvar(id, 'float', 0)
        continue
      endif
      call add(res, id)
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
  if !has('nvim-0.4.0') && !has('patch-8.2.0750')
    throw 'coc#float#scroll() requires nvim >= 0.4.0 or vim >= 8.2.0750'
  endif
  let amount = get(a:, 1, 0)
  let winids = filter(coc#float#get_float_win_list(), 'coc#float#scrollable(v:val)')
  if empty(winids)
    return ''
  endif
  for winid in winids
    if s:is_vim
      call coc#float#scroll_win(winid, a:forward, amount)
    else
      call timer_start(0, { -> coc#float#scroll_win(winid, a:forward, amount)})
    endif
  endfor
  return mode() =~ '^i' || mode() ==# 'v' ? "" : "\<Ignore>"
endfunction

function! coc#float#scroll_win(winid, forward, amount) abort
  let opts = s:get_options(a:winid)
  let lines = getbufline(winbufnr(a:winid), 1, '$')
  let maxfirst = s:max_firstline(lines, opts['height'], opts['width'])
  let topline = opts['topline']
  let height = opts['height']
  let width = opts['width']
  let scrolloff = getwinvar(a:winid, '&scrolloff', 0)
  if a:forward && topline >= maxfirst
    return
  endif
  if !a:forward && topline == 1
    return
  endif
  if a:amount == 0
    let topline = s:get_topline(opts['topline'], lines, a:forward, height, width)
  else
    let topline = topline + (a:forward ? a:amount : - a:amount)
  endif
  let topline = a:forward ? min([maxfirst, topline]) : max([1, topline])
  let lnum = s:get_cursorline(topline, lines, scrolloff, width, height)
  call s:win_setview(a:winid, topline, lnum)
  let top = s:get_options(a:winid)['topline']
  " not changed
  if top == opts['topline']
    if a:forward
      call s:win_setview(a:winid, topline + 1, lnum + 1)
    else
      call s:win_setview(a:winid, topline - 1, lnum - 1)
    endif
  endif
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
    let result['width'] = float2nr(result['width'] + 1 - get(border,3, 0))
  else
    let result['width'] = float2nr(result['width'] + 1)
  endif
  let result['height'] = float2nr(result['height'])
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

function! coc#float#nvim_refresh_scrollbar(winid) abort
  let id = coc#float#get_related(a:winid, 'scrollbar')
  if id && nvim_win_is_valid(id)
    call coc#float#nvim_scrollbar(a:winid)
  endif
endfunction

" Close related windows, or specific kind
function! coc#float#close_related(winid, ...) abort
  let timer = getwinvar(a:winid, 'timer', 0)
  if timer
    call timer_stop(timer)
  endif
  let kind = get(a:, 1, '')
  let winids = filter(coc#float#get_float_win_list(1), 'getwinvar(v:val, "target_winid", 0) == '.a:winid)
  for id in winids
    if s:is_vim
      " vim doesn't throw
      call popup_close(id)
    elseif nvim_win_is_valid(id)
      if empty(kind) || getwinvar(id, 'kind', '') ==# kind
        noa call nvim_win_close(id, 1)
      endif
    endif
  endfor
endfunction

" Close related windows if target window is not visible.
function! coc#float#check_related() abort
  let invalids = []
  let ids = coc#float#get_float_win_list(1)
  for id in ids
    let target = getwinvar(id, 'target_winid', 0)
    if (target && index(ids, target) == -1) || getwinvar(id, 'kind', '') == 'pum'
      call add(invalids, id)
    endif
  endfor
  if !s:popup_list_api
    let s:popup_list = filter(ids, "index(invalids, v:val) == -1")
  endif
  for id in invalids
    call coc#float#close(id)
  endfor
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
  let maxWidth = coc#helper#min(get(a:config, 'maxWidth', &columns - 1), &columns - 1)
  if maxWidth < 3
    return v:null
  endif
  let maxHeight = coc#helper#min(get(a:config, 'maxHeight', vh), vh)
  let ch = 0
  let width = coc#helper#min(40, strdisplaywidth(title)) + 3
  for line in a:lines
    let dw = max([1, strdisplaywidth(line)])
    let width = max([width, dw + 2])
    let ch += float2nr(ceil(str2float(string(dw))/(maxWidth - 2)))
  endfor
  let width = coc#helper#min(maxWidth, width)
  let [lineIdx, colIdx] = coc#util#cursor_pos()
  " How much we should move left
  let offsetX = coc#helper#min(get(a:config, 'offsetX', 0), colIdx)
  let showTop = 0
  let hb = vh - lineIdx -1
  if lineIdx > bh + 2 && (preferTop || (lineIdx > hb && hb < ch + bh))
    let showTop = 1
  endif
  let height = coc#helper#min(maxHeight, ch + bh, showTop ? lineIdx - 1 : hb)
  if height <= bh
    return v:null
  endif
  let col = - max([offsetX, colIdx - (&columns - 1 - width)])
  let row = showTop ? - height + bh : 1
  return {
        \ 'row': row,
        \ 'col': col,
        \ 'width': width - 2,
        \ 'height': height - bh
        \ }
endfunction

function! coc#float#create_pum_float(winid, bufnr, lines, config) abort
  if !pumvisible() || !s:float_supported
    return v:null
  endif
  let pumbounding = a:config['pumbounding']
  let pw = pumbounding['width'] + get(pumbounding, 'scrollbar', 0)
  let rp = &columns - pumbounding['col'] - pw
  let showRight = pumbounding['col'] > rp ? 0 : 1
  let maxWidth = showRight ? coc#helper#min(rp - 1, a:config['maxWidth']) : coc#helper#min(pumbounding['col'] - 1, a:config['maxWidth'])
  let maxHeight = &lines - pumbounding['row'] - &cmdheight - 1
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
  let width = float2nr(coc#helper#min(maxWidth, width))
  let height = float2nr(coc#helper#min(maxHeight, ch))
  let lines = map(a:lines, {_, s -> s =~# '^—' ? repeat('—', width - 2 + (s:is_vim && ch > height ? -1 : 0)) : s})
  let opts = {
        \ 'lines': lines,
        \ 'relative': 'editor',
        \ 'col': showRight ? pumbounding['col'] + pw : pumbounding['col'] - width - 1,
        \ 'row': pumbounding['row'],
        \ 'height': height,
        \ 'width': width - 2 + (s:is_vim && ch > height ? -1 : 0),
        \ }
  call coc#float#close_auto_hide_wins(a:winid)
  let res = coc#float#create_float_win(a:winid, a:bufnr, opts)
  if empty(res)
    return v:null
  endif
  call coc#highlight#add_highlights(res[0], a:config['codes'], a:config['highlights'])
  call setwinvar(res[0], 'kind', 'pum')
  redraw
  if has('nvim')
    call coc#float#nvim_scrollbar(res[0])
  endif
  return res
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
        \ 'borderchars': s:borderchars,
        \ 'borderhighlight': ['MoreMsg']
        \ })
    catch /.*/
      call a:cb(v:exception)
    endtry
    return
  endif
  if has('nvim-0.4.0')
    let text = ' '. a:title . ' (y/n)? '
    let maxWidth = coc#helper#min(78, &columns - 2)
    let width = coc#helper#min(maxWidth, strdisplaywidth(text))
    let maxHeight = &lines - &cmdheight - 1
    let height = coc#helper#min(maxHeight, float2nr(ceil(str2float(string(strdisplaywidth(text)))/width)))
    call coc#float#close_auto_hide_wins()
    let arr =  coc#float#create_float_win(0, s:prompt_win_bufnr, {
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
          \ 'lines': [text],
          \ })
    if empty(arr)
      call a:cb('Window create failed!')
      return
    endif
    let winid = arr[0]
    let s:prompt_win_bufnr = arr[1]
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
function! coc#float#vim_buttons(winid, config) abort
  if !has('patch-8.2.0750')
    return
  endif
  let related = getwinvar(a:winid, 'related', [])
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
  let borderhighlight = get(get(a:config, 'borderhighlight', []), 0, '')
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
    if !s:popup_list_api
      call add(s:popup_list, winid)
    endif
  endif
  if winid != 0
    if !empty(borderhighlight)
      call coc#highlight#add_highlight(bufnr, -1, borderhighlight, 0, 0, -1)
      call coc#highlight#add_highlight(bufnr, -1, borderhighlight, 2, 0, -1)
      call win_execute(winid, 'call matchadd("'.borderhighlight.'", "'.s:borderchars[1].'")')
    endif
    call setwinvar(winid, 'kind', 'buttons')
    call setwinvar(winid, 'target_winid', a:winid)
    call add(related, winid)
    call setwinvar(a:winid, 'related', related)
    call matchaddpos('MoreMsg', map(keys[0], "[2,v:val]"), 99, -1, {'window': winid})
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
  let maxheight = coc#helper#min(get(a:config, 'maxHeight', 78), &lines - &cmdheight - 6)
  let maxwidth = coc#helper#min(get(a:config, 'maxWidth', 78), &columns - 2)
  let close = get(a:config, 'close', 1)
  let minwidth = s:min_btns_width(buttons)
  if maxheight <= 0 || maxwidth <= 0 || minwidth > maxwidth
    throw 'Not enough spaces for dialog'
  endif
  let ch = 0
  let width = coc#helper#min(strdisplaywidth(title) + 1, maxwidth)
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
  let height = coc#helper#min(ch ,maxheight)
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
  if get(a:config, 'cursorline', 0)
    let opts['cursorline'] = 1
  endif
  let bufnr = coc#float#create_buf(0, a:lines)
  call coc#float#close_auto_hide_wins()
  let res =  coc#float#create_float_win(0, bufnr, opts)
  if empty(res)
    return
  endif
  if has('nvim')
    if get(a:config, 'cursorline', 0)
      execute 'sign place 6 line=1 name=CocCurrentLine buffer='.bufnr
    endif
    redraw
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

" Create temporarily buffer with optional lines and &bufhidden
function! coc#float#create_buf(bufnr, ...) abort
  if a:bufnr > 0 && bufloaded(a:bufnr)
    let bufnr = a:bufnr
  else
    if s:is_vim
      noa let bufnr = bufadd('')
      noa call bufload(bufnr)
      call setbufvar(bufnr, '&buflisted', 0)
    else
      noa let bufnr = nvim_create_buf(v:false, v:true)
    endif
    let bufhidden = get(a:, 2, 'wipe')
    call setbufvar(bufnr, '&buftype', 'nofile')
    call setbufvar(bufnr, '&bufhidden', bufhidden)
    call setbufvar(bufnr, '&swapfile', 0)
    call setbufvar(bufnr, '&undolevels', -1)
    " neovim's bug
    call setbufvar(bufnr, '&modifiable', 1)
  endif
  let lines = get(a:, 1, v:null)
  if type(lines) != 7
    if has('nvim')
      call nvim_buf_set_lines(bufnr, 0, -1, v:false, lines)
    else
      silent call deletebufline(bufnr, 1, '$')
      silent call setbufline(bufnr, 1, lines)
    endif
  endif
  return bufnr
endfunction

function! coc#float#create_menu(lines, config) abort
  let highlight = get(a:config, 'highlight', 'CocFloating')
  let borderhighlight = get(a:config, 'borderhighlight', [highlight])
  let opts = {
    \ 'lines': a:lines,
    \ 'highlight': highlight,
    \ 'title': get(a:config, 'title', ''),
    \ 'borderhighlight': borderhighlight,
    \ 'maxWidth': get(a:config, 'maxWidth', 80),
    \ 'maxHeight': get(a:config, 'maxHeight', 80),
    \ 'border': [1, 1, 1, 1],
    \ 'relative': 'cursor',
    \ }
  if s:is_vim
    let opts['cursorline'] = 1
  endif
  let dimension = coc#float#get_config_cursor(a:lines, opts)
  call extend(opts, dimension)
  call coc#float#close_auto_hide_wins()
  let res = coc#float#create_float_win(0, s:prompt_win_bufnr, opts)
  if empty(res)
    return
  endif
  let s:prompt_win_bufnr = res[1]
  redraw
  if has('nvim')
    call coc#float#nvim_scrollbar(res[0])
    execute 'sign unplace 6 buffer='.s:prompt_win_bufnr
    execute 'sign place 6 line=1 name=CocCurrentLine buffer='.s:prompt_win_bufnr
  endif
  return res
endfunction

" Notification always have border
" config including:
" - title: optional title.
" - close: default to 1
" - borderhighlight: highlight group string
" - timeout: timeout in miniseconds
" - buttons: array of button text for create buttons at bottom.
" - top: default to 1
" - right: default to 1
" - maxHeight: default to 10
" - maxWidth: default to 60
" - highlight: highlight of window, default to 'CocFloating'
function! coc#float#create_notification(lines, config) abort
  let close = get(a:config, 'close', 1)
  let timeout = get(a:config, 'timeout', 0)
  let borderhighlight = get(a:config, 'borderhighlight', 'CocFloating')
  let highlight = get(a:config, 'highlight', 'CocFloating')
  let title = get(a:config, 'title', '')
  let top = get(a:config, 'top', 1)
  let right = get(a:config, 'right', 1)
  let buttons = get(a:config, 'buttons', [])
  let maxHeight = get(a:config, 'maxHeight', 10)
  let maxWidth = min([&columns - right - 10, get(a:config, 'maxWidth', 60)])
  let progress = get(a:config, 'progress', 0)
  let minWidth = get(a:config, 'minWidth', 1)
  let minWidth = max([minWidth, s:min_btns_width(buttons)])
  if &columns < right + 10 || minWidth > maxWidth
    throw 'no enough spaces for notification'
  endif
  let width = min([maxWidth, max(map(a:lines + [title + ' '], "strdisplaywidth(v:val)"))])
  let width = max([minWidth, width])
  let height = 0
  for line in a:lines
    let w = max([1, strdisplaywidth(line)])
    let height += float2nr(ceil(str2float(string(w))/width))
  endfor
  let height = min([maxHeight, height, &lines - &cmdheight - 1])
  let col = &columns - right - width - 2
  let opts = {
        \ 'row': top,
        \ 'col': col,
        \ 'lines': a:lines,
        \ 'relative': 'editor',
        \ 'width': width,
        \ 'height': height,
        \ 'highlight': highlight,
        \ 'borderhighlight': [borderhighlight],
        \ 'border': [1, 1, 1, 1],
        \ 'title': title,
        \ 'close': close,
        \ 'buttons': buttons,
        \ }
  call coc#float#reflow(top + height + 2 + (empty(buttons) ? 0 : 2))
  let res =  coc#float#create_float_win(0, 0, opts)
  if empty(res)
    return
  endif
  let [winid, bufnr] = res
  call setwinvar(winid, 'kind', 'notification')
  redraw
  if has('nvim')
    call coc#float#nvim_scrollbar(winid)
  endif
  if timeout
    call timer_start(timeout, { -> coc#float#close(winid)})
  endif
  if progress
    let start = reltime()
    let timer = timer_start(16, { -> s:update_progress(bufnr, width, reltimefloat(reltime(start)))}, {
      \ 'repeat': -1
      \ })
    call setwinvar(winid, 'timer', timer)
  endif
  return res
endfunction

" adjust position for notification windows
function! coc#float#reflow(top) abort
  let winids = coc#float#get_float_win_list()
  let optlist = []
  for winid in winids
    if getwinvar(winid, 'kind', '') !=# 'notification'
      continue
    endif
    call add(optlist, s:get_win_opts(winid))
  endfor
  call sort(optlist, {a, b -> a['row'] - b['row']})
  "echo optlist
  let top = a:top
  for opts in optlist
    if opts['row'] <= top
      let changed = top + 1 - opts['row']
      let opts['row'] = top + 1
      call s:adjust_win_row(opts['winid'], changed)
    endif
    " adjust top
    let top = opts['row'] + opts['height']
  endfor
endfunction

" float/popup relative to current cursor position
function! coc#float#cursor_relative(winid) abort
  if !coc#float#valid(a:winid)
    return v:null
  endif
  let winid = win_getid()
  if winid == a:winid
    return v:null
  endif
  let [cursorLine, cursorCol] = coc#util#cursor_pos()
  if has('nvim')
    let [row, col] = nvim_win_get_position(a:winid)
    return {'row' : row - cursorLine, 'col' : col - cursorCol}
  endif
  let pos = popup_getpos(a:winid)
  return {'row' : pos['line'] - cursorLine - 1, 'col' : pos['col'] - cursorCol - 1}
endfunction

" move winid include relative windows.
function! s:adjust_win_row(winid, changed) abort
  let ids = getwinvar(a:winid, 'related', [])
  if s:is_vim
    let pos = popup_getpos(a:winid)
    if pos['line'] - 1 + a:changed + pos['height'] > &lines - &cmdheight
      call coc#float#close(a:winid)
      return
    endif
    call popup_move(a:winid, {
      \ 'line': pos['line'] + a:changed
      \ })
    for winid in ids
      let winpos = popup_getpos(winid)
      call popup_move(winid, {
            \ 'line': winpos['line'] + a:changed
            \ })
    endfor
  else
    let ids = [a:winid] + ids
    " close it if it's fully shown
    let borderwin = coc#float#get_related(a:winid, 'border')
    let winid = borderwin == 0 ? a:winid : borderwin
    let height = nvim_win_get_height(winid)
    let pos = nvim_win_get_position(winid)
    if pos[0] + a:changed + height > &lines - &cmdheight
      call coc#float#close(a:winid)
      return
    endif
    for winid in ids
      let [row, col] = nvim_win_get_position(winid)
      call nvim_win_set_config(winid, {
        \ 'relative': 'editor',
        \ 'row': row + a:changed,
        \ 'col': col,
        \ })
    endfor
  endif
endfunction

" winid, width, height, row, col (0 based).
" works on vim & neovim, check relative window
function! s:get_win_opts(winid) abort
  if s:is_vim
    let pos = popup_getpos(a:winid)
    return {
      \ 'winid': a:winid,
      \ 'row': pos['line'] - 1,
      \ 'col': pos['col'] - 1,
      \ 'width': pos['width'],
      \ 'height': pos['height'],
      \ }
  else
    let borderwin = coc#float#get_related(a:winid, 'border')
    let winid = borderwin == 0 ? a:winid : borderwin
    let [row, col] = nvim_win_get_position(winid)
    return {
      \ 'winid': a:winid,
      \ 'row': row,
      \ 'col': col,
      \ 'width': nvim_win_get_width(winid),
      \ 'height': nvim_win_get_height(winid)
      \ }
  endif
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
      let btnline .= s:borderchars[1]
    endif
  endfor
  let lines = [repeat(s:borderchars[0], a:width), btnline]
  if a:borderbottom
    call add(lines, repeat(s:borderchars[0], a:width))
  endif
  for idx in idxes
    let lines[0] = strcharpart(lines[0], 0, idx).s:borderjoinchars[0].strcharpart(lines[0], idx + 1)
    if a:borderbottom
      let lines[2] = strcharpart(lines[0], 0, idx).s:borderjoinchars[2].strcharpart(lines[0], idx + 1)
    endif
  endfor
  let bufnr = coc#float#create_buf(a:bufnr, lines)
  call setbufvar(bufnr, 'vcols', idxes)
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
      if ch == s:borderchars[1]
        let next = 1
      endif
    endif
  endfor
  return [cols, used]
endfunction

function! s:close_win(winid) abort
  if a:winid <= 0
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
  if a:winid == 0
    return
  endif
  if exists('*nvim_buf_set_keymap')
    let bufnr = winbufnr(a:winid)
    call nvim_buf_set_keymap(bufnr, 'n', '<LeftRelease>', ':call coc#float#nvim_float_click()<CR>', {
        \ 'silent': v:true,
        \ 'nowait': v:true
        \ })
  else
    let curr = win_getid()
    let m = mode()
    if m == 'n' || m == 'i' || m == 'ic'
      noa call win_gotoid(a:winid)
      nnoremap <buffer><silent> <LeftRelease> :call coc#float#nvim_float_click()<CR>
      noa call win_gotoid(curr)
    endif
  endif
endfunction

" getwininfo is buggy on neovim, use topline, width & height should for content
function! s:nvim_get_botline(topline, height, width, bufnr) abort
  let lines = getbufline(a:bufnr, a:topline, a:topline + a:height - 1)
  let botline = a:topline
  let count = 0
  for i in range(0, len(lines) - 1)
    let w = coc#helper#max(1, strdisplaywidth(lines[i]))
    let lh = float2nr(ceil(str2float(string(w))/a:width))
    let count = count + lh
    let botline = a:topline + i
    if count >= a:height
      break
    endif
  endfor
  return botline
endfunction

" get popup position for vim8 based on config of neovim float window
function! s:popup_position(config) abort
  let relative = get(a:config, 'relative', 'editor')
  if relative ==# 'cursor'
    return [s:popup_cursor(a:config['row']), s:popup_cursor(a:config['col'])]
  endif
  return [a:config['row'] + 1, a:config['col'] + 1]
endfunction

function! s:add_related(winid, target) abort
  let arr = getwinvar(a:target, 'related', [])
  if index(arr, a:winid) >= 0
    return
  endif
  call add(arr, a:winid)
  call setwinvar(a:target, 'related', arr)
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

function! s:is_blocking() abort
  if coc#prompt#activated()
    return 1
  endif
  return 0
endfunction

" max firstline of lines, height > 0, width > 0
function! s:max_firstline(lines, height, width) abort
  let max = len(a:lines)
  let remain = a:height
  for line in reverse(copy(a:lines))
    let w = max([1, strdisplaywidth(line)])
    let dh = float2nr(ceil(str2float(string(w))/a:width))
    if remain - dh < 0
      break
    endif
    let remain = remain - dh
    let max = max - 1
  endfor
  return min([len(a:lines), max + 1])
endfunction

" Get best lnum by topline
function! s:get_cursorline(topline, lines, scrolloff, width, height) abort
  let lastline = len(a:lines)
  if a:topline == lastline
    return lastline
  endif
  let bottomline = a:topline
  let used = 0
  for lnum in range(a:topline, lastline)
    let w = max([1, strdisplaywidth(a:lines[lnum - 1])])
    let dh = float2nr(ceil(str2float(string(w))/a:width))
    if used + dh >= a:height || lnum == lastline
      let bottomline = lnum
      break
    endif
    let used += dh
  endfor
  let cursorline = a:topline + a:scrolloff
  if cursorline + a:scrolloff > bottomline
    " unable to satisfy scrolloff
    let cursorline = (a:topline + bottomline)/2
  endif
  return cursorline
endfunction

" Get firstline for full scroll
function! s:get_topline(topline, lines, forward, height, width) abort
  let used = 0
  let lnums = a:forward ? range(a:topline, len(a:lines)) : reverse(range(1, a:topline))
  let topline = a:forward ? len(a:lines) : 1
  for lnum in lnums
    let w = max([1, strdisplaywidth(a:lines[lnum - 1])])
    let dh = float2nr(ceil(str2float(string(w))/a:width))
    if used + dh >= a:height
      let topline = lnum
      break
    endif
    let used += dh
  endfor
  if topline == a:topline
    if a:forward
      let topline = min([len(a:lines), topline + 1])
    else
      let topline = max([1, topline - 1])
    endif
  endif
  return topline
endfunction

" topline content_height content_width
function! s:get_options(winid) abort
  if has('nvim')
    let width = nvim_win_get_width(a:winid)
    if getwinvar(a:winid, '&foldcolumn', 0)
      let width = width - 1
    endif
    let info = getwininfo(a:winid)[0]
    return {
      \ 'topline': info['topline'],
      \ 'height': nvim_win_get_height(a:winid),
      \ 'width': width
      \ }
  else
    let pos = popup_getpos(a:winid)
    return {
      \ 'topline': pos['firstline'],
      \ 'width': pos['core_width'],
      \ 'height': pos['core_height']
      \ }
  endif
endfunction

function! s:win_setview(winid, topline, lnum) abort
  if has('nvim')
    call coc#compat#execute(a:winid, 'call winrestview({"lnum":'.a:lnum.',"topline":'.a:topline.'})')
    call timer_start(10, { -> coc#float#nvim_refresh_scrollbar(a:winid) })
  else
    call coc#compat#execute(a:winid, 'exe '.a:lnum)
    call popup_setoptions(a:winid, {
          \ 'firstline': a:topline,
          \ })
  endif
endfunction

function! s:min_btns_width(buttons) abort
  if empty(a:buttons)
    return 0
  endif
  let minwidth = len(a:buttons)*3 - 1
  for txt in a:buttons
    let minwidth = minwidth + strdisplaywidth(txt)
  endfor
  return minwidth
endfunction

function! s:update_progress(bufnr, width, ts) abort
  let duration = 5000
  " count of blocks
  let width = float2nr((a:width + 0.0)/4)
  let percent = (float2nr(a:ts*1000)%duration + 0.0)/duration
  let line = repeat(s:progresschars[0], a:width)
  let startIdx = float2nr(round(a:width * percent))
  let endIdx = startIdx + width
  let delta = a:width - endIdx
  if delta > 0
    let line = s:str_compose(line, startIdx, repeat(s:progresschars[1], width))
  else
    let inserted = repeat(s:progresschars[1], width + delta)
    let line = s:str_compose(line, startIdx, inserted)
    let line = s:str_compose(line, 0, repeat(s:progresschars[1], - delta))
  endif
  call setbufline(a:bufnr, 1, line)
endfunction

function! s:str_compose(line, idx, text) abort
  let first = strcharpart(a:line, 0, a:idx)
  return first.a:text.strcharpart(a:line, a:idx + strwidth(a:text))
endfunction
