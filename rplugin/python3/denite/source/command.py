# ============================================================================
# FILE: command.py
# AUTHOR: Qiming Zhao <chemzqm@gmail.com>
# License: MIT license
# ============================================================================
# pylint: disable=E0401,C0411
from denite.kind.base import Base as BaseKind
from denite.source.base import Base


class Source(Base):

    def __init__(self, vim):
        super().__init__(vim)

        self.name = 'coc-command'
        self.matchers = ['matcher_fuzzy']
        self.sorters = ['sorter/sublime']
        self.kind = Kind(vim)

    def gather_candidates(self, context):
        items = self.vim.call('CocAction', 'commands')
        if items is None or items is 0:
            return []
        candidates = []
        for item in items:
            candidates.append({
                'word': item,
                'abbr': item,
                'source__name': item
                })

        return candidates


class Kind(BaseKind):

    def __init__(self, vim):
        super().__init__(vim)
        self.default_action = 'run'

    def action_run(self, context):
        target = context['targets'][0]
        self.vim.call('CocAction', 'runCommand', target['source__name'])

