// Owns: hearing that the phone's default network changed (B-084) – one ConnectivityManager callback per process; a new
// network, the loss of the current one or another network taking over calls check() on the current PhoneConnection, so
// the link proves itself within seconds instead of after the 65 s watchdog. Needs ACCESS_NETWORK_STATE in the manifest.
// Never: polls, keeps a connection itself, or reads anything about the network beyond which one is the default.
// The only relay/* file with Android imports (the others compile on a host JVM for the tests).
package com.teydralab.autark.android.relay;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;

public final class NetworkWake extends ConnectivityManager.NetworkCallback {
    private static NetworkWake registered;
    private static volatile PhoneConnection target;
    private Network last;
    private boolean seen;

    private NetworkWake() {}

    /** Points the callback at `connection` (null: nobody) and registers it the first time. */
    public static synchronized void register(Context context, PhoneConnection connection) {
        target = connection;
        if (registered != null) return;
        ConnectivityManager manager = context.getApplicationContext().getSystemService(ConnectivityManager.class);
        if (manager == null) return;
        NetworkWake callback = new NetworkWake();
        try { manager.registerDefaultNetworkCallback(callback); registered = callback; }
        catch (RuntimeException error) { /* no permission or too many callbacks: resume and the watchdog still check */ }
    }

    @Override public void onAvailable(Network network) { changed(network); }

    @Override public void onCapabilitiesChanged(Network network, NetworkCapabilities capabilities) { changed(network); }

    @Override public synchronized void onLost(Network network) {
        if (!network.equals(last)) return;
        last = null;
        wake();
    }

    /** The first callback after registering names the network the link already uses; every other network is news. */
    private synchronized void changed(Network network) {
        if (network.equals(last)) return;
        boolean first = !seen;
        seen = true;
        last = network;
        if (!first) wake();
    }

    private static void wake() {
        PhoneConnection connection = target;
        if (connection != null) connection.check();
    }
}
