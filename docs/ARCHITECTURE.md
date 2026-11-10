# Architecture

## Target

```
                +-----------------------------+            +--------------------------+
 data/*.kom --> |  @els/kom   (done)          |            |  apps/server (Bun)       |
 data/ui,...    |  archive reader + XORCRC    |            |  game server: packet     |
                +--------------+--------------+            |  protocol subset,        |
                               |                           |  bun:sqlite persistence  |
                +--------------v--------------+            +------------^-------------+
                |  @els/assets   (phase 2)    |                         | WebSocket
                |  TGA/DDS/X/Y/XET/TET/...    |                         |
                +--------------+--------------+            +------------+-------------+
                               |                           |  apps/client (browser)   |
   +---------------------------v--------------+            |  boot, game states       |
   |  @els/d3d9 (phase 3) D3D9 + D3DX on WebGPU|<----------+  (CX2State*), main loop  |
   +---------------------------+--------------+            +------------+-------------+
                               |                                        |
   +---------------------------v--------------+              +----------v-------------+
   |  @els/engine / @els/ui (phases 4-5)       |  host API   |  @els/lua  (done*)      |
   |  KTDX/KTDG classes, dialogs, lua_tinker-  |<----------->|  LuaJIT 2.0.2-compatible|
   |  equivalent bindings                      |             |  VM running the KOM     |
   +-------------------------------------------+             |  scripts unmodified     |
                                                             +-------------------------+
```

`*` verified against a native oracle, with the gaps listed in `docs/FINDINGS.md`.

The client runs in a browser (WebGPU, WebAudio, DOM input). Bun is used as package manager, test runner, bundler and server
runtime. Nothing in `data/` is modified or re-packed: archives are read through `@els/kom`, either from disk (tools/tests) or
over HTTP range requests (browser).

## Packages (implemented)

### `@els/kom` (`packages/kom`)
`KomArchive.open(source)` parses the header and XML manifest, `read(entry)` returns the decoded bytes (zlib; algorithm 2 adds
`xorCrcDecrypt`), `readStored` / `verifyStored` give the raw bytes and the Adler-32 check, `find(name)` is case-insensitive.
`ByteSource` abstracts a file (`fileSource`) or an HTTP resource with `Range` (`httpSource`). `MassFileManager` (`massfile.ts`) is the exe's
`KGCMassFileManager` name map: `addMassFile` / `addArchive` / `lock` / `find` / `has` / `loadDataFile` (upper-case lookup, a duplicate name is an error, nothing can be added
after the lock); `CLIENT_KOM_NAMES` is the mount order of `CX2Main` (`datai001`..`datai023`, `data001`..`data150`) and `mountClientArchives` opens them concurrently (FINDINGS 14).

### `@els/assets` (`packages/assets`)
Decoders for the client's asset formats (Phase 2). `decodeImage(bytes)` sniffs the container from the content (as D3DX does) and
returns level 0 as straight RGBA8, first row on top, plus the D3D9 source format name: `tga.ts` (types 1/2/3/9/10/11, 15-32 bpp,
palettes, origin bits), `dds.ts` (BC1/BC2/BC3 block decoders, bit-mask formats), `bmp.ts`, `png.ts` (non-interlaced, via fflate);
`xet.ts` reads the `.xet` / `.tet` tables with the exe's own `GetString` and binary search; `ess.ts` loads `General.ess` (the string
table: `parseEss`, `StringTable.get` / `.replaced`); `kim.ts` opens `item.kim` (`Kim.open`, `getItem`, `getSet`, per-unit lookups).
Meshes: `mszip.ts` + `inflate.ts` (the `bzip` container of X files; own raw-deflate decoder because the files contain stored blocks
without NLEN and chunks that reference the previous 32 KiB), `xfile.ts` (generic DirectX X reader, text + binary, template driven:
`parseXFile` returns the object tree with typed members), `ksm.ts` (KOG's `KME` static mesh, `KSM` skinned mesh and `KAC` animation
block, decoded from the exe's loaders with the same range checks), `xscene.ts` (`loadXScene`: the frames, meshes, skin weights and
animation sets of an X file as typed data, the input of the D3DX mesh functions in `@els/d3d9`). Skinning and animation evaluation are not
written yet, see ROADMAP phases 2 and 3.
Movies: `avi.ts` (RIFF AVI demuxer: headers, `movi` chunks, `idx1` key frames), `mpeg1.ts` + `mpeg1-tables.ts` (MPEG-1 video decoder of ISO 11172-2:
`Mpeg1Decoder.decode(bytes)` -> `Mpeg1Frame` YUV 4:2:0 planes in display order, `yuv420ToBgra`, `visiblePlanes`, `splitPictures`; the tables are generated
by `tools/gen-mpeg1-tables.py`) and `movie.ts` (`Mpeg1Movie.open(aviBytes)`: `info`, `next()`, `frame(i)`, `seek(i)`); the 30 shipped movies decode
identically to FFmpeg (FINDINGS section 13). Effect scripts: `effectscript.ts` (the shared tokenizer with the exe's quirks, `ProcessNumber/Vector/Color`, the CRT `rand` and
`RandomNumber`, `EFFECT_SYSTEMS` = which file feeds which of the eight systems), `particle.ts` (`parseParticleScript` -> sequences with
their properties and events, `ParticleLibrary`) and `xmeshplayer.ts` (`parseXMeshPlayerScript` -> templets with Global / Anim / Die
timelines, `XMeshLibrary`): the compile side of `CKTDGParticleSystem` / `CKTDGXMeshPlayer`; the run-time simulation is not ported.
Tests: `packages/assets/test` (270 tests) and `packages/lua/test` (`loader.test.ts` 14, `proxy.test.ts` 38); all with `bun run test:packages`; corpus tools: `decode-images.ts` + `verify-images.py` (Pillow),
`verify-xet-tet.ts`, `verify-xfiles.ts`, `verify-xparse.ts`, `verify-ksm.ts`, `verify-ess.ts`, `verify-kim.ts`, `verify-effects.ts`, `verify-mpeg1.ts` (+ the FFmpeg oracle
`oracle-mpeg1.py`, the fixture generator `gen-mpeg1-fixtures.py`, the mutation check `mutate-mpeg1.py`).

### `@els/d3d9` (`packages/d3d9`)
`Direct3DDevice9` (PascalCase, D3D's names, `HRESULT` results; `CreateX` returns `{hr, resource}`, `Lock` returns `{hr, data}`) over a WebGPU
device, plus the D3DX functions the exe imports. Rendering is recorded into one command encoder per frame; `await dev.readPixels()`
reads the back buffer or any surface (that is how the tests and `tools/render-demo.ts` produce images). Every module has a header comment that
documents its design and assumptions; FINDINGS section 12 is the reference.

| File | Content |
|---|---|
| `enums.generated.ts`, `enums.ts` | the D3D9 enums and flags, generated from the enum definitions of `data/x2.exe.h` by `tools/gen-d3d9-enums.ts` (`--check` verifies the checked-in file); `enums.ts` adds the D3DFVF / D3DTS helpers |
| `state.ts` | the device state machine: render / texture-stage / sampler states with the defaults the exe writes back in `CKTDGStateManager::RestoreDeviceObjects`, transforms, lights, material, viewport |
| `vertex.ts`, `formats.ts` | FVF codes and vertex declarations -> WebGPU vertex layouts (one fixed shader location per semantic); `D3DFORMAT` metadata and the CPU conversions to the uploaded texel format |
| `ffp.ts`, `pipeline-state.ts` | the fixed-function pipeline: device state -> `ProgramDesc` -> generated WGSL (vertex transform + lighting + fog + texcoord generation; texture-stage cascade + specular + fog + alpha test); blend / depth / stencil / raster / sampler translation |
| `resources.ts`, `arena.ts` | buffers, textures, surfaces, declarations with CPU shadows in D3D's layout and the renaming rules for data written after use; the per-frame bump allocator for uniform blocks and dynamic vertex data |
| `device.ts`, `caps.ts`, `hresult.ts` | `Direct3DDevice9`, `D3DCAPS9` (a Shader Model 3 HAL), `D3D_OK` / `D3DERR_*` / `D3DXERR_*` |
| `direct3d.ts` | `Direct3D9`, the `IDirect3D9` object (`g_pD3D`) that the exe asks for the adapter's display mode and for `CheckDeviceFormat` (what a current card answers); with it `CreateTexture` of `device.ts` refuses a dynamic texture in the managed pool as the runtime does (FINDINGS 17.28) |
| `d3dx-math.ts` | the 26 D3DX math functions of the import table (single-precision at the same points as the SSE code) |
| `d3dx-texture.ts` | `D3DXGetImageInfoFromFileInMemory`, `D3DXCheckTextureRequirements`, `D3DXCreateTextureFromFileInMemoryEx` (decoding by `@els/assets`), `D3DXCreateTexture`, `D3DXSaveSurfaceToFileInMemory`, `ID3DXBuffer` |
| `d3dx-mesh.ts` | `ID3DXMesh` and the mesh functions (`D3DXLoadMeshFromXInMemory` = merge all meshes of the X file with their frame transforms baked in, `D3DXBuildMesh` = one X mesh as D3DX loads it, `Optimize`, `WeldVertices`, `GetAttributeTable`, `DrawSubset`, `Intersect`, `ComputeBoundingSphere`) |
| `d3dx-animation.ts` | `D3DXCreateKeyframedAnimationSet` and `D3DXCreateAnimationController`: tracks, priority groups, keyed speed / weight / position / enable / priority-blend events (the exact cross-fade of `CKTDGXSkinAnim::ChangeAnim` is a test), `AdvanceTime`, `CloneAnimationController` |
| `d3dx-skin.ts` | `ID3DXSkinInfo` (+ software `UpdateSkinnedMesh`), `ConvertToIndexedBlendedMesh`, `D3DXFrame*`, `ID3DXAllocateHierarchy` and `D3DXLoadMeshHierarchyFromXInMemory` (frames, mesh containers, skin info, controller from an X file) |
| `vshader.ts` | the programmable vertex stage of the device: an emulated vertex shader is WGSL (`user_vs`) over the 256 float4 constant registers; what it replaces and what stays fixed-function is in the header (FINDINGS 12.7) |
| `xrenderer-shaders.ts` | the 34 HLSL functions of `XRenderer.fx` (`vs_1_1`: rigid and 1-4 bone skinning of real colour, cartoon, black / colour edge, 8 light-flow families) as WGSL, the register layout `XR`, and the token hashes that tie them to the shipped file |
| `effect.ts` | `D3DXCreateEffect` / `ID3DXEffect` for `XRenderer.fx`: parses the shipped HLSL text (parameters, techniques, passes, state assignments, shader arrays), `Begin` / `BeginPass` / `CommitChanges` / `EndPass` / `End`, `ID3DXEffectStateManager`, `DeviceStateManager` |

`@els/assets` gained `xscene.ts` (`loadXScene`: frames, meshes, skin weights and animation sets of an X file as typed data) and
`encodePng`. Tests are GPU tests: `./tools/gpu.sh ./node_modules/.bin/bun test packages/d3d9` (software Vulkan from `tools/setup-gpu.sh`);
without an adapter they skip themselves and only `pure.test.ts` and the effect-file parse test of `xrenderer.test.ts` run.

### `@els/engine` (`packages/engine`)
The engine classes (`CKTDX*` / `CKTDG*`) over the D3D9 layer, ported function by function with their x2.exe.c anchors in the header comments (FINDINGS 15.3, 16):

| File | Content |
|---|---|
| `skinmesh-frames.ts` | `setupFrameList`, `setupDrawFrameList`, `collisionFrames` of `CKTDXDeviceXSkinMesh::XSkinMeshProxy`: which frames of a model are drawn |
| `multianim.ts` | `CMultiAnimAllocateHierarchy`, `MultiAnimFrame`, `MultiAnimMC`: the frame / mesh-container classes the loaders fill (the exe's `ID3DXAllocateHierarchy`) |
| `ksm-load.ts` | `loadKSkinnedMesh` (`LoadKSkinnedMesh`, `ReadKSM`, `KTDXAnimationController::ReadFromMemory`): a KSM file -> frames, skinned mesh containers, an `ID3DXAnimationController` with one keyframed set per KAC set |
| `kac-keys.ts` | `optimizeKeys` (the key reducer `OptimizeKeys`, **bit-identical to the exe**, FINDINGS 16.2 / 16.3), `prepareKeys` (UnpackKeys output -> reduced D3DX key arrays) |
| `skinmesh.ts` | `loadSkinnedMesh` (`CKTDXDeviceXSkinMesh::_Load`: KSM -> `ksm-load.ts`, anything else -> `D3DXLoadMeshHierarchyFromXInMemory` + frame lists) |
| `xmesh.ts` | `loadXMesh` (`CKTDXDeviceXMesh::_Load`: `LoadKMEMesh` for KME, `LoadD3DXMesh` for X): FVF 338 mesh, welded, attribute sorted, one bounding sphere per range |

Tests (`./tools/gpu.sh ./node_modules/.bin/bun test packages/engine`, 42): `skinmesh-frames.test.ts` (10), `ksm-load.test.ts` (14: the real `Motion_Elsword.x`, pose at time 0, Wait3 upright, the Walk set), `xmesh.test.ts` (7),
`kac-keys.test.ts` (11, no GPU: hand cases from the oracle + the recorded fixture `test/fixtures/optimizekeys.bin`; `test/keys-fixture.ts` is its codec, shared with `tools/verify-optimizekeys.ts`).

### `@els/host` (`packages/host`)
The `lua_tinker` layer: what a script sees of the C++ client. The binder is data driven (one implementation instead of one C++ template
instance per signature), fed by `src/api.generated.ts`, which `tools/gen-host-api.ts` generates from `docs/host_api.tsv` (`--check` fails
when it is stale): 128 classes (119 with methods or fields; the rest are named only as a base or as the class of a global object), 1,418
methods, 34 fields, 59 global object names (66 name / class pairs from the 93 registration sites), 5 global functions, 19 constants, each method with the exe's address and its C++ parameter / return types, and a typed `<Class>_Methods` interface per class.

| File | Content |
|---|---|
| `src/tinker.ts` | `HostRuntime`: `class_add` / `class_inh` / `class_mem` / `class_con` (a global table named like the class is the metatable of its objects; `__index` = `meta_get`, `__newindex` = `meta_set`, `__parent` chain, fields as accessor userdata, `__call` constructors for D3DXVECTOR2 / 3 / COLOR), `read<T>` / `push<T>` (`(int)lua_tonumber` truncation with the x86 `cvttsd2si` results, bool rules, `char const *` from strings and numbers, a struct by value is a copy, a pointer is a NEW userdata per push), the exact error texts (`can't find 'X' class variable. (forgot registering class variable ?)`, `no class at first argument. (forgot ':' expression ?)`), `registerImpl` / `registerFunction` / `setObject` / `status`, and **not-ported handling**: strict mode throws `HostNotPortedError("Class.method @addr")`, record mode counts the call and returns a typed stub value (0, false, "", a zero vector, a stub object of the declared class) |
| `src/kluamanager.ts` | `KLuaManager` (the table reader of every `*_LUA` function): `BeginTable` / `EndTable` / `GetValue` overloads / `GetUserDefinedTypeValue<D3DXVECTOR2/3/COLOR>` / `GetNumIndexedValues`; `(L, 1)` reads the table on top of the stack of the native call being served |
| `src/values.ts` | `Vec2` / `Vec3` / `Color` (Float32Array backed, C++ `float` semantics), `HostHandle` (`KHandleType<int, ...>`) |
| `src/world.ts` | `HostWorld`: one Lua state with the host layer, `IncludeLua` (base name, case ignored, `false` for a missing script), `loadEnums` (what `CX2Main::LoadLuaEnum` runs: `Enum.lua`, `DungeonEnum.lua`, `MassFileMappingList_HK.lua`, `StringID_def.lua`) and `publishStubObjects` (the registered globals as typed stubs) |
| `src/classes/massfile.ts` | the first real host class: `KGCMassFileManager.AddMappingList` / `AddMappingTime` (`std::map::emplace` semantics, `CTime` date parsing as in 328D43E0); the file lookup that applies the mapping is not ported yet |
| `src/census.ts` | `makeCensusWorld`, `runCensus`: every script on typed stubs (the core of `tools/host-census.ts`) |

A host class is a plain TS class whose methods are named exactly like the Lua names and declare `implements Partial<Class_Methods>`; calls are
dispatched on the receiver by name, so one TS class can implement a base class and its derived classes. Nothing is invented: a name the exe
does not register is not visible to scripts. `docs/HOST_CENSUS.md` (`tools/host-census.ts`) runs all 4,498 scripts on the binder with record
mode and lists what they need: 4,422 run to the end; the other 76 need 23 names that are not even strings of `x2.exe`.
Tests: `bun test packages/host` (36, no GPU; the 9 script tests need `data/`, the whole-corpus ones take ~6 s each).

### `@els/ui` (`packages/ui`)
The classes behind the `DLG_*.lua` scripts (Phase 4), registered with the binder of `@els/host` under the exe's own class names so that the real scripts run on them in strict mode (FINDINGS 17). A method is named like the
registered Lua function (`_LUA` kept where the registry has it; a lower camel name is a C++ member the registered functions call); the header of each file holds the addresses, struct sizes and quirks of its classes.
All 346 registered methods of the 22 classes in `docs/UI_COVERAGE.md` are implemented (`CX2Main`, listed after them, is partial on purpose: of its 46 registered methods only `InstallFont`, which the text path needs, belongs to the UI; the rest is the game's main object, Phase 6), and all 992 DLG scripts that can run on the host layer run strictly without an error (the other 32 need game states).

| File | Content |
|---|---|
| `world.ts` | `UIWorld`: a `HostWorld` + the devices + the fonts; `boot()` (stub objects, enums, the start-up config `CONFIG_HK_SERVICE.LUA`), `createOwners()` (the globals `g_pPostBoxInventory`, `g_pCouponBox`, `g_pMapSelectWindow`), `openDialog(script, layer, owner)` |
| `device.ts` | the devices: `OpenTexture` (a texture is its file's size and `.tet` UV table; with a device it also loads the pixels, `_Load`, and draws: `Draw` 329675F0), sounds (gated like the exe: sound system up and `IsValidFile`), `OpenRenderTargetTexture` with `CKTDXDeviceRenderTargetTexture` (the constructor, `OnLostDevice` / `OnResetDevice`, `BeginRender` / `Clear` / `EndRender`, `Draw`, `SetDeviceTexture`: FINDINGS 17.28), `drawDeviceTexture` (the one quad that both `Draw` functions make), `CBandiVideoTexture_DX9` (`BandiVideoTextureDX9`: the video texture a movie is drawn into) and the Bandi video library as a hook (`NoVideoLibrary` by default; `installMovies` puts a player in) |
| `render.ts` | what the UI draws with: `UIRender` (the state manager with the baseline `akStates`, the dynamic vertex buffers, the resolution scale, the view port and the three matrices of the application that `OutProjectionText` reads; `noteUndrawn` counts what is not drawn yet), `VertexUI4`, `RSI_UI_DIALOG` / `RSI_DEVICE_TEXTURE` |
| `dialogmanager.ts` | `CKTDGUIDialogManager` (FINDINGS 17.20): the list of dialogs from the back to the front as the exe's `std::list` (`DialogList`, a ring through a sentinel, so that the walks of `m_vecIterator` / `m_vecReverseIterator` can stand on a node that `removeFromDialogList` takes out), `addDlg` / `insertIntoDialogListTop`, `changeFront` / `changeLayer`, both `changeSequence`, `unmanageDlg` / `deleteDlg` / `clearAllDlg`, `getDialog` with the count of changes that caches it, the getters, and the frame (`onFrameMove`, `onFrameRender` with its pass over the guide text and the dragged slot, `onFrameRenderTopModal`, `MsgProc`), `onLostDevice` 328E09A0 / `onResetDevice` 328E0A40 and the destructor (`Destroy()` 328DD8A0: FINDINGS 17.27); the manager takes the `UIContext`, and the dialog's `Destroy()` is `~CKTDGUIDialog` (which destroys its controls: 17.21) |
| `dialog.ts` | `CKTDGUIDialog`: the script run (`OpenScriptFile`), the control map and list (`AddControl` / `ReNameControl` naming, `Get*Control`, `ChangeSequence*`), the radio button groups, `onFrameMove` (32958A00: guide text, move to the goal, queue, controls last to first, drag range), the hiding half of `setShow`, `SetFront` / `SetLayer` through the manager, `Destroy()` (`~CKTDGUIDialog` 329554D0: FINDINGS 17.20) and the input (FINDINGS 17.23): `msgProc` 32958350 (the keyboard with the tab keys, the mouse over / out messages, the drag of the dialog, the click outside, the close on focus out), `handleMouse` 32957AA0 (a focused combo box or IME box first, then the walk from the last control), `sendInternelEvent` 3295B610, `requestFocus` 3295B490, `getControl` 329572D0, the hint's dialog (`createGuideDesc` 32956BD0, `showGuideDesc` 3295BA30) and the fade-in at the end of the constructor (FINDINGS 17.26), `onLostDevice` 3295A480 / `onResetDevice` 3295A610 (17.27) |
| `control.ts`, `static.ts` | `CKTDGUIControl` (rectangles, UV tables `setTexureData`, point and string data readers, sounds, the move queue; `updateVertex` / `renderVertex` and the bars of an edge, `drawEdgeBars`; `onFrameMove`, `animate`, `changePoint`, `updateTexChangeData`), `CKTDGUIStatic` (+ its `handleMouse` 32929E60 and its loops over its movies, `onFrameMove` 3292A120 / `onFrameRender` 3292A2B0: 17.28), `CPictureData` (+ its `onFrameMove`: twinkle, flicker, vibrate, fades); the focus every control shares (`requestFocus` / `clearFocus`: the exe's `s_pControlFocus`), `sendInternelEvent` (the message of a control to the stage) and `containPTForEditBox` 329331C0 (FINDINGS 17.23, 17.24); every control class's `Destroy()` is its C++ destructor and then the control's (`~CKTDGUIControl` 32923680: FINDINGS 17.21), a release being `closeDevice` and a null field |
| `button.ts`, `radiobutton.ts`, `checkbox.ts` | button (+ its `DrawEdge`), radio button (+ `RadioButtonGroupInfo`, `DrawCheckedEdge`), check box; each has its `onFrameRender`, `onFrameMove` and `handleMouse` (button 3292E520 with `LButtonMouseUp` 3292E6D0, check box 32931830, radio button 3294A680: FINDINGS 17.23) |
| `slot.ts` | `CKTDGUISlot` (its `onFrameRender` 32952670, `drawEdge`, `updateDraggingVertex` 329545B0 and `renderDragSlot` 32952DD0 draw: FINDINGS 17.16; its `handleMouse` 329520A0, `onFocusOut` 329523D0 and `getGuideDescPos` 32951F20: 17.23) and the owners that make slots: `CX2SlotManager` (`g_pCX2SlotManager`), `CX2Slot` / `CX2SlotItem`, `CX2PostBox`, `CX2CouponBox` |
| `imeeditbox.ts`, `editbox.ts`, `unibuffer.ts`, `d3dcolor.ts` | the IME edit box (its `onFrameRender` 32939580 with `DrawTextW`, `CalcTextRect`, `DrawRect`, `RenderComposition` and `RenderCandidateReadingWindow` draws, and `ImeSystem`, the statics of the IME with `getImeId`: FINDINGS 17.18), the plain edit box (its `onFrameRender` 32934400 with `PlaceCaret`, `DrawRect` and `DrawTextW` draws: FINDINGS 17.17), `CKTDGUIUniBuffer` (and its measuring: `CPtoX`, `CPtoY`, `GetLineWidth`, `XtoCP`, which ask the box's UK font, and its editing: `InsertChar`, `InsertString`, `RemoveChar`, `XYtoCP`, `GetCaretLineMove` and the others of FINDINGS 17.24), the colour the edit box setters make of four floats; the input of the two boxes: the plain edit box's `HandleKeyboard` 32933AB0, `MsgProc` 32933F70, `HandleMouse` 32933D80 and its clipboard members (17.24), the IME box's `handleKeyboard` 32937C10, `msgProc` 329387A0 (with the `WM_IME_*` messages), `ebProc` 32936A30, `handleMouse` 32937EF0, `onFocusIn` / `onFocusOut` and, in `ImeSystem`, `checkToggleState`, `getImeId`, `getPrivateReadingString`, `staticMsgProc` (17.25) |
| `imehost.ts` | `ImeHost`: what the IME edit box asks of the window system (FINDINGS 17.25): USER32 (the keyboard layout, `GetAsyncKeyState`, the focus window, `PostMessageW` / `SendMessageW`, `keybd_event`, the list of the layouts), KERNEL32 (`GetLocaleInfoW`) and the `imm32.dll` calls the exe reaches through its table of function pointers (`ImmBytes` is the answer of those that fill a buffer); `NoImeHost` is a machine without an IME and the host of a world until a platform plugs in its own; the loading of `imm32.dll` is not modelled |
| `combobox.ts`, `listbox.ts`, `scrollbar.ts`, `slider.ts`, `controllist.ts`, `navigation.ts` | combo box, list box (+ `CKTDGUIItem`), scroll bar, slider, control list, navigation window; the combo box (`onFrameRender` and `onFrameRenderEnd`), the list box (`onFrameRender`), the last four and the scroll bar draw; all of them take the mouse (FINDINGS 17.23): the `handleMouse` of each, the combo box's `onFocusOut` and `onHotkey`, the list box's `listBoxMsgProc` 32943960, and the scroll bar's `scrollBarMsgProc` 32985E10 and the navigation's `navigationMsgProc` 3294E510, which sit in slot 41 and take no window handle |
| `input.ts` | `UIKeyboard`: the 256 key bytes and locks of `CKTDIDevice` (`getKeyState` 32962CF0, the lock loop of `Read` 32962ED0) that `OnFrameMove` reads, and `UIMouse`: the position the list box's mouse pass reads (`GetXPos` 32962E60, `GetYPos` 32962EB0); and `UIInputManager`, the `CKTDIManager` flag `m_bEnabled` that `GetCloseDialogByESC` turns on; the keyboard's `m_bExtraEnter` and `setLock` (FINDINGS 17.25); `UIClipboard` with `MemoryClipboard`, the clipboard the edit boxes copy and paste with until a host plugs in the real one (17.24); the DirectInput poll is not ported (a test or the host puts the key states and the mouse position in) |
| `prefetch.ts` | `PrefetchSource`, the `MassFileSource` of a synchronous UI world over an asynchronous store (the archives over HTTP Range requests): it hands out what is resident, says "no such file" for the rest and remembers what it was asked for; `settle(build)` builds the world again until one build asks for nothing that is not resident (a build that missed a file is void and is handed to `discard`), `trim` forgets what the last build did not read. Platform glue for the browser's dialog preview, not in the exe (FINDINGS 17.29) |
| `movie.ts`, `video.ts`, `mapselect.ts` | `CMovieData` (file name, render target and the playback: `onFrameMove` 32924DE0, `onFrameRender` 32925150: FINDINGS 17.28), `Mpeg1VideoLibrary` and `installMovies` (the platform's player: it stands in for Bandisoft's `bdvid32.dll`, which the exe loads at run time and talks to through `IBandiVideo2`, and plays the AVI / MPEG-1 files of `data/movie` with the decoder of FINDINGS 13), `CX2MapSelectWindow` (`g_pMapSelectWindow`) |
| `freetypefont.ts`, `dynamictexture.ts` | `CKTDGFreeTypeFont` (the faces of `Load`, the glyph cache with its LRU rule and its four 256 x 256 pages, `CharToSystemTexture` on `@els/freetype`, `Buffering` / `Flush` as triangle lists through the dynamic vertex buffers, `OutTextXY` / `OutTextMultiline`, the measuring, the life of the device) and `CKTDGDynamicTexture` (a locked system-memory page and the default-pool texture the GPU samples) |
| `font.ts`, `fontmanager.ts`, `main.ts` | `CUKFont` (the wrapper that scales to the back buffer; all 15 of its functions and the destructor: `DrawFontStyle`, `DrawTextFont`, the queue of 2D texts `Push2DText` / `Delete2DFont` / `Get2DArticle` with `FontArticle`, and `OutProjectionText`, the text at the screen position of a world point: FINDINGS 17.19), the font manager `g_pFontManager` (`InstallFont`, `GetFontMemory`, `CreateNewUIUKFont`, `OnFrameMove`, the destructor, the reset), `CX2Main::InstallFont`; a C++ destructor is a method `Destroy()` |
| `stringdraw.ts` | the strings that Static, Button and RadioButton draw after their pictures (the code their three `OnFrameRender`s inline): the UK font of `fontIndex`, the colour `(dialog * string) * control` and the place `(dialog.pos + string.pos) + control.offset` in floats, `OutTextMultiline` (or the font map and `Draw2DText` for a static without `USE_UK_FONT`), the spread of a static's string; FINDINGS 17.13 |
| `pick.ts` | the geometry of the mouse (FINDINGS 17.22): `pick2DRect` (32946C10: single precision, a point on an edge is outside), `pick2DRectOfRect` (a scroll bar's box), `localAxis` / `localPoint` (the point a dialog hands a control: `(int)((pt - (int)(scale * offset)) / scale)`), `resolutionScale`; the `containsPoint` of the control classes and the dialog's `getControlAtPointAbsolute` / `getControlAtPointForStatic` / `getControlMouseOver` / `onMouseMove` use it |
| `stdmap.ts`, `rect.ts` | `std::map` iteration order (`WStringMap`, `IntPairMap`), the Win32 `RECT` helpers (`intersectRect` too), `idiv` / `ftoi` (x86 integer semantics) |
| `census.ts` | the steps of `tools/ui-census.ts`: `makeUICensusWorld`, `implementedMethods`, `runStrict` (also the classes of each dialog and the ones whose `OnFrameRender` is not ported), `runStrictWorld` (keeps the world and its dialogs) and `destroyDialogs` (destroys them all and reports what the device manager still holds: FINDINGS 17.21) |

Tests: `bun test packages/ui/test` (12,173, no GPU, `data/` needed: `dialog` 13, `controls` 26, `slot` 15, `slotdraw` 50, `imeeditbox` 20, `combobox` 33, `listbox` 30, `widgets` 58, `render` 39, `devicetexture` 13, `controldraw` 45, `reference` 21, `framemove` 101, `dialogmanager` 57, `dynamictexture` 22, `freetypefont` 140, `fontmanager` 14, `stringdraw` 29, `comboboxdraw` 36, `listboxdraw` 57, `fontdraw` 68, `unibuffer` 23, `rect` 6, `editboxdraw` 45, `imeboxdraw` 127, `destroy` 60, `mouse` 35, `census` 1, `input` 122, `controls-input` 65, `gamemessage` 7, `toggles-input` 95, `focus` 8, `bars-input` 214, `containers-input` 152, `slots-input` 172, `combos-input` 214, `lists-input` 474, `unibuffer-ops` 9, `edits-input` 1918, `ime-input` 7394, `guide` 28, `devicelost` 29, `movie` 53, `video` 29, `prefetch` 6; `census` is the strict run of all 992 scripts and the destruction of all 1,001 dialogs, 22 s; the `*-input` files and `ime-input` replay the cases of the exe oracles `tools/oracle-*.py`, FINDINGS 17.22 to 17.25) and `packages/ui/test-gpu` (37 tests: `dialog-draw.test.ts`, 24 real dialogs and a dragged slot drawn through `@els/d3d9` with their strings and composed again on the CPU by `reference.ts`; `text-draw.test.ts`, 3 pictures of text; `movie-draw.test.ts`, 3 pictures of a movie (17.28); `manager-draw.test.ts`, 6 pictures of the dialog manager's frame (17.29); they need the GPU). Checks that have no exe oracle are pinned by unit tests and the mutation checks of the tool table below (`tools/mutate-ui.py`, 100 mutants: 98 killed, 2 equivalent; `tools/mutate-draw.py`, 967 mutants: 951 killed, 16 equivalent; `tools/mutate-font.py`, 955 mutants: 906 killed, 49 equivalent; `tools/mutate-edit.py`, 1,275 mutants: 1,188 killed, 87 equivalent; `tools/mutate-framemove.py`, 443 mutants: 437 killed, 6 equivalent; `tools/mutate-manager.py`, 334 mutants of the dialog manager: 325 killed, 9 equivalent; `tools/mutate-destroy.py`, 418 mutants of the destructors: 415 killed, 3 equivalent; the input, the edit boxes, the hint, the device reset, the movies, the manager's picture and the prefetching source have their own, listed there). The mouse hit tests, the input, the guide text, the device reset and the movies are ported (17.22 to 17.28). Not ported: the 32 state scripts, the IMEs that need a file (`GetImeId`, `WM_INPUTLANGCHANGE`, `ImmLockIMC`), `CopyBackBufferToSurface` and the device manager's reset of its render targets (every function of the text path is ported: Static, Button, RadioButton, ComboBox, ListBox, Slot, EditBox and IMEEditBox draw their strings with it, 17.13 to 17.18).

### `@els/freetype` (`packages/freetype`)
FreeType 2.4.11 (the version x2.exe's own copy reports) ported as the exe uses it for its text: `CKTDGFreeTypeFont::CharToSystemTexture` calls `FT_Get_Char_Index`, `FT_Load_Glyph(.., 8)` (hinted, `NO_BITMAP`), `FT_Render_Glyph(.., NORMAL)`, `FT_Bitmap_Copy` and `FT_Bitmap_Embolden`. The exe's build has no `FT_LONG64`; there is no autohinter (it never runs for its five fonts). Each function follows the 2.4.11 C text, the integer helpers the disassembly (FINDINGS 17.11).

| File | Content |
|---|---|
| `types.ts`, `bytes.ts`, `ttypes.ts` | the constants of 2.4.11 (`FT_LOAD`, error codes, formats), the big-endian reader of a font in memory (`FT_Stream`), the records the size, the loader and the interpreter share (graphics state, glyph zone, code ranges) |
| `calc.ts`, `trig.ts` | `FT_MulFix` / `MulDiv` / `MulDiv_No_Round` / `DivFix` / `SqrtFixed` as the exe computes them, `FT_Vector_Length` / `Transform`, the CORDIC helpers |
| `face.ts`, `cmap.ts`, `size.ts`, `slot.ts`, `library.ts` | `FT_New_Memory_Face` for TrueType fonts and collections (head, hhea, hmtx, maxp, loca, cvt, fpgm, prep, EBLC strikes), `cmap` formats 4 / 6 / 12, `FT_Set_Char_Size` / `FT_Match_Size`, the glyph slot and `FT_Bitmap`, the library that owns the one TrueType exec context every face and size shares |
| `glyph.ts`, `loader.ts` | `FT_Load_Glyph` for TrueType (`TT_Load_Glyph`: simple and composite glyphs, phantom points, hinted metrics, `tt_loader_init` with its `INSTCTRL` and grayscale rules, `ft_glyphslot_grid_fit_metrics`); `FT_GlyphLoader` (`ftgloadr.c`), the buffers an outline is built in |
| `interp.ts`, `interp-tables.ts`, `bytecode.ts` | the TrueType interpreter (all 119 instructions of `ttinterp.c`, generated opcode tables), `tt_size_run_fpgm` / `prep` |
| `outline.ts`, `raster.ts`, `render.ts`, `bitmap.ts` | `FT_Outline_*`, the smooth rasterizer (`ftgrays.c`), `FT_Render_Glyph`, `FT_Bitmap_Copy` / `Embolden` |

Tests: `bun test packages/freetype/test` (204, no GPU; `data/` for the fonts): `oracle.test.ts` replays `fixtures/oracle.json` (976 KB, written by `tools/verify-freetype.ts --record`: what the exe's FreeType answered), `interp-ops.test.ts` (104: each instruction group on a hand-built exec, values from the C text), `interp`, `arith`, `cmap`, `render`, `outline`, `size`; `synth.ts` generates three TrueType fonts (random programs over all 119 instructions, composites, skewed bearings, `INSTCTRL`) that the verifier loads in the exe's FreeType and the port, 15,885 glyph loads. A 376-mutant check (`tools/mutate-freetype.py`) pins the rest: 358 killed, 18 survivors with a reason each. Not ported (not reachable with the five fonts): the autohinter, mono and LCD renderers, cmap formats 0 / 2 / 8 / 10 / 13 / 14, EBDT strikes, GX, incremental fonts.

### `@els/lua` (`packages/lua`)
A register-based interpreter for LuaJIT 2.0.2 bytecode, following `lj_*` of the exe:

| File | Content |
|---|---|
| `value.ts` | value representation (`nil` = `undefined`, numbers = doubles, strings = JS byte strings, `LuaTable`, `LuaClosure`, `LuaNative`, `LuaUserdata`), `LuaError`, error-context records |
| `table.ts` | port of `lj_tab_*`: array/hash parts, node chaining with the same hash functions, `lj_tab_len` border search, `next` order |
| `bytecode.ts` | opcode tables (`lj_bc_mode`), `loadBytecode` (private header `1B 4B 4C 81`, flags, uleb128 constants, nested prototypes), `disassemble` (format of `jit.bc`) |
| `vm.ts` | `LuaState`/`LuaThread`/`Frame`, the interpreter loop (`runLoop`), calls, varargs, upvalues, metamethods (`lj_meta_*`), coroutines, error context (`resolveError`, `slotName`, `callerLevels`), synthetic `pcall`/`xpcall` closures |
| `numfmt.ts` | C-correct `%e/%f/%g` (ties-to-even) used by `tostring` and `string.format` |
| `strscan.ts` | literal port of `lj_strscan.c` (`tonumber`, string arithmetic coercions; not always correctly rounded, so never replace it by `Number()`) |
| `cmath.ts` | `x ^ y` / `math.pow` exactly as `vm_pow_sse` (repeated squaring for int32 exponents, special cases; `Math.pow` for the x87 path) |
| `lib/base.ts` | base library; `loadChunk` (= `lj_lex_setup` + `cpparser` + `lj_bcread`: the exe has no source compiler, so text is refused), `loadFileChunk` (`luaL_loadfilex` with `iEncoding`), `dofile_UTF8`, `BaseHost` |
| `proxy.ts` | `LuaManagerProxy`: port of KOG's `KLuaManagerProxy`, the interpreter of the text configuration files (`GameOption*.txt`, server group, tutor, console arguments); no Lua VM involved except for global lookups |
| `lib/string.ts`, `lib/pattern.ts` | `string.*` (`lj_cf_string_format` port, Lua patterns) |
| `lib/table.ts`, `lib/misc.ts` | `table.*`; `math` (Tausworthe PRNG as in `lj_math_random`), `bit`, `coroutine`, `os`, `io`, `debug`, `jit` stubs, `package`/`require`/`module` |
| `index.ts` | `createLuaState(host)`, `runChunk` |

Design points that matter for faithfulness:

* **Bytecode only, like the exe.** The client has no Lua source compiler (FINDINGS section 11): scripts are precompiled and stripped, so debug info is
  absent; text chunks fail with `cannot load malformed bytecode`. Error messages and `tostring` formats follow the exe (see FINDINGS section 3).
* **Strings are byte strings** (code units 0-255): bytes round-trip exactly, string hashing and `#` match the 32-bit exe.
* **Error context is computed lazily**: natives and VM raise `LuaError` with a *pending* description; `resolveError` (run when the
  error reaches the nearest frame boundary, while the frames are still intact) builds the final message, exactly as
  `lj_err_*`/`lj_debug_*` do (position prefix, `bad argument #n to 'name'`, variable naming from bytecode).
* **`pcall`/`xpcall` are ordinary Lua closures over synthetic bytecode** (`Proto.synthetic`), so error handling, tail calls and
  stack depth behave like in LuaJIT (handler runs at the error point, before unwinding).
* **Coroutines** have their own stacks and frames; yields across natives or metamethods are not supported yet.

## Apps

* `apps/server` (`@els/server`): `bun run apps/server/src/main.ts [--port 8080] [--host 0.0.0.0]`. Serves the client page, the bundle (`Bun.build` of
  `apps/client/src/main.ts`, rebuilt when a source file changes), `/data/*` with `Range` / `HEAD` (only asset types; no `..`) and `/api/files` (the loose files). The game server
  (packet protocol, `bun:sqlite`) is Phase 6.
* `apps/client` (`@els/client`): today the **asset viewer** (FINDINGS 15.2): `vfs.ts` mounts the 173 archives over HTTP Range requests, `gpu.ts` creates the WebGPU device and the D3D9 layer that
  presents to a canvas, `viewer.ts` is the list + preview pane, `previews/` has one module per type (image, movie, audio, text / Lua / tables, mesh, dialog). `previews/dialog.ts` opens a `DLG_*.LUA` script (the chip "dialogs": 1,024 of them) as the dialog it makes and keeps it running: the Lua VM runs the script, `@els/ui` builds the dialog, the dialog manager's frame (`OnFrameMove`, `OnFrameRender(false)` and `(true)`) is drawn through the D3D9 layer on the 1024 x 768 canvas and the mouse goes to `MsgProc`; `PrefetchSource` lets that synchronous world read the archives over the asynchronous Range requests; a script that stops (the 32 state scripts) shows its reason and its listing (FINDINGS 17.29). The boot sequence and the game states
  replace `main.ts` in Phase 6. `window.__els` is the handle for the browser tests.

## Tools (`tools/`)

| Tool | Purpose |
|---|---|
| `verify-kom.ts` | full verification of every KOM entry |
| `verify-lua-bytecode.ts` + `lua/native_dump_bc.lua` | loader/disassembler vs the native `jit.bc` listing |
| `setup-oracle.sh` | builds the LuaJIT 2.0.2 oracle (patched for 32-bit `long`, client header) |
| `lua-difftest.sh` + `tests/lua/*.lua` | differential tests (t10-t14 are fuzzers, t15 the chunk loader); both VMs run the same `luajit -b -s` bytecode, the oracle with `-joff`; a compile error or non-zero exit fails the test |
| `corpus-diff.sh` + `lua/stubrun.lua` + `corpus-run.ts` | stub-environment differential run of all 4,498 game scripts (native xargs -P2 vs one in-process TS run, ~3 minutes per flavor) |
| `lua-run.ts` + `lib/lua-host.ts` | run a `.luac` in the TS VM (`arg` like the standalone interpreter); the shared runner of the corpus tool |
| `bindings.py` | extracts the `lua_tinker` registrations from `data/x2.exe.c` -> `docs/HOST_API.md`, `docs/host_api.tsv` (phase 5 ground truth) |
| `gen-host-api.ts` | `docs/host_api.tsv` -> `packages/host/src/api.generated.ts` (`--check` fails when stale) |
| `host-census.ts` | runs every script of the KOMs on the host layer with typed stubs (`--md docs/HOST_CENSUS.md`, `--show SCRIPT`, `--match RE`, `--isolated`) |
| `ui-census.ts` | the UI counterpart (`bun run census:ui` -> `docs/UI_COVERAGE.md`): which DLG scripts run on the stubs, which are fully ported, the strict run of those, the textures they name, the class table, `--next N` = what to port next (greedy), `--json F` |
| `ui-draw.ts` | the draw census (`./tools/gpu.sh bun run tools/ui-draw.ts --md docs/UI_DRAW.md --tsv docs/ui-draw.tsv`; `--json F`, `--png DIR`, `--only RE`, `--limit N`, `--frames N`): every DLG script is opened in ONE Lua state and one UI world, run for `N` (default 1) frames of no time (`OnFrameMove(0, 0)`; the first exception of a frame is the `frame_error` column), drawn on a cleared 1024 x 768 target through the whole stack and composed again on the CPU (`packages/ui/test-gpu/draw.ts`, `reference.ts`); per dialog the quads, bars, flat quads, the largest difference, the error log, the reason for no quad; `--from OLD.json` writes the reports of a run that was saved with `--json` without drawing again (the movies of the three dialogs are drawn since 17.28: nothing is counted as undrawn) |
| `mutate-ui.py` | `bun run mutate:ui`: 100 mutants of `packages/ui/src` against `packages/ui/test/widgets.test.ts` (and `bars-input.test.ts` for the slider): 98 killed, 2 equivalent (the source is restored after each; a must-kill survivor makes exit code 1; `--list`, name substrings select) |
| `mutate-framemove.py` | 443 mutants of the frame update (`OnFrameMove` of the controls, the dialog and the static's movie loop, `CheckDlg` / `CheckFrontModalDlg` / `CountModalDialog`, the keyboard) against `packages/ui/test/framemove.test.ts`: 437 killed, 6 equivalent (6 min; the source is restored after each; `--list`, `--check` = every anchor is in its file once, name substrings select; an expected survivor carries a reason) |
| `mutate-draw.py` | 967 mutants of the drawing: 925 of `packages/ui/src` (the device with `drawDeviceTexture`, the controls, `stringdraw.ts`, `combobox.ts`, `listbox.ts`, `input.ts`) against `render.test.ts`, `controldraw.test.ts`, `stringdraw.test.ts`, `comboboxdraw.test.ts` and `listboxdraw.test.ts`, 42 of the CPU reference `packages/ui/test-gpu/reference.ts` against `reference.test.ts` (~25 min; the source is restored after each; `--list`, name substrings select; an expected survivor carries a reason: 951 killed, 16 equivalent) |
| `mutate-font.py` | 955 mutants of the text path: `freetypefont.ts`, `font.ts`, `dynamictexture.ts`, `fontmanager.ts`, `main.ts` of `packages/ui/src`, each against the test files of its source (`freetypefont`, `dynamictexture`, `fontmanager`, `combobox`); the source is restored after each; `--list`, `--check` (every anchor occurs exactly once: run it after every edit of those sources), `--survivors=LOG` (rerun the survivors of a log), name substrings select; an equivalent survivor carries its reason (inline or in the `WHY` table, and a reason for a mutant that is killed is an error): 906 killed, 49 equivalent |
| `oracle-mouse.py` .. `oracle-lists.py`, `oracle-unibuf.py`, `oracle-edits.py`, `oracle-ime.py` | the UI's emulator oracles (PEEmu): the exe's functions on dialogs, controls, stages and text boxes built by hand in the emulator's memory with their real vtables, the operating system stubbed and logged; each loads an earlier one (`mouse` -> `input` -> `controls` -> `toggles`, `bars`, `slots`; `bars` -> `containers`, `combos` -> `lists`; `lists` + `unibuf` -> `edits` -> `ime`) and writes the cases (`packages/ui/test/*-cases.json`) that `replay.ts` runs on the port (FINDINGS 17.22 to 17.25); `oracle-ime.py` runs some scene groups with `ONLY=K9,M10`, all with `--json FILE` (about 10 min) |
| `mutate-edit.py`, `mutate-manager.py`, `mutate-destroy.py`, `mutate-input.py`, `mutate-unibuf.py`, `mutate-edits.py`, `mutate-ime.py` | the other mutation checks of the UI, with the same options (`--list`, `--check`, `--survivors=LOG`, name substrings): `mutate-edit.py` the measuring and the drawing of the text boxes (1,275 mutants), `mutate-manager.py` the dialog manager (334), `mutate-destroy.py` the destructors (415), `mutate-input.py` the mouse input of the controls (953), `mutate-unibuf.py` the buffer's editing (407), `mutate-edits.py` the edit box's input (497), `mutate-ime.py` the IME box's input and the IME system (1,816); `--shard=K/N` (the ones built on `mutate-edit.py`) takes every N-th mutant, `MUTATE_TIMEOUT_SCALE` multiplies the time limit of a test file (a mutant whose run times out is reported as `(timeout)` and is no kill until it is run again alone) |
| `mutate-guide.py`, `mutate-devicelost.py`, `mutate-movie.py` | the mutation checks of the units after the input, with the options of `mutate-edit.py` (`--list`, `--check`, `--survivors=LOG`, `--shard=K/N`, name substrings): `mutate-guide.py` the hint's dialog and the fade-in (245 mutants against `guide.test.ts`: 244 killed, 1 equivalent), `mutate-devicelost.py` the device reset (124 against `devicelost.test.ts`: all killed), `mutate-movie.py` the movie playback, the render target texture and the video texture (1,085 against `movie.test.ts`, `widgets.test.ts`, `destroy.test.ts`, `framemove.test.ts`, `video.test.ts` and, for the Direct3D object, `direct3d.test.ts`: 1,072 killed, 13 equivalent, each with its reason) |
| `mutate-managerdraw.py`, `mutate-prefetch.py` | the last two mutation checks: 19 hand-made mutants of the dialog manager's `onFrameRender` / `onFrameRenderTopModal` against the picture test `packages/ui/test-gpu/manager-draw.test.ts` (all killed; every run is the whole test file on SwiftShader), and 76 mutants of `packages/ui/src/prefetch.ts` against `prefetch.test.ts` (all killed; the options of `mutate-edit.py`) |
| `test-packages.sh` | `bun run test:packages`: every test of `packages/*` in three bun processes (d3d9 / engine / assets / kom / lua; host + `packages/ui/test`; the dialogs drawn through the device in `packages/ui/test-gpu`), because one process peaks above 4 GB |
| `decomp.py`, `structs.py`, `layout.py`, `vtbl.py`, `vtstr.py`, `cstr-uses.py`, `null-cstr.py`, `xrefs.py`, `disasm.py` | the porting helpers over `data/x2.exe.c` / `x2.exe`: a function cleaned of STL noise (`decomp.py ADDR --clean`), the struct fields of a class and its bases (`structs.py`), the MSVC member layout (`layout.py CLASS --find OFF`), the virtual overrides of a class (`vtbl.py CTOR BASE_CTOR`), the strings behind `vftable[N]` (`vtstr.py`), what a `char*` parameter is used for (`cstr-uses.py`; `null-cstr.py` -> `docs/host_null_cstr.tsv`), who calls or points at a function (`xrefs.py ADDR_OR_NAME`: every `call` / `jmp` rel32 and every copy of the address, with the function that holds it), the machine code (`disasm.py`); the Python ones that read the exe need `pefile` / `capstone` (`PYTHONPATH=/home/user/work/pycap`) |
| `komindex.ts` | `indexAllKoms` (every archive's entries by upper-cased name) and `KomMassFileSource` (the synchronous `MassFileSource` of the host layer over them: `load`, `settle`; image files can be cut to a header; `evict(pattern)`; a `sync` mode that loads a missing member at once, which the draw census needs because it cannot rerun on a fresh world) |
| `api-census.ts`, `script-graph.ts` | what the scripts use of the host API (`docs/SCRIPT_API_USAGE.md`) and which scripts the exe loads (`docs/SCRIPT_GRAPH.md`) |
| `census-images.ts`, `decode-images.ts`, `verify-images.py`, `verify-xet-tet.ts` | image format census, decode of all 55,377 TGA/DDS entries, cross-check against Pillow (needs a venv with `pillow`), XET/TET structure check |
| `verify-xfiles.ts` | container census of the 26,453 `.x` / `.y` entries; decompresses all 25,204 MSZIP entries (`--crosscheck` against fflate, `--dump DIR --every N` writes samples) |
| `verify-xparse.ts` | parses all 25,313 DirectX-format files with `parseXFile`, object census and per-mesh consistency checks (`--limit N --filter RE --verbose`) |
| `verify-ksm.ts` | parses the 109 KME + 1,031 KSM files (with their KAC animations) and checks the invariants the exe relies on |
| `verify-ksm-load.ts` | loads all 1,031 KSM through `loadSkinnedMesh` on a software WebGPU device and compares with `parseKsm` (frames, containers, bones, sets, animations, poses; keys before / after `OptimizeKeys`), ~90 s |
| `verify-xmesh-load.ts` | loads the 109 KME (and with `--x N` every N-th X / Y file) through `loadXMesh`, checks the tail of `_Load` (FVF 338, ranges tile the faces, finite spheres), ~45 s |
| `peemu.py` | runs functions of `data/x2.exe` on the Unicorn CPU emulator (PE mapped at its base, imports replaced by stubs / Python hooks): the oracle for pure functions of the exe |
| `oracle-optimizekeys.py`, `verify-optimizekeys.ts`, `mutate-optimizekeys.py` | `OptimizeKeys` of the exe on `peemu.py` for a file of cases; the TS tool generates cases (synthetic + the shipped animations), compares the port bit for bit and records / merges the fixture; the mutation check of `kac-keys.ts` (22 mutants; unit tests or `--live`) |
| `oracle-freetype.py`, `verify-freetype.ts`, `mutate-freetype.py`, `ft-kill-pick.ts` + `ft-picks.json`, `ft-opcode-census.ts`, `gen-freetype-tables.py` | FreeType 2.4.11: the exe's own copy on the Unicorn emulator (`oracle-freetype.py JOBS.json RESULTS.jsonl`: face / size / glyph / render / embolden / raster / integer-helper jobs); the TS verifier (layers calc, face, chars, unhinted, hinted, render, render-unhinted, raster, embolden, synth; `--record FILE` writes the test fixture); the mutation check of `packages/freetype/src` (376 mutants, `--list` / `--check` / `--survivors=LOG` / `--pick`); the killer-glyph search the picks come from; the census of which instructions the shipped fonts and the synthetic ones run (`ft-opcode-census.ts`); the generator of `interp-tables.ts` from the opcode table of `ttinterp.c` |
| `disasm.py` | Capstone disassembly of a range of `x2.exe` by virtual address, imports named (also through the `jmp [slot]` thunks): for what the decompile gets wrong (float code, FINDINGS 7) |
| `verify-ess.ts`, `verify-ess.py` | decodes `data/general.ess` and reports index mismatches, capped lines, placeholders, character classes; the Python script is an independent second implementation of the loader |
| `verify-kim.ts` | decodes `item.kim` from its KOM, checks id order / id agreement / string length words / set cross references and reports every byte the decoder did not read |
| `verify-effects.ts` + `lib/effect-oracle.ts` | parses the 37 particle / XMeshPlayer scripts of the KOMs and compares every field of all 13,882 blocks with an independent line-based reader; counts three ways, unread tokens, duplicate names per script system (`--census`: property and event usage) |
| `setup-gpu.sh`, `gpu.sh` | `setup-gpu.sh` installs the software Vulkan driver (SwiftShader, taken from the `@sparticuz/chromium` npm package) into `/home/user/work/swsh`; `gpu.sh CMD...` runs a command with the environment that lets Dawn (the `webgpu` npm package) find it (`ELS_GPU_NATIVE=1` skips this on a machine with a real GPU) |
| `gen-d3d9-enums.ts` | regenerates `packages/d3d9/src/enums.generated.ts` from `data/x2.exe.h` (`--check` fails when the file is stale) |
| `census-xscene.ts` | loads all 25,313 X / Y files through `loadXScene` and checks every index (faces, normals, texture coordinates, materials, bones, animation targets); prints the census quoted in FINDINGS section 12 |
| `census-skin.ts` | the D3DX hierarchy loader, `ConvertToIndexedBlendedMesh` (with the engine's palette) and the controller over every skinned X file (needs the GPU wrapper) |
| `render-demo.ts` | the D3D9 visual milestone: loading screen + starter sword -> PNG (`docs/img/d3d9-demo.png` with `--docs`) |
| `setup-browser.sh`, `browser.mjs` (+ `browser.d.mts`) | installs `puppeteer-core` and a headless Chromium (`@sparticuz/chromium`, WebGPU on SwiftShader) under `/home/user/work/browser` and `/tmp/chromium`; `node tools/browser.mjs URL [--shot f.png] [--wait EXPR] [--eval EXPR]... [--size WxH] [--settle ms]` opens a page, prints the console, evaluates, screenshots, exits 1 on a page error / failed request / timeout; `withPage` for scripts (FINDINGS 15.1) |
| `browser-test.ts` | 30 browser checks of the web client (`--smoke N` opens N pseudo-random X / Y files as well, N = 1,500: all open as meshes - 440 skinned, 349 animated, 50 KSM, 5 KME, 10 with nothing to draw - 0 errors) against the same decoders run in Bun (archives over Range, TGA and AVI pictures pixel-identical, static, skinned and KSM / KME meshes through the WebGPU canvas incl. the standing Elsword and a Walk pose, RGBA vs BGRA back buffer identical, Lua / XET / TET / audio previews, 8 checks of the dialogs: a dialog built by `@els/ui` and drawn, its picture equal to the one Bun makes, the mouse on its buttons, a script that stops shown with its reason, a second dialog in the same page, a mesh after the dialogs unchanged; no console error); `--shots DIR` keeps screenshots |
| `ledger.py` | coverage ledger keyed by IDA address -> `docs/LEDGER.md` (rules in `docs/ledger.tsv`, `docs/ledger-classes.tsv`) |
| `index_decomp.py`, `komlib.py`, `kom_extract.py`, `luadecrypt.py`, `census.ts` | reverse-engineering helpers (function index, extraction, census) |

## Reproducing the verification from a clean checkout

```sh
# npm cannot read the `workspace:` specs of this repo, so bun is bootstrapped into a scratch prefix and does the real install
npm install --no-audit --no-fund --prefix /home/user/work/boot bun@1.4.4 && /home/user/work/boot/node_modules/.bin/bun install   # bun, typescript, fflate, webgpu + the @els/* workspace links
./tools/setup-gpu.sh                          # software Vulkan (SwiftShader) for the d3d9 tests -> /home/user/work/swsh (run code through ./tools/gpu.sh)
python3 tools/index_decomp.py data/x2.exe.c /home/user/work/analysis/functions.tsv   # function index (needed by tools/ledger.py)
./tools/setup-oracle.sh                       # LuaJIT 2.0.2 oracle -> /home/user/work/luajit-2.0
./node_modules/.bin/bun run tools/verify-kom.ts
python3 tools/kom_extract.py /home/user/work/ex lua,LUA
ls /home/user/work/ex | sort > /home/user/work/lualist.txt
LUA_PATH=/home/user/work/luajit-2.0/src/?.lua /home/user/work/luajit-2.0/src/luajit tools/lua/native_dump_bc.lua \
  /home/user/work/ex /home/user/work/lualist.txt > /home/user/work/native_bc.txt
./node_modules/.bin/bun run tools/verify-lua-bytecode.ts /home/user/work/native_bc.txt
./tools/lua-difftest.sh                       # 15 differential tests (t10-t14 are fuzzers, t15 the chunk loader)
./tools/corpus-diff.sh 1 && ./tools/corpus-diff.sh 2 && ./tools/corpus-diff.sh 3    # stub-environment corpus, 3 flavors
python3 tools/index_decomp.py data/x2.exe.c /home/user/work/analysis/functions.tsv
./node_modules/.bin/bun run tools/api-census.ts --md docs/SCRIPT_API_USAGE.md --json /home/user/work/analysis/api_census.json --usage /home/user/work/analysis/member_usage.json
./node_modules/.bin/bun run tools/script-graph.ts --md docs/SCRIPT_GRAPH.md
python3 tools/bindings.py && python3 tools/ledger.py                                # docs/HOST_API.md, docs/LEDGER.md
ELS_GPU_NATIVE=1 ./tools/test-packages.sh                                           # without the software GPU the d3d9 / engine / dialog-picture GPU tests skip themselves (12,847 pass, 176 skip); everything else runs (three bun processes: one does not fit 4 GB)
./tools/setup-gpu.sh                                                                   # software Vulkan for Dawn -> /home/user/work/swsh (about 2 s)
./tools/test-packages.sh                                                              # everything: 13,023 tests (777 + 12,209 + 37: the first two processes are d3d9 / engine / assets / kom / lua and host + ui, the third is packages/ui/test-gpu), incl. the 160 d3d9 tests on Dawn + SwiftShader
./node_modules/.bin/bun run tools/verify-freetype.ts --layers calc,face,chars,unhinted,hinted,render,render-unhinted,raster,embolden,synth --char-max 196607   # the port against the exe's FreeType on Unicorn (15 min; pip install --target /home/user/work/pycap unicorn pefile capstone)
python3 tools/mutate-freetype.py                                                       # 376 mutants of packages/freetype/src (22 min)
./node_modules/.bin/bun run tools/gen-d3d9-enums.ts --check                            # enums.generated.ts is current
./node_modules/.bin/bun run tools/census-xscene.ts                                     # integrity of all 25,313 X / Y scenes
./tools/gpu.sh ./node_modules/.bin/bun run tools/census-skin.ts                        # hierarchy loader + skin conversion + animation over all 7,395 skinned files, ~3 min
./tools/gpu.sh ./node_modules/.bin/bun run tools/render-demo.ts /home/user/work/out --docs   # the picture in docs/img
./node_modules/.bin/bun run tools/decode-images.ts --tsv /home/user/work/analysis/images_ts.tsv --dump /home/user/work/analysis/rgba_dump --every 40
python3 -m venv /home/user/work/venv && /home/user/work/venv/bin/pip install pillow
/home/user/work/venv/bin/python tools/verify-images.py /home/user/work/analysis/images_ts.tsv /home/user/work/analysis/rgba_dump
./node_modules/.bin/bun run tools/verify-xet-tet.ts
./node_modules/.bin/bun run tools/verify-xfiles.ts --crosscheck       # MSZIP container, ~105 s
./node_modules/.bin/bun run tools/verify-xparse.ts                    # generic X reader on 25,313 files, ~100 s
./node_modules/.bin/bun run tools/verify-ksm.ts                       # KME / KSM / KAC, ~45 s
./tools/gpu.sh ./node_modules/.bin/bun run tools/verify-ksm-load.ts   # all 1,031 KSM through the engine loader, ~90 s
./tools/gpu.sh ./node_modules/.bin/bun run tools/verify-xmesh-load.ts --x 50   # 109 KME + every 50th X / Y file through loadXMesh, ~45 s
pip install --target /home/user/work/pycap unicorn pefile capstone                      # CPU emulator + PE / disassembler libraries (ELS_PYLIBS overrides the directory)
./node_modules/.bin/bun run tools/verify-optimizekeys.ts              # OptimizeKeys of the exe (emulated) vs the port, bit for bit: 3,000 synthetic cases + every 400th shipped animation, ~1 min
python3 tools/mutate-optimizekeys.py                                  # 22 mutants of kac-keys.ts against the unit tests (4 survivors are expected: equivalent or unreachable, FINDINGS 16.3), ~1 s
./node_modules/.bin/bun run tools/verify-ess.ts                       # string table
./node_modules/.bin/bun run tools/verify-kim.ts                       # item database, ~2 s
./node_modules/.bin/bun run tools/ui-census.ts --md docs/UI_COVERAGE.md    # 1,024 DLG scripts: 992 run on the stubs, all 992 fully ported and strict-clean, all 992 only with classes that draw, ~21 s
python3 tools/mutate-ui.py                                            # 100 mutants of packages/ui/src against widgets.test.ts: 98 killed, 2 equivalent survivors, ~5 min (`--list`, name substrings)
python3 tools/mutate-framemove.py                                      # 443 mutants of the frame update against framemove.test.ts: 437 killed, 6 equivalent survivors, ~6 min (`--list`, `--check`, name substrings)
python3 tools/mutate-draw.py                                          # 967 mutants of the drawing (925 of packages/ui/src, 42 of the CPU reference): 951 killed, 16 equivalent survivors, ~25 min (`--list`, name substrings)
python3 tools/mutate-movie.py --shard=K/2   # 1,085 mutants of the movie playback, the render target texture and the video texture: 1,072 killed, 13 equivalent survivors, each with its reason (K = 0 and 1, each shard in its own copy of the tree, since a run rewrites the source; with the two side by side on two CPUs each took ~48 min); the other checks of the units after the input have the same options: mutate-guide.py, mutate-devicelost.py, mutate-destroy.py, mutate-input.py, mutate-unibuf.py, mutate-edits.py, mutate-ime.py, mutate-edit.py, mutate-manager.py (the counts: the tool table above)\npython3 tools/mutate-managerdraw.py && python3 tools/mutate-prefetch.py   # 19 hand-made mutants of the manager's frame against the picture test (SwiftShader), 76 mutants of prefetch.ts: all killed\npython3 tools/mutate-font.py                                           # 955 mutants of the text path (glyph font, pages, font manager, text queue): 906 killed, 49 equivalent survivors with a reason each (`--list`, `--check`, `--survivors=LOG`, name substrings)
./tools/gpu.sh ./node_modules/.bin/bun run tools/ui-draw.ts --md docs/UI_DRAW.md --tsv docs/ui-draw.tsv   # draw census: 1,024 DLG scripts, one frame each, drawn through the whole stack and compared with the CPU reference, ~4 min, ~1 GB
./node_modules/.bin/bun run tools/verify-effects.ts                   # particle / XMeshPlayer scripts, ~4 s
pip install --target /home/user/work/pyav av numpy                                      # FFmpeg (libavcodec) bundled in the `av` wheel: the MPEG-1 oracle
PYTHONPATH=/home/user/work/pyav python3 tools/oracle-mpeg1.py --out /home/user/work/mpeg1_oracle.json data/movie/*.avi
./node_modules/.bin/bun run tools/verify-mpeg1.ts --hashes /home/user/work/mpeg1_oracle.json   # 30 movies, 18,514 pictures, ~22 s
./tools/setup-browser.sh                                                              # puppeteer-core + headless Chromium with WebGPU (SwiftShader), ~1 min (tools/browser.mjs runs it when missing)
./node_modules/.bin/bun run tools/browser-test.ts --shots /home/user/work/shots       # 30 checks of apps/client + apps/server in the browser (the dialogs of the client among them), ~21–32 s
./node_modules/.bin/bun run apps/server/src/main.ts --port 8080                       # the asset viewer on http://localhost:8080/ (needs a WebGPU browser for the mesh previews)
```
