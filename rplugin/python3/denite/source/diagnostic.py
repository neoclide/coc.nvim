# ============================================================================
# FILE: diagnostic.py
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

        self.name = 'coc-diagnostic'
        self.matchers = ['matcher_fuzzy']
        self.sorters = []
        self.kind = FileKind(vim)

    def define_syntax(self):
        self.vim.command('syntax case ignore')
        self.vim.command(r'syntax match deniteSource_DiagnosticHeader /\v^.*$/ containedin=' + self.syntax_name)
        self.vim.command(r'syntax match deniteSource_DiagnosticFile /\v^\s*\S+/ contained '
                         r'containedin=deniteSource_DiagnosticHeader')
        self.vim.command(r'syntax match deniteSource_DiagnosticError /\sError\s/ contained '
                         r'containedin=deniteSource_DiagnosticHeader')
        self.vim.command(r'syntax match deniteSource_DiagnosticWarning /\sWarning\s/ contained '
                         r'containedin=deniteSource_DiagnosticHeader')
        self.vim.command(r'syntax match deniteSource_DiagnosticInfo /\sInformation\s/ contained '
                         r'containedin=deniteSource_DiagnosticHeader')
        self.vim.command(r'syntax match deniteSource_DiagnosticHint /\sHint\s/ contained '
                         r'containedin=deniteSource_DiagnosticHeader')

    def highlight(self):
        self.vim.command('highlight default link deniteSource_DiagnosticFile Comment')
        self.vim.command('highlight default link deniteSource_DiagnosticError CocErrorSign')
        self.vim.command('highlight default link deniteSource_DiagnosticWarning CocWarningSign')
        self.vim.command('highlight default link deniteSource_DiagnosticInfo CocInfoSign')
        self.vim.command('highlight default link deniteSource_DiagnosticHint CocHintSign')

    def gather_candidates(self, context):
        cwd = self.vim.call('getcwd')
        items = self.vim.call('CocAction', 'diagnosticList')
        candidates = []
        for item in items:
            filepath = relpath(item['file'], start=cwd)
            candidates.append({
                'word': item['message'],
                'abbr': '%s:%s:%s %s %s' % (filepath, item['lnum'], item['col'], item['severity'], item['message'].replace('\n', ' ')),
                'action__path': item['file'],
                'action__col': item['col'],
                'action__line': item['lnum'],
                })

        return candidates
