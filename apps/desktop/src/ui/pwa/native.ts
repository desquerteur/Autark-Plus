// The page inside one of Autark's phone apps: the Android app (apps/android: its WebView adds "AutarkAndroid/" to the
// user agent) or the iPhone web app (the website's shell, window.autarkHosted – pwa/hosted.ts). What the web UI does
// differently there – no "Install app" row, Back from the app's own Back (window.autarkBack, back.ts; the iPhone app
// calls it from an edge swipe), and "Forget this phone" (Settings › Devices since B-084): the Android app takes it over
// its port (native-port.ts) or, before the port is there, intercepts the autark-app: address, and asks before it clears
// this company's pairing; the iPhone app asks, then clears its own. The apps have no toolbar of their own, so the phone
// looks like the web UI.
// Owns: those facts. Never: talks to the Android app other than through the port or an autark-app: address the person
// taps (no JavaScript bridge object).

import { hostedShell } from './hosted.ts';
import { sendNative } from './native-port.ts';

/** The address the app's WebView intercepts for "Forget this phone" (MainActivity / PhoneNavigation). */
export const FORGET_ADDRESS = 'autark-app:forget';

/** True inside the Autark Android app. */
export function isAndroidApp(agent: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): boolean {
  return /\bAutarkAndroid\//.test(agent);
}

/** True inside the iPhone web app (the website's shell loaded this PC's UI). */
export function inHostedApp(): boolean {
  return hostedShell() !== undefined;
}

/** True inside either phone app (Android or the iPhone web app). */
export function isPhoneApp(): boolean {
  return isAndroidApp() || inHostedApp();
}

/** "Forget this phone": the app asks, then clears its pairing and shows its connect screen. */
export function forgetThisPhone(): void {
  const hosted = hostedShell();
  if (hosted) { void hosted.forget(); return; }
  if (!sendNative({ t: 'forget' })) location.href = FORGET_ADDRESS;
}
