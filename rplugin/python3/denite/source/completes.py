# ============================================================================
# FILE: completes.py
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

        self.name = 'completes'
        self.matchers = ['matcher_fuzzy']
        self.sorters = []
        self.kind = CompleteKind(vim)

    def define_syntax(self):
        self.vim.command('syntax case ignore')
        self.vim.command(r'syntax match deniteSource_CompletesHeader /\v^.*$/ containedin=' + self.syntax_name)
        self.vim.command(r'syntax match deniteSource_CompletesStar /\v^\%1c.*\%3c/ contained '
                r'containedin=deniteSource_CompletesHeader')
        self.vim.command(r'syntax match deniteSource_CompletesName /\%4c.*\%22c/ contained '
                r'containedin=deniteSource_CompletesHeader')
        self.vim.command(r'syntax match deniteSource_CompletesType /\%25c.*\%31c/ contained '
                r'containedin=deniteSource_CompletesHeader')
        self.vim.command(r'syntax match deniteSource_CompletesPath /\%32c.*$/ contained '
                r'containedin=deniteSource_CompletesHeader')

    def highlight(self):
        self.vim.command('highlight default link deniteSource_CompletesStar Special')
        self.vim.command('highlight default link deniteSource_CompletesName Type')
        self.vim.command('highlight default link deniteSource_CompletesType Statement')
        self.vim.command('highlight default link deniteSource_CompletesPath Comment')

    def gather_candidates(self, context):
        items = self.vim.eval('CompleteSourceStat()')
        candidates = []
        for item in items:
            name = item['name']
            prefix = '   ' if item['disabled'] else ' * '
            t = '[vim] ' if item['type'] == 'remote' else '[node]'
            filepath = item['filepath']
            candidates.append({
                'word': name,
                'abbr': '%s %-18s %-6s %s' % (prefix, name, t, filepath),
                'action__path': filepath,
                'source__name': name
                })

        return candidates


class CompleteKind(FileKind):

    def __init__(self, vim):
        super().__init__(vim)
        self.default_action = 'toggle'
        self.redraw_actions += ['toggle']
        self.persist_actions += ['toggle']

    def action_toggle(self, context):
        target = context['targets'][0]
        self.vim.call('CompleteSourceToggle', target['source__name'])

    def action_refresh(self, context):
        target = context['targets'][0]
        self.vim.call('CompleteSourceRefresh', target['source__name'])
