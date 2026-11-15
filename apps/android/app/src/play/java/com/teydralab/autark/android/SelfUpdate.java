// Owns: the Play build's side of updates (flavor play): there is no own download or install – Google Play updates the
// app itself (Play's policy: an app from Play updates only through Play); UpdateCheck reads no feed for this build and
// its line is the neutral "Check in Google Play".
// Never: downloads or installs an APK, or asks for REQUEST_INSTALL_PACKAGES.
package com.teydralab.autark.android;

import android.app.Activity;
import java.util.Map;

final class SelfUpdate {
    static final boolean BUILT = false;

    private SelfUpdate() {}

    static boolean busy() { return false; }

    static void attach(Activity activity, UpdateBar.Progress progress) {}

    static void start(Activity activity, Map<String, Object> release, UpdateBar.Progress progress, Runnable retry) {}

    static void resumed(Activity activity, UpdateBar.Progress progress) {}
}
