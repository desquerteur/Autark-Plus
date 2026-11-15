// B-055: opening the feedback tour from anywhere (the command palette's "Watch how it works"; B-085: the
// first run's choice card opens it too). The player (ui/tour/TourPlayer.tsx) is mounted by the shell while
// `tourOpen` is true. B-090 (owner 13.11.2026: "wenn man eine neue Company auswählt, dass man dann das Video sieht"):
// "Set up a new company" opens it already playing (`tourAutoplay`; the click is the user gesture).
// Owns: the open/close signal. Never: the player or its timeline.

import { signal } from '@preact/signals';

/** True while the tour is shown as a dialog over the app (not the first-run step). */
export const tourOpen = signal(false);

/** True when this opening starts playing at once instead of at its poster. */
export const tourAutoplay = signal(false);

export function openTour(options: { autoplay?: boolean } = {}): void { tourAutoplay.value = Boolean(options.autoplay); tourOpen.value = true; }
export function closeTour(): void { tourOpen.value = false; tourAutoplay.value = false; }
