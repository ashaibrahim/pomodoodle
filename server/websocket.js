// A small WebSocket server (RFC 6455) built on Node's http module — no npm packages.
// Handles the handshake, framing, fragmentation, ping/pong heartbeats and closing.
// Text messages only (that's all the app uses).

const crypto = require('crypto');
const { EventEmitter } = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_PAYLOAD = 64 * 1024; // 64 KB is plenty for chat and pet updates

class Connection extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.frags = [];
    this.fragOp = 0;
    this.alive = true;
    this.closed = false;
    socket.setNoDelay(true);
    socket.on('data', (d) => this._onData(d));
    socket.on('close', () => this._finish());
    socket.on('error', () => this._finish());
  }

  _onData(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    while (!this.closed) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0;
      const op = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;

      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        const big = this.buf.readBigUInt64BE(2);
        if (big > BigInt(MAX_PAYLOAD)) { this.close(1009, 'Message too big'); return; }
        len = Number(big);
        off = 10;
      }
      if (len > MAX_PAYLOAD) { this.close(1009, 'Message too big'); return; }
      if (!masked) { this.close(1002, 'Client frames must be masked'); return; }
      if (this.buf.length < off + 4 + len) return; // wait for the rest

      const mask = this.buf.subarray(off, off + 4);
      const payload = Buffer.from(this.buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i & 3];
      this.buf = this.buf.subarray(off + 4 + len);
      this._onFrame(fin, op, payload);
    }
  }

  _onFrame(fin, op, payload) {
    if (op === 0x8) { this.close(1000); return; }          // close
    if (op === 0x9) { this._send(0xa, payload); return; }  // ping → pong
    if (op === 0xa) { this.alive = true; return; }         // pong

    if (op === 0x1 || op === 0x2) { this.frags = [payload]; this.fragOp = op; }
    else if (op === 0x0) { if (!this.frags.length) return; this.frags.push(payload); }
    else return; // unknown opcode: ignore

    const total = this.frags.reduce((n, b) => n + b.length, 0);
    if (total > MAX_PAYLOAD) { this.close(1009, 'Message too big'); return; }
    if (!fin) return;

    const data = Buffer.concat(this.frags);
    this.frags = [];
    this.alive = true;
    if (this.fragOp === 0x1) this.emit('message', data.toString('utf8'));
  }

  _send(op, payload) {
    if (this.closed || this.socket.destroyed) return;
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.from([0x80 | op, len]);
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | op;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | op;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    this.socket.write(Buffer.concat([header, payload]));
  }

  send(text) { this._send(0x1, Buffer.from(text, 'utf8')); }

  ping() { this._send(0x9, Buffer.alloc(0)); }

  close(code = 1000, reason = '') {
    if (this.closed) return;
    const p = Buffer.alloc(2 + Buffer.byteLength(reason));
    p.writeUInt16BE(code, 0);
    p.write(reason, 2);
    this._send(0x8, p);
    this.closed = true;
    this.socket.end();
    setTimeout(() => this.socket.destroy(), 1000).unref();
    this._finish();
  }

  _finish() {
    if (this._done) return;
    this._done = true;
    this.closed = true;
    this.emit('close');
  }
}

// Turns an http.Server into a WebSocket server.
function attach(server, onConnection, { heartbeatMs = 25000 } = {}) {
  const conns = new Set();

  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    if ((req.headers.upgrade || '').toLowerCase() !== 'websocket' || !key) {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '', '',
    ].join('\r\n'));

    const conn = new Connection(socket);
    conns.add(conn);
    conn.on('close', () => conns.delete(conn));
    onConnection(conn, req);
  });

  // Drop connections that stop answering pings (laptop went to sleep, Wi-Fi died…)
  const timer = setInterval(() => {
    for (const c of conns) {
      if (!c.alive) { c.socket.destroy(); c._finish(); continue; }
      c.alive = false;
      c.ping();
    }
  }, heartbeatMs);
  timer.unref();

  return { conns };
}

module.exports = { attach, MAX_PAYLOAD };
