#!/usr/bin/env node
// Check SOCKS5 username/password authentication (RFC 1929) in an engine
// build.
//
//   node facet/socks5_auth_test.mjs <chrome.exe>
//
// Starts a SOCKS5 proxy on 127.0.0.1 that only accepts username/password
// authentication and a small web server, then opens the web page through the
// proxy with good, bad and missing credentials. Prints what the proxy saw for
// each case and exits with 1 if a case did not behave as expected. The
// credentials contain characters that have to be percent-encoded.
//
// Needs Node 22 or newer. No dependencies.
import { execFile } from 'node:child_process'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const exe = process.argv[2]
if (!exe) {
  console.error('usage: node facet/socks5_auth_test.mjs <chrome.exe>')
  process.exit(2)
}
const probe = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fingerprint_probe.mjs')
const USER = 'us er'
const PASS = 'p@ss:w/rd'

let log = []

function reader(socket) {
  let buffer = Buffer.alloc(0)
  let waiter = null
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk])
    if (waiter) waiter()
  })
  socket.on('close', () => { if (waiter) waiter() })
  socket.on('error', () => { if (waiter) waiter() })
  return {
    async read(n) {
      while (buffer.length < n) {
        if (socket.destroyed) throw new Error('closed')
        await new Promise((r) => { waiter = r })
        waiter = null
      }
      const out = buffer.subarray(0, n)
      buffer = buffer.subarray(n)
      return out
    },
    rest() {
      const out = buffer
      buffer = Buffer.alloc(0)
      return out
    }
  }
}

const server = net.createServer(async (socket) => {
  const entry = {}
  log.push(entry)
  const r = reader(socket)
  try {
    const [version, count] = await r.read(2)
    const methods = [...(await r.read(count))]
    entry.greeting = { version, methods }
    if (!methods.includes(2)) {
      entry.result = 'no username/password method offered'
      socket.end(Buffer.from([5, 0xff]))
      return
    }
    socket.write(Buffer.from([5, 2]))
    const [authVersion, ulen] = await r.read(2)
    const user = (await r.read(ulen)).toString('utf8')
    const [plen] = await r.read(1)
    const pass = (await r.read(plen)).toString('utf8')
    entry.auth = { authVersion, user, pass }
    if (user !== USER || pass !== PASS) {
      entry.result = 'bad credentials'
      socket.end(Buffer.from([1, 1]))
      return
    }
    socket.write(Buffer.from([1, 0]))
    const [, command, , atyp] = await r.read(4)
    let host
    if (atyp === 1) host = [...(await r.read(4))].join('.')
    else if (atyp === 3) host = (await r.read((await r.read(1))[0])).toString('ascii')
    else if (atyp === 4) host = (await r.read(16)).toString('hex')
    const port = (await r.read(2)).readUInt16BE(0)
    entry.request = { command, atyp, host, port }
    const upstream = net.connect(port, atyp === 4 ? '::1' : host, () => {
      entry.result = 'connected'
      socket.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]))
      const rest = r.rest()
      if (rest.length) upstream.write(rest)
      socket.removeAllListeners('data')
      socket.pipe(upstream)
      upstream.pipe(socket)
    })
    upstream.on('error', (e) => {
      entry.result = 'upstream error ' + e.code
      socket.destroy()
    })
    socket.on('error', () => upstream.destroy())
  } catch (e) {
    entry.result = entry.result || 'client closed: ' + e.message
    socket.destroy()
  }
})

await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port

let hits = 0
let failed = false
const web = http.createServer((req, res) => {
  hits++
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end('<!doctype html><title>target</title><body>reached the target page')
})
await new Promise((r) => web.listen(0, '127.0.0.1', r))
const webPort = web.address().port

async function runCase(name, proxy, expectReached) {
  log = []
  hits = 0
  let text = ''
  let exit = 0
  await new Promise((resolve) => {
    execFile(process.execPath, [probe, 'visit', '--exe', exe, '--seed', '1000', '--wait', '3',
      '--url', `http://127.0.0.1:${webPort}/`, '--',
      '--headless=new', `--proxy-server=${proxy}`, '--proxy-bypass-list=<-loopback>'],
    { timeout: 150000 }, (error, stdout, stderr) => {
      exit = error ? (error.code ?? -1) : 0
      text = String(stdout || '') + String(stderr || '')
      resolve()
    })
  })
  // Chrome opens several connections; summarise them.
  const summary = {}
  for (const e of log) {
    const key = JSON.stringify({ methods: e.greeting?.methods, auth: e.auth, host: e.request?.host, result: e.result })
    summary[key] = (summary[key] || 0) + 1
  }
  const reached = hits > 0
  const ok = reached === expectReached
  if (!ok) failed = true
  console.log(`== ${name}: ${proxy}: ${ok ? 'ok' : 'FAILED'}`)
  console.log(`probe exit ${exit}, target hits ${hits}, page text: ${JSON.stringify(text.replace(/\s+/g, ' ').slice(0, 200))}`)
  for (const [key, n] of Object.entries(summary)) console.log(`  ${n}x ${key}`)
}

const enc = encodeURIComponent
await runCase('good credentials', `socks5://${enc(USER)}:${enc(PASS)}@127.0.0.1:${port}`, true)
await runCase('bad password', `socks5://${enc(USER)}:wrong@127.0.0.1:${port}`, false)
await runCase('no credentials', `socks5://127.0.0.1:${port}`, false)
server.close()
web.close()
process.exit(failed ? 1 : 0)
