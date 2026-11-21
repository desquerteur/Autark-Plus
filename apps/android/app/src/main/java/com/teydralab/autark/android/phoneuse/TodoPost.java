// Owns: one to-do the person is putting together in the to-do button (TodoButton) – its screenshots (JPEG bytes, at most
// MAX, each with the file id once files.upload took it, so a second Send uploads nothing twice), the client id of this
// post (made once, the same on every retry until it went through: tasks.quickCreate then answers the first task, never a
// second one) and the frames the PC gets (files.upload, tasks.quickCreate). Pure, so a host test pins it.
// Never: Android classes, or the person's text anywhere but the tasks.quickCreate frame.
package com.teydralab.autark.android.phoneuse;

import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

final class TodoPost {
    static final int MAX = 6;

    /** One screenshot: its JPEG, and its file id on the PC once uploaded. */
    static final class Shot {
        final byte[] jpeg;
        volatile String fileId;
        Shot(byte[] jpeg) { this.jpeg = jpeg; }
    }

    private final List<Shot> shots = new ArrayList<>();
    private String clientId;

    /** Adds a shot; false when MAX are there already. */
    synchronized boolean add(byte[] jpeg) {
        if (shots.size() >= MAX) return false;
        shots.add(new Shot(jpeg));
        return true;
    }

    synchronized boolean full() { return shots.size() >= MAX; }

    synchronized void remove(Shot shot) { shots.remove(shot); }

    synchronized List<Shot> shots() { return Collections.unmodifiableList(new ArrayList<>(shots)); }

    /** This post's client id: made at the first Send, the same on every retry until clear(). */
    synchronized String clientId() {
        if (clientId == null) clientId = UUID.randomUUID().toString();
        return clientId;
    }

    /** Takes over a quick task's client id whose post failed when this post has none yet (it may have arrived after all: a retry then answers that task). */
    synchronized void adopt(String id) { if (clientId == null) clientId = id; }

    /** The post went through: no shots, the next Send makes a new task. */
    synchronized void clear() { shots.clear(); clientId = null; }

    /** The upload's file name: screen-1.jpg, screen-2.jpg … in the order they go up. */
    synchronized String name(Shot shot) { return "screen-" + (shots.indexOf(shot) + 1) + ".jpg"; }

    static Map<String, Object> upload(String name, byte[] jpeg) {
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("name", name);
        params.put("mime", "image/jpeg");
        params.put("dataBase64", Base64.getEncoder().encodeToString(jpeg));
        return params;
    }

    /** The file id in files.upload's answer – the stored file's `id` (FileRef), or `fileId`; null when neither is there. */
    static String fileId(Object result) {
        if (!(result instanceof Map)) return null;
        Object id = ((Map<?, ?>) result).get("id");
        if (!(id instanceof String)) id = ((Map<?, ?>) result).get("fileId");
        return id instanceof String && !((String) id).isEmpty() ? (String) id : null;
    }

    /** tasks.quickCreate's params: the text, the uploaded shots as attachments, this post's client id – no target (Autark picks the owner). */
    static Map<String, Object> create(String text, List<String[]> attachments, String clientId) {
        List<Map<String, Object>> files = new ArrayList<>();
        for (String[] file : attachments) {
            Map<String, Object> one = new LinkedHashMap<>();
            one.put("fileId", file[0]);
            one.put("name", file[1]);
            files.add(one);
        }
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("text", text);
        if (!files.isEmpty()) params.put("attachments", files);
        params.put("clientId", clientId);
        return params;
    }

    /** The task in tasks.quickCreate's answer {task:{id, assigneeKind, assigneeId}}: {id, kind, assignee}, or null. */
    static String[] task(Object result) {
        if (!(result instanceof Map)) return null;
        Object task = ((Map<?, ?>) result).get("task");
        if (!(task instanceof Map)) return null;
        Map<?, ?> t = (Map<?, ?>) task;
        if (!(t.get("id") instanceof String)) return null;
        return new String[] { (String) t.get("id"), t.get("assigneeKind") instanceof String ? (String) t.get("assigneeKind") : null,
                t.get("assigneeId") instanceof String ? (String) t.get("assigneeId") : null };
    }

    /** The agent a call goes to: the task's assignee when it is an agent, else null (the task opens instead). */
    static String callee(String[] task) {
        return task != null && "agent".equals(task[1]) && task[2] != null && !task[2].isEmpty() ? task[2] : null;
    }
}
