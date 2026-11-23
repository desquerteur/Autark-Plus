// Owner 18.11.2026 ("To-Do-Button … überall auf dem Bildschirm, auch wenn unsere App gerade nicht geöffnet ist"): the
// floating to-do button over the whole desktop. Three looks of one small always-on-top window: the dot (DOT px, drag it
// anywhere, a tap opens the panel), the panel (icons only: one more screenshot, dictate, call, send, fold to the edge,
// close; one text field; the shots as thumbnails, each removable) and the tab (TAB_W × TAB_H, glued to the nearest
// screen edge; a tap brings the dot back). Opening the panel takes a screenshot of the display under the button at
// once – the window is out of every capture (content protection), so the shot shows the screen, not us. Send uploads
// the shots (files.upload) and posts the words as one quick task (tasks.quickCreate, no target: Autark picks the
// owner); Call does the same and then opens the picked agent's 1:1 in the app window with its call starting
// (NavigateRequest call). A retried post keeps its clientId, so a lost answer never makes a second task. Dictation:
// the page records a 16 kHz WAV, heard here through files.upload + voice.transcribe. The place and look are kept in
// float-bar.json; the global shortcut (FLOAT_KEYS) opens or closes the panel.
// Holding the dot is the quick task (owner 18.11.2026): the screen at the hold's start ('hold'), the words heard at
// the release and posted at once ('quick'); nothing heard or a failed post opens the panel with both.
// Owns: the button's state, its actions and their RPC calls. Never: imports electron (the window comes from
// float-bar-window.ts), keeps a shot after the post, or decides who does the task (the runtime does).

import { randomUUID } from 'node:crypto';
import type { NavigateRequest } from '../shared/api/desktop.ts';
import type { MethodName, ParamsOf, ResultOf } from '../shared/api/methods.ts';

export const DOT = 44;
export const TAB_W = 12;
export const TAB_H = 40;
export const PANEL_W = 336;
export const PANEL_H = 128;
export const MAX_SHOTS = 6;
export const FLOAT_KEYS = 'CommandOrControl+Alt+N';

export type FloatLook = 'dot' | 'panel' | 'tab';
export interface Rect { x: number; y: number; width: number; height: number }
export interface FloatPlace { x: number; y: number; look: Exclude<FloatLook, 'panel'> }
export interface FloatShot { data: Uint8Array; mime: string; thumb: string }

export interface FloatRpc {
  call<M extends MethodName>(method: M, params?: ParamsOf<M>, timeoutMs?: number): Promise<ResultOf<M>>;
}

/** What the window gives the logic (float-bar-window.ts, a fake in tests). */
export interface FloatWindow {
  bounds(): Rect;
  setBounds(rect: Rect): void;
  /** The work area of the display holding `point` (DIP). */
  workArea(point: { x: number; y: number }): Rect;
  /** The look changed: the page redraws (and the panel gets the keyboard). */
  show(look: FloatLook, focus: boolean): void;
}

export interface FloatDeps {
  rpc: FloatRpc;
  /** A screenshot of the display holding `point`, as JPEG with a small thumbnail. */
  shot(point: { x: number; y: number }): Promise<FloatShot>;
  load(): FloatPlace | null;
  save(place: FloatPlace): void;
  /** Shows the app window at a chat or task (desktop.ts: the window's navigate). */
  open(request: NavigateRequest): void;
  /** The primary display's work area – where a first start puts the dot. */
  primaryArea(): Rect;
  log(line: string): void;
}

/** What the page sees after every action. */
export interface FloatView {
  look: FloatLook;
  shots: string[];
  text: string;
  note?: string;
  done?: boolean;
}

export type FloatAction =
  | { act: 'view' }
  | { act: 'open' }
  | { act: 'close' }
  | { act: 'fold' }
  | { act: 'unfold' }
  | { act: 'shot' }
  | { act: 'drop'; index: number }
  | { act: 'move'; x: number; y: number }
  | { act: 'moved' }
  | { act: 'text'; text: string }
  | { act: 'hear'; wav: string }
  | { act: 'send'; text: string; call?: boolean }
  | { act: 'hold' }
  | { act: 'quick'; wav: string };

/** The window's size in each look (DIP). */
export function sizeOf(look: FloatLook): { width: number; height: number } {
  return look === 'panel' ? { width: PANEL_W, height: PANEL_H } : look === 'tab' ? { width: TAB_W, height: TAB_H } : { width: DOT, height: DOT };
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), Math.max(low, high));

/** `rect` moved fully into `area`. */
export function inside(rect: Rect, area: Rect): Rect {
  return { ...rect, x: clamp(rect.x, area.x, area.x + area.width - rect.width), y: clamp(rect.y, area.y, area.y + area.height - rect.height) };
}

/** The tab glued to the edge nearest the dot, at the dot's height (or width on top/bottom it stays a side tab). */
export function tabAt(dot: Rect, area: Rect): Rect {
  const left = dot.x + dot.width / 2 - area.x < area.x + area.width - (dot.x + dot.width / 2);
  const x = left ? area.x : area.x + area.width - TAB_W;
  return inside({ x, y: dot.y + (dot.height - TAB_H) / 2, width: TAB_W, height: TAB_H }, area);
}

/** The dot coming back from the tab: beside it, inside the work area. */
export function dotFromTab(tab: Rect, area: Rect): Rect {
  const left = tab.x <= area.x + area.width / 2;
  return inside({ x: left ? area.x + 8 : area.x + area.width - DOT - 8, y: tab.y + (TAB_H - DOT) / 2, width: DOT, height: DOT }, area);
}

/** The panel opens from the dot towards the middle of the screen, fully inside the work area. */
export function panelAt(dot: Rect, area: Rect): Rect {
  const right = dot.x + dot.width / 2 > area.x + area.width / 2;
  const below = dot.y + dot.height / 2 > area.y + area.height / 2;
  return inside({
    x: right ? dot.x + dot.width - PANEL_W : dot.x,
    y: below ? dot.y + dot.height - PANEL_H : dot.y,
    width: PANEL_W, height: PANEL_H,
  }, area);
}

/** The dot of a panel that was dragged: the panel's corner the dot opened it from. */
export function dotOfPanel(panel: Rect, area: Rect): Rect {
  const right = panel.x + panel.width / 2 > area.x + area.width / 2;
  const below = panel.y + panel.height / 2 > area.y + area.height / 2;
  return { x: right ? panel.x + panel.width - DOT : panel.x, y: below ? panel.y + panel.height - DOT : panel.y, width: DOT, height: DOT };
}

export class FloatBar {
  private look: FloatLook = 'dot';
  private dot: Rect;
  private shots: FloatShot[] = [];
  private text = '';
  private note: string | undefined;
  private done = false;
  private clientId = randomUUID();
  private busy = false;
  private held: FloatShot | null = null;

  private readonly deps: FloatDeps;
  private readonly window: FloatWindow;

  constructor(deps: FloatDeps, window: FloatWindow) {
    this.deps = deps;
    this.window = window;
    const kept = deps.load();
    const area = deps.primaryArea();
    const start: Rect = kept ? { x: kept.x, y: kept.y, width: DOT, height: DOT } : { x: area.x + area.width - DOT - 16, y: area.y + Math.round(area.height * 0.6), width: DOT, height: DOT };
    this.dot = inside(start, window.workArea(start));
    if (kept?.look === 'tab') this.place('tab', false);
    else this.place('dot', false);
  }

  view(): FloatView {
    return {
      look: this.look, shots: this.shots.map((shot) => shot.thumb), text: this.text,
      ...(this.note ? { note: this.note } : {}), ...(this.done ? { done: true } : {}),
    };
  }

  /** The shortcut: the panel opens (with its screenshot) or closes. */
  async toggle(): Promise<FloatView> {
    return this.look === 'panel' ? this.act({ act: 'close' }) : this.act({ act: 'open' });
  }

  async act(action: FloatAction): Promise<FloatView> {
    this.done = false;
    switch (action.act) {
      case 'view': break;
      case 'open':
        if (this.look === 'tab') this.dot = dotFromTab(this.window.bounds(), this.area());
        this.note = undefined;
        this.place('panel', true);
        await this.takeShot();
        break;
      case 'close': this.place('dot', false); break;
      case 'fold': this.place('tab', false); break;
      case 'unfold': this.dot = dotFromTab(this.window.bounds(), this.area()); this.place('dot', false); break;
      case 'shot': await this.takeShot(); break;
      case 'drop': this.shots.splice(action.index, 1); break;
      case 'move': { // always the look's own size: Windows grows a scaled window that is moved by setPosition alone
        const at = { x: Math.round(action.x), y: Math.round(action.y), ...sizeOf(this.look) };
        this.window.setBounds(inside(at, this.window.workArea(at)));
        break;
      }
      case 'moved': {
        const now = { ...this.window.bounds(), ...sizeOf(this.look) };
        if (this.look === 'dot') this.dot = now;
        else if (this.look === 'panel') this.dot = dotOfPanel(now, this.window.workArea(now));
        if (this.look === 'tab') this.window.setBounds(tabAt(now, this.window.workArea(now)));
        this.keep();
        break;
      }
      case 'text': this.text = action.text.slice(0, 8000); break;
      case 'hear': await this.hear(action.wav); break;
      case 'send': await this.send(action.text, action.call === true); break;
      case 'hold': await this.hold(); break;
      case 'quick': await this.quick(action.wav); break;
    }
    return this.view();
  }

  private area(): Rect {
    return this.window.workArea({ x: this.dot.x + DOT / 2, y: this.dot.y + DOT / 2 });
  }

  private place(look: FloatLook, focus: boolean): void {
    this.look = look;
    const area = this.area();
    const rect = look === 'panel' ? panelAt(this.dot, area) : look === 'tab' ? tabAt(this.dot, area) : inside(this.dot, area);
    this.window.setBounds(rect);
    this.window.show(look, focus);
    this.keep();
  }

  private keep(): void {
    const look = this.look === 'tab' ? 'tab' : 'dot';
    try { this.deps.save({ x: this.dot.x, y: this.dot.y, look }); } catch { /* the place is a convenience */ }
  }

  private async takeShot(): Promise<void> {
    if (this.shots.length >= MAX_SHOTS) { this.note = `${MAX_SHOTS} screenshots at most.`; return; }
    try {
      const middle = { x: this.dot.x + DOT / 2, y: this.dot.y + DOT / 2 };
      this.shots.push(await this.deps.shot(middle));
    } catch (error) {
      this.note = 'No screenshot: ' + message(error);
    }
  }

  /** A hold on the dot began: the screen as it is now (the words follow at the release). */
  private async hold(): Promise<void> {
    try {
      this.held = await this.deps.shot({ x: this.dot.x + DOT / 2, y: this.dot.y + DOT / 2 });
    } catch (error) {
      this.held = null;
      this.deps.log(`float bar hold shot failed: ${message(error)}`);
    }
  }

  /**
   * Owner 18.11.2026 ("drückt einfach nur drauf, spricht rein … und geht in den Task rein mit dem Bildschirm"): the
   * hold's words, heard and posted at once with the hold's shot. When nothing was heard or the post fails, the panel
   * opens with the shot and the words, so nothing is lost.
   */
  private async quick(wav: string): Promise<void> {
    const shot = this.held;
    this.held = null;
    const before = { shots: this.shots, text: this.text, clientId: this.clientId };
    this.shots = shot ? [shot] : [];
    this.text = '';
    await this.hear(wav);
    if (this.text.trim()) {
      this.clientId = randomUUID();
      await this.send(this.text, false);
      if (this.done) { this.shots = before.shots; this.text = before.text; this.clientId = before.clientId; return; }
    } else {
      this.note ??= 'Nothing heard – say it again or type it.';
    }
    this.shots = [...before.shots, ...this.shots].slice(0, MAX_SHOTS);
    this.text = [before.text.trim(), this.text.trim()].filter(Boolean).join(' ');
    this.place('panel', true);
  }

  private async upload(name: string, mime: string, data: Uint8Array): Promise<string> {
    const ref = await this.deps.rpc.call('files.upload', { name, mime, dataBase64: Buffer.from(data).toString('base64') }, 60_000);
    return ref.id;
  }

  private async hear(wav: string): Promise<void> {
    try {
      const data = Buffer.from(wav, 'base64');
      if (data.length < 1000) return; // a tap, not a take
      const fileId = await this.upload(`dictation-${Date.now()}.wav`, 'audio/wav', data);
      const heard = await this.deps.rpc.call('voice.transcribe', { fileId }, 120_000);
      const words = heard.text.trim();
      if (words) this.text = this.text.trim() ? `${this.text.trimEnd()} ${words}` : words;
      this.note = undefined;
    } catch (error) {
      this.note = 'Not heard: ' + message(error);
    }
  }

  private async send(text: string, call: boolean): Promise<void> {
    if (this.busy) return;
    this.text = text.slice(0, 8000);
    if (!this.text.trim() && !this.shots.length) { this.note = 'Type or say what should be done.'; return; }
    this.busy = true;
    try {
      const attachments: Array<{ fileId: string; name: string }> = [];
      for (const [index, shot] of this.shots.entries()) {
        const name = `screen-${index + 1}.jpg`;
        attachments.push({ fileId: await this.upload(name, shot.mime, shot.data), name });
      }
      const { task } = await this.deps.rpc.call('tasks.quickCreate', { text: this.text.trim(), attachments, clientId: this.clientId }, 60_000);
      if (call && task.assigneeKind === 'agent' && task.assigneeId) {
        const chat = await this.deps.rpc.call('chats.direct', { memberId: task.assigneeId });
        this.deps.open({ conversationId: chat.id, call: true });
      } else if (call) {
        this.deps.open({ taskId: task.id });
      }
      this.shots = [];
      this.text = '';
      this.note = undefined;
      this.clientId = randomUUID();
      this.place('dot', false);
      this.done = true;
    } catch (error) {
      this.note = 'Not sent: ' + message(error);
      this.deps.log(`float bar post failed: ${message(error)}`);
    } finally {
      this.busy = false;
    }
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'error';
}
