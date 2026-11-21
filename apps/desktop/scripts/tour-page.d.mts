// Types of scripts/tour-page.mjs (the Android app's feedback video page).

export const TOUR_PAGE_ENTRIES: { script: string; style: string };
export function bundleTourPage(options?: { minify?: boolean }): Promise<string>;
export function writeTourPage(out: string, options?: { minify?: boolean }): Promise<number>;
