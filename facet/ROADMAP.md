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

Status values: **have** (in a released build), **patch written** (on the
`cloak-parity` branch, applies to Chromium 157, not compiled yet),
**planned**, **research** (the behaviour is known only from a one-line
description, the design is open), **not planned**.

## Identity

| Capability | Status | Notes |
|---|---|---|
| Seed for canvas, WebGL, audio, fonts, client rects | have | `--fingerprint=<int>` |
| Reported platform, platform version, brand, brand version | have | |
| Brand defaults to Chrome for a seeded profile | patch written | `003-normalise-fingerprint-switches` |
| `--fingerprint-timezone`, `--fingerprint-locale` | patch written | `003`. Aliases for `--timezone` and for `--lang` plus `--accept-lang`; a single locale tag is expanded to the list a localized Chrome uses |
| `--fingerprint-device-memory` | patch written | `006-device-memory-switch` |
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
| `--fingerprint-screen-width`, `--fingerprint-screen-height` | patch written | `004-screen-size-and-work-area`. Applied where the browser builds `ScreenInfo`, so `screen.*` and the `device-width` media queries agree |
| Work area with a taskbar, menu bar or Dock for the reported platform; `--fingerprint-taskbar-height` | patch written | `004`. Also fixes `screen.availHeight == screen.height` on headless screens |
| Window frame size in headless (`outerHeight` larger than `innerHeight`), window position | planned | The largest remaining headless tell. Until then run headed under Xvfb on Linux |
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
| SOCKS5 username/password (RFC 1929) | patch written | `005-socks5-username-password-auth`. `--proxy-server=socks5://user:pass@host:port`, credentials percent-encoded |
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
| Windows x64 | have (157 and the 148 baseline) |
| macOS arm64 | 148 baseline building; 157 waits for upstream's macOS packaging |
| Linux x64 (glibc, with `chromedriver`) | started |

## Order of work

1. Compile and test the four patches on `cloak-parity`, then merge.
2. Linux x64 package, tested headless and headed under Xvfb with a Windows
   persona.
3. Headless window frame, storage quota, WebRTC exit address.
4. Coherent hardware scheme, WebGPU.
5. Scope the `Runtime.enable` change; DevTools input research.
