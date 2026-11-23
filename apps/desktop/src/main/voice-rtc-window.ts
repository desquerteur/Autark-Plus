// Owner 07.11.2026: the Electron side of the voice job (voice-rtc.ts): a hidden window in a private in-memory session of
// its own ('wf-voice-rtc', no cache) – apart from the media analyzer's, whose "only its own origin" rule stays as it is.
// The session refuses every permission and device (no microphone: the take is played into the track by the page) and
// cancels every HTTP request that is not for wf-file://voice-rtc; its wf-file:// requests go to voice-rtc.ts's routes.
// The page may start audio without a gesture (an AudioContext would stay suspended otherwise), the window's sound is
// muted and WebRTC offers only the default route's interface (no VPN or other adapters' addresses). No preload, no
// node, no devtools, no popups, no navigation.
// Owns: the window and session options. Never: imports electron values (hidden-windows.ts injects them), touches the
// default session, the media analyzer's session or the app window.

import type { BrowserWindow, BrowserWindowConstructorOptions, Session } from 'electron';
import { RTC_ORIGIN, type RtcServe, type RtcWindow } from './voice-rtc.ts';

/** No "persist:" prefix: memory only, never shared. */
export const RTC_PARTITION = 'wf-voice-rtc';

export interface ElectronRtcDeps {
  BrowserWindow: new (options: BrowserWindowConstructorOptions) => BrowserWindow;
  fromPartition(partition: string, options: { cache: boolean }): Session;
}

/** `VoiceRtcDeps.open` for Electron; the private session is set up on the first window. */
export function electronRtcWindows(deps: ElectronRtcDeps): (serve: RtcServe) => RtcWindow {
  let serving: RtcServe = async () => new Response(null, { status: 410 });
  let prepared: Session | null = null;
  const privateSession = (): Session => {
    if (prepared) return prepared;
    const session = deps.fromPartition(RTC_PARTITION, { cache: false });
    session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.setPermissionCheckHandler(() => false);
    session.setDevicePermissionHandler(() => false);
    session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith(`${RTC_ORIGIN}/`) }));
    session.protocol.handle('wf-file', (request) => serving(request));
    prepared = session;
    return session;
  };

  return (serve) => {
    serving = serve;
    const window = new deps.BrowserWindow({
      width: 160, height: 90, useContentSize: true, show: false, frame: false, skipTaskbar: true, focusable: false, resizable: false,
      webPreferences: {
        session: privateSession(), sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: false,
        webSecurity: true, webviewTag: false, backgroundThrottling: false, spellcheck: false, devTools: false,
        safeDialogs: true, navigateOnDragDrop: false, webgl: false, autoplayPolicy: 'no-user-gesture-required',
      },
    });
    const contents = window.webContents;
    contents.setAudioMuted(true);
    contents.setWebRTCIPHandlingPolicy('default_public_and_private_interfaces');
    contents.on('will-navigate', (event) => event.preventDefault());
    contents.on('will-frame-navigate', (event) => event.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const gone = new Set<() => void>();
    const fire = () => { for (const listener of [...gone]) listener(); };
    contents.on('render-process-gone', fire);
    window.on('closed', fire);
    return {
      load: (url) => window.loadURL(url),
      onGone: (listener) => { gone.add(listener); },
      destroy: () => {
        gone.clear();
        if (!window.isDestroyed()) window.destroy();
      },
    };
  };
}
