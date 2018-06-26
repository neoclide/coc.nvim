# ============================================================================
# FILE: workspace.py
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

        self.name = 'coc-workspace'
        self.matchers = ['matcher_fuzzy']
        self.sorters = []
        self.kind = FileKind(vim)

    def define_syntax(self):
        self.vim.command('syntax case ignore')
        self.vim.command(r'syntax match deniteSource_WorkspaceHeader /\v^.*$/ containedin=' + self.syntax_name)
        self.vim.command(r'syntax match deniteSource_WorkspaceName /\v^\s*\S+/ contained '
                         r'containedin=deniteSource_WorkspaceHeader')
        self.vim.command(r'syntax match deniteSource_WorkspaceKind /\[\w\+\]/ contained '
                         r'containedin=deniteSource_WorkspaceHeader')
        self.vim.command(r'syntax match deniteSource_WorkspaceFile /\f\+$/ contained '
                         r'containedin=deniteSource_WorkspaceHeader')


    def highlight(self):
        self.vim.command('highlight default link deniteSource_WorkspaceName Normal')
        self.vim.command('highlight default link deniteSource_WorkspaceKind Typedef')
        self.vim.command('highlight default link deniteSource_WorkspaceFile Comment')

    def gather_candidates(self, context):
        cwd = self.vim.call('getcwd')
        items = self.vim.call('CocAction', 'workspaceSymbols')
        candidates = []
        for item in items:
            filepath = relpath(item['filepath'], start=cwd)
            candidates.append({
                'word': item['text'],
                'abbr': '%s [%s] %s' % (item['text'], item['kind'], filepath),
                'action__path': item['filepath'],
                'action__col': item['col'],
                'action__line': item['lnum'],
                })

        return candidates
