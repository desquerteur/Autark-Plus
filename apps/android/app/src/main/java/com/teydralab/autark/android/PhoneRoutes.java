// Owns: the few places of the phone UI that a notification, a home-screen shortcut or a share may open (#/chats,
// #/tasks, #/day, #/chat/<id>, #/settings/<page>, the router's own hashes), and which 'notify' event becomes a phone
// notification (every kind but 'info', unless its chat is quiet: toast false) with its route (the notice's own place,
// e.g. a connect request's #/settings/devices, else its chat, else #/day), tag and count (chat messages accumulate;
// a task remains one outstanding notice). A task's own tag takes precedence over the chat it belongs to.
// Pure, so a host test pins it. Never: Android classes, or a route with characters a script string could break out of.
package com.teydralab.autark.android;

final class PhoneRoutes {
    /** The intent extra that carries a route (notifications, shortcuts in res/xml/shortcuts.xml). */
    static final String EXTRA = "route";

    private PhoneRoutes() {}

    /** The route when it is one of the phone UI's places, else null. */
    static String valid(String route) {
        if (route == null) return null;
        if (route.equals("#/chats") || route.equals("#/tasks") || route.equals("#/day")) return route;
        return route.matches("#/chat/[A-Za-z0-9._~-]{1,200}") || route.matches("#/settings/[a-z-]{1,40}") ? route : null;
    }

    /** The place a page address shows ("#/…" of plain characters, e.g. to restore it after the activity was recreated), or null. */
    static String place(String url) {
        int at = url == null ? -1 : url.indexOf('#');
        String hash = at < 0 ? null : url.substring(at);
        return hash != null && hash.matches("#/[A-Za-z0-9._~/-]{1,300}") ? hash : null;
    }

    /** A chat's route, or null for an id the route cannot carry as it is. */
    static String chat(String conversationId) {
        return conversationId == null ? null : valid("#/chat/" + conversationId);
    }

    /** A 'notify' event's route (its own `route` when that is a phone UI place), or null when the phone shows nothing for it. */
    static String forNotice(String kind, Object toast, String conversationId, String route) {
        if (kind == null || kind.equals("info") || Boolean.FALSE.equals(toast)) return null;
        if (valid(route) != null) return route;
        String chat = chat(conversationId);
        return chat != null ? chat : "#/day";
    }

    /** One notification per chat (or task); a newer one replaces it. */
    static String tag(String conversationId, String taskId) {
        if (taskId != null && !taskId.isEmpty()) return "task:" + taskId;
        if (conversationId != null && !conversationId.isEmpty()) return "chat:" + conversationId;
        return "day";
    }

    /** Number represented by one bundled notification; null is a newly opened notice, zero an older uncounted one. */
    static int noticeCount(String tag, Integer previous) {
        return tag != null && tag.startsWith("chat:") && previous != null
                ? (int) Math.min(Integer.MAX_VALUE, Math.max(1L, previous.longValue()) + 1) : 1;
    }
}
