// Owns: level 2b's one input – the 9-digit Remote ID in a large centred field on the number keyboard, grouped 3-3-3
// while typing ("482 913 071"), cut at 9 digits, with its "Connect" enabled exactly at 9 digits and the keyboard's Go
// doing the same. Never: autofill, saved state, or any text that is not digits and the group spaces.
package com.teydralab.autark.android.pair;

import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.text.method.DigitsKeyListener;
import android.view.Gravity;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.widget.EditText;
import android.widget.TextView;

final class CodeField {
    private CodeField() {}

    /** The field with value filled in; connect is enabled at 9 digits; edited runs after each change. */
    static EditText create(PairLook look, String value, TextView connect, Runnable go, Runnable edited) {
        EditText field = new EditText(look.activity);
        field.setKeyListener(DigitsKeyListener.getInstance("0123456789 "));
        field.setRawInputType(InputType.TYPE_CLASS_NUMBER);
        field.setSingleLine(true);
        field.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO);
        field.setSaveEnabled(false);
        field.setTextSize(30);
        field.setLetterSpacing(0.08f);
        field.setTextColor(look.ink);
        field.setHintTextColor(look.line);
        field.setHint("000 000 000");
        field.setGravity(Gravity.CENTER);
        field.setBackground(look.round(look.card, 16, look.line));
        field.setImeOptions(EditorInfo.IME_ACTION_GO);
        PairLook.enable(connect, false);
        field.addTextChangedListener(new TextWatcher() {
            private boolean busy;
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) {}
            @Override public void afterTextChanged(Editable text) {
                if (busy) return;
                String numbers = text.toString().replaceAll("\\D", "");
                if (numbers.length() > 9) numbers = numbers.substring(0, 9);
                String grouped = numbers.replaceAll("(\\d{3})(?=\\d)", "$1 ");
                if (!grouped.equals(text.toString())) { busy = true; text.replace(0, text.length(), grouped); busy = false; field.setSelection(text.length()); }
                PairLook.enable(connect, numbers.length() == 9);
                edited.run();
            }
        });
        field.setText(value);
        field.setOnEditorActionListener((view, action, event) -> { if (connect.isEnabled()) go.run(); return true; });
        return field;
    }
}
