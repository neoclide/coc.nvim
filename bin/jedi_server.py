# -*- coding: utf-8 -*-

from __future__ import print_function

import argparse
import json
import tempfile
import logging
import os.path
import sys

log_file = os.path.join(tempfile.gettempdir(), 'coc-jedi.log')
logger = logging.getLogger('python-jedi')
handler = logging.FileHandler(log_file, delay=1)
handler.setLevel(logging.INFO)
handler.setFormatter(logging.Formatter(
    '%(asctime)s [%(levelname)s][%(module)s] %(message)s'))
logger.addHandler(handler)


def write(msg):
    print(msg)
    sys.stdout.flush()


def process_request(args):
    import jedi
    script = jedi.Script(source=args['content'], line=args['line'],
                         column=args['col'], path=args['filename'])

    data = []
    if args['action'] == 'complete':
        for c in script.completions():
            res = {
                'word': c.name,
                'abbr': c.name_with_symbols,
                'menu': c.description,
                'info': c.docstring(),
            }
            data.append(res)
    elif args['action'] == 'definition':
        for d in script.goto_assignments(follow_imports=True):
            item = {'text': d.description}
            if d.in_builtin_module():
                item['text'] = 'Builtin {}'.format(item['text'])
            else:
                item.update({
                    'filename': d.module_path,
                    'lnum': d.line,
                    'col': d.column + 1,
                    'name': d.name,
                })
            data.append(item)
    elif args['action'] == 'doc':
        for d in script.goto_assignments(follow_imports=True):
            data.append(d.docstring(fast=False).strip())
    elif args['action'] == 'signature':
        for s in script.call_signatures():
            params = [p.description.replace('\n', '')[6:] for p in s.params]
            item = {
                'params': params,
                'func': s.call_name,
                'index': s.index or 0
            }
            logger.info(str(item))
            data.append(item)
    write(json.dumps(data))


def run():
    """
    input data:
    {
        "line": <int>,
        "col": <int>,
        "filename": <string>,
        "content": <string>,
    }
    """
    while True:
        data = sys.stdin.readline()
        logger.info(data)

        try:
            args = json.loads(data)
        except Exception as e:
            logger.exception(e)
            continue

        try:
            process_request(args)
        except Exception as e:
            logger.exception(e)
            write(json.dumps([]))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('-v', '--verbose', action='store_true')
    args = parser.parse_args()

    class Filter(object):
        def filter(self, record):
            return args.verbose

    logger.addFilter(Filter())
    run()


if __name__ == '__main__':
    main()
