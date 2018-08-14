
function! UltiSnips#SnippetsInCurrentScope()
  return {
        \ 'ultisnips': 'ultisnips snippet'
        \}
endfunction

function! UltiSnips#ExpandSnippet(item)
  let g:ultisnips_expand = 1
endfunction
