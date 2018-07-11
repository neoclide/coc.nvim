# ============================================================================
# FILE: symbols.py
# AUTHOR: Qiming Zhao <chemzqm@gmail.com>
# License: MIT license
# ============================================================================
# pylint: disable=E0401,C0411
import re
from denite.kind.file import Kind as FileKind
from denite.source.base import Base
from os.path import relpath

class Source(Base):

    def __init__(self, vim):
        super().__init__(vim)

        self.name = 'coc-symbols'
        self.matchers = ['matcher_fuzzy']
        self.sorters = ['sorter/sublime']
        self.kind = FileKind(vim)

    def define_syntax(self):
        self.vim.command('syntax case ignore')
        self.vim.command(r'syntax match deniteSource_SymbolsHeader /\v^.*$/ containedin=' + self.syntax_name)
        self.vim.command(r'syntax match deniteSource_SymbolsName /\v^\s*\S+/ contained '
                         r'containedin=deniteSource_SymbolsHeader')
        self.vim.command(r'syntax match deniteSource_SymbolsKind /\[\w\+\]/ contained '
                         r'containedin=deniteSource_SymbolsHeader')


    def highlight(self):
        self.vim.command('highlight default link deniteSource_SymbolsName Normal')
        self.vim.command('highlight default link deniteSource_SymbolsKind Typedef')

    def gather_candidates(self, context):
        items = self.vim.call('CocAction', 'documentSymbols')
        if items is None:
            return
        candidates = []
        for item in items:
            candidates.append({
                'word': item['text'] + item['kind'],
                'abbr': '%s%s [%s]' % ('  ' * item['level'], item['text'], item['kind']),
                'action__path': item['filepath'],
                'action__col': item['col'],
                'action__line': item['lnum'],
                })

        return candidates
