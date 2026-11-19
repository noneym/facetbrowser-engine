# Capability roadmap

What this engine does, what it does not do yet, and in which order the gaps
are being closed. The list of gaps comes from comparing the engine with the
public documentation of other stealth Chromium builds, mainly CloakBrowser
(README, changelog and the MIT-licensed wrapper), and from public research on
bot detection.

Rules for this work:

- The reference for correct behaviour is real Google Chrome on a real
  machine, measured with `facet/fingerprint_probe.mjs`. Detection systems
  compare a browser with real Chrome, so that is what a patch has to match.
- Other vendors' binaries are not downloaded, run, inspected or
  disassembled, and their output values are not copied. Their documentation
  tells us which behaviours matter; every implementation here is written
  from the Chromium source.
- A capability counts as done when it is compiled, covered by the probe and
  checked on the detection sites listed in `.github/README.md`. Until then
  it is listed as "patch written".

Status values: **have** (in a released build), **have, Windows and Linux**
(in the Windows release `facet-157.0.8103.50-2` and the Linux release
`facet-157.0.8103.50-3`, checked with `facet/fingerprint_probe.mjs` or
`facet/socks5_auth_test.mjs` in headless mode, on Linux in a Debian bookworm
container; the macOS package of `-3` is built with it but it has not been
run there), **have, Linux** (in the Linux release `facet-157.0.8103.50-3`,
checked headless in a Debian bookworm container; not in the Windows package,
and the macOS disk image has no `chromedriver`), **patch written** (on
`main`, applies to Chromium 157, not built yet), **planned**, **research** (the behaviour is known only from a one-line
description, the design is open), **not planned**.

## Identity

| Capability | Status | Notes |
|---|---|---|
| Seed for canvas, WebGL, audio, fonts, client rects | have | `--fingerprint=<int>` |
| Reported platform, platform version, brand, brand version | have | |
| Brand defaults to Chrome for a seeded profile | have, Windows and Linux | `003-normalise-fingerprint-switches` |
| `--fingerprint-timezone`, `--fingerprint-locale` | have, Windows and Linux | `003`. The `Accept-Language` header follows too. Aliases for `--timezone` and for `--lang` plus `--accept-lang`; a single locale tag is expanded to the list a localized Chrome uses |
| Default locale of `Intl` follows `--fingerprint-locale` on Linux | planned | Today it stays `en-US` there while `navigator.language` changes, because Chromium takes its interface language from the environment on Linux. Until then start the browser with `LANGUAGE=<language>` as well |
| `--fingerprint-device-memory` | have, Windows and Linux | `006-device-memory-switch` |
| `--fingerprint-hardware-concurrency` | have | |
| Hardware drawn as one coherent set (GPU, cores, memory, screen) from common real devices | planned | Today cores are `((seed % 13) + 4) * 2`, which yields rare counts such as 26. Changing the mapping changes what an existing seed looks like, so it needs a versioned scheme (`--fingerprint-scheme=2`) |
| `--fingerprint-gpu-vendor` | planned | Part of the coherent hardware work |
| Random seed when none is given | planned | Small. FacetBrowser always passes a seed |
| Switch off noise but keep the seed | have | `--disable-spoofing=canvas,audio,...` |
| `--fingerprint-max-touch-points` | planned | Small |
| Speech synthesis voice list that matches the reported platform | planned | Matters when the host is Linux and the persona is Windows |

## Screen, window, storage

| Capability | Status | Notes |
|---|---|---|
| `--fingerprint-screen-width`, `--fingerprint-screen-height` | have, Windows and Linux | `004-screen-size-and-work-area`. Applied where the browser builds `ScreenInfo`, so `screen.*` and the `device-width` media queries agree |
| Work area with a taskbar, menu bar or Dock for the reported platform; `--fingerprint-taskbar-height` | have, Windows and Linux | `004`. Checked for a Windows and a macOS persona on a Windows and on a Linux host. Also fixes `screen.availHeight == screen.height` on headless screens |
| Window frame size in headless (`outerHeight` larger than `innerHeight`), window position | planned | Headless on Windows already reports a frame (outer 1100x800, inner 1084x705 in the probe). Headless on Linux reports one in height only (outer 1100x800, inner 1100x713) and an 800x600 screen unless the screen switches are given; until then run headed under Xvfb there |
| Storage quota like a regular profile (`storage.estimate()`, storage buckets) | planned | Closes the storage-based incognito checks |

## Fonts

| Capability | Status | Notes |
|---|---|---|
| Font list for the reported platform | have | Upstream patch `006-font-fingerprint` |
| Text metrics of the reported platform | planned | Needs the real fonts of that platform installed on the host. The engine will not bundle fonts |
| Document which fonts a Linux host needs for a Windows persona | planned | Deployment note for the Linux package |

## Automation signals

| Capability | Status | Notes |
|---|---|---|
| `navigator.webdriver` false, no `HeadlessChrome` in the UA, closed shadow root access | have | Upstream patches `009`, `010`, `007` |
| `Runtime.enable` side effects hidden | have, crude | `001-disable-runtime.enable` also removes console events and `Runtime.addBinding` for every client. Planned: hide only the observable side effect and keep console delivery |
| Screen coordinates of mouse events sent through DevTools | have | Chromium 157 already converts widget to screen coordinates (`ConvertWidgetPointToScreenPoint` in `input_handler.cc`); checked in the source, not yet in the probe |
| Other properties of DevTools input events (movement deltas, pointer ids, timestamps) | research | Needs a probe page that records trusted input from a real user and from DevTools |
| No warning bar for `--no-sandbox` | planned | Small. The bar changes the viewport height |
| No `cdc_` properties on `window` in a `chromedriver` session | have, Linux | `007-chromedriver-no-window-properties`. The Linux 148 test found 7 of them in a page driven by stock `chromedriver`; the Linux 157 package leaves none, and its `chromedriver` binary has no `cdc_` string. The patch stops saving them and stops reading them, so a page cannot find them or trap a read. Cost: `chromedriver` no longer survives a page that replaces `Array`, `Promise` or `JSON` |

## Graphics and media

| Capability | Status | Notes |
|---|---|---|
| WebGL vendor, renderer and parameters from the seed | have | Upstream patches `011`, `020` |
| Real GPU values on a Windows host | have | `--disable-spoofing=gpu` |
| WebGPU adapter info, features and limits that match the WebGL identity | planned | Today WebGPU reports the real adapter, or none in a container |
| Offline audio rendering consistency | have | Upstream patch `003` |

## Network and proxy

| Capability | Status | Notes |
|---|---|---|
| SOCKS5 username/password (RFC 1929) | have, Windows and Linux | `005-socks5-username-password-auth`. Good, wrong and missing credentials checked against a local proxy. `--proxy-server=socks5://user:pass@host:port`, credentials percent-encoded |
| QUIC through SOCKS5 (UDP ASSOCIATE) | not planned | Large; HTTP/2 over the TCP tunnel is what Chrome uses behind most SOCKS proxies anyway |
| HTTP proxy credentials in `--proxy-server` | planned | Today the embedder answers the 407 through DevTools, which works but is visible as extra DevTools traffic |
| WebRTC candidates show the proxy exit address | planned | Until then use `--webrtc-ip-handling-policy=disable_non_proxied_udp`, which hides the real address but leaves no public candidate |
| Proxy timing and header signals | research | Described elsewhere only as "DNS/connect/SSL timing zeroed, proxy headers stripped". First step is to measure what a page can observe through Resource Timing behind a proxy |
| "Transparent proxy" connection mode | not planned | No public description of what it does |
| TLS and HTTP/2 fingerprint | have | Unchanged Chromium network stack. To be confirmed with a JA4 check in the probe |

## Outside the engine

These belong to FacetBrowser or to a deployment, not to the Chromium build:

- Timezone and locale from the proxy exit address.
- Human-like mouse paths, typing and scrolling for the Automation API and
  the MCP tools.
- Keeping one seed per profile.
- Real fonts of the reported platform on Linux hosts.

## Platforms

| Platform | Status |
|---|---|
| Windows x64 | have (157 with the patches up to `006`, and the 148 baseline) |
| macOS arm64 | have (157 with the patches up to `007`, `facet-157.0.8103.50-3`, tested on the build runner only, the new switches not run; not notarized); 148 baseline package built and tested the same way, not released |
| Linux x64 (glibc, with `chromedriver`) | have (157 with the patches up to `007`, `facet-157.0.8103.50-3`, tested headless on Debian bookworm only); 148 baseline package built and tested the same way, not released |

## Order of work

1. Rebuild the Windows package with `007`. Run the switches of `003` to
   `006` and the SOCKS5 test on the macOS package.
2. Test the Linux package headed under Xvfb with a Windows persona and on
   the detection sites.
3. `Intl` locale on Linux, headless window frame, storage quota, WebRTC exit
   address.
4. Coherent hardware scheme, WebGPU.
5. Scope the `Runtime.enable` change; DevTools input research.
