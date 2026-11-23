// Owns: the total of open notifications and the browser's app-icon badge, shared by page and worker.
// A bundled chat notice carries its message count; older notices count once. A read notice kept for iOS counts zero.
// Never: asks for permission, keeps a second counter, or changes the notification tray.

interface Notice { data?: unknown }
interface BadgeNavigator {
  setAppBadge?(count: number): Promise<void>;
  clearAppBadge?(): Promise<void>;
}

/** The worker serializes this with push delivery, so a page cannot overwrite a newer badge with an older total. */
export function requestBadgeSync(registration: Pick<ServiceWorkerRegistration, 'active'> | null): void {
  registration?.active?.postMessage({ type: 'wf.badge' });
}

export function noticeCount(notices: readonly Notice[]): number {
  return notices.reduce((total, notice) => {
    const count = (notice.data as { count?: unknown } | null)?.count;
    return total + (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 ? count : 1);
  }, 0);
}

/** Unsupported browsers keep their native notification dot; a denied badge leaves delivery unaffected. */
export async function syncAppBadge(registration: Pick<ServiceWorkerRegistration, 'getNotifications'> | null, navigator: unknown): Promise<void> {
  const nav = navigator as BadgeNavigator | undefined;
  if (!registration || !nav?.setAppBadge) return;
  try {
    const count = noticeCount(await registration.getNotifications());
    if (count || !nav.clearAppBadge) await nav.setAppBadge(count);
    else await nav.clearAppBadge();
  } catch (error) {
    console.warn('[pwa] app badge update failed', error);
  }
}
