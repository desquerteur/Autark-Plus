// Owns: the one rule "who updates this app": an app installed from Google Play is updated only by Play (Play's policy
// bars any other self-update). Pure, so a host test pins it; UpdateCheck asks it with the installer package name.
// Never: Android classes.
package com.teydralab.autark.android;

final class InstallSource {
    static final String PLAY_STORE = "com.android.vending";

    private InstallSource() {}

    /** True when the app may offer its own update (a sideloaded APK); false for an install from Google Play. */
    static boolean selfUpdates(String installerPackage) { return !PLAY_STORE.equals(installerPackage); }
}
