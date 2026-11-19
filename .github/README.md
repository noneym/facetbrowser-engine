# FacetBrowser Engine

The Chromium build that [FacetBrowser](https://facetbrowser.com) launches its
profiles with: [ungoogled-chromium](https://github.com/ungoogled-software/ungoogled-chromium)
plus a set of patches that apply a per-profile fingerprint inside the engine
(C++), so nothing has to be injected into pages.

The fingerprint patches come from
[fingerprint-chromium](https://github.com/adryfish/fingerprint-chromium)
(BSD-3-Clause), whose last published source is for Chromium 148. This
repository carries them forward to current Chromium and fixes bugs in them.

> **Status: Chromium 157.0.8103.50 with the ported series is released for
> Windows x64, Linux x64 and macOS arm64.** The packages are on the
> [releases page](https://github.com/noneym/facetbrowser-engine/releases):
> Windows in `facet-157.0.8103.50-2`, Linux and macOS in
> `facet-157.0.8103.50-3`. The Windows build passes the checks in [What is verified](#what-is-verified).
> FacetBrowser downloads the Windows package; on macOS it still downloads the
> upstream 148 engine. `baseline-148` reproduces the behaviour of that 148
> engine.

## Branches

| Branch | Chromium | Contents |
|---|---|---|
| `main` | 157.0.8103.50 | ungoogled-chromium `157.0.8103.50-1` + the fingerprint patches ported to 157 + our fixes |
| `baseline-148` | 148.0.7778.215 | ungoogled-chromium `148.0.7778.215-1` + the fingerprint patches exactly as published upstream. Tree-identical to fingerprint-chromium's `148.0.7778.215` tag. The reference point: it should build the engine FacetBrowser ships today. |

`upstream` (ungoogled-chromium) is merged in at each Chromium release tag.
Root-level files such as `README.md` are upstream's and are left untouched so
those merges stay clean; this file lives in `.github/` for the same reason.

## What is added to ungoogled-chromium

- `patches/extra/fingerprint/` — 18 patches: user agent and client hints,
  platform, hardware concurrency and device memory, fonts, WebGL vendor /
  renderer / parameters, canvas, WebGL and audio readback noise, client rects,
  timezone, `navigator.webdriver`, headless UA, closed shadow root access,
  and `Runtime.enable` hiding.
- `patches/extra/facet/` — fixes on top (see below).
- `facet/port_workbench.py` — the tool used to move the patches to a new
  Chromium version.
- `devutils/validate_patches.py` — repaired remote mode (see its commits).

### Changes made while porting 148 → 157

- 9 of the 18 patches had rejected hunks and were ported by hand; the other
  9 applied with line offsets only.
- `ShuffleSubchannelColorData()` lost its `srcX, srcY` parameters in
  ungoogled-chromium 157; all four call sites were adapted.
- `OfflineAudioContext` no longer passes the frame count to its destination
  node; the sample-rate noise was moved to the new constructor.
- `V8RuntimeAgentImpl::addBindings()` gained context liveness checks; the
  disabled body was updated to match.
- Every use of the fingerprint switches inside Blink is spelled
  `::switches::kFingerprint…`. In `namespace blink` a bare `switches::`
  resolves to `blink::switches` wherever Blink's own switches header is
  visible, which is now the case in `timezone_controller.cc`.
- The Chrome and Edge version lists in `components/ungoogled/fingerprint_data.h`
  were updated to real 157 releases.

Found by the first compile and link:

- `LayoutObject::Style()` returns `const ComputedStyle&` instead of a
  pointer (`014-client-rects`).
- `partition_alloc::MaxDirectMapped()` is now `MaxAllocationSize()` in
  `partition_alloc/partition_alloc_public_constants.h`, which has to be
  included explicitly (`013-canvas-toDataURL`).
- `third_party/blink/common` reads the fingerprint switches in
  `user_agent_metadata.cc` without depending on
  `//components/ungoogled:ungoogled_switches`. `chrome.dll` gets the symbols
  through other targets; `chromedriver.exe` does not and failed to link. The
  dependency is now declared (`002-user-agent-fingerprint`).

### Fixes (`patches/extra/facet/`)

| Patch | Problem in upstream |
|---|---|
| `001-measure-text-noise-is-a-factor` | `measureText()` returned near-zero metrics with `--fingerprint`: the noise was passed to a function that multiplies by it, as an offset of about 0.000005 instead of a factor around 1. |
| `002-webgl-readpixels-noise-only-for-rgba8` | `readPixels()` noise treated every format as 4 bytes per pixel. With `RGB`, the packed 16-bit types or float types it wrote past the end of the caller's buffer (page-triggerable heap out-of-bounds write in the renderer). Noise is now applied to `RGBA` / `UNSIGNED_BYTE` only. |

## What is verified

Windows x64, Chromium 157.0.8103.50, engine commit `ca924222`, built by
[run 43538885643](https://github.com/noneym/facetbrowser-engine-windows/actions/runs/43538885643)
(`ungoogled-chromium_157.0.8103.50-1.1_windows_x64.zip`, SHA-256
`a322cabd612032bf02515ea788ee591499b75fca5d54918903db27b48cfa0d43`). "148"
below is the engine FacetBrowser ships today
(`ungoogled-chromium_148.0.7778.215-1.1_windows_x64.zip` from
fingerprint-chromium), measured on the same machine with
`facet/fingerprint_probe.mjs`.

| Check | Result |
|---|---|
| `baseline-148` equals upstream's published 148 tree | Yes, same git tree hash |
| All 128 patches on `main` apply to pristine Chromium 157.0.8103.50 (`validate_patches.py`) | Pass |
| Validator rejects an unported patch (negative control) | Fails as expected |
| `main` compiles and links (`chrome`, `chromedriver`, `mini_installer`) | Pass |
| Starts with `--fingerprint=<seed> --fingerprint-platform=windows --fingerprint-brand=Chrome` | Pass. UA and client hints report Google Chrome 157, `navigator.webdriver` is `false` |
| Same seed twice gives the same fingerprint | Pass, 161 of 161 probe values equal |
| A different seed changes canvas, WebGL, audio, client rects, fonts, `measureText`, hardware concurrency, device memory and GPU | Pass, 42 values differ, the rest are equal |
| Same seed on 148 and 157 | Canvas (`toDataURL`, `toBlob`, `getImageData`), WebGL `RGBA8` readback, client rects, fonts, GPU strings and WebGL parameters are identical. The differences are listed under this table |
| `001-measure-text-noise-is-a-factor` | Pass. Width of the probe's test string in 16px Arial: 410.03 (0.0019 on 148) |
| `002-webgl-readpixels-noise-only-for-rgba8` | Pass. Bytes written past the end of an `R8` read: 0 (13 on 148). `RGB565`, `R8` and `RGBA32F` reads are returned unmodified |
| Canvas readback stability | No renderer crash in 200 rounds of the probe's readback stress loop, with and without the switches; the source canvas is unchanged afterwards |
| [CreepJS](https://abrahamjuliot.github.io/creepjs/) | 0% headless, 0% stealth, 19% "like headless". Same three numbers as 148 |
| [BrowserScan](https://www.browserscan.net/) | Fingerprint authenticity 100%, bot detection "No" |
| [Pixelscan](https://pixelscan.net/fingerprint-check) | "Masking detected", "No automated behavior detected". 148 gets the same verdict, so this is inherited, not a regression of the port |
| `baseline-148` builds on the same pipeline ([run 43196114201](https://github.com/noneym/facetbrowser-engine-windows/actions/runs/43196114201), zip SHA-256 `8f94064db4236d2d63fe30e4d160b23e42628b508e7d3b5a5edff264f1d1129b`) | Pass |
| Our `baseline-148` build against the shipped 148 engine | Same behaviour: 161 of 161 probe values equal for seed 1000, for seed 2000 and without `--fingerprint`, including the `measureText` and `readPixels` bugs. Same file list. The binaries are not byte-identical; our `chrome.dll` is 277 MB against 308 MB, so the shipped engine was built with different settings |
| macOS arm64 package (`facet-157.0.8103.50-3`, engine commit `5df4d870`, [run 44296656521](https://github.com/noneym/facetbrowser-engine-macos/actions/runs/44296656521)) | On a GitHub macOS arm64 runner: starts as signed in the disk image (ad hoc), the same seed gives the same values, a different seed changes 38 of 176, `measureText` in 16px Arial is 410.03, a window and headless differ only in screen and window sizes. The switches of `003` to `006`, SOCKS5 authentication, the detection sites and a real Mac have not been tried. Not notarized, so Gatekeeper rejects it. The older disk image in `facet-157.0.8103.50-1` has the same file name and was built before `003` |
| Linux x64 package (`facet-157.0.8103.50-3`, engine commit `5df4d870`, [run 44299016991](https://github.com/noneym/facetbrowser-engine-linux/actions/runs/44299016991)) | Headless in a Debian bookworm container: no missing library, the same seed gives the same values, a different seed changes 35 of 176, `measureText` in 16px Arial is 410.03, the brand defaults to Google Chrome 157, and a page driven by the bundled `chromedriver` finds no `cdc_` property on `window`. The switches of `003` to `006` and `facet/socks5_auth_test.mjs` pass in the same image, with the `Intl` exception noted under the switch table. A visible window, the sandbox and the detection sites have not been run on Linux |

Differences between 148 and 157 for the same seed, other than the version
strings:

- `measureText()` and the non-`RGBA8` `readPixels()` formats: the two fixes.
- Audio: the rendered samples differ slightly (sum 124.040574 against
  124.040578). They differ the same way without `--fingerprint`, so this is a
  change in Chromium, not in the noise.
- `screen.colorDepth` is 24 on 157 and 32 on 148 on the same display, also
  without `--fingerprint`. Not caused by the fingerprint patches.
- `navigator.userAgentData.brands` uses Chromium 157's GREASE brand and
  ordering (`Not-A.Brand`).

Not covered by these checks: `--fingerprint-platform=linux|macos`, the Edge,
Opera and Vivaldi brands, `--timezone`, `--disable-spoofing`, and profiles
launched by FacetBrowser itself. The site results are a single visit each
from one machine.

Known behaviour inherited from upstream, not changed here:

- `001-disable-runtime.enable` turns off console message delivery and
  `Runtime.addBinding` for every DevTools client, not only for detection
  scripts. Automation that relies on live `console` events has to poll.
- `ImageDataBuffer::EncodeImage()` adds noise in place, which can write into
  pixel memory owned by the source image. Upstream 150 has open crash reports
  in this area. The stress loop above did not reproduce a crash; it is still
  the first suspect if readback crashes.
- The device scale factor switch is declared but nothing reads it. Screen
  size is handled by `004-screen-size-and-work-area`, from
  `facet-157.0.8103.50-2` on.
- `chromedriver.exe` is in the Windows zip from `facet-157.0.8103.50-2` on.
  It is the stock one there and leaves `cdc_` properties on `window`. The
  Linux package of `facet-157.0.8103.50-3` is built with
  `007-chromedriver-no-window-properties` and does not.

## Command line switches

| Switch | Meaning |
|---|---|
| `--fingerprint=<int>` | Seed. Enables the fingerprint features; canvas, WebGL, audio, font and client-rect noise are derived from it. |
| `--fingerprint-platform=windows\|linux\|macos` | Reported operating system (UA, `navigator.platform`, client hints, font list). |
| `--fingerprint-platform-version=<v>` | Client-hints platform version; seed-derived if absent. |
| `--fingerprint-brand=Chrome\|Edge\|Opera\|Vivaldi` | Browser brand in UA and client hints; Chromium if absent. |
| `--fingerprint-brand-version=<v>` | Version for that brand. |
| `--fingerprint-hardware-concurrency=<n>` | `navigator.hardwareConcurrency`; seed-derived if absent. |
| `--timezone=<IANA id>` | Timezone for JavaScript and ICU. |
| `--disable-spoofing=<list>` | Comma-separated features to leave real: `canvas`, `gpu`, `audio`, `clientrects`, `font`. |
| `--lang`, `--accept-lang` | Standard Chromium language switches. |

Added in the Windows release `facet-157.0.8103.50-2`
(`patches/extra/facet/003` to `006`). They pass the probe and
`facet/socks5_auth_test.mjs` in headless mode on Windows and, in the Linux
release `facet-157.0.8103.50-3`, in a Debian bookworm container. The macOS
package of `-3` is built with them but they have not been run there. The
`-1` release (Windows and macOS) does not have them:

| Switch | Meaning |
|---|---|
| `--fingerprint-brand` absent | Defaults to `Chrome` when `--fingerprint` is given. |
| `--fingerprint-timezone=<IANA id>` | Another name for `--timezone`. |
| `--fingerprint-locale=<tag>[,<tag>...]` | Sets `--lang` to the first tag and `--accept-lang` to the list. A single tag such as `tr-TR` becomes `tr-TR,tr,en-US,en`. Explicit `--lang` and `--accept-lang` win. |
| `--fingerprint-screen-width=<px>`, `--fingerprint-screen-height=<px>` | Screen size that pages see (`screen.*`, `device-width` media queries). |
| `--fingerprint-taskbar-height=<px>` | Bottom inset of the work area. Without it the real insets are kept, and a spoofed platform gets its usual ones: 48 for Windows, a 25 menu bar and a 70 Dock for macOS, none for Linux. |
| `--fingerprint-device-memory=2\|4\|8\|16\|32` | `navigator.deviceMemory`; seed-derived if absent. |
| `--proxy-server=socks5://user:pass@host:port` | SOCKS5 username/password authentication. Percent-encode the credentials. |

On Linux, `--fingerprint-locale` and `--lang` set `navigator.languages` and
`Accept-Language` but not the default locale of `Intl`, which stays `en-US`:
Chromium takes its interface language from the environment there. Start the
browser with `LANGUAGE` set as well, for example `LANGUAGE=tr`. Headless on
Linux reports an 800x600 screen unless the screen switches are given.

What is still missing compared with other stealth builds, and the order it
is being worked on, is in [`facet/ROADMAP.md`](../facet/ROADMAP.md).

## Working on the patches

Check that the series applies (downloads only the files the patches touch,
about 700, from the Chromium mirror on GitHub and from googlesource.com):

```sh
python devutils/validate_patches.py -r
```

Move to a new Chromium version:

1. `git fetch upstream --tags && git merge <new ungoogled-chromium tag>`
2. `python devutils/validate_patches.py -c ../cache` (download the sources)
3. `python facet/port_workbench.py init ../cache ../work`, then `apply` /
   fix rejects / `commit` for each patch under `extra/fingerprint/` and
   `extra/facet/`, in series order. See the docstring in the script.
4. Update the version lists in `components/ungoogled/fingerprint_data.h`
   (inside `002-user-agent-fingerprint.patch`) to current Chrome and Edge
   releases.
5. `python devutils/validate_patches.py -l ../cache`

## Building

Windows x64 is built by
[noneym/facetbrowser-engine-windows](https://github.com/noneym/facetbrowser-engine-windows),
a fork of ungoogled-chromium-windows that uses this repository as its
submodule. Its `main` branch pins `main` here, its `baseline-148` branch pins
`baseline-148`.

```sh
gh workflow run build-x64.yml -R noneym/facetbrowser-engine-windows --ref main
```

The output is the `chromium` artifact of the run (zip and installer, kept for
30 days). On GitHub's free runners a build from scratch is a chain of up to
16 jobs of about 4.5 hours each; both branches needed 9 of them.

Two additions to the fork keep a failed build from costing days:

- **Preflight.** Before the full build, `build.py` compiles only the files
  that `patches/extra/fingerprint/` and `patches/extra/facet/` touch. A
  compile error in a ported patch shows up in the first hour. It does not
  catch link errors.
- **Resume.** `-f resume_run_id=<run id>` starts from the source tree an
  earlier run uploaded instead of from scratch (the tree is kept for 4 days).
  Patch changes made since that run have to be added to the fork's `hotfix/`
  directory, see `hotfix/README.md` there. The `chromedriver` link fix was
  built this way in 1.5 hours.

Releases are made by hand from that artifact, after testing it:

```sh
gh release create facet-<ungoogled tag> <zip> -R noneym/facetbrowser-engine --target <engine commit the zip was built from>
```

Tags carry the `facet-` prefix so they never collide with ungoogled-chromium's
own tags, which are fetched from `upstream` but not pushed here.

macOS arm64 and Linux x64 are built the same way, by
[noneym/facetbrowser-engine-macos](https://github.com/noneym/facetbrowser-engine-macos)
and
[noneym/facetbrowser-engine-linux](https://github.com/noneym/facetbrowser-engine-linux),
forks of ungoogled-chromium-macos and ungoogled-chromium-portablelinux with
this repository as their submodule. The Linux run also tests the package in a
Debian bookworm container and uploads the results as `test-results`.

## License and credits

BSD-3-Clause, see [LICENSE](../LICENSE).

- [ungoogled-chromium](https://github.com/ungoogled-software/ungoogled-chromium) and its contributors — the base.
- [fingerprint-chromium](https://github.com/adryfish/fingerprint-chromium) by adryfish — the fingerprint patches.
- Bromite, Iridium, Inox and Debian — patches carried by ungoogled-chromium.
