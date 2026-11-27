// Playwright and the app both attach a debugger to native website views. On lexivers a new view can stay
// loading with an empty URL until the debugger handshake completes (#27). Await the resume command before
// starting the short title/layout assertion timeout. An unawaited timer does not provide that barrier.
// Test profiles only: no production behavior, security settings or page assertions are changed.
export async function resumeNativePages(app) {
  await app.evaluate(async ({ webContents }) => {
    await new Promise((resolve) => setTimeout(resolve, 1000)); // let the address IPC create its native view
    await Promise.all(webContents.getAllWebContents()
      .filter((contents) => !contents.isDestroyed() && !contents.getURL() && contents.debugger.isAttached())
      .map((contents) => contents.debugger.sendCommand('Runtime.runIfWaitingForDebugger')));
  });
}
