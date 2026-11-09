#!/usr/bin/env python3
"""Mutation check of the control destructors (E4b): the `Destroy()` of every control class (static.ts, button.ts, checkbox.ts, radiobutton.ts,
editbox.ts, imeeditbox.ts, slider.ts, navigation.ts, scrollbar.ts, combobox.ts, listbox.ts, controllist.ts, slot.ts with CX2Slot, movie.ts), what
they release and in which order, the base class (control.ts: `~CKTDGUIControl`, `~UITextureData`, `~TexChangeData`, `~CPictureData`, the helpers
`destroyTexture` / `closeHeldDevice`, the `leakedSounds` the exe leaks), the dialog's side of it (dialog.ts: `CheckControl`, the auto-delete of
`OnFrameMove`), the list box's removals, `UniBuffer.Destroy`, `IntPairMap.clear`, the stray close hook of the device manager and the census's
`destroyDialogs` (census.ts).  One small change at a time is applied to a source file, the tests are run and the script reports whether a test
notices (killed) or not (SURVIVED).

    python3 tools/mutate-destroy.py [--list] [--check] [--survivors=LOG] [substring of a mutant name ...]

Most mutants are made from the code of the destructors themselves (the statements of each `Destroy()` body: one that is not executed, and two
neighbours that swap places when the order shows in the log of the closed devices); the others are written out.  A mutant that must be killed
and survives makes the exit code 1; so does a mutant with a reason that is killed (the reason is out of date).  The reason (`WHY`, by name) says
why no input can tell the mutant from the original.  `--check` only verifies that every anchor text occurs exactly once and that every reason
belongs to a mutant; `--survivors=LOG` runs only the mutants that survived in an earlier run's output.  The source is restored after every mutant
(also on Ctrl-C), but do not run this with edits you cannot afford to lose in the mutated files and edit nothing meanwhile.  Needs `bun` in
./node_modules/.bin.  Each run has a 120 s timeout and an 8 GB address-space limit: a mutant that loops or blows up is killed, too.
"""
import os, re, resource, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUN = os.path.join(ROOT, 'node_modules/.bin/bun')
T = 'packages/ui/test/'
S = 'packages/ui/src/'
DESTROY = T + 'destroy.test.ts'
# the source files of the mutants, and the tests that run for the mutants of a file
SRC = {f: S + f for f in ['control.ts', 'static.ts', 'button.ts', 'checkbox.ts', 'radiobutton.ts', 'editbox.ts', 'imeeditbox.ts', 'slider.ts', 'navigation.ts',
                          'scrollbar.ts', 'combobox.ts', 'listbox.ts', 'controllist.ts', 'slot.ts', 'movie.ts', 'unibuffer.ts', 'stdmap.ts', 'dialog.ts',
                          'device.ts', 'census.ts']}
TESTS = {f: [DESTROY] for f in SRC}
for f in ['control.ts', 'static.ts', 'button.ts', 'checkbox.ts', 'radiobutton.ts', 'slider.ts', 'navigation.ts', 'scrollbar.ts']:
    TESTS[f] = [DESTROY, T + 'controls.test.ts']
TESTS['controllist.ts'] = [DESTROY, T + 'controls.test.ts', T + 'widgets.test.ts']
TESTS['editbox.ts'] = [DESTROY, T + 'editboxdraw.test.ts']
TESTS['imeeditbox.ts'] = [DESTROY, T + 'imeeditbox.test.ts']
TESTS['device.ts'] = [DESTROY, T + 'widgets.test.ts']
TESTS['dialog.ts'] = [DESTROY, T + 'framemove.test.ts', T + 'dialog.test.ts']
TESTS['movie.ts'] = [DESTROY, T + 'widgets.test.ts']
TESTS['listbox.ts'] = [DESTROY, T + 'listbox.test.ts']
TESTS['combobox.ts'] = [DESTROY, T + 'combobox.test.ts']
TESTS['slot.ts'] = [DESTROY, T + 'slot.test.ts']
TESTS['stdmap.ts'] = [DESTROY, T + 'widgets.test.ts']
TESTS['unibuffer.ts'] = [DESTROY, T + 'editboxdraw.test.ts']

M = []
WHY = {}


def m(f, name, a, b, why=''):
    M.append((f, name, a, b, why))


def path_of(f):
    return os.path.join(ROOT, SRC[f])


def read(f):
    return open(path_of(f)).read()


# ---- the statements of a destructor ----------------------------------------------------------------------------------------------------


def body(f, marker, indent=None):
    """the lines of the block that starts after the line containing `marker` (up to the closing brace at the indentation of that line)"""
    lines = read(f).split('\n')
    hits = [i for i, l in enumerate(lines) if marker in l]
    assert len(hits) == 1, (f, marker, hits)
    i = hits[0]
    ind = len(lines[i]) - len(lines[i].lstrip())
    j = i + 1
    while not (lines[j].startswith(' ' * ind + '}') and len(lines[j]) - len(lines[j].lstrip()) == ind):
        j += 1
    return lines[i + 1:j]


RE_TEX = re.compile(r'^\s+(?:this\.|tex\.)(\w+) = destroyTexture\(')
RE_CLOSE = re.compile(r'^\s+this\.(\w+) = this\.closeHeldDevice\(')
RE_NULL = re.compile(r'^\s+this\.(\w+) = null;$')
RE_CALL = re.compile(r'^\s+this\.(\w+)\.Destroy\(\);$')
RE_SUPER = re.compile(r'^\s+super\.Destroy\(\);$')


def statements(f, cls, marker):
    """a mutant for each statement of the body that is not executed, and one for each pair of neighbours that is released in the other order
    when the order shows (textures, sounds, owned objects: each leaves its device id in the log of the closes)"""
    lines = body(f, marker)
    src = read(f)
    kinds = []
    for l in lines:
        for kind, rx in (('texture', RE_TEX), ('device', RE_CLOSE), ('field', RE_NULL), ('object', RE_CALL), ('super', RE_SUPER)):
            mt = rx.match(l)
            if mt:
                kinds.append((kind, mt.group(1) if kind != 'super' else 'the base class'))
                break
        else:
            kinds.append((None, None))
    for i, l in enumerate(lines):
        kind, what = kinds[i]
        if kind is None:
            continue
        verb = {'texture': 'is not destroyed', 'device': 'is not closed', 'field': 'is not freed', 'object': 'is not destroyed', 'super': 'is not run'}[kind]
        a = l + '\n'
        if src.count(a) != 1:  # the same statement is in another class of the file: take the line before it as well
            a = lines[i - 1] + '\n' + l + '\n'
            m(f, f'{cls}: {what} {verb}', a, lines[i - 1] + '\n')
        else:
            m(f, f'{cls}: {what} {verb}', a, '')
    for i in range(len(lines) - 1):
        (k1, w1), (k2, w2) = kinds[i], kinds[i + 1]
        if k1 in ('texture', 'device', 'object') and k2 in ('texture', 'device', 'object'):
            a = lines[i] + '\n' + lines[i + 1]
            m(f, f'{cls}: {w1} and {w2} are released in the other order', a, lines[i + 1] + '\n' + lines[i])


# ---- the classes ---------------------------------------------------------------------------------------------------------------------------

for f, cls in [('static.ts', 'Static'), ('checkbox.ts', 'CheckBox'), ('radiobutton.ts', 'RadioButton'), ('editbox.ts', 'EditBox'), ('imeeditbox.ts', 'IMEEditBox'),
               ('slider.ts', 'Slider'), ('navigation.ts', 'Navigation'), ('scrollbar.ts', 'ScrollBar'), ('combobox.ts', 'ComboBox'), ('listbox.ts', 'ListBox'),
               ('controllist.ts', 'ContolList'), ('slot.ts', 'Slot'), ('button.ts', 'Button')]:
    statements(f, cls, 'override Destroy(): void {')

ST = 'static.ts'
m(ST, 'Static: the pictures are not destroyed', '    for (const picture of this.m_PictureDataList) picture.Destroy();\n    this.m_PictureDataList.length = 0;', '    this.m_PictureDataList.length = 0;')
m(ST, 'Static: the pictures are kept', '    for (const picture of this.m_PictureDataList) picture.Destroy();\n    this.m_PictureDataList.length = 0;', '    for (const picture of this.m_PictureDataList) picture.Destroy();')
m(ST, 'Static: the strings are kept', '    this.m_StringDataList.length = 0;\n', '')
m(ST, 'Static: the movies are not destroyed', '    for (const movie of this.m_MovieDataList) movie.Destroy();\n    this.m_MovieDataList.length = 0;', '    this.m_MovieDataList.length = 0;')
m(ST, 'Static: the movies are kept', '    for (const movie of this.m_MovieDataList) movie.Destroy();\n    this.m_MovieDataList.length = 0;', '    for (const movie of this.m_MovieDataList) movie.Destroy();')
m(ST, 'Static: the movies go before the pictures', '    for (const picture of this.m_PictureDataList) picture.Destroy();\n    this.m_PictureDataList.length = 0;\n    this.m_StringDataList.length = 0;\n    for (const movie of this.m_MovieDataList) movie.Destroy();\n    this.m_MovieDataList.length = 0;',
  '    for (const movie of this.m_MovieDataList) movie.Destroy();\n    this.m_MovieDataList.length = 0;\n    this.m_StringDataList.length = 0;\n    for (const picture of this.m_PictureDataList) picture.Destroy();\n    this.m_PictureDataList.length = 0;')

# ---- ~CKTDGUIControl and the data -----------------------------------------------------------------------------------------------------------
for l in ['    this.m_pDialog = null;', '    this.m_Name = "";', '    this.m_NowTexChangeData.Destroy(this.ctx.devices);', '    this.m_GuideDesc = "";',
          '    this.m_DummyIntList.length = 0;', '    this.m_DummyStringList.length = 0;', '    this.m_DummyPosList.length = 0;', '    this.m_queMoveItems.length = 0;',
          '    this.m_TabControlName = "";', '    this.m_PrevTabControlName = "";']:
    what = re.sub(r'^\s+this\.(\w+).*$', r'\1', l)
    anchor = '    this.m_Name = "";\n    this.m_NowTexChangeData' if what == 'm_Name' else None
    if what == 'm_TabControlName':  # `this.m_TabControlName = "";` is also the tail of `SetTabControlName`
        m('control.ts', 'control: m_TabControlName is not emptied', '    this.m_queMoveItems.length = 0;\n' + l + '\n', '    this.m_queMoveItems.length = 0;\n')
    elif what == 'm_Name':
        m('control.ts', 'control: m_Name is not emptied', '    this.m_pDialog = null;\n' + l + '\n', '    this.m_pDialog = null;\n')
    elif what == 'm_queMoveItems':
        m('control.ts', 'control: m_queMoveItems is not emptied', '    this.m_DummyPosList.length = 0;\n' + l + '\n', '    this.m_DummyPosList.length = 0;\n')
    elif what == 'm_pDialog':
        m('control.ts', 'control: m_pDialog is not forgotten', '    this.m_pDialog = null;\n    this.m_Name = "";\n    this.m_NowTexChangeData', '    this.m_Name = "";\n    this.m_NowTexChangeData')
    else:
        m('control.ts', f'control: {what} is not emptied', l + '\n', '')

CO = 'control.ts'
m(CO, 'UITextureData: the device is not closed', '      devices.closeDevice(this.pTexture.deviceID);\n      this.pTexture = null;\n    }\n  }\n}\n\n/**\n * What every destructor',
  '      this.pTexture = null;\n    }\n  }\n}\n\n/**\n * What every destructor')
m(CO, 'UITextureData: the texture is kept', '      devices.closeDevice(this.pTexture.deviceID);\n      this.pTexture = null;\n    }\n  }\n}\n\n/**\n * What every destructor',
  '      devices.closeDevice(this.pTexture.deviceID);\n    }\n  }\n}\n\n/**\n * What every destructor')
m(CO, 'destroyTexture: the data is not destroyed', '  data?.Destroy(devices);\n  return null;', '  return null;')
m(CO, 'destroyTexture: the field keeps the data', '  data?.Destroy(devices);\n  return null;', '  data?.Destroy(devices);\n  return data as null;')
m(CO, 'TexChangeData: the device is not closed', '        devices.closeDevice(t.pTexture.deviceID);\n        t.pTexture = null;', '        t.pTexture = null;')
m(CO, 'TexChangeData: the texture is kept', '        devices.closeDevice(t.pTexture.deviceID);\n        t.pTexture = null;', '        devices.closeDevice(t.pTexture.deviceID);')
m(CO, 'TexChangeData: the texture data is kept', '      this.m_pTexData = null;\n    }\n  }\n}', '    }\n  }\n}')
m(CO, 'TexChangeData: a step without a texture data is a crash (the data is not tested)', '    const t = this.m_pTexData;\n    if (t) {\n      if (t.pTexture) {',
  '    const t = this.m_pTexData!;\n    if (true) {\n      if (t.pTexture) {')
m(CO, 'CPictureData: the texture is not destroyed', '      this.pTexture.Destroy(this.ctx.devices);\n      this.pTexture = null;\n    }\n    this.pPoint = null;',
  '      this.pTexture = null;\n    }\n    this.pPoint = null;')
m(CO, 'CPictureData: the texture is kept', '      this.pTexture.Destroy(this.ctx.devices);\n      this.pTexture = null;\n    }\n    this.pPoint = null;',
  '      this.pTexture.Destroy(this.ctx.devices);\n    }\n    this.pPoint = null;')
m(CO, 'CPictureData: the point is kept', '      this.pTexture = null;\n    }\n    this.pPoint = null;', '      this.pTexture = null;\n    }')
m(CO, 'closeHeldDevice: the device is not closed', '    if (device) this.ctx.devices.closeDevice(device.deviceID);\n    return undefined;', '    return undefined;')
m(CO, 'closeHeldDevice: a missing device is closed too (a crash)', '    if (device) this.ctx.devices.closeDevice(device.deviceID);\n    return undefined;',
  '    this.ctx.devices.closeDevice(device!.deviceID);\n    return undefined;')
m(CO, 'closeHeldDevice: the field keeps the device', '    if (device) this.ctx.devices.closeDevice(device.deviceID);\n    return undefined;',
  '    if (device) this.ctx.devices.closeDevice(device.deviceID);\n    return device as undefined;')

# ---- the sounds the exe leaks -----------------------------------------------------------------------------------------------------------------
BU = 'button.ts'
m(BU, 'Button: the old over sound is not recorded as leaked', '    if (this.m_pSndMouseOver) this.leakedSounds.push(this.m_pSndMouseOver);\n    this.m_pSndMouseOver = this.ctx.devices.openSound(soundFileName);',
  '    this.m_pSndMouseOver = this.ctx.devices.openSound(soundFileName);')
m(BU, 'Button: a custom over sound is recorded when there was none', '    if (this.m_pSndMouseOver) this.leakedSounds.push(this.m_pSndMouseOver);\n    this.m_pSndMouseOver = this.ctx.devices.openSound(soundFileName);',
  '    this.leakedSounds.push(this.m_pSndMouseOver!);\n    this.m_pSndMouseOver = this.ctx.devices.openSound(soundFileName);')
m(BU, 'Button: the old over sound is closed by the custom one', '    if (this.m_pSndMouseOver) this.leakedSounds.push(this.m_pSndMouseOver);\n    this.m_pSndMouseOver = this.ctx.devices.openSound(soundFileName);',
  '    this.m_pSndMouseOver = this.closeHeldDevice(this.m_pSndMouseOver);\n    this.m_pSndMouseOver = this.ctx.devices.openSound(soundFileName);')
m(BU, 'Button: the old up sound is not recorded as leaked', '    if (this.m_pSndMouseUp) this.leakedSounds.push(this.m_pSndMouseUp);\n    this.m_pSndMouseUp = this.ctx.devices.openSound(soundFileName);',
  '    this.m_pSndMouseUp = this.ctx.devices.openSound(soundFileName);')
m(BU, 'Button: a custom up sound is recorded when there was none', '    if (this.m_pSndMouseUp) this.leakedSounds.push(this.m_pSndMouseUp);\n    this.m_pSndMouseUp = this.ctx.devices.openSound(soundFileName);',
  '    this.leakedSounds.push(this.m_pSndMouseUp!);\n    this.m_pSndMouseUp = this.ctx.devices.openSound(soundFileName);')
m(BU, 'Button: the old up sound is closed by the custom one', '    if (this.m_pSndMouseUp) this.leakedSounds.push(this.m_pSndMouseUp);\n    this.m_pSndMouseUp = this.ctx.devices.openSound(soundFileName);',
  '    this.m_pSndMouseUp = this.closeHeldDevice(this.m_pSndMouseUp);\n    this.m_pSndMouseUp = this.ctx.devices.openSound(soundFileName);')
m(BU, 'Button: the custom over sound goes into the up sound', 'override setCustomMouseOverSound(soundFileName: string): void {\n    if (this.m_pSndMouseOver) this.leakedSounds.push(this.m_pSndMouseOver);\n    this.m_pSndMouseOver = ',
  'override setCustomMouseOverSound(soundFileName: string): void {\n    if (this.m_pSndMouseOver) this.leakedSounds.push(this.m_pSndMouseOver);\n    this.m_pSndMouseUp = ')
m(BU, 'Button: the mouse down sound is not recorded as leaked', '    if (this.m_pSndMouseDown) this.leakedSounds.push(this.m_pSndMouseDown); // the destructor never closes it\n', '')
m(BU, 'Button: a missing mouse down sound is recorded (a crash)', '    if (this.m_pSndMouseDown) this.leakedSounds.push(this.m_pSndMouseDown); // the destructor never closes it',
  '    this.leakedSounds.push(this.m_pSndMouseDown!); // the destructor never closes it')
m(BU, 'Button: the mouse down sound is closed after all', '    if (this.m_pSndMouseDown) this.leakedSounds.push(this.m_pSndMouseDown); // the destructor never closes it',
  '    if (this.m_pSndMouseDown) this.leakedSounds.push(this.m_pSndMouseDown);\n    this.m_pSndMouseDown = this.closeHeldDevice(this.m_pSndMouseDown);')
for kind, field in (('Over', 'm_pSndMouseOver'), ('Up', 'm_pSndMouseUp'), ('Down', 'm_pSndMouseDown')):
    A = f'    if (this.{field}) this.ctx.devices.closeDevice(this.{field}.deviceID);\n    this.{field} = this.ctx.devices.openSound(fileName);'
    other = {'Over': 'm_pSndMouseUp', 'Up': 'm_pSndMouseDown', 'Down': 'm_pSndMouseOver'}[kind]
    m(BU, f'Button: Change{kind}Sound does not close the old sound', A, f'    this.{field} = this.ctx.devices.openSound(fileName);')
    m(BU, f'Button: Change{kind}Sound closes a sound that is not there (a crash)', A, f'    this.ctx.devices.closeDevice(this.{field}!.deviceID);\n    this.{field} = this.ctx.devices.openSound(fileName);')
    m(BU, f'Button: Change{kind}Sound closes the sound of another kind', A, f'    if (this.{other}) this.ctx.devices.closeDevice(this.{other}.deviceID);\n    this.{field} = this.ctx.devices.openSound(fileName);')
    m(BU, f'Button: Change{kind}Sound counts the old sound as leaked too', A, f'    if (this.{field}) this.leakedSounds.push(this.{field});\n' + A)
    m(BU, f'Button: Change{kind}Sound does not open the new sound', A, f'    if (this.{field}) this.ctx.devices.closeDevice(this.{field}.deviceID);\n    this.{field} = undefined;')
    m(BU, f'Button: Change{kind}Sound keeps the old sound when the name is empty', A, f'    if (this.{field}) this.ctx.devices.closeDevice(this.{field}.deviceID);\n    this.{field} = this.ctx.devices.openSound(fileName) ?? this.{field};')
    m(BU, f'Button: Change{kind}Sound opens the sound before it closes the old one', A, f'    const next = this.ctx.devices.openSound(fileName);\n    if (this.{field}) this.ctx.devices.closeDevice(this.{field}.deviceID);\n    this.{field} = next;')
m(BU, 'Button: the custom up sound goes into the mouse down sound', 'override setCustomMouseUpSound(soundFileName: string): void {\n    if (this.m_pSndMouseUp) this.leakedSounds.push(this.m_pSndMouseUp);\n    this.m_pSndMouseUp = ',
  'override setCustomMouseUpSound(soundFileName: string): void {\n    if (this.m_pSndMouseUp) this.leakedSounds.push(this.m_pSndMouseUp);\n    this.m_pSndMouseDown = ')
RB = 'radiobutton.ts'
m(RB, 'RadioButton: the old over sound is not recorded as leaked', '    if (this.m_pSndMouseOver) this.leakedSounds.push(this.m_pSndMouseOver);\n', '')
m(RB, 'RadioButton: the old check sound is not recorded as leaked', '    if (this.m_pSndCheck) this.leakedSounds.push(this.m_pSndCheck);\n', '')
m(RB, 'RadioButton: a custom over sound is recorded when there was none', '    if (this.m_pSndMouseOver) this.leakedSounds.push(this.m_pSndMouseOver);', '    this.leakedSounds.push(this.m_pSndMouseOver!);')
m(RB, 'RadioButton: a custom check sound is recorded when there was none', '    if (this.m_pSndCheck) this.leakedSounds.push(this.m_pSndCheck);', '    this.leakedSounds.push(this.m_pSndCheck!);')
m(RB, 'RadioButton: the old over sound is closed by the custom one', '    if (this.m_pSndMouseOver) this.leakedSounds.push(this.m_pSndMouseOver);',
  '    this.m_pSndMouseOver = this.closeHeldDevice(this.m_pSndMouseOver);')
m(RB, 'RadioButton: the old check sound is closed by the custom one', '    if (this.m_pSndCheck) this.leakedSounds.push(this.m_pSndCheck);',
  '    this.m_pSndCheck = this.closeHeldDevice(this.m_pSndCheck);')
m(RB, 'RadioButton: the custom over sound goes into the check sound', 'override setCustomMouseOverSound(soundFileName: string): void {\n    if (this.m_pSndMouseOver) this.leakedSounds.push(this.m_pSndMouseOver);\n    this.m_pSndMouseOver = ',
  'override setCustomMouseOverSound(soundFileName: string): void {\n    if (this.m_pSndMouseOver) this.leakedSounds.push(this.m_pSndMouseOver);\n    this.m_pSndCheck = ')
m(RB, 'RadioButton: the custom up sound goes into the over sound', 'override setCustomMouseUpSound(soundFileName: string): void {\n    if (this.m_pSndCheck) this.leakedSounds.push(this.m_pSndCheck);\n    this.m_pSndCheck = ',
  'override setCustomMouseUpSound(soundFileName: string): void {\n    if (this.m_pSndCheck) this.leakedSounds.push(this.m_pSndCheck);\n    this.m_pSndMouseOver = ')

# ---- the button ---------------------------------------------------------------------------------------------------------------------------
MOVE = 's.move(s.m_OffsetPos, new Color(0, 0, 0, 0), f(0.07), true, true, false, 1)'
STATIC = 'if (dialog !== null && !dialog.destroyed && dialog.checkControl(s)) ' + MOVE + ';'
m(BU, 'Button: a static is not moved', STATIC, '')
m(BU, 'Button: a static of a missing dialog is moved (a crash)', 'if (dialog !== null && !dialog.destroyed && dialog.checkControl(s)) ' + MOVE, 'if (!dialog!.destroyed && dialog!.checkControl(s)) ' + MOVE)
m(BU, 'Button: a static of a destroyed dialog is moved', 'if (dialog !== null && !dialog.destroyed && dialog.checkControl(s)) ' + MOVE, 'if (dialog !== null && dialog.checkControl(s)) ' + MOVE)
m(BU, 'Button: a static that is not in the dialog is moved', 'if (dialog !== null && !dialog.destroyed && dialog.checkControl(s)) ' + MOVE, 'if (dialog !== null && !dialog.destroyed) ' + MOVE)
m(BU, 'Button: the move goes to the position of the static, not to its offset', 's.move(s.m_OffsetPos, new Color(0, 0, 0, 0)', 's.move(s.m_Pos, new Color(0, 0, 0, 0)')
m(BU, 'Button: the move goes to the colour 1', 'new Color(0, 0, 0, 0), f(0.07)', 'new Color(1, 1, 1, 1), f(0.07)')
m(BU, 'Button: the move goes to the colour 0 but keeps the alpha', 'new Color(0, 0, 0, 0), f(0.07)', 'new Color(0, 0, 0, 1), f(0.07)')
m(BU, 'Button: the move takes 0.07 as a double', 'new Color(0, 0, 0, 0), f(0.07), true', 'new Color(0, 0, 0, 0), 0.07, true')
m(BU, 'Button: the move takes 0.1 s', 'new Color(0, 0, 0, 0), f(0.07), true', 'new Color(0, 0, 0, 0), f(0.1), true')
m(BU, 'Button: the move is not direct', 'f(0.07), true, true, false, 1)', 'f(0.07), false, true, false, 1)')
m(BU, 'Button: the move does not delete the static on arrival', 'f(0.07), true, true, false, 1)', 'f(0.07), true, false, false, 1)')
m(BU, 'Button: the move goes back and forth', 'f(0.07), true, true, false, 1)', 'f(0.07), true, true, true, 1)')
m(BU, 'Button: the move repeats', 'f(0.07), true, true, false, 1)', 'f(0.07), true, true, false, 2)')
EDGE = '    this.m_pEdgeTexture = this.closeHeldDevice(this.m_pEdgeTexture);\n'
m(BU, 'Button: only the first three statics are looked at', EDGE + '    for (let i = 0; i < 4; i++) {', EDGE + '    for (let i = 0; i < 3; i++) {')
m(BU, 'Button: the first static is not looked at', EDGE + '    for (let i = 0; i < 4; i++) {', EDGE + '    for (let i = 1; i < 4; i++) {')
m(BU, 'Button: a missing static is a crash', '      const s = this.m_StaticControls[i];\n      if (!s) continue;', '      const s = this.m_StaticControls[i]!;',
  'equivalent: a missing static is null and CheckControl (32956A00) is false for null, so nobody is moved either way; the guard only saves the call')
m(BU, 'Button: the statics move after the animation maps are destroyed', '    for (let i = 0; i < 4; i++) {\n      const s = this.m_StaticControls[i];\n      if (!s) continue;\n      const dialog = this.m_pDialog;\n      if (dialog !== null && !dialog.destroyed && dialog.checkControl(s)) ' + MOVE + ';\n    }\n    for (const map of',
  '    for (const map of [this.m_mapMouseOverTex, this.m_mapMouseNormalTex, this.m_mapMouseDownTex]) {\n      for (const sequenceID of [...map.keys()].sort((a, b) => a - b)) map.get(sequenceID)!.Destroy(devices); // a `std::map<int, ...>` is walked in key order\n      map.clear();\n    }\n    for (let i = 0; i < 4; i++) {\n      const s = this.m_StaticControls[i];\n      if (!s) continue;\n      const dialog = this.m_pDialog;\n      if (dialog !== null && !dialog.destroyed && dialog.checkControl(s)) ' + MOVE + ';\n    }\n    for (const map of')
MAPS = 'for (const map of [this.m_mapMouseOverTex, this.m_mapMouseNormalTex, this.m_mapMouseDownTex]) {'
m(BU, 'Button: the normal animation steps go before the over ones', MAPS, 'for (const map of [this.m_mapMouseNormalTex, this.m_mapMouseOverTex, this.m_mapMouseDownTex]) {')
m(BU, 'Button: the down animation steps go before the normal ones', MAPS, 'for (const map of [this.m_mapMouseOverTex, this.m_mapMouseDownTex, this.m_mapMouseNormalTex]) {')
m(BU, 'Button: the down animation steps are not destroyed', MAPS, 'for (const map of [this.m_mapMouseOverTex, this.m_mapMouseNormalTex]) {')
m(BU, 'Button: the over animation steps are not destroyed', MAPS, 'for (const map of [this.m_mapMouseNormalTex, this.m_mapMouseDownTex]) {')
m(BU, 'Button: the animation steps go in the order they were put in', '[...map.keys()].sort((a, b) => a - b)', '[...map.keys()]')
m(BU, 'Button: the animation steps go from the last key to the first', '[...map.keys()].sort((a, b) => a - b)', '[...map.keys()].sort((a, b) => b - a)')
m(BU, 'Button: the animation steps are not destroyed', 'map.get(sequenceID)!.Destroy(devices); // a `std::map<int, ...>` is walked in key order\n', '')
m(BU, 'Button: the animation maps are not emptied', '      map.clear();\n', '')

# ---- the radio button ---------------------------------------------------------------------------------------------------------------------
GRP = '    const dialog = this.m_pDialog;\n    if (dialog !== null && !dialog.destroyed) {\n      const order = dialog.m_mapRadioButtonGroupInfo.get(this.m_GroupID)?.m_vecpCheckedOrder;\n      const at = order?.indexOf(this) ?? -1;\n      if (order && at >= 0) order.splice(at, 1);\n    }\n'
m(RB, 'RadioButton: the button stays in its group\'s checked order', GRP, '')
m(RB, 'RadioButton: a button of no dialog is looked up (a crash)', 'if (dialog !== null && !dialog.destroyed) {\n      const order', 'if (!dialog!.destroyed) {\n      const order')
m(RB, 'RadioButton: a button of a destroyed dialog is taken out of the order', 'if (dialog !== null && !dialog.destroyed) {\n      const order', 'if (dialog !== null) {\n      const order')
m(RB, 'RadioButton: another group\'s order is looked at', 'get(this.m_GroupID)?.m_vecpCheckedOrder', 'get(this.m_GroupID + 1)?.m_vecpCheckedOrder')
m(RB, 'RadioButton: the last place of the button goes', 'const at = order?.indexOf(this) ?? -1;', 'const at = order?.lastIndexOf(this) ?? -1;')
m(RB, 'RadioButton: the place 0 is not found', 'if (order && at >= 0) order.splice(at, 1);', 'if (order && at > 0) order.splice(at, 1);')
m(RB, 'RadioButton: two places go', 'if (order && at >= 0) order.splice(at, 1);', 'if (order && at >= 0) order.splice(at, 2);')
m(RB, 'RadioButton: the place that follows goes', 'if (order && at >= 0) order.splice(at, 1);', 'if (order && at >= 0) order.splice(at + 1, 1);')
m(RB, 'RadioButton: the order is left after the dialog\'s part is done and the sounds are closed', '    this.m_pCheckedEdgeTexture = this.closeHeldDevice(this.m_pCheckedEdgeTexture);\n' + GRP + '    super.Destroy();',
  '    super.Destroy();\n' + GRP + '    this.m_pCheckedEdgeTexture = this.closeHeldDevice(this.m_pCheckedEdgeTexture);')

# ---- the list box and the combo box -------------------------------------------------------------------------------------------------------
for f, cls in [('listbox.ts', 'ListBox'), ('combobox.ts', 'ComboBox')]:
    LOOP = '    for (const item of this.m_Items) {\n      if (item.pControl) {\n        item.pControl.Destroy();\n        item.pControl = null;\n      }\n    }\n'
    m(f, f'{cls}: the controls of the rows are not destroyed', '        item.pControl.Destroy();\n        item.pControl = null;', '        item.pControl = null;')
    m(f, f'{cls}: the rows keep their controls', '        item.pControl.Destroy();\n        item.pControl = null;', '        item.pControl.Destroy();')
    m(f, f'{cls}: a row without a control is a crash', '      if (item.pControl) {\n        item.pControl.Destroy();\n        item.pControl = null;\n      }', '      {\n        item.pControl!.Destroy();\n        item.pControl = null;\n      }')
    TAIL = {'listbox.ts': '    this.m_nSelected = -1;\n    this.m_pBoudingBoxTex', 'combobox.ts': '    this.m_iSelected = -1;\n    this.m_iFocused = -1;'}[f]
    TRACK = '    this.m_pScrollBar?.setTrackRange(0, 1);\n'
    m(f, f'{cls}: the rows stay', '    this.m_Items.length = 0;\n' + TRACK + TAIL, TRACK + TAIL)
    m(f, f'{cls}: the scroll bar is not told the track', TRACK + TAIL, TAIL)
    m(f, f'{cls}: a box without a scroll bar is a crash', TRACK + TAIL, TRACK.replace('?.', '!.') + TAIL)
    m(f, f'{cls}: the track is 0..0', TRACK + TAIL, TRACK.replace('(0, 1)', '(0, 0)') + TAIL)
    m(f, f'{cls}: the track is 1..1', TRACK + TAIL, TRACK.replace('(0, 1)', '(1, 1)') + TAIL)
    m(f, f'{cls}: the track is 0..2', TRACK + TAIL, TRACK.replace('(0, 1)', '(0, 2)') + TAIL)
m('listbox.ts', 'ListBox: nothing stays selected', '    this.m_nSelected = -1;\n    this.m_pBoudingBoxTex', '    this.m_pBoudingBoxTex')
m('listbox.ts', 'ListBox: row 0 stays selected', '    this.m_nSelected = -1;\n    this.m_pBoudingBoxTex', '    this.m_nSelected = 0;\n    this.m_pBoudingBoxTex')
m('listbox.ts', 'ListBox: the group mark is kept', '    this.m_pGroupMark.Destroy();\n    this.m_pGroupMark = null as never;', '    this.m_pGroupMark.Destroy();')
m('listbox.ts', 'ListBox: the group mark is destroyed before the sound is closed',
  '    this.m_pSndMouseDown = this.closeHeldDevice(this.m_pSndMouseDown);\n    this.m_pGroupMark.Destroy();', '    this.m_pGroupMark.Destroy();\n    this.m_pSndMouseDown = this.closeHeldDevice(this.m_pSndMouseDown);')
m('combobox.ts', 'ComboBox: nothing stays selected', '    this.m_iSelected = -1;\n    this.m_iFocused = -1;', '    this.m_iFocused = -1;')
m('combobox.ts', 'ComboBox: row 0 stays selected', '    this.m_iSelected = -1;\n    this.m_iFocused = -1;', '    this.m_iSelected = 0;\n    this.m_iFocused = -1;')
m('combobox.ts', 'ComboBox: nothing stays focused', '    this.m_iSelected = -1;\n    this.m_iFocused = -1;', '    this.m_iSelected = -1;')
m('combobox.ts', 'ComboBox: row 0 stays focused', '    this.m_iSelected = -1;\n    this.m_iFocused = -1;', '    this.m_iSelected = -1;\n    this.m_iFocused = 0;')

# the removals of the list box
LB = 'listbox.ts'
m(LB, 'ListBox: destroyRowControl does not destroy', '    if (row.pControl) {\n      row.pControl.Destroy();\n      row.pControl = null;\n    }', '    if (row.pControl) {\n      row.pControl = null;\n    }')
m(LB, 'ListBox: destroyRowControl keeps the control', '    if (row.pControl) {\n      row.pControl.Destroy();\n      row.pControl = null;\n    }', '    if (row.pControl) {\n      row.pControl.Destroy();\n    }')
m(LB, 'ListBox: destroyRowControl on a row without a control is a crash', '    if (row.pControl) {\n      row.pControl.Destroy();\n      row.pControl = null;\n    }', '    {\n      row.pControl!.Destroy();\n      row.pControl = null;\n    }')
m(LB, 'ListBox: RemoveItem does not destroy the row\'s control', '    this.destroyRowControl(this.m_Items[index]!);\n    this.m_Items.splice(index, 1);', '    this.m_Items.splice(index, 1);')
m(LB, 'ListBox: RemoveItem destroys the control after the row is gone (the wrong row)', '    this.destroyRowControl(this.m_Items[index]!);\n    this.m_Items.splice(index, 1);', '    this.m_Items.splice(index, 1);\n    this.destroyRowControl(this.m_Items[index]!);')
m(LB, 'ListBox: RemoveItem destroys the control of the first row', '    this.destroyRowControl(this.m_Items[index]!);\n    this.m_Items.splice(index, 1);', '    this.destroyRowControl(this.m_Items[0]!);\n    this.m_Items.splice(index, 1);')
m(LB, 'ListBox: RemoveItemByText does not destroy the row\'s control', '      this.destroyRowControl(this.m_Items[i]!);\n      this.m_Items.splice(i, 1);', '      this.m_Items.splice(i, 1);')
m(LB, 'ListBox: RemoveItemByText destroys the control of the next row', '      this.destroyRowControl(this.m_Items[i]!);\n      this.m_Items.splice(i, 1);', '      this.destroyRowControl(this.m_Items[i + 1] ?? this.m_Items[i]!);\n      this.m_Items.splice(i, 1);')
m(LB, 'ListBox: RemoveItemByText destroys every control', '      if (this.m_Items[i]!.strText !== text) continue;\n      this.destroyRowControl(this.m_Items[i]!);', '      this.destroyRowControl(this.m_Items[i]!);\n      if (this.m_Items[i]!.strText !== text) continue;')
m(LB, 'ListBox: RemoveAllItems does not destroy the rows\' controls', '    for (const item of this.m_Items) this.destroyRowControl(item);\n    this.m_Items.length = 0;', '    this.m_Items.length = 0;')
m(LB, 'ListBox: RemoveAllItems destroys only the first control', '    for (const item of this.m_Items) this.destroyRowControl(item);', '    this.destroyRowControl(this.m_Items[0]!);')
RA = '    this.m_Items.length = 0;\n    this.m_pScrollBar?.setTrackRange(0, 1);\n    this.m_nSelected = -1;\n  }'
m(LB, 'ListBox: RemoveAllItems keeps the rows', RA, '    this.m_pScrollBar?.setTrackRange(0, 1);\n    this.m_nSelected = -1;\n  }')
m(LB, 'ListBox: RemoveAllItems does not tell the scroll bar', RA, '    this.m_Items.length = 0;\n    this.m_nSelected = -1;\n  }')
m(LB, 'ListBox: RemoveAllItems keeps the selection', RA, '    this.m_Items.length = 0;\n    this.m_pScrollBar?.setTrackRange(0, 1);\n  }')
m(LB, 'ListBox: RemoveAllItems selects the first row', RA, '    this.m_Items.length = 0;\n    this.m_pScrollBar?.setTrackRange(0, 1);\n    this.m_nSelected = 0;\n  }')
m(LB, 'ListBox: RemoveAllItems destroys the controls after the rows are gone', '    for (const item of this.m_Items) this.destroyRowControl(item);\n    this.m_Items.length = 0;', '    this.m_Items.length = 0;\n    for (const item of this.m_Items) this.destroyRowControl(item);')

# ---- the control list -----------------------------------------------------------------------------------------------------------------
CL = 'controllist.ts'
m(CL, 'ContolList: the cells are not forgotten', '    this.m_mapControls.clear();\n', '')
m(CL, 'ContolList: the controls of the cells are destroyed too', '    this.m_mapControls.clear();\n', '    for (const cell of this.m_mapControls) for (const c of cell.value) c.m_pControl.Destroy();\n    this.m_mapControls.clear();\n')
m(CL, 'ContolList: only the x bar is destroyed', 'for (const axis of ["m_pScrollBarX", "m_pScrollBarY"] as const) {', 'for (const axis of ["m_pScrollBarX"] as const) {')
m(CL, 'ContolList: only the y bar is destroyed', 'for (const axis of ["m_pScrollBarX", "m_pScrollBarY"] as const) {', 'for (const axis of ["m_pScrollBarY"] as const) {')
m(CL, 'ContolList: the y bar goes first', 'for (const axis of ["m_pScrollBarX", "m_pScrollBarY"] as const) {', 'for (const axis of ["m_pScrollBarY", "m_pScrollBarX"] as const) {')
m(CL, 'ContolList: the bars are not destroyed', '        bar.Destroy();\n        this[axis] = null;', '        this[axis] = null;')
m(CL, 'ContolList: the bars are kept', '        bar.Destroy();\n        this[axis] = null;', '        bar.Destroy();')
m(CL, 'ContolList: the y textures go before the x textures', 'for (const tex of [this.xTex, this.yTex]) {', 'for (const tex of [this.yTex, this.xTex]) {')
m(CL, 'ContolList: only the x textures are destroyed', 'for (const tex of [this.xTex, this.yTex]) {', 'for (const tex of [this.xTex]) {')
m(CL, 'ContolList: only the y textures are destroyed', 'for (const tex of [this.xTex, this.yTex]) {', 'for (const tex of [this.yTex]) {')
m(CL, 'ContolList: the current controls are kept', '    this.m_vecNowControls.length = 0;\n    super.Destroy();', '    super.Destroy();')

# ---- the slot -------------------------------------------------------------------------------------------------------------------------
SL = 'slot.ts'
m(SL, 'Slot: the slot that is dragged stays the dragged one', '    if (CKTDGUISlot.s_pDragSlot === this) CKTDGUISlot.s_pDragSlot = null;\n', '')
m(SL, 'Slot: any dragged slot is let go', 'if (CKTDGUISlot.s_pDragSlot === this) CKTDGUISlot.s_pDragSlot = null;', 'CKTDGUISlot.s_pDragSlot = null;')
m(SL, 'Slot: the slot being dragged is let go only when there is none', 'if (CKTDGUISlot.s_pDragSlot === this) CKTDGUISlot.s_pDragSlot = null;', 'if (CKTDGUISlot.s_pDragSlot !== this) CKTDGUISlot.s_pDragSlot = null;')
m(SL, 'Slot: the additional pictures go in the order they were put in', 'for (const picture of this.additionalPictures()) picture.Destroy();\n    this.m_mapAdditionalPictureDataList.clear();',
  'for (const picture of this.m_mapAdditionalPictureDataList.values()) picture.Destroy();\n    this.m_mapAdditionalPictureDataList.clear();')
m(SL, 'Slot: the additional pictures are not destroyed', '    for (const picture of this.additionalPictures()) picture.Destroy();\n    this.m_mapAdditionalPictureDataList.clear();', '    this.m_mapAdditionalPictureDataList.clear();')
m(SL, 'Slot: the additional pictures are kept', '    for (const picture of this.additionalPictures()) picture.Destroy();\n    this.m_mapAdditionalPictureDataList.clear();', '    for (const picture of this.additionalPictures()) picture.Destroy();')
m(SL, 'Slot: a slot without data is a crash', '    if (this.m_pSlotData) {\n      this.m_pSlotData.Destroy();\n      this.m_pSlotData = null;\n    }', '    {\n      this.m_pSlotData!.Destroy();\n      this.m_pSlotData = null;\n    }')

CX = '    for (const key of ["m_pDLGSlot", "m_pDLGSlotFixBack"] as const) {\n      const dialog = this[key];\n      if (dialog !== null && !dialog.destroyed) {\n        this.ctx.dialogManager.deleteDlg(dialog);\n        this[key] = null;\n      }\n    }'
m(SL, 'CX2Slot: the fixed back dialog goes first', 'for (const key of ["m_pDLGSlot", "m_pDLGSlotFixBack"] as const) {', 'for (const key of ["m_pDLGSlotFixBack", "m_pDLGSlot"] as const) {')
m(SL, 'CX2Slot: only the slot dialog is deleted', 'for (const key of ["m_pDLGSlot", "m_pDLGSlotFixBack"] as const) {', 'for (const key of ["m_pDLGSlot"] as const) {')
m(SL, 'CX2Slot: only the fixed back dialog is deleted', 'for (const key of ["m_pDLGSlot", "m_pDLGSlotFixBack"] as const) {', 'for (const key of ["m_pDLGSlotFixBack"] as const) {')
m(SL, 'CX2Slot: a missing dialog is deleted (a crash)', 'if (dialog !== null && !dialog.destroyed) {\n        this.ctx.dialogManager.deleteDlg(dialog);', 'if (!dialog!.destroyed) {\n        this.ctx.dialogManager.deleteDlg(dialog);')
m(SL, 'CX2Slot: a destroyed dialog is deleted again', 'if (dialog !== null && !dialog.destroyed) {\n        this.ctx.dialogManager.deleteDlg(dialog);', 'if (dialog !== null) {\n        this.ctx.dialogManager.deleteDlg(dialog);')
m(SL, 'CX2Slot: the dialog is not deleted', '        this.ctx.dialogManager.deleteDlg(dialog);\n        this[key] = null;', '        this[key] = null;')
m(SL, 'CX2Slot: the handle is kept', '        this.ctx.dialogManager.deleteDlg(dialog);\n        this[key] = null;', '        this.ctx.dialogManager.deleteDlg(dialog);')
m(SL, 'CX2Slot: the handle of a destroyed dialog is cleared too', '        this.ctx.dialogManager.deleteDlg(dialog);\n        this[key] = null;\n      }\n    }',
  '        this.ctx.dialogManager.deleteDlg(dialog);\n      }\n      this[key] = null;\n    }')

# ---- CMovieData -----------------------------------------------------------------------------------------------------------------------
MV = 'movie.ts'
m(MV, 'CMovieData: the render target is not closed', '      this.ctx.devices.closeDevice(target.deviceID);\n      this.m_pRenderTargetTexture = null;', '      this.m_pRenderTargetTexture = null;')
m(MV, 'CMovieData: the render target is kept', '      this.ctx.devices.closeDevice(target.deviceID);\n      this.m_pRenderTargetTexture = null;', '      this.ctx.devices.closeDevice(target.deviceID);')
m(MV, 'CMovieData: no render target is a crash', '    const target = this.m_pRenderTargetTexture;\n    if (target) {', '    const target = this.m_pRenderTargetTexture!;\n    if (true) {')
m(MV, 'CMovieData: the player is destroyed twice', '    if (this.m_Bvl.isCreated()) this.m_Bvl.destroy();', '    this.m_Bvl.destroy();')
m(MV, 'CMovieData: the player is not destroyed when it was created', '    if (this.m_Bvl.isCreated()) this.m_Bvl.destroy();\n', '')
m(MV, 'CMovieData: the player is destroyed when it was not created', '    if (this.m_Bvl.isCreated()) this.m_Bvl.destroy();', '    if (!this.m_Bvl.isCreated()) this.m_Bvl.destroy();')
m(MV, 'CMovieData: the video texture is not closed', '      texture.close();\n      texture.Destroy();', '      texture.Destroy();')
m(MV, 'CMovieData: the video texture is not destroyed', '      texture.close();\n      texture.Destroy();', '      texture.close();')
m(MV, 'CMovieData: the video texture is destroyed before it is closed', '      texture.close();\n      texture.Destroy();', '      texture.Destroy();\n      texture.close();')
m(MV, 'CMovieData: the video texture is kept', '      texture.Destroy();\n      this.m_pBvt = null;', '      texture.Destroy();')
m(MV, 'CMovieData: the video texture is destroyed before the player', '    if (this.m_Bvl.isCreated()) this.m_Bvl.destroy();\n    const texture = this.m_pBvt;', '    const texture = this.m_pBvt;')
m(MV, 'CMovieData: the last release of the player is not made', '      this.m_pBvt = null;\n    }\n    this.m_Bvl.destroy();\n  }', '      this.m_pBvt = null;\n    }\n  }')

# ---- the data classes of the edit controls ----------------------------------------------------------------------------------------------
m('unibuffer.ts', 'UniBuffer: the text is kept', '  Destroy(): void {\n    this.m_pwszBuffer = null;\n  }', '  Destroy(): void {\n  }')
m('stdmap.ts', 'IntPairMap: clear keeps the cells', '  clear(): void {\n    this.cells.length = 0;\n  }', '  clear(): void {\n  }')
m('stdmap.ts', 'IntPairMap: clear drops all but the first cell', '  clear(): void {\n    this.cells.length = 0;\n  }', '  clear(): void {\n    this.cells.length = 1;\n  }')

# ---- the dialog -----------------------------------------------------------------------------------------------------------------------
DL = 'dialog.ts'
m(DL, 'CheckControl: a control that is not in the list is found', 'return control !== null && this.m_ControlsList.includes(control);', 'return control !== null;')
m(DL, 'CheckControl: a control that is in the list is not found', 'return control !== null && this.m_ControlsList.includes(control);', 'return control !== null && !this.m_ControlsList.includes(control);')
m(DL, 'CheckControl: null is found', 'return control !== null && this.m_ControlsList.includes(control);', 'return control === null || this.m_ControlsList.includes(control);')
AUTO = '''      if (control.m_bCheckAutoDeleteEnd) {
        const named = this.m_ControlsMap.get(control.m_Name);
        if (named !== undefined) {
          this.m_ControlsMap.erase(control.m_Name); // the entry goes whether or not the control is in the list
          const at = this.m_ControlsList.indexOf(named);
          if (at >= 0) {
            const focus = this.ctx.controlFocus;
            if (focus === named) {
              focus.onFocusOut();
              this.ctx.controlFocus = null;
            }
            named.Destroy();
            this.m_ControlsList.splice(at, 1);
            continue; // a control that was deleted is not moved
          }
        }
      }'''
m(DL, 'auto-delete: the map entry stays', '          this.m_ControlsMap.erase(control.m_Name); // the entry goes whether or not the control is in the list\n', '')
m(DL, 'auto-delete: the map entry goes only for a control that is in the list', AUTO,
  AUTO.replace('          this.m_ControlsMap.erase(control.m_Name); // the entry goes whether or not the control is in the list\n', '').replace('            const focus = this.ctx.controlFocus;', '            this.m_ControlsMap.erase(control.m_Name);\n            const focus = this.ctx.controlFocus;'))
m(DL, 'auto-delete: a control that is not in the list is deleted too', 'if (at >= 0) {\n            const focus', 'if (at >= -1) {\n            const focus')
m(DL, 'auto-delete: the control at the first place is not deleted', 'if (at >= 0) {\n            const focus', 'if (at > 0) {\n            const focus')
m(DL, 'auto-delete: the control that has the focus does not lose it', '            if (focus === named) {\n              focus.onFocusOut();\n              this.ctx.controlFocus = null;\n            }\n', '')
m(DL, 'auto-delete: the marked control, not the named one, is compared with the focus', '            if (focus === named) {', '            if (focus === control) {')
m(DL, 'auto-delete: any focus is lost', '            if (focus === named) {', '            if (focus !== null) {')
m(DL, 'auto-delete: a control that loses the focus is not told', '              focus.onFocusOut();\n              this.ctx.controlFocus = null;\n            }\n            named.Destroy();', '              this.ctx.controlFocus = null;\n            }\n            named.Destroy();')
m(DL, 'auto-delete: the focus stays on the destroyed control', '              focus.onFocusOut();\n              this.ctx.controlFocus = null;\n            }\n            named.Destroy();', '              focus.onFocusOut();\n            }\n            named.Destroy();')
m(DL, 'auto-delete: the control is not destroyed', '            named.Destroy();\n            this.m_ControlsList.splice(at, 1);', '            this.m_ControlsList.splice(at, 1);')
m(DL, 'auto-delete: the marked control is destroyed, not the named one', '            named.Destroy();\n            this.m_ControlsList.splice(at, 1);', '            control.Destroy();\n            this.m_ControlsList.splice(at, 1);')
m(DL, 'auto-delete: the control is destroyed after it left the list', '            named.Destroy();\n            this.m_ControlsList.splice(at, 1);', '            this.m_ControlsList.splice(at, 1);\n            named.Destroy();')
m(DL, 'auto-delete: the control stays in the list', '            named.Destroy();\n            this.m_ControlsList.splice(at, 1);', '            named.Destroy();')
m(DL, 'auto-delete: the place of the marked control leaves the list, not the named one\'s', '            this.m_ControlsList.splice(at, 1);\n            continue;', '            this.m_ControlsList.splice(i, 1);\n            continue;')
m(DL, 'auto-delete: the deleted control is moved', '            continue; // a control that was deleted is not moved\n', '')

ADD1 = '    if (this.m_wstrCustomButtonMouseOverSndFileName !== "") control.setCustomMouseOverSound(this.m_wstrCustomButtonMouseOverSndFileName);\n'
ADD2 = '    if (this.m_wstrCustomButtonMouseUpSndFileName !== "") control.setCustomMouseUpSound(this.m_wstrCustomButtonMouseUpSndFileName);\n'
m(DL, 'AddControl: the custom over sound is not handed on', ADD1, '')
m(DL, 'AddControl: the custom up sound is not handed on', ADD2, '')
m(DL, 'AddControl: an empty custom over sound is handed on', ADD1, ADD1.replace('!== ""', '!== "\\0"'))
m(DL, 'AddControl: an empty custom up sound is handed on', ADD2, ADD2.replace('!== ""', '!== "\\0"'))
m(DL, 'AddControl: the custom over sound is handed on when there is a custom up sound', ADD1, ADD1.replace('m_wstrCustomButtonMouseOverSndFileName !== ""', 'm_wstrCustomButtonMouseUpSndFileName !== ""'))
m(DL, 'AddControl: the custom up sound is handed on when there is a custom over sound', ADD2, ADD2.replace('m_wstrCustomButtonMouseUpSndFileName !== ""', 'm_wstrCustomButtonMouseOverSndFileName !== ""'))
m(DL, 'AddControl: the custom over sound is handed on as the up sound', ADD1, ADD1.replace('control.setCustomMouseOverSound(this.m_wstrCustomButtonMouseOverSndFileName)', 'control.setCustomMouseOverSound(this.m_wstrCustomButtonMouseUpSndFileName)'))
m(DL, 'AddControl: the custom up sound is handed on as the over sound', ADD2, ADD2.replace('control.setCustomMouseUpSound(this.m_wstrCustomButtonMouseUpSndFileName)', 'control.setCustomMouseUpSound(this.m_wstrCustomButtonMouseOverSndFileName)'))
m(DL, 'AddControl: the custom sounds are handed on after the control is entered', ADD1 + ADD2 + '    this.m_ControlsMap.emplace(control.m_Name, control);\n    this.m_ControlsList.push(control);',
  '    this.m_ControlsMap.emplace(control.m_Name, control);\n    this.m_ControlsList.push(control);\n' + ADD1 + ADD2,
  'equivalent: the sounds are handed to the control itself, which does not look at the dialog\'s lists')

# ---- the device manager's hook and the census's destruction -----------------------------------------------------------------------------------
DV = 'device.ts'
m(DV, 'CloseDevice: the stray close is not told', '    this.onStrayClose?.(id);\n', '')
m(DV, 'CloseDevice: the stray close is told the id as it was given', '    this.onStrayClose?.(id);', '    this.onStrayClose?.(deviceID);')
m(DV, 'CloseDevice: a texture close is a stray close too', '      if (--tex.refCount <= 0) this.devices.delete(id);\n      return;', '      if (--tex.refCount <= 0) this.devices.delete(id);\n      this.onStrayClose?.(id);\n      return;')
m(DV, 'CloseDevice: a render target close is a stray close too', '      if (--target.refCount <= 0) this.renderTargets.delete(id);\n      return;', '      if (--target.refCount <= 0) this.renderTargets.delete(id);\n      this.onStrayClose?.(id);\n      return;')
m(DV, 'CloseDevice: a sound close is a stray close too', '      if (--snd.refCount <= 0) this.sounds.delete(id);\n      return;', '      if (--snd.refCount <= 0) this.sounds.delete(id);\n      this.onStrayClose?.(id);\n      return;')
m(DV, 'CloseDevice: a sound close goes on to the stray close', '      if (--snd.refCount <= 0) this.sounds.delete(id);\n      return;\n    }\n    this.onStrayClose', '      if (--snd.refCount <= 0) this.sounds.delete(id);\n    }\n    this.onStrayClose')
m(DV, 'CloseDevice: the empty id is a stray close', '    if (deviceID.length === 0) return;\n    const id = towupperAscii(deviceID);\n    const tex = this.devices.get(id);', '    if (deviceID.length === 0) return void this.onStrayClose?.(deviceID);\n    const id = towupperAscii(deviceID);\n    const tex = this.devices.get(id);')

CE = 'census.ts'
m(CE, 'destroyDialogs: the dialogs are destroyed in the other order', '  dialogs.forEach((dialog, i) => {\n    report.controls += controls[i]!.length;', '  [...dialogs].reverse().forEach((dialog, j) => {\n    const i = dialogs.length - 1 - j;\n    report.controls += controls[i]!.length;')
m(CE, 'destroyDialogs: the controls are counted after the destruction', '  const controls = dialogs.map((d) => d.m_ControlsList.slice()); // a destroyed dialog\'s list is empty', '  const controls = dialogs.map((d) => d.m_ControlsList.slice(0, 0));')
m(CE, 'destroyDialogs: the controls are not counted', '    report.controls += controls[i]!.length;\n', '')
m(CE, 'destroyDialogs: the controls are counted twice', '    report.controls += controls[i]!.length;', '    report.controls += controls[i]!.length * 2;')
m(CE, 'destroyDialogs: a destruction that throws is not reported', '      report.errors.push(`${i}: ${HostWorld.describeError(e)}`);', '      void e;')
m(CE, 'destroyDialogs: a destruction that throws is reported with the wrong index', '      report.errors.push(`${i}: ${HostWorld.describeError(e)}`);', '      report.errors.push(`${i + 1}: ${HostWorld.describeError(e)}`);')
m(CE, 'destroyDialogs: a destruction that throws stops the others', '      report.errors.push(`${i}: ${HostWorld.describeError(e)}`);', '      report.errors.push(`${i}: ${HostWorld.describeError(e)}`);\n      throw e;')
m(CE, 'destroyDialogs: the leaked sounds are not added up', '  for (const list of controls) for (const c of list) for (const sound of c.leakedSounds) leaked.set(sound.deviceID, (leaked.get(sound.deviceID) ?? 0) + 1);\n', '')
m(CE, 'destroyDialogs: a leaked sound counts for 2', 'leaked.set(sound.deviceID, (leaked.get(sound.deviceID) ?? 0) + 1);', 'leaked.set(sound.deviceID, (leaked.get(sound.deviceID) ?? 0) + 2);')
m(CE, 'destroyDialogs: a leaked sound replaces the count', 'leaked.set(sound.deviceID, (leaked.get(sound.deviceID) ?? 0) + 1);', 'leaked.set(sound.deviceID, 1);')
m(CE, 'destroyDialogs: the leaks of the first control of each dialog only', 'for (const list of controls) for (const c of list) for (const sound of c.leakedSounds)', 'for (const list of controls) for (const c of list.slice(0, 1)) for (const sound of c.leakedSounds)')
m(CE, 'destroyDialogs: the stray closes of the scripts count too', '  const firstStray = world.strayCloses.length;', '  const firstStray = 0;')
m(CE, 'destroyDialogs: the stray closes are not told', '  for (const id of world.strayCloses.slice(firstStray)) strays.set(id, (strays.get(id) ?? 0) + 1);\n', '')
m(CE, 'destroyDialogs: a stray close counts for 2', 'strays.set(id, (strays.get(id) ?? 0) + 1);', 'strays.set(id, (strays.get(id) ?? 0) + 2);')
m(CE, 'destroyDialogs: a stray close replaces the count', 'strays.set(id, (strays.get(id) ?? 0) + 1);', 'strays.set(id, 1);')
m(CE, 'destroyDialogs: what is left is not compared with the baseline', 'report.left = holdingsDelta(holdings(ui), baseline);', 'report.left = holdingsDelta(holdings(ui), new Map());')
m(CE, 'destroyDialogs: what is left is the baseline minus the holdings', 'report.left = holdingsDelta(holdings(ui), baseline);', 'report.left = holdingsDelta(baseline, holdings(ui));')
m(CE, 'holdings: the sounds are not counted', 'for (const map of [ui.devices.devices, ui.devices.sounds, ui.devices.renderTargets])', 'for (const map of [ui.devices.devices, ui.devices.renderTargets])')
m(CE, 'holdings: the textures are not counted', 'for (const map of [ui.devices.devices, ui.devices.sounds, ui.devices.renderTargets])', 'for (const map of [ui.devices.sounds, ui.devices.renderTargets])')
m(CE, 'holdings: the render targets are not counted', 'for (const map of [ui.devices.devices, ui.devices.sounds, ui.devices.renderTargets])', 'for (const map of [ui.devices.devices, ui.devices.sounds])')
m(CE, 'holdings: the references are not added up', 'out.set(id, (out.get(id) ?? 0) + device.refCount);', 'out.set(id, device.refCount);',
  'equivalent: an id is in one of the three maps at most (the exe keeps every device in one map keyed by id), so there is nothing to add to')
m(CE, 'holdingsDelta: only the ids of the first map', 'for (const id of [...new Set([...after.keys(), ...before.keys()])].sort()) {', 'for (const id of [...new Set([...after.keys()])].sort()) {')
m(CE, 'holdingsDelta: only the ids of the second map', 'for (const id of [...new Set([...after.keys(), ...before.keys()])].sort()) {', 'for (const id of [...new Set([...before.keys()])].sort()) {')
m(CE, 'holdingsDelta: the ids are in the order they were found', 'for (const id of [...new Set([...after.keys(), ...before.keys()])].sort()) {', 'for (const id of [...new Set([...after.keys(), ...before.keys()])]) {')
m(CE, 'holdingsDelta: a count that did not change is reported', '    if (delta !== 0) out[id] = delta;', '    out[id] = delta;')
m(CE, 'holdingsDelta: a count that went down is not reported', '    if (delta !== 0) out[id] = delta;', '    if (delta > 0) out[id] = delta;')


def limits():
    resource.setrlimit(resource.RLIMIT_AS, (8 * 2**30, 8 * 2**30))


def main():
    args = sys.argv[1:]
    mutants = [(f, n, a, b, WHY.get(n, why)) for f, n, a, b, why in M]
    if '--list' in args:
        for f, name, a, b, why in mutants:
            print(f'{f:16s} {name}' + (f'   [survives: {why}]' if why else ''))
        print(f'{len(mutants)} mutants')
        return 0
    pick = [a for a in args if not a.startswith('--')]
    for a in args:
        if a.startswith('--survivors='):
            # only the mutants that survived in an earlier run (its log): to see which a new test now kills
            gone = {m_.group(1) + ': ' + m_.group(2) for m_ in (re.match(r'SURVIVED  (\S+): (.*?)(   |$)', ln) for ln in open(a.split('=', 1)[1])) if m_}
            mutants = [mu for mu in mutants if mu[0] + ': ' + mu[1] in gone]
    sources = {}
    errors = []
    for f, name, a, b, why in mutants:
        path = path_of(f)
        if path not in sources:
            sources[path] = open(path).read()
        if sources[path].count(a) != 1:
            errors.append(f'anchor found {sources[path].count(a)} times: {f}: {name}')
        if a == b:
            errors.append(f'no change: {name}')
    names = [(f, name) for f, name, *_ in mutants]
    for dup in sorted({n for n in names if names.count(n) > 1}):
        errors.append(f'duplicate name: {dup}')
    for name in WHY:
        if not any(n == name for _, n, *_ in M):
            errors.append(f'a reason for no mutant: {name}')
    if errors:
        print('\n'.join(errors))
        return 2
    if '--check' in args:
        print(f'{len(mutants)} mutants, every anchor occurs exactly once')
        return 0
    bad = survived = run = stale = 0
    try:
        for f, name, a, b, why in mutants:
            if pick and not any(p in name for p in pick):
                continue
            path = path_of(f)
            orig = sources[path]
            open(path, 'w').write(orig.replace(a, b, 1))
            try:
                r = subprocess.run([BUN, 'test', '--bail', *TESTS[f]], cwd=ROOT, capture_output=True, text=True, timeout=120, preexec_fn=limits)
                killed = r.returncode != 0
            except subprocess.TimeoutExpired:
                killed = True
            finally:
                open(path, 'w').write(orig)
            run += 1
            if killed:
                if why:
                    stale += 1
                    print(f'killed    {f}: {name}   <-- its reason to survive is out of date: {why}', flush=True)
                else:
                    print(f'killed    {f}: {name}', flush=True)
            else:
                survived += 1
                if why:
                    print(f'SURVIVED  {f}: {name}   (expected: {why})', flush=True)
                else:
                    bad += 1
                    print(f'SURVIVED  {f}: {name}   <-- not expected', flush=True)
    finally:
        for path, orig in sources.items():
            open(path, 'w').write(orig)
    print(f'{run} mutants: {run - survived} killed, {survived} survived ({survived - bad} expected, {bad} not), {stale} reasons out of date')
    return 1 if (bad or stale) else 0


if __name__ == '__main__':
    sys.exit(main())
