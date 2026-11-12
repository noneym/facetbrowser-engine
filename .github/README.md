# FacetBrowser Engine

The Chromium build that [FacetBrowser](https://facetbrowser.com) launches its
profiles with: [ungoogled-chromium](https://github.com/ungoogled-software/ungoogled-chromium)
plus a set of patches that apply a per-profile fingerprint inside the engine
(C++), so nothing has to be injected into pages.

The fingerprint patches come from
[fingerprint-chromium](https://github.com/adryfish/fingerprint-chromium)
(BSD-3-Clause), whose last published source is for Chromium 148. This
repository carries them forward to current Chromium and fixes bugs in them.

> **Status: patches ported, not built yet.** The whole series applies cleanly
> to Chromium 157.0.8103.50 sources. Nothing here has been compiled or run so
> far, and there are no binaries to download. See [What is verified](#what-is-verified).

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

### Fixes (`patches/extra/facet/`)

| Patch | Problem in upstream |
|---|---|
| `001-measure-text-noise-is-a-factor` | `measureText()` returned near-zero metrics with `--fingerprint`: the noise was passed to a function that multiplies by it, as an offset of about 0.000005 instead of a factor around 1. |
| `002-webgl-readpixels-noise-only-for-rgba8` | `readPixels()` noise treated every format as 4 bytes per pixel. With `RGB`, the packed 16-bit types or float types it wrote past the end of the caller's buffer (page-triggerable heap out-of-bounds write in the renderer). Noise is now applied to `RGBA` / `UNSIGNED_BYTE` only. |

## What is verified

| Check | Result |
|---|---|
| `baseline-148` equals upstream's published 148 tree | Yes, same git tree hash |
| All 128 patches on `main` apply to pristine Chromium 157.0.8103.50 (`validate_patches.py`) | Pass |
| Validator rejects an unported patch (negative control) | Fails as expected |
| Compiles | **Not tried** |
| Fingerprint behaviour (CreepJS, BrowserScan, Pixelscan) | **Not tested** |
| Windows x64 / macOS arm64 packages | **Not built** |

Things to watch at the first compile, because the surrounding Chromium code
could only be read, not built:

- `Element::ShouldSkipClientRectsOffset()` uses `ComputedStyle::Top()` /
  `Left()` as `const Length&`; the inset accessors may have changed type.
- `HTMLCanvasElement::ToDataURLInternal()` relies on a transitive include
  for `partition_alloc::MaxDirectMapped()`.
- `components/embedder_support` and several Blink targets include
  `components/ungoogled/ungoogled_switches.h` without a GN dependency, as
  upstream did.

Known behaviour inherited from upstream, not changed here:

- `001-disable-runtime.enable` turns off console message delivery and
  `Runtime.addBinding` for every DevTools client, not only for detection
  scripts. Automation that relies on live `console` events has to poll.
- `ImageDataBuffer::EncodeImage()` adds noise in place, which can write into
  pixel memory owned by the source image. Upstream 150 has open crash reports
  in this area; treat it as the first suspect if readback crashes.
- Screen size, device scale factor and colour depth switches are declared
  but nothing reads them.

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

Not set up yet. The plan follows ungoogled-chromium: its
[Windows](https://github.com/ungoogled-software/ungoogled-chromium-windows)
and [macOS](https://github.com/ungoogled-software/ungoogled-chromium-macos)
packaging repositories use the main repository as a submodule, so forks of
those pointing at this repository produce the installers. First target is
`baseline-148`, to confirm the pipeline reproduces the current engine, then
`main`.

## License and credits

BSD-3-Clause, see [LICENSE](../LICENSE).

- [ungoogled-chromium](https://github.com/ungoogled-software/ungoogled-chromium) and its contributors — the base.
- [fingerprint-chromium](https://github.com/adryfish/fingerprint-chromium) by adryfish — the fingerprint patches.
- Bromite, Iridium, Inox and Debian — patches carried by ungoogled-chromium.
