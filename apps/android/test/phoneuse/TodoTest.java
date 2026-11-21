// Owns: executable checks of the to-do button's pure parts without a device – where it sits (TodoPlace: drag or tap,
// whole on the screen, the tab's side, the panel beside the dot and above the keyboard, the screenshot's size), what one
// post sends (TodoPost: at most six shots, one client id per post until it went through, the files.upload and
// tasks.quickCreate frames, the answers read) and the overlay's wiring read from its source (the AI's screenshot leaves
// the button out, the window takes key focus only in the panel). Never: claims the overlay shows or a task arrives – that
// needs a phone and a PC.
package com.teydralab.autark.android.phoneuse;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class TodoTest {
    private static int assertions;

    public static void main(String[] args) throws Exception {
        place();
        post();
        wiring(source("app/src/main/java/com/teydralab/autark/android/phoneuse/TodoButton.java"),
                source("app/src/main/java/com/teydralab/autark/android/phoneuse/UseService.java"),
                source("app/src/main/java/com/teydralab/autark/android/phoneuse/UseLink.java"));
        System.out.println(assertions + " to-do button place, post and wiring assertions passed.");
    }

    private static void place() {
        check(!TodoPlace.dragged(3, 4, 8) && TodoPlace.dragged(6, 7, 8) && !TodoPlace.dragged(0, 8, 8)); // the slop is a tap
        check(TodoPlace.clamp(-20, 100, 1080) == 0 && TodoPlace.clamp(1000, 100, 1080) == 980 && TodoPlace.clamp(500, 100, 1080) == 500);
        check(TodoPlace.clamp(10, 2000, 1080) == 0); // wider than the screen: at its start
        check(TodoPlace.droppedAtEdge(10, 1080, 42) && TodoPlace.droppedAtEdge(1050, 1080, 42) && !TodoPlace.droppedAtEdge(540, 1080, 42) && !TodoPlace.droppedAtEdge(43, 1080, 42));
        check(TodoPlace.left(100, 120, 1080) && !TodoPlace.left(900, 120, 1080) && !TodoPlace.left(480, 120, 1080));
        check(TodoPlace.sideX(true, 30, 1080) == 0 && TodoPlace.sideX(false, 30, 1080) == 1050);
        int[] right = TodoPlace.panel(20, 300, 120, 700, 400, 1080, 2400); // dot on the left: the panel opens to its right
        check(right[0] == 20 && right[1] == 300);
        int[] left = TodoPlace.panel(940, 300, 120, 700, 400, 1080, 2400); // dot on the right: the panel ends at its right edge
        check(left[0] == 360 && left[1] == 300);
        int[] low = TodoPlace.panel(940, 2300, 120, 700, 400, 1080, 2400); // near the bottom: whole on the screen
        check(low[1] == 2000);
        check(TodoPlace.aboveKeyboard(100, 400, 2400) == 100); // already above the keyboard
        check(TodoPlace.aboveKeyboard(1500, 400, 2400) == Math.round(2400 * TodoPlace.ABOVE_KEYBOARD) - 400);
        check(TodoPlace.aboveKeyboard(1500, 2000, 2400) == 0);
        check(Arrays.equals(TodoPlace.shotSize(1080, 2400), new int[] {720, 1600}));
        check(Arrays.equals(TodoPlace.shotSize(2400, 1080), new int[] {1600, 720}));
        check(Arrays.equals(TodoPlace.shotSize(720, 1600), new int[] {720, 1600}) && Arrays.equals(TodoPlace.shotSize(800, 600), new int[] {800, 600}));
    }

    private static void post() {
        TodoPost post = new TodoPost();
        for (int i = 0; i < TodoPost.MAX; i++) check(post.add(new byte[] {(byte) i}));
        check(post.full() && !post.add(new byte[] {9}) && post.shots().size() == TodoPost.MAX);
        List<TodoPost.Shot> shots = post.shots();
        post.remove(shots.get(0));
        check(!post.full() && post.shots().size() == TodoPost.MAX - 1);
        check("screen-1.jpg".equals(post.name(shots.get(1))) && "screen-5.jpg".equals(post.name(shots.get(5))));
        String id = post.clientId();
        check(id.equals(post.clientId()) && id.length() == 36); // a retry keeps it
        post.clear();
        check(post.shots().isEmpty() && !id.equals(post.clientId())); // the next post is a new task
        TodoPost fresh = new TodoPost();
        fresh.adopt("quick-1");
        check("quick-1".equals(fresh.clientId())); // a failed quick task hands its id to the panel
        fresh.adopt("quick-2");
        check("quick-1".equals(fresh.clientId())); // never over an id of its own

        Map<String, Object> upload = TodoPost.upload("screen-1.jpg", new byte[] {1, 2, 3});
        check(upload.keySet().equals(new java.util.LinkedHashSet<>(Arrays.asList("name", "mime", "dataBase64"))));
        check("image/jpeg".equals(upload.get("mime")) && Arrays.equals(Base64.getDecoder().decode((String) upload.get("dataBase64")), new byte[] {1, 2, 3}));
        check("abc".equals(TodoPost.fileId(map("id", "abc", "name", "x"))) && "f1".equals(TodoPost.fileId(map("fileId", "f1"))));
        check(TodoPost.fileId(null) == null && TodoPost.fileId(map("id", "")) == null && TodoPost.fileId("x") == null);

        List<String[]> files = new ArrayList<>();
        files.add(new String[] {"abc", "screen-1.jpg"});
        Map<String, Object> create = TodoPost.create("Fix the login", files, "cid");
        check(create.keySet().equals(new java.util.LinkedHashSet<>(Arrays.asList("text", "attachments", "clientId")))); // no target: Autark picks
        check("Fix the login".equals(create.get("text")) && "cid".equals(create.get("clientId")));
        check(create.get("attachments").equals(Arrays.asList(map("fileId", "abc", "name", "screen-1.jpg"))));
        check(!TodoPost.create("Only text", new ArrayList<>(), "c").containsKey("attachments"));

        String[] task = TodoPost.task(map("task", map("id", "t1", "assigneeKind", "agent", "assigneeId", "ag_7", "title", "x")));
        check(task != null && "t1".equals(task[0]) && "ag_7".equals(TodoPost.callee(task)));
        check(TodoPost.callee(TodoPost.task(map("task", map("id", "t2", "assigneeKind", "team")))) == null);
        check(TodoPost.callee(TodoPost.task(map("task", map("id", "t3", "assigneeKind", "human", "assigneeId", "per_1")))) == null);
        check(TodoPost.task(map("task", map("assigneeKind", "agent"))) == null && TodoPost.task(null) == null && TodoPost.callee(null) == null);
    }

    private static void wiring(String button, String service, String link) {
        // The AI's screenshot and the button's both go through capture(), which hides the bubble and the button for the frame.
        check(service.contains("bubble.hideForShot();\n            if (button != null) button.hideForShot();"));
        check(service.contains("full = capture();") && service.split("takeScreenshot\\(", -1).length == 2); // one screenshot path
        // Collapsed it never takes key focus or touches outside itself.
        check(button.contains("FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL"));
        check(button.contains("if (next != Look.PANEL) focusable(false);"));
        check(button.contains("TYPE_ACCESSIBILITY_OVERLAY"));
        // JPEG 85, the post's client id reused, the text only in the RPC (no log of it, no preference of it).
        check(button.contains("CompressFormat.JPEG, 85"));
        check(button.contains("String[] task = deliver(link, text, post);") && button.contains("TodoPost.create(text, attachments, from.clientId())"));
        check(button.contains("HOLD_MS = 350") && button.contains("if (held) { holdRelease(); return true; }")); // the hold is the quick task
        check(!button.contains("putString(") && !button.matches("(?s).*Log\\.[a-z]\\([^;]*text[^;]*\\);.*"));
        // A call's answer is matched by id; a socket that ends fails every call still waiting.
        check(link.contains("calls.remove(((Number) frame.get(\"id\")).intValue())") && link.contains("failCalls();"));
    }

    private static Map<String, Object> map(Object... pairs) {
        Map<String, Object> map = new LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) map.put((String) pairs[i], pairs[i + 1]);
        return map;
    }

    private static String source(String path) throws Exception {
        return new String(Files.readAllBytes(Paths.get(System.getProperty("autark.android"), path)), StandardCharsets.UTF_8).replace("\r\n", "\n");
    }

    private static void check(boolean value) { assertions++; if (!value) throw new AssertionError("Unexpected result " + assertions); }
}
