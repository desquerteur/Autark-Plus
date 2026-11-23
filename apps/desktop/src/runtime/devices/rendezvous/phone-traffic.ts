// F29 stage 1 (16.11.2026): how many bytes each phone's channels carried with this PC – straight to its peer listener
// ('direct', /peer/phone) or through the meeting server ('relay', a tunnel) – and which way its channel runs now, so the
// gain of the direct way is measured. Settings › Devices shows it (RelayState.phones), and one 'phone traffic' info line
// per day says it in the log: at the first count of a new day for the day before, and at shutdown for the running day.
// F25 stage 2: a third way, 'rtc' – a WebRTC data channel the phone set up through its tunnel (rtc.ts).
// Owns: these counters (in memory, from this start or from midnight on). Never: reads, keeps or logs any content.

import type { Logger } from '../../contracts.ts';

export type PhonePath = 'direct' | 'rtc' | 'relay';

/** One phone's counts since `since` (ms): bytes both ways per path, and the path of its open channel (none: not connected). */
export interface PhoneCount { deviceId: string; via?: PhonePath; direct: number; rtc: number; relay: number; since: number }

type Ways = Record<PhonePath, number>;
const none = (): Ways => ({ direct: 0, rtc: 0, relay: 0 });

/** Local midnight of the day of `ms`, or of a day `plus` days later (a DST day is 23 or 25 hours long). */
const midnight = (ms: number, plus = 0): number => { const day = new Date(ms); return new Date(day.getFullYear(), day.getMonth(), day.getDate() + plus).getTime(); };

export class PhoneTraffic {
  private readonly log: Logger;
  private readonly now: () => number;
  private readonly bytes = new Map<string, Ways>();
  private readonly open = new Map<string, Ways>();
  private day: number;
  private next: number;
  private since: number;

  constructor(log: Logger, now: () => number = Date.now) {
    this.log = log;
    this.now = now;
    this.since = now();
    this.day = midnight(this.since);
    this.next = midnight(this.since, 1);
  }

  /** `n` bytes of one phone's channel on `path` (frames both ways, handshake included). */
  add(deviceId: string, path: PhonePath, n: number): void {
    if (!(n > 0)) return;
    this.roll();
    const row = this.bytes.get(deviceId) ?? none();
    row[path] += n;
    this.bytes.set(deviceId, row);
  }

  /** A channel of `deviceId` on `path` opened; the returned function marks its close (once). */
  opened(deviceId: string, path: PhonePath): () => void {
    const row = this.open.get(deviceId) ?? none();
    row[path]++;
    this.open.set(deviceId, row);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      row[path]--;
      if (!row.direct && !row.rtc && !row.relay && this.open.get(deviceId) === row) this.open.delete(deviceId);
    };
  }

  /** Every phone with bytes today or an open channel now. */
  list(): PhoneCount[] {
    this.roll();
    return [...new Set([...this.bytes.keys(), ...this.open.keys()])].map((deviceId) => {
      const bytes = this.bytes.get(deviceId) ?? none();
      const open = this.open.get(deviceId);
      const via: PhonePath | undefined = open?.direct ? 'direct' : open?.rtc ? 'rtc' : open?.relay ? 'relay' : undefined;
      return { deviceId, ...(via ? { via } : {}), direct: bytes.direct, rtc: bytes.rtc, relay: bytes.relay, since: this.since };
    });
  }

  /** Shutdown: the running day's line. */
  flush(): void { this.report(); }

  private roll(): void {
    const now = this.now();
    if (now >= this.day && now < this.next) return; // the same day (a clock set back starts a new one too)
    this.report();
    this.bytes.clear();
    this.day = midnight(now);
    this.next = midnight(now, 1);
    this.since = this.day;
  }

  private report(): void {
    if (!this.bytes.size) return;
    const day = new Date(this.day);
    const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    const phones = [...this.bytes].map(([deviceId, row]) => ({ deviceId, direct: row.direct, rtc: row.rtc, relay: row.relay }));
    this.log.info('phone traffic', { day: date, since: new Date(this.since).toISOString(), phones });
  }
}
