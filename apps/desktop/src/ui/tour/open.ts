// B-055: opening the feedback tour from anywhere (the command palette's "Watch how it works", Settings › Feedback,
// the spotlight tour's feedback step – AF-002: the setup assistant does not show it). The player (ui/tour/TourPlayer.tsx)
// is mounted by the shell while `tourOpen` is true. `tourAutoplay` opens it already playing (upstream B-090; the click is
// the user gesture). Feedback 16.11.2026 (F15): the iPhone web app's first start after pairing opens it playing too
// (shell/Shell.tsx, pwa/native.ts).
// The variant (the computer's or the phone's tour) is the opening's: `tourVariant` keeps it while the tour is open, so a
// window that crosses the phone breakpoint meanwhile – the shell mounts its overlays afresh then (shell/Shell.tsx) –
// goes on with the same tour.
// Owns: the open/close signal and the opening's variant. Never: the player or its timeline.

import { signal } from '@preact/signals';
import type { Variant } from './scene-layout.ts';

/** True while the tour is shown as a dialog over the app (not the first-run step). */
export const tourOpen = signal(false);

/** True when this opening starts playing at once instead of at its poster. */
export const tourAutoplay = signal(false);

/** The variant this opening plays (set by the dialog when it first shows; null while closed). */
export const tourVariant = signal<Variant | null>(null);

export function openTour(options: { autoplay?: boolean } = {}): void { tourAutoplay.value = Boolean(options.autoplay); tourOpen.value = true; }
export function closeTour(): void { tourOpen.value = false; tourAutoplay.value = false; tourVariant.value = null; }
