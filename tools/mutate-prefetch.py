#!/usr/bin/env python3
"""Mutation check of the prefetching file source (platform glue of the dialog preview of the web client): `PrefetchSource` in packages/ui/src/prefetch.ts,
the `MassFileSource` a synchronous UI world reads over an asynchronous store (`read`, `load`, `settle`, `trim`).  The mutants are made from the source by
operator, like those of tools/mutate-edit.py (every comparison, logical and arithmetic operator, number, `!`, condition, `?:`, statement, one at a
time), and by swaps no operator makes: the set of what was asked for that is the set of what is pending, the store asked about the wrong name, a round that
does not forget the last one.  Their names are the text of the line.  The test that runs for each is packages/ui/test/prefetch.test.ts (no oracle: the
file is not in the exe; every expectation follows from the protocol its docblock states).

    python3 tools/mutate-prefetch.py [--list] [--check] [--survivors=LOG] [substring of a mutant name ...]

The options, the exit code and the way the source is restored are those of tools/mutate-edit.py (this script loads it and replaces its list of mutants): a
mutant that must be killed and survives makes the exit code 1; so does a mutant with a reason that is killed.  Commit first, or work in a copy.
"""
import importlib.util, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location('mutate_edit', os.path.join(HERE, 'mutate-edit.py'))
me = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(me)

PF = 'prefetch.ts'
# the names of the mutants say the method they are in: `async load(...)`, `async settle<T>(...)` and `get residentBytes()` are methods
me.FUNC_RE = re.compile(r'  (?:private |override |static |async |get )*(\w+)(?:<\w+>)?\(')
T = me.T
me.M.clear()
me.TIMEOUT.clear()
me.TESTS[PF] = [T + 'prefetch.test.ts']
me.TIMEOUT[PF] = 30  # the test takes a fraction of a second; a mutant that loops for ever is a kill

# (the name of the method the region is, first marker, last marker); `MAX_ROUNDS` and the default of `concurrency` are policy, not behaviour, and are not mutated
REGIONS = [
    ('has', '  has(upperName: string): boolean {', '\n  }\n'),
    ('read', '  read(upperName: string): Uint8Array | undefined {', '\n  }\n'),
    ('residentBytes', '  get residentBytes(): number {', '\n  }\n'),
    ('load', '  async load(upperNames: Iterable<string>): Promise<void> {', '\n  }\n'),
    ('settle', '  async settle<T>(run: () => T, discard?: (result: T) => void)', '\n  }\n'),
    ('trim', '  trim(limit: number, evictable: RegExp): number {', '\n  }\n'),
]

WHY = {}


def add(name, why):
    WHY[name] = why


def src(f):
    return open(me.path_of(f)).read()


def swap_mutants(f, regions, patterns, rename=None):
    """[(name, anchor, replacement)]: in the code of the file between each pair of markers, every match of a pattern of `patterns` ([(regex, [new text])]) is
    replaced, one at a time; the anchor is the line, with the lines before it while it is not unique"""
    text = src(f)
    lines = text.split('\n')
    pos = [0]
    for ln in lines:
        pos.append(pos[-1] + len(ln) + 1)
    spans = []
    for first, last in regions:
        a = text.index(first)
        b = text.index(last, a + len(first)) + (len(last) if last.endswith('\n') else 0)
        spans.append((a, b))
    result, seen = [], {}
    for n, line in enumerate(lines):
        if not any(a <= pos[n] < b for a, b in spans):
            continue
        st = line.strip()
        if not st or st.startswith(('*', '/*', '//')):
            continue
        code = line.split(' // ')[0]  # a trailing comment is no code
        for regex, news in patterns:
            for hit in re.finditer(regex, code):
                for new in news(hit) if callable(news) else news:
                    if hit.group() == new:
                        continue
                    changed = line[:hit.start()] + new + line[hit.end():]
                    k, anchor, repl = 0, line, changed
                    while text.count(anchor) != 1 and n - k > 0:
                        k += 1
                        anchor = '\n'.join(lines[n - k:n + 1])
                        repl = '\n'.join(lines[n - k:n] + [changed])
                    if text.count(anchor) != 1:
                        raise SystemExit(f'no unique anchor for line {n + 1}: {st}')
                    snippet = ' '.join(st.split())
                    snippet = snippet if len(snippet) <= 72 else snippet[:72] + '...'
                    name = f'{rename}: {hit.group()} -> {new} in `{snippet}`'
                    seen[name] = seen.get(name, 0) + 1
                    if seen[name] > 1:
                        name += f' (#{seen[name]})'
                    result.append((name, anchor, repl))
    return result


SWAPS = [
    # the sets: what was asked for is not what is pending, what is resident is not what was asked for
    (r'this\.asked\.add\(', ['this.pending.add(']),
    (r'this\.pending\.add\(', ['this.asked.add(']),
    (r'this\.pending\.clear\(\)', ['this.asked.clear()']),
    (r'this\.asked = new Set\(\)', ['this.asked = this.pending']),
    (r'this\.resident\.get\(', ['this.asked.has(']),
    (r'this\.resident\.has\(name\)', ['this.asked.has(name)', 'this.pending.has(name)']),
    (r'this\.resident\.set\(name, bytes\)', ['this.asked.add(name)']),
    (r'this\.asked\.has\(name\)', ['this.pending.has(name)']),
    # the store is asked about the name, and the bytes are the ones it gave
    (r'this\.store\.has\(upperName\)', ['this.store.has(\'\')', 'this.resident.has(upperName)']),
    (r'this\.store\.has\(name\)', ['this.resident.has(name)']),
    (r'await this\.store\.load\(name\)', ['await this.store.load(todo[0]!)']),
    (r'bytes\.length', ['1']),
    (r'todo\[i\]!', ['todo[0]!']),
    (r'\[\.\.\.new Set\(upperNames\)\]', ['[...upperNames]']),
    # what settle hands out and what it loads
    (r'discard\?\.\(result as T\)', ['discard?.(undefined as T)']),
    (r'await this\.load\(\[\.\.\.this\.pending\]\)', ['await this.load([])']),
    (r'return \{ result: result as T, rounds: round \}', ['return { result: result as T, rounds: round - 1 }', 'return { result: result as T, rounds: 1 }']),
]

MUTANTS = []
for _rename, _first, _last in REGIONS:
    for _name, _a, _b in me.operator_mutants(PF, [(_first, _last)]):
        MUTANTS.append((PF, _name, _a, _b))
    for _name, _a, _b in swap_mutants(PF, [(_first, _last)], SWAPS, _rename):
        MUTANTS.append((PF, _name, _a, _b))

# ---- hand-made mutants (the lines the generators do not reach)
HAND = [
    (PF, 'settle: the round does not forget what the one before it asked for', '      this.asked = new Set();\n', ''),
    (PF, 'settle: a void run that threw is handed to discard, too', '      if (!failed) discard?.(result as T);', '      discard?.(result as T);'),
    (PF, 'settle: a run that threw with nothing missing is not thrown', '        if (failed) throw error;\n', ''),
    (PF, 'trim: the oldest member goes last (the newest is forgotten first)', '    for (const [name, bytes] of this.resident) {', '    for (const [name, bytes] of [...this.resident].reverse()) {'),
    (PF, 'trim: a member the last round read is forgotten', 'if (!evictable.test(name) || this.asked.has(name)) continue;', 'if (!evictable.test(name)) continue;'),
    (PF, 'trim: members that the pattern does not name are forgotten', 'if (!evictable.test(name) || this.asked.has(name)) continue;', 'if (this.asked.has(name)) continue;'),
    (PF, 'trim: the walk goes on when the limit is met', '      if (total <= limit) break;\n', ''),
    (PF, 'load: the workers are one more than the limit', 'Math.min(this.concurrency, todo.length)', 'Math.min(this.concurrency + 1, todo.length)'),
    (PF, 'load: one worker too few', 'Math.min(this.concurrency, todo.length)', 'Math.min(this.concurrency - 1, todo.length)'),
]
for _f, _name, _a, _b in HAND:
    MUTANTS.append((_f, _name, _a, _b))

# ---- the mutants that no input can tell from the original (name -> why)

for _f, _name, _a, _b in MUTANTS:
    me.m(_f, _name, _a, _b, WHY.get(_name, ''))
for _name in WHY:
    assert any(mu[1] == _name for mu in me.M), f'a reason for a mutant that does not exist: {_name}'

if __name__ == '__main__':
    sys.exit(me.main())
