// Owns: a public door for the host test to the package-private InstallSource. Never: used by the app.
package com.teydralab.autark.android;

public final class InstallSourceProbe {
    private InstallSourceProbe() {}

    public static boolean selfUpdates(String installer) { return InstallSource.selfUpdates(installer); }
}
