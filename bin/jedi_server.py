# -*- coding: utf-8 -*-

from __future__ import print_function
import argparse
import json
import os.path
import sys
import jedi

def eprint(*args, **kwargs):
    print(*args, file=sys.stderr, **kwargs)


def write(msg):
    print(msg + '\nEND')
    sys.stdout.flush()

def set_settings(args):
    settings = args['settings']
    for attr, value in settings.items():
        setattr(jedi.settings, attr, value)
    write('ok')

def preload_module(args):
    modules = args['modules']
    jedi.preload_module(modules)
    write('ok')


def process_request(args):
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
            params = [p.description.rstrip()[6:] for p in s.params]
            item = {
                'params': params,
                'func': s.name,
                'index': s.index or 0
            }
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

        try:
            args = json.loads(data)
            if args['action'] == 'settings':
                set_settings(args)
            elif args['action'] == 'preload':
                preload_module(args)
            else:
                process_request(args)
        except Exception as e:
            eprint(e)
            continue



def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('-v', '--verbose', action='store_true')
    run()


if __name__ == '__main__':
    main()
