// Planche server: serves the client, relays Yjs documents over WebSocket
// (y-websocket wire protocol), persists rooms to disk and unfurls links.
//
//   node server/server.mjs          -> production (serves ./dist)
//   node server/server.mjs --dev    -> development (Vite middleware + HMR)
//
// Env: PORT (default 8787), HOST (default 0.0.0.0), DATA_DIR (default ./data)

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { unfurl } from './unfurl.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEV = process.argv.includes('--dev')
const PORT = Number(process.env.PORT || 8787)
const HOST = process.env.HOST || '0.0.0.0'
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'))
fs.mkdirSync(DATA_DIR, { recursive: true })

// ---------------------------------------------------------------- Yjs rooms

const MSG_SYNC = 0
const MSG_AWARENESS = 1
const ROOM_RE = /^[\w-]{3,64}$/
const rooms = new Map()

class Room {
  constructor (name) {
    this.name = name
    this.file = path.join(DATA_DIR, `${name}.ybin`)
    this.doc = new Y.Doc({ gc: true })
    this.conns = new Map() // ws -> Set<awareness clientID>
    this.saveTimer = null
    if (fs.existsSync(this.file)) {
      try { Y.applyUpdate(this.doc, fs.readFileSync(this.file)) } catch (e) { console.error(`[room ${name}] load failed`, e) }
    }
    this.awareness = new awarenessProtocol.Awareness(this.doc)
    this.awareness.setLocalState(null)

    this.doc.on('update', (update) => {
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, MSG_SYNC)
      syncProtocol.writeUpdate(enc, update)
      this.broadcast(encoding.toUint8Array(enc))
      this.scheduleSave()
    })

    this.awareness.on('update', ({ added, updated, removed }, origin) => {
      const changed = added.concat(updated, removed)
      const ids = this.conns.get(origin)
      if (ids) {
        added.forEach((id) => ids.add(id))
        removed.forEach((id) => ids.delete(id))
      }
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, MSG_AWARENESS)
      encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed))
      this.broadcast(encoding.toUint8Array(enc))
    })
  }

  broadcast (msg) {
    for (const ws of this.conns.keys()) send(ws, msg)
  }

  scheduleSave () {
    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.save(), 1000)
  }

  save () {
    clearTimeout(this.saveTimer)
    this.saveTimer = null
    const tmp = `${this.file}.tmp`
    fs.writeFileSync(tmp, Y.encodeStateAsUpdate(this.doc))
    fs.renameSync(tmp, this.file)
  }

  join (ws) {
    this.conns.set(ws, new Set())
    ws.on('message', (data) => this.onMessage(ws, new Uint8Array(data)))
    ws.on('close', () => this.leave(ws))

    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, MSG_SYNC)
    syncProtocol.writeSyncStep1(enc, this.doc)
    send(ws, encoding.toUint8Array(enc))

    const states = this.awareness.getStates()
    if (states.size > 0) {
      const aw = encoding.createEncoder()
      encoding.writeVarUint(aw, MSG_AWARENESS)
      encoding.writeVarUint8Array(aw, awarenessProtocol.encodeAwarenessUpdate(this.awareness, [...states.keys()]))
      send(ws, encoding.toUint8Array(aw))
    }
  }

  onMessage (ws, data) {
    try {
      const dec = decoding.createDecoder(data)
      const enc = encoding.createEncoder()
      const type = decoding.readVarUint(dec)
      if (type === MSG_SYNC) {
        encoding.writeVarUint(enc, MSG_SYNC)
        syncProtocol.readSyncMessage(dec, enc, this.doc, ws)
        if (encoding.length(enc) > 1) send(ws, encoding.toUint8Array(enc))
      } else if (type === MSG_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(dec), ws)
      }
    } catch (e) {
      console.error(`[room ${this.name}] bad message`, e)
    }
  }

  leave (ws) {
    const ids = this.conns.get(ws)
    this.conns.delete(ws)
    if (ids) awarenessProtocol.removeAwarenessStates(this.awareness, [...ids], null)
    if (this.conns.size === 0) {
      this.save()
      this.doc.destroy()
      rooms.delete(this.name)
    }
  }
}

function send (ws, msg) {
  if (ws.readyState !== ws.OPEN) return
  ws.send(msg, (err) => { if (err) ws.close() })
}

function getRoom (name) {
  let room = rooms.get(name)
  if (!room) { room = new Room(name); rooms.set(name, room) }
  return room
}

// ---------------------------------------------------------------- HTTP

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json'
}

async function handleApi (req, res, url) {
  if (url.pathname === '/api/unfurl') {
    const target = url.searchParams.get('url') || ''
    try {
      const meta = await unfurl(target)
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' })
      res.end(JSON.stringify(meta))
    } catch (e) {
      res.writeHead(422, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: String(e.message || e) }))
    }
    return true
  }
  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }))
    return true
  }
  return false
}

function serveStatic (req, res, url) {
  const dist = path.join(ROOT, 'dist')
  let file = path.normalize(path.join(dist, decodeURIComponent(url.pathname)))
  if (!file.startsWith(dist)) { res.writeHead(403); res.end(); return }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html')
  if (!fs.existsSync(file)) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('Build manquant : lancez "npm run build" puis "npm start" (ou "npm run dev").')
    return
  }
  const immutable = file.includes(`${path.sep}assets${path.sep}`)
  res.writeHead(200, {
    'content-type': MIME[path.extname(file)] || 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache'
  })
  fs.createReadStream(file).pipe(res)
}

const server = http.createServer()
let vite = null
if (DEV) {
  const { createServer } = await import('vite')
  vite = await createServer({
    root: ROOT,
    server: { middlewareMode: true, hmr: { server } },
    appType: 'spa'
  })
}

server.on('request', async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  if (await handleApi(req, res, url)) return
  if (vite) vite.middlewares(req, res)
  else serveStatic(req, res, url)
})

const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 * 1024 })
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost')
  const m = url.pathname.match(/^\/yjs\/(.+)$/)
  if (!m) return // left to Vite HMR in dev
  const name = decodeURIComponent(m[1])
  if (!ROOM_RE.test(name)) { socket.destroy(); return }
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.isAlive = true
    ws.on('pong', () => { ws.isAlive = true })
    getRoom(name).join(ws)
  })
})

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue }
    ws.isAlive = false
    ws.ping()
  }
}, 30000)

function shutdown () {
  for (const room of rooms.values()) room.save()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

server.listen(PORT, HOST, () => {
  console.log(`Planche ${DEV ? '(dev) ' : ''}-> http://localhost:${PORT}  (données: ${DATA_DIR})`)
})
