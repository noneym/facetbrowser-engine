#!/usr/bin/env node
// Launch an engine build with the fingerprint switches and record what a page
// can observe: navigator and client hints, timezone, canvas, measureText,
// WebGL, audio, client rects, fonts. Used to compare two builds (or two
// seeds) and to check that readback does not crash the renderer.
//
//   node facet/fingerprint_probe.mjs run --exe <chrome.exe> [--seed 1000]
//        [--platform windows] [--brand Chrome] [--out result.json]
//        [--no-fingerprint] [--no-brand] [--stress 200]
//        [-- <extra chrome switches>]
//   node facet/fingerprint_probe.mjs diff a.json b.json
//   node facet/fingerprint_probe.mjs visit --exe <chrome.exe> --url <url>
//        [--wait 30] [--out page.txt] [--screenshot page.png]
//
// Needs Node 22 or newer (global WebSocket). No dependencies.
//
// The page is served from 127.0.0.1 so that it is a secure context
// (navigator.userAgentData, crypto.subtle). CDP is used without
// Runtime.enable, which the engine disables.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

// ---------------------------------------------------------------- page side

// Runs inside the page. Must be self-contained: it is sent as source text.
async function pageProbe(stressRounds) {
  const out = {}
  const sha = async (data) => {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
  }
  const section = async (name, fn) => {
    try {
      out[name] = await fn()
    } catch (e) {
      out[name] = { error: String(e && e.message ? e.message : e) }
    }
  }

  await section('navigator', async () => ({
    userAgent: navigator.userAgent,
    appVersion: navigator.appVersion,
    platform: navigator.platform,
    vendor: navigator.vendor,
    webdriver: navigator.webdriver,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: navigator.deviceMemory,
    language: navigator.language,
    languages: [...navigator.languages],
    maxTouchPoints: navigator.maxTouchPoints,
    pdfViewerEnabled: navigator.pdfViewerEnabled,
    plugins: navigator.plugins.length
  }))

  await section('userAgentData', async () => {
    const d = navigator.userAgentData
    if (!d) return null
    const high = await d.getHighEntropyValues([
      'architecture', 'bitness', 'model', 'platformVersion', 'uaFullVersion', 'fullVersionList', 'wow64', 'formFactors'
    ])
    return { brands: d.brands, mobile: d.mobile, platform: d.platform, high }
  })

  await section('timezone', async () => ({
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    locale: Intl.DateTimeFormat().resolvedOptions().locale,
    offsetJan: new Date(2026, 0, 15).getTimezoneOffset(),
    offsetJul: new Date(2026, 6, 15).getTimezoneOffset()
  }))

  await section('screen', async () => ({
    width: screen.width, height: screen.height, availWidth: screen.availWidth, availHeight: screen.availHeight,
    colorDepth: screen.colorDepth, pixelDepth: screen.pixelDepth, devicePixelRatio,
    availLeft: screen.availLeft, availTop: screen.availTop,
    // The media queries have to agree with screen.*.
    deviceWidthQuery: matchMedia(`(device-width: ${screen.width}px)`).matches,
    deviceHeightQuery: matchMedia(`(device-height: ${screen.height}px)`).matches,
    outerWidth, outerHeight, innerWidth, innerHeight, screenX, screenY
  }))

  const paint = (canvas) => {
    const c = canvas.getContext('2d')
    c.fillStyle = '#f60'
    c.fillRect(10, 5, 120, 40)
    c.fillStyle = '#069'
    c.font = '15px Arial'
    c.textBaseline = 'alphabetic'
    c.fillText('Cwm fjordbank glyphs vext quiz, \u{1F603}', 4, 30)
    c.strokeStyle = 'rgba(102, 204, 0, 0.7)'
    c.beginPath()
    c.arc(160, 40, 30, 0, Math.PI * 2)
    c.stroke()
    const g = c.createLinearGradient(0, 0, 240, 0)
    g.addColorStop(0, 'red')
    g.addColorStop(1, 'blue')
    c.fillStyle = g
    c.fillRect(0, 60, 240, 12)
    return c
  }

  await section('canvas', async () => {
    const make = () => Object.assign(document.createElement('canvas'), { width: 240, height: 80 })
    const a = make()
    const ca = paint(a)
    const b = make()
    paint(b)
    const url1 = a.toDataURL()
    const url2 = a.toDataURL()
    const blob = await new Promise((r) => a.toBlob(r))
    const pixels = ca.getImageData(0, 0, 240, 80).data
    const blank = make()
    blank.getContext('2d')
    return {
      toDataURL: await sha(url1),
      toDataURLLength: url1.length,
      sameCanvasTwice: url1 === url2,
      secondCanvasSame: url1 === b.toDataURL(),
      toBlob: await sha(new Uint8Array(await blob.arrayBuffer())),
      getImageData: await sha(pixels),
      jpeg: await sha(a.toDataURL('image/jpeg', 0.8)),
      blank: await sha(blank.toDataURL())
    }
  })

  await section('measureText', async () => {
    const c = document.createElement('canvas').getContext('2d')
    const res = {}
    for (const font of ['16px Arial', '20px Times New Roman', '13px monospace']) {
      c.font = font
      const m = c.measureText('The quick brown fox jumps over the lazy dog 0123456789')
      res[font] = {
        width: m.width,
        left: m.actualBoundingBoxLeft,
        right: m.actualBoundingBoxRight,
        ascent: m.actualBoundingBoxAscent,
        descent: m.actualBoundingBoxDescent,
        fontAscent: m.fontBoundingBoxAscent
      }
    }
    return res
  })

  const webgl = async (kind) => {
    const canvas = Object.assign(document.createElement('canvas'), { width: 64, height: 64 })
    const gl = canvas.getContext(kind, { preserveDrawingBuffer: true })
    if (!gl) return null
    const dbg = gl.getExtension('WEBGL_debug_renderer_info')
    const names = ['MAX_TEXTURE_SIZE', 'MAX_RENDERBUFFER_SIZE', 'MAX_VERTEX_ATTRIBS', 'MAX_VARYING_VECTORS',
      'MAX_VERTEX_UNIFORM_VECTORS', 'MAX_FRAGMENT_UNIFORM_VECTORS', 'MAX_COMBINED_TEXTURE_IMAGE_UNITS',
      'MAX_CUBE_MAP_TEXTURE_SIZE', 'ALIASED_LINE_WIDTH_RANGE', 'ALIASED_POINT_SIZE_RANGE', 'MAX_VIEWPORT_DIMS',
      'RED_BITS', 'DEPTH_BITS', 'STENCIL_BITS', 'SAMPLES']
    const params = {}
    for (const n of names) {
      const v = gl.getParameter(gl[n])
      params[n] = v && v.length !== undefined ? [...v] : v
    }
    const vs = gl.createShader(gl.VERTEX_SHADER)
    gl.shaderSource(vs, 'attribute vec2 p; varying vec2 v; void main(){ v = p; gl_Position = vec4(p, 0.0, 1.0); }')
    gl.compileShader(vs)
    const fs = gl.createShader(gl.FRAGMENT_SHADER)
    gl.shaderSource(fs, 'precision mediump float; varying vec2 v; void main(){ gl_FragColor = vec4(v * 0.5 + 0.5, sin(v.x * 9.0) * 0.5 + 0.5, 1.0); }')
    gl.compileShader(fs)
    const prog = gl.createProgram()
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    gl.useProgram(prog)
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 0, 1]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, 'p')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    const draw = () => {
      gl.clearColor(0.1, 0.2, 0.3, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
    draw()

    // Read `bytesPerPixel * 64 * 64` bytes into the front of a larger buffer
    // and report anything written behind the requested range (an
    // out-of-bounds write, had the buffer been exactly as large as asked).
    //
    // The noise changes the first few pixels that differ from a neighbour, so
    // the overrun check reads a single flat colour (nothing to change inside
    // the range) into a buffer whose tail is a varying pattern (plenty to
    // change behind it, if the noise believes the pixels are wider than they
    // are). The hash is taken from the drawn scene.
    const guarded = async (format, type, bytesPerPixel, View) => {
      const wanted = 64 * 64 * bytesPerPixel
      const backing = new ArrayBuffer(64 * 64 * 16 + 64)
      const view = new View(backing, 0, wanted / View.BYTES_PER_ELEMENT)
      const all = new Uint8Array(backing)
      const tail = (i) => ((i * 37 + 11) & 0x7f) + 64

      draw()
      gl.readPixels(0, 0, 64, 64, format, type, view)
      const err = gl.getError()
      const hash = await sha(all.subarray(0, wanted))

      gl.clearColor(0.5, 0.5, 0.5, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)
      for (let i = wanted; i < all.length; i++) all[i] = tail(i)
      gl.readPixels(0, 0, 64, 64, format, type, view)
      const flat = all.subarray(0, wanted).every((v, i) => v === all[i % (bytesPerPixel * 2)])
      let touched = 0
      for (let i = wanted; i < all.length; i++) if (all[i] !== tail(i)) touched++
      draw()
      return { glError: err, flatReadIsFlat: flat, bytesWrittenPastEnd: touched, hash }
    }

    const res = {
      vendor: gl.getParameter(gl.VENDOR),
      renderer: gl.getParameter(gl.RENDERER),
      version: gl.getParameter(gl.VERSION),
      shading: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
      unmaskedVendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : null,
      unmaskedRenderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null,
      extensions: (gl.getSupportedExtensions() || []).length,
      extensionsHash: await sha((gl.getSupportedExtensions() || []).join(',')),
      params,
      toDataURL: await sha(canvas.toDataURL()),
      readPixels: {}
    }
    res.readPixels.rgba8 = await guarded(gl.RGBA, gl.UNSIGNED_BYTE, 4, Uint8Array)
    res.readPixels.rgba8Again = (await guarded(gl.RGBA, gl.UNSIGNED_BYTE, 4, Uint8Array)).hash

    // A 16-bit colour buffer: the implementation's read format has 2 bytes per pixel.
    const fb = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
    const rb = gl.createRenderbuffer()
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb)
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGB565, 64, 64)
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb)
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) {
      draw()
      const f = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_FORMAT)
      const t = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_TYPE)
      const packed = t === gl.UNSIGNED_SHORT_5_6_5 || t === gl.UNSIGNED_SHORT_4_4_4_4 || t === gl.UNSIGNED_SHORT_5_5_5_1
      const bpp = packed ? 2 : f === gl.RGB ? 3 : 4
      res.readPixels.rgb565 = { format: f, type: t, ...(await guarded(f, t, bpp, packed ? Uint16Array : Uint8Array)) }
    }

    if (kind === 'webgl2') {
      // One byte per pixel.
      const tex = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8, 64, 64)
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, null)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) {
        draw()
        const f = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_FORMAT)
        const t = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_TYPE)
        if (t === gl.UNSIGNED_BYTE) {
          const bpp = f === gl.RED ? 1 : f === gl.RG ? 2 : f === gl.RGB ? 3 : 4
          res.readPixels.r8 = { format: f, type: t, ...(await guarded(f, t, bpp, Uint8Array)) }
        }
      }
      // Float colour buffer, 16 bytes per pixel.
      if (gl.getExtension('EXT_color_buffer_float')) {
        const ftex = gl.createTexture()
        gl.bindTexture(gl.TEXTURE_2D, ftex)
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, 64, 64)
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, ftex, 0)
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) {
          draw()
          const backing = new Float32Array(64 * 64 * 4)
          gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.FLOAT, backing)
          // The triangle writes values in [0, 1]; noise applied as if these
          // were bytes shows up as garbage floats.
          let outOfRange = 0
          for (const v of backing) if (!(v >= 0 && v <= 1)) outOfRange++
          res.readPixels.rgba32f = { glError: gl.getError(), valuesOutsideUnitRange: outOfRange, hash: await sha(new Uint8Array(backing.buffer)) }
        }
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return res
  }
  await section('webgl', () => webgl('webgl'))
  await section('webgl2', () => webgl('webgl2'))

  await section('audio', async () => {
    const ctx = new OfflineAudioContext(1, 5000, 44100)
    const osc = ctx.createOscillator()
    osc.type = 'triangle'
    osc.frequency.value = 10000
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -50
    comp.knee.value = 40
    comp.ratio.value = 12
    comp.attack.value = 0
    comp.release.value = 0.25
    osc.connect(comp)
    comp.connect(ctx.destination)
    osc.start(0)
    const buf = (await ctx.startRendering()).getChannelData(0)
    let sum = 0
    for (let i = 4500; i < 5000; i++) sum += Math.abs(buf[i])
    return { sum, hash: await sha(new Uint8Array(buf.buffer.slice(0))), sampleRate: ctx.sampleRate, length: ctx.length }
  })

  await section('clientRects', async () => {
    const host = document.createElement('div')
    host.style.cssText = 'position:absolute;left:13.37px;top:7.77px;width:201.3px;font:17px/1.3 Arial;transform:rotate(3deg) scale(1.013)'
    host.innerHTML = 'A <span id="probe-span" style="letter-spacing:0.31px">fingerprint probe — mjwW</span> line that wraps a few times inside the box'
    document.body.appendChild(host)
    const r = (x) => [x.x, x.y, x.width, x.height]
    const span = host.querySelector('#probe-span')
    const range = document.createRange()
    range.selectNodeContents(host)
    const res = {
      box: r(host.getBoundingClientRect()),
      span: r(span.getBoundingClientRect()),
      spanRects: [...span.getClientRects()].map(r),
      range: r(range.getBoundingClientRect()),
      rangeRects: range.getClientRects().length
    }
    host.remove()
    return res
  })

  await section('fonts', async () => {
    const candidates = ['Arial', 'Arial Black', 'Bahnschrift', 'Calibri', 'Cambria', 'Candara', 'Comic Sans MS', 'Consolas',
      'Constantia', 'Corbel', 'Courier New', 'Ebrima', 'Franklin Gothic Medium', 'Gabriola', 'Gadugi', 'Georgia',
      'Helvetica', 'Helvetica Neue', 'Impact', 'Lucida Console', 'Lucida Grande', 'Malgun Gothic', 'Menlo',
      'Microsoft YaHei', 'Monaco', 'MS Gothic', 'Palatino Linotype', 'PingFang SC', 'Segoe UI', 'Segoe UI Emoji',
      'SF Pro Text', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Ubuntu', 'DejaVu Sans', 'Liberation Sans', 'Verdana',
      'Noto Sans', 'Roboto']
    const span = document.createElement('span')
    span.style.cssText = 'position:absolute;left:-9999px;font-size:72px;white-space:nowrap'
    span.textContent = 'mmmmmmmmmmlli'
    document.body.appendChild(span)
    const size = (family) => {
      span.style.fontFamily = family
      return span.offsetWidth + 'x' + span.offsetHeight
    }
    const base = { monospace: size('monospace'), serif: size('serif'), 'sans-serif': size('sans-serif') }
    const present = candidates.filter((f) => Object.keys(base).some((b) => size(`'${f}',${b}`) !== base[b]))
    span.remove()
    return { present, count: present.length }
  })

  await section('shadowRoot', async () => {
    const el = document.createElement('div')
    el.attachShadow({ mode: 'closed' })
    return { closedVisibleToPage: el.shadowRoot !== null }
  })

  // Readback in a loop, through every path that adds noise. A renderer crash
  // here surfaces as a failed evaluation in the driver.
  await section('stress', async () => {
    if (!stressRounds) return null
    const img = new Image()
    const src = Object.assign(document.createElement('canvas'), { width: 300, height: 150 })
    paint(src)
    img.src = src.toDataURL()
    await img.decode()
    const bitmap = await createImageBitmap(img)
    const seen = new Set()
    for (let i = 0; i < stressRounds; i++) {
      const c = Object.assign(document.createElement('canvas'), { width: 100 + (i % 7) * 37, height: 60 + (i % 5) * 29 })
      const x = c.getContext('2d', { willReadFrequently: i % 2 === 0 })
      x.drawImage(i % 3 ? img : bitmap, 0, 0, c.width, c.height)
      x.getImageData(0, 0, c.width, c.height)
      seen.add(c.toDataURL(i % 4 ? 'image/png' : 'image/webp').length)
      await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.7))
      const off = new OffscreenCanvas(c.width, c.height)
      off.getContext('2d').drawImage(c, 0, 0)
      await off.convertToBlob()
      if (i % 10 === 0) (await createImageBitmap(c)).close()
    }
    // The source image must be untouched by the noise added to its copies.
    const after = Object.assign(document.createElement('canvas'), { width: 300, height: 150 })
    paint(after)
    return { rounds: stressRounds, distinctLengths: seen.size, sourceStillEqual: after.toDataURL() === src.toDataURL() }
  })

  return out
}

// -------------------------------------------------------------- driver side

function parseArgs(argv) {
  const opts = { _: [], extra: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--') {
      opts.extra = argv.slice(i + 1)
      break
    }
    if (a === '--no-fingerprint') opts.noFingerprint = true
    else if (a === '--no-brand') opts.noBrand = true
    else if (a.startsWith('--')) opts[a.slice(2)] = argv[++i]
    else opts._.push(a)
  }
  return opts
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.next = 1
    this.pending = new Map()
    this.events = []
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(msg.error.message))
        else resolve(msg.result)
      } else if (msg.method) {
        this.events.push(msg)
      }
    })
    ws.addEventListener('close', () => {
      for (const { reject } of this.pending.values()) reject(new Error('browser connection closed'))
      this.pending.clear()
    })
  }

  static async connect(url) {
    const ws = new WebSocket(url)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true })
      ws.addEventListener('error', () => reject(new Error('cannot connect to ' + url)), { once: true })
    })
    return new Cdp(ws)
  }

  send(method, params = {}, sessionId) {
    const id = this.next++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params, sessionId }))
    })
  }

  crashed() {
    return this.events.some((e) => e.method === 'Target.targetCrashed' || e.method === 'Inspector.targetCrashed')
  }
}

async function launch(opts) {
  if (!opts.exe || !fs.existsSync(opts.exe)) throw new Error('--exe must point at chrome.exe')
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'facet-probe-'))
  const args = [
    `--user-data-dir=${profile}`,
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-search-engine-choice-screen',
    '--window-size=1100,800',
    '--window-position=40,40'
  ]
  if (!opts.noFingerprint) {
    args.push(`--fingerprint=${opts.seed || 1000}`,
      `--fingerprint-platform=${opts.platform || 'windows'}`)
    if (!opts.noBrand) args.push(`--fingerprint-brand=${opts.brand || 'Chrome'}`)
  }
  args.push(...opts.extra, 'about:blank')
  const child = spawn(opts.exe, args, { stdio: 'ignore' })
  const portFile = path.join(profile, 'DevToolsActivePort')
  for (let i = 0; i < 300 && !fs.existsSync(portFile); i++) await sleep(100)
  if (!fs.existsSync(portFile)) {
    child.kill()
    throw new Error('browser did not open a debugging port within 30 s')
  }
  const [port, wsPath] = fs.readFileSync(portFile, 'utf8').trim().split('\n')
  const cdp = await Cdp.connect(`ws://127.0.0.1:${port}${wsPath}`)
  await cdp.send('Target.setDiscoverTargets', { discover: true })
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
  const close = async () => {
    try {
      await Promise.race([cdp.send('Browser.close'), sleep(3000)])
    } catch { /* already gone */ }
    await sleep(1500)
    try { child.kill() } catch { /* ignore */ }
    for (let i = 0; i < 10; i++) {
      try {
        fs.rmSync(profile, { recursive: true, force: true })
        break
      } catch {
        await sleep(500)
      }
    }
  }
  return { cdp, sessionId, args, close }
}

async function navigate(cdp, sessionId, url, settleMs) {
  await cdp.send('Page.enable', {}, sessionId)
  await cdp.send('Page.navigate', { url }, sessionId)
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    if (cdp.events.some((e) => e.sessionId === sessionId && e.method === 'Page.loadEventFired')) break
    await sleep(100)
  }
  await sleep(settleMs)
}

async function evaluate(cdp, sessionId, expression) {
  const res = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId)
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text)
  }
  return res.result.value
}

async function run(opts) {
  let requestHeaders = null
  const server = http.createServer((req, res) => {
    if (req.url === '/') {
      requestHeaders = {}
      for (const name of ['user-agent', 'accept-language', 'sec-ch-ua', 'sec-ch-ua-platform', 'sec-ch-ua-mobile']) {
        requestHeaders[name] = req.headers[name] ?? null
      }
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end('<!doctype html><meta charset="utf-8"><title>probe</title><body>')
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const browser = await launch(opts)
  const result = { exe: opts.exe, args: browser.args.slice(1), crashed: false }
  try {
    await navigate(browser.cdp, browser.sessionId, `http://127.0.0.1:${server.address().port}/`, 300)
    const version = await browser.cdp.send('Browser.getVersion')
    result.product = version.product
    result.browserUserAgent = version.userAgent
    result.requestHeaders = requestHeaders
    const stress = opts.stress === undefined ? 100 : Number(opts.stress)
    result.page = await evaluate(browser.cdp, browser.sessionId, `(${pageProbe})(${stress})`)
  } catch (e) {
    result.error = e.message
  }
  result.crashed = browser.cdp.crashed()
  await browser.close()
  server.close()
  const json = JSON.stringify(result, null, 2)
  if (opts.out) fs.writeFileSync(opts.out, json + '\n')
  else console.log(json)
  if (result.error || result.crashed) {
    console.error(`probe failed: ${result.error || 'renderer crashed'}`)
    process.exitCode = 1
  }
}

async function visit(opts) {
  if (!opts.url) throw new Error('--url is required')
  const browser = await launch(opts)
  try {
    await navigate(browser.cdp, browser.sessionId, opts.url, Number(opts.wait || 30) * 1000)
    const text = await evaluate(browser.cdp, browser.sessionId, 'document.body.innerText')
    if (opts.out) fs.writeFileSync(opts.out, text)
    else console.log(text)
    if (opts.screenshot) {
      const shot = await browser.cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, browser.sessionId)
      fs.writeFileSync(opts.screenshot, Buffer.from(shot.data, 'base64'))
    }
    if (browser.cdp.crashed()) {
      console.error('renderer crashed')
      process.exitCode = 1
    }
  } finally {
    await browser.close()
  }
}

function flatten(value, prefix, into) {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, into)
  } else {
    into[prefix] = JSON.stringify(value)
  }
  return into
}

function diff(fileA, fileB) {
  const a = flatten(JSON.parse(fs.readFileSync(fileA, 'utf8')), '', {})
  const b = flatten(JSON.parse(fs.readFileSync(fileB, 'utf8')), '', {})
  const ignore = new Set(['exe'])
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !ignore.has(k)).sort()
  let same = 0
  const different = []
  for (const k of keys) {
    if (a[k] === b[k]) same++
    else different.push(k)
  }
  console.log(`${same} values equal, ${different.length} differ`)
  for (const k of different) console.log(`  ${k}\n    a: ${a[k]}\n    b: ${b[k]}`)
  return different.length
}

const [command, ...rest] = process.argv.slice(2)
const opts = parseArgs(rest)
try {
  if (command === 'run') await run(opts)
  else if (command === 'visit') await visit(opts)
  else if (command === 'diff' && opts._.length === 2) process.exitCode = diff(opts._[0], opts._[1]) ? 1 : 0
  else {
    console.error('usage: fingerprint_probe.mjs run|visit|diff ... (see the header of this file)')
    process.exitCode = 2
  }
} catch (e) {
  console.error(e.message)
  process.exitCode = 1
}
