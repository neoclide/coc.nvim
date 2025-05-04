scriptencoding utf-8

function! coc#hlgroup#valid(hlGroup) abort
  return hlexists(a:hlGroup) && execute('hi '.a:hlGroup, 'silent!') !~# ' cleared$'
endfunction

function! coc#hlgroup#compose(fg, bg) abort
  let fgId = synIDtrans(hlID(a:fg))
  let bgId = synIDtrans(hlID(a:bg))
  let isGuiReversed = synIDattr(fgId, 'reverse', 'gui') !=# '1' || synIDattr(bgId, 'reverse', 'gui') !=# '1'
  let guifg = isGuiReversed ? synIDattr(fgId, 'fg', 'gui') : synIDattr(fgId, 'bg', 'gui')
  let guibg = isGuiReversed ? synIDattr(bgId, 'bg', 'gui') : synIDattr(bgId, 'fg', 'gui')
  let isCtermReversed = synIDattr(fgId, 'reverse', 'cterm') !=# '1' || synIDattr(bgId, 'reverse', 'cterm') !=# '1'
  let ctermfg = isCtermReversed ? synIDattr(fgId, 'fg', 'cterm') : synIDattr(fgId, 'bg', 'cterm')
  let ctermbg = isCtermReversed ? synIDattr(bgId, 'bg', 'cterm') : synIDattr(bgId, 'fg', 'cterm')
  let bold = synIDattr(fgId, 'bold') ==# '1'
  let italic = synIDattr(fgId, 'italic') ==# '1'
  let underline = synIDattr(fgId, 'underline') ==# '1'
  let cmd = ''
  if !empty(guifg)
    let cmd .= ' guifg=' . guifg
  endif
  if !empty(ctermfg)
    let cmd .= ' ctermfg=' . ctermfg
  elseif guifg =~# '^#'
    let cmd .= ' ctermfg=' . coc#color#rgb2term(strpart(guifg, 1))
  endif
  if !empty(guibg)
    let cmd .= ' guibg=' . guibg
  endif
  if !empty(ctermbg)
    let cmd .= ' ctermbg=' . ctermbg
  elseif guibg =~# '^#'
    let cmd .= ' ctermbg=' . coc#color#rgb2term(strpart(guibg, 1))
  endif
  if bold
    let cmd .= ' cterm=bold gui=bold'
  elseif italic
    let cmd .= ' cterm=italic gui=italic'
  elseif underline
    let cmd .= ' cterm=underline gui=underline'
  endif
  return cmd
endfunction

" Compose hlGroups with foreground and background colors.
function! coc#hlgroup#compose_hlgroup(fgGroup, bgGroup) abort
  let hlGroup = 'Fg'.a:fgGroup.'Bg'.a:bgGroup
  if a:fgGroup ==# a:bgGroup
    return a:fgGroup
  endif
  if coc#hlgroup#valid(hlGroup)
    return hlGroup
  endif
  let cmd = coc#hlgroup#compose(a:fgGroup, a:bgGroup)
  if empty(cmd)
      return 'Normal'
  endif
  execute 'silent hi ' . hlGroup . cmd
  return hlGroup
endfunction

" hlGroup id, key => 'fg' | 'bg', kind => 'cterm' | 'gui'
function! coc#hlgroup#get_color(id, key, kind) abort
  if synIDattr(a:id, 'reverse', a:kind) !=# '1'
    return synIDattr(a:id, a:key, a:kind)
  endif
  return  synIDattr(a:id, a:key ==# 'bg' ? 'fg' : 'bg', a:kind)
endfunction

function! coc#hlgroup#get_hl_command(id, key, cterm, gui) abort
  let cterm = coc#hlgroup#get_color(a:id, a:key, 'cterm')
  let gui = coc#hlgroup#get_color(a:id, a:key, 'gui')
  let cmd = ' cterm'.a:key.'=' . (empty(cterm) ? a:cterm : cterm)
  let cmd .= ' gui'.a:key.'=' . (empty(gui) ? a:gui : gui)
  return cmd
endfunction

function! coc#hlgroup#get_hex_color(id, kind, fallback) abort
  let term_colors = s:use_term_colors()
  let attr = coc#hlgroup#get_color(a:id, a:kind, term_colors ? 'cterm' : 'gui')
  let hex = s:to_hex_color(attr, term_colors)
  if empty(hex) && !term_colors
    let attr = coc#hlgroup#get_color(a:id, a:kind, 'cterm')
    let hex = s:to_hex_color(attr, 1)
  endif
  return empty(hex) ? a:fallback : hex
endfunction

function! coc#hlgroup#get_contrast(group1, group2) abort
  let normal = coc#hlgroup#get_hex_color(synIDtrans(hlID('Normal')), 'bg', '#000000')
  let bg1 = coc#hlgroup#get_hex_color(synIDtrans(hlID(a:group1)), 'bg', normal)
  let bg2 = coc#hlgroup#get_hex_color(synIDtrans(hlID(a:group2)), 'bg', normal)
  return coc#color#hex_contrast(bg1, bg2)
endfunction

" Darken or lighten background
function! coc#hlgroup#create_bg_command(group, amount) abort
  let id = synIDtrans(hlID(a:group))
  let normal = coc#hlgroup#get_hex_color(synIDtrans(hlID('Normal')), 'bg', &background ==# 'dark' ? '#282828' : '#fefefe')
  let bg = coc#hlgroup#get_hex_color(id, 'bg', normal)
  let hex = a:amount > 0 ? coc#color#darken(bg, a:amount) : coc#color#lighten(bg, -a:amount)

  let ctermbg = coc#color#rgb2term(strpart(hex, 1))
  if s:use_term_colors() && !s:check_ctermbg(id, ctermbg) && abs(a:amount) < 20.0
    return coc#hlgroup#create_bg_command(a:group, a:amount * 2)
  endif
  return 'ctermbg=' . ctermbg.' guibg=' . hex
endfunction


function! s:check_ctermbg(id, cterm) abort
  let attr = coc#hlgroup#get_color(a:id, 'bg', 'cterm')
  if empty(attr)
    let attr = coc#hlgroup#get_color(synIDtrans(hlID('Normal')), 'bg', 'cterm')
  endif
  if attr ==# a:cterm
    return 0
  endif
  return 1
endfunction

function! s:to_hex_color(color, term) abort
  if empty(a:color)
    return ''
  endif
  if a:color =~# '^#\x\+$'
    return a:color
  endif
  if a:term && a:color =~# '^\d\+$'
    return coc#color#term2rgb(a:color)
  endif
  let hex = coc#color#nameToHex(tolower(a:color), a:term)
  return empty(hex) ? '' : hex
endfunction

" Can't use script variable as nvim change it after VimEnter
function! s:use_term_colors() abort
  return &termguicolors == 0 && !has('gui_running')
endfunction
