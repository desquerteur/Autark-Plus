// Owns: whether the person agreed to the in-app disclosure for phone use (UseDisclosure), and whether this build has phone
// use at all (the playLite build removes the AccessibilityService from its manifest). Phone use stays off in every way –
// no "ready", no steps, no enable prompt – until the agreement is stored. Never: agrees by itself.
package com.teydralab.autark.android.phoneuse;

import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;

public final class UseConsent {
    /** Raise when the disclosure's meaning changes: everyone is asked again. */
    static final int VERSION = 1;
    private static final String KEY = "disclosureAgreed";

    private UseConsent() {}

    private static SharedPreferences preferences(Context context) {
        return context.getApplicationContext().getSharedPreferences("phone-use-disclosure", Context.MODE_PRIVATE);
    }

    /** Whether this build carries the phone-use service (false in the Play build without it). */
    public static boolean available(Context context) {
        try {
            context.getPackageManager().getServiceInfo(new ComponentName(context, UseService.class), 0);
            return true;
        } catch (PackageManager.NameNotFoundException | RuntimeException error) {
            return false;
        }
    }

    public static boolean agreed(Context context) { return preferences(context).getInt(KEY, 0) >= VERSION; }

    static void agree(Context context) { preferences(context).edit().putInt(KEY, VERSION).apply(); }

    static void revoke(Context context) { preferences(context).edit().remove(KEY).apply(); }
}
