#!/usr/bin/env python3
"""Mutation check of the movie playback of packages/ui (unit "movie playback"): `CMovieData` (movie.ts: `OnFrameMove` 32924DE0, `OnFrameRender`
32925150, SetRect, SetMovieFileName, the destructor), the loops of `CKTDGUIStatic` over its movies (static.ts: 3292A120, 3292A2B0), the render target
texture `CKTDXDeviceRenderTargetTexture` and `OpenRenderTargetTexture` (device.ts), the machine without `bdvid32.dll` (device.ts: `NoVideoLibrary`,
`NoVideoTexture`), the video texture `CBandiVideoTexture_DX9` and the platform's player (video.ts: `Mpeg1VideoLibrary`, `installMovies`), and what the
Direct3D side gained for them (packages/d3d9: `Direct3D9`, the refusal of a dynamic managed texture in `CreateTexture`).  The mutants are made from the
source by operator, like those of tools/mutate-edit.py (every comparison, logical and arithmetic operator, number, `!`, condition, `?:`, statement, one at a
time), by swaps no operator makes (an enum member for its neighbour, `true` for `false`, a call for the one beside it, the x of a size for its y, a float32
rounding left out), by exchanging two statements that follow each other (the order of the calls is what the exe's code is) and by hand.  Their names are the
text of the line.  The tests that run for each are those of the file (packages/ui/test/movie.test.ts, video.test.ts, ...), whose every number is worked out
from the decompile and the disassembly of the exe: there is no oracle for the movies (the player is the platform's, the frames are the decoder's, FINDINGS 13).

    python3 tools/mutate-movie.py [--list] [--check] [--survivors=LOG] [--shard=K/N] [substring of a mutant name ...]

The options, the exit code and the way the source is restored are those of tools/mutate-edit.py (this script loads it and replaces its list of mutants): a
mutant that must be killed and survives makes the exit code 1; so does a mutant with a reason that is killed.  Commit first, or work in a copy.
"""
import importlib.util, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location('mutate_edit', os.path.join(HERE, 'mutate-edit.py'))
me = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(me)

# the files are given by their path from the root of the repository (the movies touch two packages)
me.path_of = lambda f: os.path.join(me.ROOT, f)
UI, D3, T = 'packages/ui/src/', 'packages/d3d9/src/', 'packages/ui/test/'
MOVIE, STATIC, DEVICE, VIDEO = UI + 'movie.ts', UI + 'static.ts', UI + 'device.ts', UI + 'video.ts'
DIRECT3D, D3DEVICE = D3 + 'direct3d.ts', D3 + 'device.ts'
me.M.clear()
me.TESTS.clear()
me.TIMEOUT.clear()
me.TESTS.update({
    MOVIE: [T + 'movie.test.ts', T + 'widgets.test.ts', T + 'destroy.test.ts'],
    STATIC: [T + 'movie.test.ts', T + 'framemove.test.ts'],
    DEVICE: [T + 'movie.test.ts', T + 'widgets.test.ts', T + 'destroy.test.ts'],
    VIDEO: [T + 'video.test.ts', T + 'movie.test.ts'],
    DIRECT3D: ['packages/d3d9/test/direct3d.test.ts'],
    D3DEVICE: ['packages/d3d9/test/direct3d.test.ts'],
})
for _f in me.TESTS:
    me.TIMEOUT[_f] = 30  # the tests take 2 to 4 seconds; a mutant that loops for ever is a kill

# (file, name of the class or function, first marker, last marker): the code the mutants are made of.  A marker pair ends at the START of the last marker
# unless it ends with a newline.  `rename` names a module level function (its lines are no method's).
REGIONS = [
    (MOVIE, None, 'ftol', 'function ftol(x: number): number {', '\n}\n'),
    (MOVIE, 'CMovieData', None, '  SetLoop(loop: boolean): void {', '\n  }\n}\n'),
    (STATIC, 'CKTDGUIStatic', None, '    const scale = resolutionScale(this.ctx);\n    for (const movie of this.m_MovieDataList) {', '      movie.onFrameRender();\n    }\n'),
    (STATIC, 'CKTDGUIStatic', None, '    for (const movie of this.m_MovieDataList) movie.onFrameMove()', ';\n'),
    (DEVICE, 'DeviceRenderTargetTexture', None, 'export class DeviceRenderTargetTexture {', '\n}\n'),
    (DEVICE, 'DeviceManager', None, '  openRenderTargetTexture(deviceID: string, width: number, height: number, format: number): DeviceRenderTargetTexture | undefined {', '\n  }\n'),
    (DEVICE, 'NoVideoLibrary', None, 'export class NoVideoLibrary implements BandiVideoLibrary {', '\n}\n'),
    (DEVICE, 'NoVideoTexture', None, 'export class NoVideoTexture implements BandiVideoTexture {', '\n}\n'),
    (VIDEO, None, 'TEXTURE_FORMATS', 'const TEXTURE_FORMATS: readonly (readonly [number, number, number])[] = [', '\n];\n'),
    (VIDEO, 'BandiVideoTextureDX9', None, 'export class BandiVideoTextureDX9 implements BandiVideoTexture {', '\n}\n'),
    (VIDEO, 'Mpeg1VideoLibrary', None, 'export class Mpeg1VideoLibrary implements BandiVideoLibrary {', '\n}\n'),
    (VIDEO, None, 'installMovies', 'export function installMovies(', '\n}\n'),
    (DIRECT3D, 'Direct3D9', None, 'export class Direct3D9 {', '\n}\n'),
    (D3DEVICE, 'Direct3DDevice9', None, '    // a dynamic texture is made in the default pool', 'return { hr: D3DERR_INVALIDCALL, tex: null };\n'),
]

WHY = {}


def add(name, why):
    WHY[name] = why


def src(f):
    return open(me.path_of(f)).read()


def span(text, first, last):
    a = text.index(first)
    return a, text.index(last, a + len(first)) + (len(last) if last.endswith('\n') else 0)


FIELD = re.compile(r'(?:readonly |private )*\w+(?:: [^=]+)?(?: = .*)?;')


def is_field(f, anchor):
    """whether the anchor is a member of a class that is declared (not a statement of a method): one line at two spaces, `name: type = value;`"""
    if '\n' in anchor:
        return False
    text = src(f)
    at = text.index(anchor)
    indent = at - (text.rfind('\n', 0, at) + 1) + len(anchor) - len(anchor.lstrip(' '))
    return indent == 2 and FIELD.fullmatch(anchor.strip()) is not None


def named(name, cls, rename):
    """the name a mutant gets: the method (or the function `rename`), with the class in front of a method"""
    if rename:
        return rename + name[name.index(': '):]
    return f'{cls}.{name}'


def swap_mutants(f, first, last, cls, rename):
    """[(name, anchor, replacement)]: in the code of the region, every match of a pattern of `patterns` ([(regex, [new text])]) is replaced, one at a time;
    the anchor is the line, with the lines before it while it is not unique"""
    text = src(f)
    lines = text.split('\n')
    pos = [0]
    for ln in lines:
        pos.append(pos[-1] + len(ln) + 1)
    a, b = span(text, first, last)
    patterns = [p for files, ps in SWAPS.items() if f in files for p in ps]
    result, seen, func = [], {}, ''
    for n, line in enumerate(lines):
        mo = me.FUNC_RE.match(line)
        if mo:
            func = mo.group(1)
        if not (a <= pos[n] < b):
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
                    name = named(f'{func}: {hit.group()} -> {new} in `{snippet}`', cls, rename)
                    seen[name] = seen.get(name, 0) + 1
                    if seen[name] > 1:
                        name += f' (#{seen[name]})'
                    result.append((name, anchor, repl))
    return result


def simple(line):
    """a line that is one whole statement a neighbour can change places with (no declaration, no jump, no block)"""
    st = line.strip()
    return (st.endswith(';') and not re.match(r'(const|let|var|return|throw|if|for|while|break|continue|case)\b', st) and not st.startswith(('} ', '//', '*', '/*'))
            and sum(st.count(c) for c in '([{') == sum(st.count(c) for c in ')]}'))


def order_mutants(f, first, last, cls, rename):
    """[(name, anchor, replacement)]: two statements that follow each other, exchanged (the order of the calls is what the code is)"""
    text = src(f)
    lines = text.split('\n')
    pos = [0]
    for ln in lines:
        pos.append(pos[-1] + len(ln) + 1)
    a, b = span(text, first, last)
    result, seen, func = [], {}, ''
    for n in range(len(lines) - 1):
        mo = me.FUNC_RE.match(lines[n])
        if mo:
            func = mo.group(1)
        if not (a <= pos[n] and pos[n + 2] <= b):
            continue
        one, two = lines[n], lines[n + 1]
        indent = len(one) - len(one.lstrip())
        # (the statements of a method are at 4 spaces or more, those of a function of the module at 2; the members of a class are no statements)
        if not (simple(one) and simple(two) and one != two and indent == len(two) - len(two.lstrip()) and indent >= (2 if rename else 4)):
            continue
        # the anchor: the two lines, with the lines before them while the text is not unique
        k, anchor, repl = 0, one + '\n' + two, two + '\n' + one
        while text.count(anchor) != 1 and n - k > 0:
            k += 1
            anchor = '\n'.join(lines[n - k:n + 2])
            repl = '\n'.join(lines[n - k:n] + [two, one])
        if text.count(anchor) != 1:
            raise SystemExit(f'no unique anchor for the lines {n + 1}, {n + 2}: {one.strip()}')
        cut = lambda s: ' '.join(s.split())[:44]
        name = named(f'{func}: statements exchanged `{cut(one)}` <-> `{cut(two)}`', cls, rename)
        seen[name] = seen.get(name, 0) + 1
        if seen[name] > 1:
            name += f' (#{seen[name]})'
        result.append((name, anchor, repl))
    return result


ENUM_NEIGHBOUR = {
    'BVL_STATUS': ['CLOSED', 'READY', 'PLAYING', 'PLAYEND'],
    'BVLPF': ['X8R8G8B8', 'R8G8B8', 'R5G6B5', 'R5G5B5', 'A8R8G8B8'],
}


def enum_neighbours(hit):
    """`BVL_STATUS.PLAYING` -> the other members of the enum the code uses"""
    enum, member = hit.group(1), hit.group(2)
    return [f'{enum}.{m}' for m in ENUM_NEIGHBOUR[enum] if m != member]


SWAPS = {
    (MOVIE,): [
        # ---- the player's status and the seek of the loop
        (r'\b(BVL_STATUS)\.(\w+)\b', enum_neighbours),
        (r'\bBVL_SEEK\.TIME\b', ['BVL_SEEK.FRAME']),
        (r'\bBVL_SEEK\.FRAME\b', ['BVL_SEEK.TIME']),
        (r'\bbvl\.seek\(0n, ', ['bvl.seek(1n, ']),
        (r'\bbvl\.play\(\)', ['bvl.stop()']),
        (r'\bbvl\.stop\(\)', ['bvl.play()']),
        (r'\bbvl\.getFrame\(frame, 1\)', ['bvl.getFrame(frame, 0)']),
        # ---- the frame's description
        (r'\bpixel_format: texture\.getFormat\(\)', ['pixel_format: 0']),
        (r'\bwidth: this\.m_Info\.width,', ['width: this.m_Info.height,']),
        (r'\bheight: this\.m_Info\.height,', ['height: this.m_Info.width,']),
        (r'Math\.imul\(locked\.pitch, this\.m_Info\.height\)', ['Math.imul(locked.pitch, this.m_Info.width)', 'locked.pitch']),
        # ---- the render target and its draws
        (r'\btarget\.beginRender\(render\.device, true\)', ['target.beginRender(render.device, false)']),
        (r'\bctx\.devices\.openRenderTargetTexture\("MoveData", ', ['ctx.devices.openRenderTargetTexture("MovieData", ', 'ctx.devices.openRenderTargetTexture("", ']),
        (r'Math\.trunc\(width\), Math\.trunc\(height\)', ['Math.trunc(height), Math.trunc(width)', 'Math.round(width), Math.round(height)']),
        (r'\bftoi\(', ['Math.round(', 'Math.floor(']),
        (r'\bftol\(', ['ftoi(', 'Math.round(']),
        (r'\breturn Math\.trunc\(x\) \| 0;', ['return Math.round(x) | 0;', 'return Math.floor(x) | 0;']),
        (r'\bthis\.m_vPos\.x / scale\.x', ['this.m_vPos.x * scale.x', 'this.m_vPos.x / scale.y']),
        (r'\bthis\.m_vPos\.y / scale\.y', ['this.m_vPos.y * scale.y', 'this.m_vPos.y / scale.x']),
        (r'\bthis\.m_vSize\.x, this\.m_vSize\.y\)', ['this.m_vSize.y, this.m_vSize.x)']),
        (r'0xffffffff', ['0xffffff', '0xff000000']),
    ],
    (STATIC,): [
        # ---- the loops of the static
        (r'of this\.m_MovieDataList\b', ['of this.m_MovieDataList.slice(1)', 'of this.m_MovieDataList.slice(0, -1)', 'of [...this.m_MovieDataList].reverse()']),
        (r'\bf\(f\(left \+ movie\.m_vOriginPos\.x\) \+ this\.m_OffsetPos\.x\)', ['f(left + movie.m_vOriginPos.x + this.m_OffsetPos.x)', 'f(f(left + movie.m_vOriginPos.x) + this.m_OffsetPos.y)']),
        (r'\bf\(f\(top \+ movie\.m_vOriginPos\.y\) \+ this\.m_OffsetPos\.y\)', ['f(top + movie.m_vOriginPos.y + this.m_OffsetPos.y)', 'f(f(top + movie.m_vOriginPos.y) + this.m_OffsetPos.x)']),
        (r'\bconst left = this\.dialogPos\(\)\.x;', ['const left = this.dialogPos().y;']),
        (r'\bconst top = this\.dialogPos\(\)\.y;', ['const top = this.dialogPos().x;']),
    ],
    (DEVICE,): [
        # ---- the render target texture's resources
        (r'D3DCLEAR\.TARGET \| D3DCLEAR\.ZBUFFER', ['D3DCLEAR.TARGET', 'D3DCLEAR.ZBUFFER', 'D3DCLEAR.TARGET | D3DCLEAR.STENCIL']),
        (r'\bD3DUSAGE\.RENDERTARGET\b', ['0', 'D3DUSAGE.DEPTHSTENCIL']),
        (r'\bD3DPOOL\.DEFAULT\b', ['D3DPOOL.MANAGED']),
        (r'\bthis\.(m_pRenderTargetSurface|m_pRenderTargetZSurface|m_pRenderTargetTexture|m_pBackupBuffer|m_pBackupZBuffer)\b',
         lambda hit: ['this.' + o for o in ('m_pRenderTargetSurface', 'm_pRenderTargetZSurface', 'm_pBackupBuffer', 'm_pBackupZBuffer') if o != hit.group(1)]),
        (r'\bdevice\.GetDepthStencilSurface\(\)', ['device.GetRenderTarget(0)']),
        (r'\bdevice\.GetRenderTarget\(0\)', ['device.GetDepthStencilSurface()']),
        (r'\bback\.GetDesc\(\)\.Format', ['backZ.GetDesc().Format']),
        (r'\bbackZ\.GetDesc\(\)\.Format', ['back.GetDesc().Format']),
        (r'D3DXCreateTexture\(device, this\.width, this\.height, ', ['D3DXCreateTexture(device, this.height, this.width, ']),
        (r'device\.CreateDepthStencilSurface\(this\.width, this\.height, ', ['device.CreateDepthStencilSurface(this.height, this.width, ']),
        (r'this\.log\.push\((0x[0-9a-f]+), this\.deviceID\)', lambda hit: [f'this.log.push({hit.group(1)}, "")']),
        (r'\bSetTexture\(stage, null\)', ['SetTexture(stage, texture)']),
        (r'\bD3DPT\.TRIANGLESTRIP\b', ['D3DPT.TRIANGLELIST', 'D3DPT.TRIANGLEFAN']),
        (r'\bDVB_TYPE\.XYZRHW_DIFFUSE_TEX1\b', ['DVB_TYPE.XYZ_DIFFUSE_TEX1', 'DVB_TYPE.XYZ_TEX1']),
        (r'\bstates\.apply\(RSI_DEVICE_TEXTURE\)', ['states.apply(RSI_DEVICE_TEXTURE + 1)']),
        (r'\bthis\.setDeviceTexture\(render, 0\)', ['this.setDeviceTexture(render, 1)']),
        (r'\bconst sx = render\.resolutionScale\.x;', ['const sx = render.resolutionScale.y;']),
        (r'\bconst sy = render\.resolutionScale\.y;', ['const sy = render.resolutionScale.x;']),
        (r'\bf\(sx \* f\(nX\)\)', ['f(sx * nX)', 'f(nX)']),
        (r'\bf\(sy \* f\(nY\)\)', ['f(sy * nY)', 'f(nY)']),
        (r'\bf\(f\(f\(nWidth\) \* sx\) \+ x\)', ['f(f(nWidth * sx) + x)', 'f(f(f(nWidth) * sx) + nX)']),
        (r'\bf\(f\(f\(nHeight\) \* sy\) \+ y\)', ['f(f(nHeight * sy) + y)', 'f(f(f(nHeight) * sy) + nY)']),
        (r'\bthis\.width = width \| 0;', ['this.width = height | 0;']),
        (r'\bthis\.height = height \| 0;', ['this.height = width | 0;']),
        (r'\bthis\.format = format \| 0;', ['this.format = 0;']),
        (r'\bthis\.deviceID = deviceID;', ['this.deviceID = deviceID.toLowerCase();']),
        # ---- the machine without the DLL
        (r'return BVL_E_NO_DLL;', ['return BVL_E_NOT_CREATED;', 'return 0;']),
        (r'return BVL_E_NOT_CREATED;', ['return BVL_E_NO_DLL;', 'return 0;']),
        (r'return E_FAIL;', ['return 0;', 'return BVL_E_NOT_CREATED;']),
        (r'return BVLPF\.NULL;', ['return BVLPF.X8R8G8B8;']),
        (r'return false;', ['return true;']),
        (r'return \{ width: 0, height: 0 \};', ['return { width: 1, height: 0 };', 'return { width: 0, height: 1 };']),
    ],
    (VIDEO,): [
        # ---- the video texture
        (r'\b(BVLPF)\.(\w+)(?=, \d\])', enum_neighbours),
        (r'^\s*\[D3DFMT\.(X8R8G8B8|R8G8B8|R5G6B5|X1R5G5B5), ',
         lambda hit: [hit.group().replace(hit.group(1), o) for o in ('X8R8G8B8', 'R8G8B8', 'R5G6B5', 'X1R5G5B5') if o != hit.group(1)]),
        (r'\bD3DDEVTYPE\.HAL\b', ['D3DDEVTYPE.REF']),
        (r'\bD3DRTYPE\.TEXTURE\b', ['D3DRTYPE.SURFACE']),
        (r'\bdisplay\.mode\.Format, 0, D3DRTYPE\.TEXTURE, d3dFormat', ['d3dFormat, 0, D3DRTYPE.TEXTURE, display.mode.Format']),
        (r'\bd3d\?\.GetAdapterDisplayMode\(0\)', ['d3d?.GetAdapterDisplayMode(1)']),
        (r'\bresult \*= 2', ['result *= 3', 'result += 2']),
        (r'\bD3DUSAGE\.DYNAMIC\b', ['0', 'D3DUSAGE.WRITEONLY']),
        (r'\bD3DPOOL\.MANAGED\b', ['D3DPOOL.DEFAULT', 'D3DPOOL.SYSTEMMEM']),
        (r'\bthis\.m_vid_width = vidWidth;', ['this.m_vid_width = vidHeight;']),
        (r'\bthis\.m_vid_height = vidHeight;', ['this.m_vid_height = vidWidth;']),
        (r'\bthis\.m_tex_width = width;', ['this.m_tex_width = height;']),
        (r'\bthis\.m_tex_height = height;', ['this.m_tex_height = width;']),
        (r'\bthis\.calcTexSize\(vidWidth, pow2\)', ['this.calcTexSize(vidHeight, pow2)']),
        (r'\bthis\.calcTexSize\(vidHeight, pow2\)', ['this.calcTexSize(vidWidth, pow2)']),
        (r'Math\.imul\(this\.m_pixel_size, width\)', ['Math.imul(this.m_pixel_size, height)', 'this.m_pixel_size']),
        (r'\bD3DTADDRESS\.CLAMP\b', ['D3DTADDRESS.WRAP', 'D3DTADDRESS.MIRROR']),
        (r'\bD3DTEXF\.LINEAR\b', ['D3DTEXF.POINT']),
        (r'\bD3DSAMP\.ADDRESSU\b', ['D3DSAMP.ADDRESSV']),
        (r'\bD3DSAMP\.ADDRESSV\b', ['D3DSAMP.ADDRESSU']),
        (r'\bD3DSAMP\.MAGFILTER\b', ['D3DSAMP.MINFILTER']),
        (r'\bD3DSAMP\.MINFILTER\b', ['D3DSAMP.MAGFILTER']),
        (r'\bf\(this\.m_vid_width / this\.m_tex_width\)', ['f(this.m_vid_width / this.m_tex_height)', 'f(this.m_vid_height / this.m_tex_width)']),
        (r'\bf\(this\.m_vid_height / this\.m_tex_height\)', ['f(this.m_vid_height / this.m_tex_width)', 'f(this.m_vid_width / this.m_tex_height)']),
        (r'\bconst right = f\(left \+ f\(width\)\);', ['const right = f(left + width);', 'const right = f(left + f(height));']),
        (r'\bconst lower = f\(upper \+ f\(height\)\);', ['const lower = f(upper + height);', 'const lower = f(upper + f(width));']),
        (r'\bquad\.setColor\(i, 0xffffffff\);', ['quad.setColor(i, 0xff000000);']),
        (r'\brender\.device\.SetTexture\(0, texture\)', ['render.device.SetTexture(1, texture)']),
        (r'\brender\.device\.SetTexture\(0, null\)', ['render.device.SetTexture(0, texture)']),
        (r'\bcache\[0\]', ['cache[1]']),
        # ---- the player
        (r'\bMath\.floor\(', ['Math.round(', 'Math.ceil(']),
        (r'\bBVL_E_ALREADY_CREATED\b', ['BVL_E_NOT_CREATED']),
        (r'\bthis\.origin = 0;', ['this.origin = 1;']),
        (r'\bthis\.given = -1;', ['this.given = 0;']),
        (r'\bcanSkip !== 0 \? this\.due\(\) : this\.given \+ 1', ['canSkip === 0 ? this.due() : this.given + 1', 'this.due()', 'this.given + 1']),
        (r'\bframe\.frame_number = BigInt\(number\);', ['frame.frame_number = BigInt(this.given);']),
        (r'\bmovie\.info\.frameRate\.den\) / movie\.info\.frameRate\.num', ['movie.info.frameRate.num) / movie.info.frameRate.den']),
        (r'\binfo\.frameRate\.num\) / \(1000 \* info\.frameRate\.den\)', ['info.frameRate.den) / (1000 * info.frameRate.num)', 'info.frameRate.num) / info.frameRate.den']),
        (r'\bfps_rate: info\.frameRate\.num, fps_scale: info\.frameRate\.den', ['fps_rate: info.frameRate.den, fps_scale: info.frameRate.num']),
        (r'\bwidth: info\.width, height: info\.height', ['width: info.height, height: info.width']),
        (r'\btotal_time: BigInt\(Math\.round\(info\.durationMs\)\)', ['total_time: BigInt(Math.floor(info.durationMs))', 'total_time: BigInt(Math.ceil(info.durationMs))']),
        (r'\btotal_frames: BigInt\(info\.frameCount\)', ['total_frames: BigInt(info.frameCount - 1)']),
        (r'\bout\[at\+\+\] = b;', ['out[at++] = r;']),
        (r'\bout\[at\+\+\] = r;', ['out[at++] = b;']),
        (r'\bconst b = bgra\[from\]!;', ['const b = bgra[from + 2]!;']),
        (r'\bconst r = bgra\[from \+ 2\]!;', ['const r = bgra[from]!;']),
        (r'\bframe\.pixel_format === BVLPF\.R5G6B5 \?', ['frame.pixel_format === BVLPF.R5G5B5 ?']),
        # ---- the platform's installation
        (r'\bpath\.startsWith\(prefix\) \? path\.slice\(prefix\.length\) : path', ['path.slice(prefix.length)', 'path']),
        (r'\\\\movie\\\\', ['\\\\Movie\\\\']),
        (r'\bdevices\.createVideoLibrary = ', ['devices.createVideoTexture = ']),
    ],
    (DIRECT3D, D3DEVICE): [
        # ---- the adapter
        (r'return D3DERR_INVALIDCALL;', ['return D3DERR_NOTAVAILABLE;', 'return D3D_OK;']),
        (r'return D3DERR_NOTAVAILABLE;', ['return D3DERR_INVALIDCALL;', 'return D3D_OK;']),
        (r'return D3D_OK;', ['return D3DERR_NOTAVAILABLE;']),
        (r'\bD3DFMT\.(X8R8G8B8|R5G6B5|X1R5G5B5|A8R8G8B8|R8G8B8)\b',
         lambda hit: ['D3DFMT.' + o for o in ('X8R8G8B8', 'R5G6B5', 'X1R5G5B5', 'A8R8G8B8') if o != hit.group(1)][:2]),
        (r'\bD3DUSAGE\.(DEPTHSTENCIL|RENDERTARGET)\b', lambda hit: ['D3DUSAGE.RENDERTARGET' if hit.group(1) == 'DEPTHSTENCIL' else 'D3DUSAGE.DEPTHSTENCIL']),
        (r'\badapter !== 0\b', ['adapter !== 1']),
        (r'\bRefreshRate: 60', ['RefreshRate: 0']),
        (r'\{ \.\.\.this\.displayMode \}', ['this.displayMode']),
        (r'usage & D3DUSAGE\.DYNAMIC && pool === D3DPOOL\.MANAGED', ['usage & D3DUSAGE.DYNAMIC || pool === D3DPOOL.MANAGED', 'usage & D3DUSAGE.DYNAMIC', 'pool === D3DPOOL.MANAGED',
                                                                      'usage & D3DUSAGE.DYNAMIC && pool === D3DPOOL.DEFAULT', 'usage & D3DUSAGE.WRITEONLY && pool === D3DPOOL.MANAGED']),
    
    ],
}

# the statements the generated mutants cannot reach: a loop whose body is not run, an order only the whole of the calls shows
HAND = [
    (STATIC, 'CKTDGUIStatic.OnFrameMove: no movie is moved', 'for (const movie of this.m_MovieDataList) movie.onFrameMove();', 'for (const movie of this.m_MovieDataList) void movie;'),
    (STATIC, 'CKTDGUIStatic.OnFrameRender: no movie is drawn', '      movie.onFrameRender();\n    }\n    return 0;', '      void movie;\n    }\n    return 0;'),
    (STATIC, 'CKTDGUIStatic.OnFrameRender: the place is left for the movie to take', '      movie.m_vPos.x = f(f(left + movie.m_vOriginPos.x) + this.m_OffsetPos.x) * scale.x;',
     '      movie.m_vPos.x = movie.m_vPos.x;'),
    (STATIC, 'CKTDGUIStatic.OnFrameRender: the movies are drawn before the strings', '    const scale = resolutionScale(this.ctx);\n    for (const movie of this.m_MovieDataList) {',
     '    const scale = resolutionScale(this.ctx);\n    for (const movie of this.m_MovieDataList.slice(0, 0)) {'),
]

MUTANTS = []
for _f, _cls, _rename, _first, _last in REGIONS:
    for _name, _a, _b in me.operator_mutants(_f, [(_first, _last)]):
        # (the method the generator names is the last one above the line: a member that is declared has none)
        _name = 'fields' + _name[_name.index(': '):] if _cls and is_field(_f, _a) else _name
        MUTANTS.append((_f, named(_name, _cls, _rename), _a, _b))
    for _name, _a, _b in swap_mutants(_f, _first, _last, _cls, _rename):
        MUTANTS.append((_f, _name, _a, _b))
    for _name, _a, _b in order_mutants(_f, _first, _last, _cls, _rename):
        MUTANTS.append((_f, _name, _a, _b))
for _f, _name, _a, _b in HAND:
    MUTANTS.append((_f, _name, _a, _b))

# ---- the mutants that no input can tell from the original (name -> why)

for _f, _name, _a, _b in MUTANTS:
    me.m(_f, _name, _a, _b, WHY.get(_name, ''))
for _name in WHY:
    assert any(mu[1] == _name for mu in me.M), f'a reason for a mutant that does not exist: {_name}'

if __name__ == '__main__':
    sys.exit(me.main())
