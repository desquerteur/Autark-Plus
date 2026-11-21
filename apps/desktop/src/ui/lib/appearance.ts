// The window's view on settings.json › appearance (shared/model/appearance.ts): where a chat's tabs dock and how large
// they are (AF-010), read forgivingly from the settings signal and written back whole. A drag shows its live value
// first (`dockLive`) and writes once when it ends. While a dock or a tab is dragged the native website pages step
// aside (`dock-dragging` on <html>; workspace/native-surface.ts hides them), so the pointer never lands in a page.
// Owns: those signals and their writes. Never: geometry rules (the shared model) or the drawing (chat/ChatArea.tsx).

import { computed, effect, signal } from '@preact/signals';
import {
  DEFAULT_CHAT_DOCK, DEFAULT_PANELS, DEFAULT_SCALE, SCALE_KEYS, appearanceOf, chatDockOf, panelOrderOf, scaleOf, stepScale,
  type ChatDock, type DockPlace, type PanelKind, type ScaleTarget,
} from '../../shared/model/appearance.ts';
import { AUTARK_LOOK, themeCss, type CustomTheme } from '../../shared/model/themes.ts';
import { hotkey } from './hotkeys.ts';
import { isTouchApp, layoutZoom } from './platform.ts';
import { settings, updateSettings } from './store.ts';
import { pushToast, toastError } from './toasts.ts';

/** A value a drag shows before it is saved (null: none). */
export const dockLive = signal<Partial<ChatDock> | null>(null);

/** The saved dock, as settings.json says (defaults for anything missing or unusable). */
export const savedDock = computed<ChatDock>(() => chatDockOf(settings.value?.appearance?.chatDock));

/** The dock as the window draws it now: the saved one with a drag's live value over it. */
export const chatDock = computed<ChatDock>(() => ({ ...savedDock.value, ...(dockLive.value ?? {}) }));

/** Writes the dock (the whole object, so every device reads the same) and ends a live value. */
export function saveDock(patch: Partial<ChatDock>): Promise<void> {
  const next = chatDockOf({ ...savedDock.peek(), ...patch });
  return updateSettings({ appearance: { chatDock: next } }).finally(() => { dockLive.value = null; });
}

/** Moves the chat's tabs to `place` (the menu, a drop, Settings › Appearance). */
export function dockAt(place: DockPlace, more: Partial<ChatDock> = {}): void {
  void saveDock({ ...more, place }).catch((error) => toastError(error, 'Could not move the chat tabs'));
}

/** Back to the shipped place and sizes. */
export function resetDock(): void {
  void saveDock({ ...DEFAULT_CHAT_DOCK }).catch((error) => toastError(error));
}

/** A dock or tab drag started (true) or ended (false): native pages hide meanwhile and come back after. */
export function setDockDragging(on: boolean): void {
  document.documentElement.classList.toggle('dock-dragging', on);
  surfacesMoved();
}

/** Tells every native surface to measure again (a slot moved without resizing: a floating window, a dock change). */
export function surfacesMoved(): void {
  document.dispatchEvent(new Event('wf-surfaces-moved'));
}

// ---------------------------------------------------------------- AF-008: themes, panels, reset

/** The whole section as the window reads it (forgiving; defaults for an older runtime). */
export const appearance = computed(() => appearanceOf(settings.value?.appearance));
export const themes = computed(() => appearance.value.themes);
export const activeThemeId = computed(() => appearance.value.theme);
export const panelOrder = computed(() => appearance.value.panels);
export const hiddenPanels = computed(() => appearance.value.hiddenPanels);
/** The theme being edited in Settings › Appearance: the whole window shows it until it is saved or dropped. */
export const themeDraft = signal<CustomTheme | null>(null);

/** The look the window shows now: the draft, else the theme in use, else Autark's own (null). */
export const shownTheme = computed<CustomTheme | null>(() => themeDraft.value ?? themes.value.find((theme) => theme.id === activeThemeId.value) ?? null);

/** Uses theme `id` ('' = Autark's own). */
export function chooseTheme(id: string): void {
  void updateSettings({ appearance: { theme: id } }).catch((error) => toastError(error, 'Could not change the theme'));
}

/** Writes the theme list and the theme in use together (so the id in use is always in the list). */
export function saveThemes(list: CustomTheme[], use = activeThemeId.peek()): Promise<void> {
  return updateSettings({ appearance: { themes: list, theme: list.some((theme) => theme.id === use) ? use : '' } });
}

/** The panels of a new tab: their order and the hidden ones. */
export function savePanels(order: PanelKind[], hidden: PanelKind[]): Promise<void> {
  return updateSettings({ appearance: { panels: panelOrderOf(order), hiddenPanels: hidden } });
}

// ---------------------------------------------------------------- #30: the app's scale

/** Which value this window uses: a phone's for the web app on a touch screen, else the PC's (fixed for the window's life). */
export const scaleTarget: ScaleTarget = typeof window === 'undefined' ? 'desktop' : isTouchApp() ? 'phone' : 'desktop';
/** A value the window shows before it is saved (a slider drag, a key press on its way; null: none). */
export const scaleLive = signal<number | null>(null);
/** The saved scale of this window's kind, in percent. */
export const savedScale = computed(() => appearance.value[SCALE_KEYS[scaleTarget]]);
/** The scale the window shows now, in percent. */
export const uiScale = computed(() => scaleLive.value ?? savedScale.value);

let scaleWrite: Promise<void> = Promise.resolve();
/** Saves a scale (writes queue up, so fast Ctrl + presses land in order); this window's kind shows it at once. */
export function saveScale(value: number, target: ScaleTarget = scaleTarget): Promise<void> {
  const next = scaleOf(value);
  if (target === scaleTarget) scaleLive.value = next;
  scaleWrite = scaleWrite.catch(() => undefined)
    .then(() => updateSettings({ appearance: { [SCALE_KEYS[target]]: next } }))
    .finally(() => { if (target === scaleTarget && scaleLive.peek() === next) scaleLive.value = null; });
  return scaleWrite;
}

/** Ctrl + / Ctrl − / Ctrl 0: one step up, down or back to 100 %, with a short note of the new size. */
export function stepUiScale(step: 1 | -1 | 0): void {
  const now = uiScale.peek();
  const next = stepScale(now, step);
  if (next === now) {
    if (step !== 0) pushToast({ title: `Scale ${now} % – already the ${step > 0 ? 'largest' : 'smallest'}`, tone: 'info' }, 1500);
    return;
  }
  pushToast({ title: `Scale ${next} %`, body: next === DEFAULT_SCALE ? undefined : 'Ctrl 0 goes back to 100 %', tone: 'info' }, 1500);
  void saveScale(next).catch((error) => toastError(error, 'Could not save the scale'));
}

/** The app's own zoom keys (outside a website tab, whose keys zoom the page – workspace/pane-shortcuts.ts). */
function watchScaleKeys(): void {
  for (const combo of ['mod+=', 'mod++', 'mod+shift+=', 'mod+shift++']) hotkey(combo, () => stepUiScale(1));
  for (const combo of ['mod+-', 'mod+shift+-', 'mod+shift+_']) hotkey(combo, () => stepUiScale(-1));
  hotkey('mod+0', () => stepUiScale(0));
}

/** "Reset to default": Autark's own look and layout; the person's themes stay in the list. */
export async function resetAppearance(): Promise<void> {
  themeDraft.value = null;
  scaleLive.value = null;
  await updateSettings({
    appearance: { theme: '', chatDock: { ...DEFAULT_CHAT_DOCK }, panels: [...DEFAULT_PANELS], hiddenPanels: [], uiScale: DEFAULT_SCALE, uiScalePhone: DEFAULT_SCALE },
    preferences: { theme: 'system', sidebarOpen: true, sidebarWidth: 288, workspaceWidth: 420 },
  });
}

/** Applies the shown theme: its custom properties under <data>/theme.css (which still wins) and data-accent on <html>. */
export function applyAppearance(): void {
  const style = document.createElement('style');
  style.id = 'wf-appearance';
  const custom = document.getElementById('wf-theme-css');
  if (custom) custom.before(style); else document.head.append(style);
  effect(() => {
    const theme = shownTheme.value;
    const css = theme ? themeCss(theme) : '';
    if (style.textContent !== css) style.textContent = css;
    document.documentElement.toggleAttribute('data-accent', Boolean(theme?.accent));
    const scale = uiScale.value;
    if (scale === DEFAULT_SCALE) document.documentElement.style.removeProperty('--ui-scale');
    else document.documentElement.style.setProperty('--ui-scale', String(scale / 100));
    layoutZoom.value = (scale / 100) * ((theme?.textSize ?? AUTARK_LOOK.textSize) / 100); // the phone layout's threshold
    surfacesMoved(); // a new text size or scale moves every native page's slot
  });
  watchScaleKeys();
}
