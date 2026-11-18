// F25 stage 2 (16.11.2026): a WebRTC data channel (werift, rendezvous/rtc.ts) as a SocketLike (devices/channel.ts), so the
// phone runs the usual pinned-key handshake and SecureChannel over it a second time – DTLS is only the outer wrapper,
// never what this PC trusts. Text messages (the handshake, ≤ 4 KiB) go as strings. A binary channel frame is cut into
// pieces [flags][bytes] of 16 KiB (flag MORE: another piece follows; every piece but the last is exactly 16 KiB, which
// fits any SCTP max-message-size) and joined again here, up to the channel's 8 MiB frame limit.
// Until the bridge marks the socket trusted (the handshake done, PhoneBridge.acceptRtc), at most 16 KiB arrive in all and
// binary data before the first text ends it – as on a tunnel (tunnel.ts). A piece out of shape ends it, and so does a
// send buffer past 16 MiB: that way is too slow, and the phone's tunnel takes over.
// Owns: framing, those caps and the close semantics of one data channel. Never: ICE, signalling or trust decisions.

import type { SocketLike } from '../channel.ts';

/** The part of werift's RTCDataChannel this socket uses. */
export interface DataChannelLike {
  readonly bufferedAmount: number;
  send(data: Buffer | string): void;
  close(): void;
  readonly onMessage: { subscribe(listener: (data: string | Buffer) => void): unknown };
  readonly stateChanged: { subscribe(listener: (state: string) => void): unknown };
}

/** Bytes of a frame per piece. */
export const PIECE = 16 * 1024;
const MORE = 1;
const MAX_MESSAGE = 8 * 1024 * 1024 + 1024;
/** Everything the other end may send before the handshake is done. */
export const MAX_EARLY = 16 * 1024;
/** Unsent bytes past which this way ends (the phone goes back to its tunnel). */
export const MAX_BUFFERED = 16 * 1024 * 1024;

export class RtcSocket implements SocketLike {
  closed = false;
  /** The code it closed with (REFUSED_CLOSE: the handshake refused the key; 1006: the data channel went away). */
  code?: number;
  private readonly channel: DataChannelLike;
  private readonly messageListeners: Array<(data: Buffer, isText: boolean) => void> = [];
  private readonly closeListeners: Array<(code?: number) => void> = [];
  private parts: Buffer[] = [];
  private size = 0;
  private early = 0;
  private spoke = false;
  private trust = false;

  constructor(channel: DataChannelLike) {
    this.channel = channel;
    channel.onMessage.subscribe((data) => this.receive(data));
    channel.stateChanged.subscribe((state) => { if (state === 'closed') this.ended(1006); });
  }

  /** The handshake is done: the early caps end (the channel's own limits hold from here). */
  trusted(): void { this.trust = true; }

  send(data: Buffer | string): void {
    if (this.closed) return;
    if (this.channel.bufferedAmount > MAX_BUFFERED) { this.close(1006, 'send buffer full'); return; }
    try {
      if (typeof data === 'string') { this.channel.send(data); return; }
      let offset = 0;
      do {
        const chunk = data.subarray(offset, offset + PIECE);
        offset += chunk.length;
        const piece = Buffer.allocUnsafe(1 + chunk.length);
        piece[0] = offset < data.length ? MORE : 0;
        chunk.copy(piece, 1);
        this.channel.send(piece);
      } while (offset < data.length);
    } catch {
      this.close(1006, 'send failed');
    }
  }

  private receive(data: string | Buffer): void {
    if (this.closed) return;
    const isText = typeof data === 'string';
    const bytes = isText ? Buffer.from(data, 'utf8') : data;
    if (!this.trust) {
      this.early += bytes.length;
      if (this.early > MAX_EARLY || (!isText && !this.spoke)) return this.close(4000, 'not a handshake');
    }
    if (isText) {
      if (this.parts.length || bytes.length > MAX_EARLY) return this.close(4000, 'bad text');
      this.spoke = true;
      return this.emit(bytes, true);
    }
    const more = bytes.length > 0 && bytes[0] === MORE;
    const payload = bytes.length - 1;
    if (payload < 1 || payload > PIECE || (bytes[0] & ~MORE) || (more && payload !== PIECE)) return this.close(4000, 'bad piece');
    this.size += payload;
    if (this.size > MAX_MESSAGE) return this.close(4000, 'too large');
    this.parts.push(Buffer.from(bytes.subarray(1)));
    if (more) return;
    const whole = this.parts.length === 1 ? this.parts[0] : Buffer.concat(this.parts);
    this.parts = [];
    this.size = 0;
    this.emit(whole, false);
  }

  private emit(data: Buffer, isText: boolean): void {
    for (const listener of [...this.messageListeners]) listener(data, isText);
  }

  close(code = 1000, _reason?: string): void {
    if (this.closed) return;
    this.ended(code); // first: the channel's own 'closed' must not overwrite the code
    try { this.channel.close(); } catch { /* already gone */ }
  }

  private ended(code: number): void {
    if (this.closed) return;
    this.closed = true;
    this.code = code;
    this.parts = [];
    queueMicrotask(() => { for (const listener of this.closeListeners) listener(code); });
  }

  onMessage(listener: (data: Buffer, isText: boolean) => void): void { this.messageListeners.push(listener); }
  onClose(listener: (code?: number) => void): void { this.closeListeners.push(listener); }
}
