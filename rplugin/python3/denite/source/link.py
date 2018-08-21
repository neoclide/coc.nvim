# ============================================================================
# FILE: command.py
# AUTHOR: Qiming Zhao <chemzqm@gmail.com>
# License: MIT license
# ============================================================================
# pylint: disable=E0401,C0411
from denite.source.base import Base


class Source(Base):

    def __init__(self, vim):
        super().__init__(vim)

        self.name = 'coc-link'
        self.matchers = ['matcher_fuzzy']
        self.sorters = ['sorter/sublime']
        self.kind = 'file'

    def gather_candidates(self, context):

        items = self.vim.call('CocAction', 'links')
        if items is None or items is 0:
            return []
        candidates = []
        for item in items:
            candidates.append({
                'word': item['target'],
                'abbr': item['target'],
                'action__path': item['target']
                })

        return candidates

