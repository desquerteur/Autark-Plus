// Owns: the look of the system bar areas (B-084 decision 2). The app keeps its native inset padding – nothing of the UI
// sits under the clock, battery or gesture pill – and paints the two inset areas itself: a top strip in the page's header
// colour and a bottom strip in its tab-bar colour (the page's 'colors' port message; until then the theme's tones per
// light/dark mode), with dark or light bar icons picked from the colour's luminance. Android 8–10 (the window fits the
// bars) gets the same colours as the bar colours. Never: draws the UI under the bars, reads the page itself, or moves
// anything – the strips only change colour; their height is the bar height.
package com.teydralab.autark.android;

import android.app.Activity;
import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Build;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.widget.LinearLayout;

final class SystemBars {
    private static volatile SystemBars installed;
    private final Window window;
    private final ViewGroup root;
    private final View top;
    private final View bottom;
    private final int defaultTop;
    private final int defaultBottom;

    private SystemBars(Activity activity, ViewGroup root) {
        boolean dark = (activity.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        this.window = activity.getWindow();
        this.root = root;
        this.defaultTop = dark ? 0xFF202020 : 0xFFF3F3F3; // the page's --chrome
        this.defaultBottom = dark ? 0xFF232323 : 0xFFF5F5F5; // the page's --sidebar (tab bar)
        this.top = new View(activity);
        this.bottom = new View(activity);
    }

    /**
     * Call once in onCreate right after setContentView(root), with root holding its children (the update line, then
     * content): root is that vertical LinearLayout; content is the area below the update line (it gets the surface tone).
     */
    @SuppressWarnings("deprecation")
    static void install(Activity activity, ViewGroup root, View content) {
        SystemBars bars = new SystemBars(activity, root);
        boolean dark = bars.defaultTop == 0xFF202020;
        content.setBackgroundColor(dark ? 0xFF2B2B2B : Color.WHITE); // the page's --surface
        root.addView(bars.top, 0, new LinearLayout.LayoutParams(-1, 0));
        root.addView(bars.bottom, new LinearLayout.LayoutParams(-1, 0));
        if (Build.VERSION.SDK_INT >= 29) { bars.window.setNavigationBarContrastEnforced(false); bars.window.setStatusBarContrastEnforced(false); }
        if (Build.VERSION.SDK_INT >= 30) {
            bars.window.setDecorFitsSystemWindows(false);
            bars.window.setStatusBarColor(Color.TRANSPARENT);
            bars.window.setNavigationBarColor(Color.TRANSPARENT);
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets edge = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime() | WindowInsets.Type.displayCutout());
                view.setPadding(edge.left, 0, edge.right, 0);
                bars.height(bars.top, edge.top);
                bars.height(bars.bottom, edge.bottom);
                return WindowInsets.CONSUMED;
            });
        }
        installed = bars;
        bars.paint(bars.defaultTop, bars.defaultBottom);
    }

    /** The page's header and tab-bar colours (CSS strings); null or unreadable → the theme's tone. Any thread. */
    static void apply(String top, String bottom) {
        SystemBars bars = installed;
        if (bars == null) return;
        int topColor = CssColor.parse(top, bars.defaultTop), bottomColor = CssColor.parse(bottom, bars.defaultBottom);
        bars.root.post(() -> { if (installed == bars) bars.paint(topColor, bottomColor); });
    }

    private void height(View strip, int px) {
        ViewGroup.LayoutParams params = strip.getLayoutParams();
        if (params.height == px) return;
        params.height = px;
        strip.setLayoutParams(params);
    }

    @SuppressWarnings("deprecation")
    private void paint(int topColor, int bottomColor) {
        top.setBackgroundColor(topColor);
        bottom.setBackgroundColor(bottomColor);
        root.setBackgroundColor(bottomColor); // the side insets in landscape
        boolean lightTop = CssColor.light(topColor), lightBottom = CssColor.light(bottomColor);
        if (Build.VERSION.SDK_INT >= 30) {
            // From the decor view: Window.getInsetsController() throws (NPE) while the window has no decor yet (B-084 start crash).
            WindowInsetsController controller = window.getDecorView().getWindowInsetsController();
            if (controller == null) return;
            int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
            controller.setSystemBarsAppearance((lightTop ? WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS : 0)
                    | (lightBottom ? WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS : 0), mask);
            return;
        }
        window.setStatusBarColor(topColor);
        window.setNavigationBarColor(bottomColor);
        View decor = window.getDecorView();
        int flags = decor.getSystemUiVisibility() & ~(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        if (lightTop) flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        if (lightBottom) flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        decor.setSystemUiVisibility(flags);
    }
}
