---
name: app-look
description: I read this when the person asks to change how this app looks - colours, fonts, spacing, sizes, hiding or restyling parts of the window - which I do by editing theme.css in the Autark data folder.
metadata:
  modes:
    - none
---

# The app's look: theme.css

The app's look is one file: `theme.css` in the Autark data folder (my prompt names the folder; light/dark/system
is `preferences.theme` in `settings.json`, see the skill app-settings). Whatever the file says is applied at once in
the window and on connected phones, after the app's own styles. Deleting the file brings the shipped look back.

1. I read `theme.css` if it exists. Before a big change, I copy it next to it (e.g. `theme.before.css`) so I can go back.
2. I write plain CSS. The app's design tokens beat single elements - they change every place at once:
   `:root { --surface: …; --text: …; --sidebar: …; --chrome: …; --focus: …; --font: … }`
   Dark mode: `:root[data-theme=dark] { … }` (and `@media (prefers-color-scheme: dark) { :root[data-theme=system] { … } }`
   for "as the system"). Other tokens: --secondary, --muted, --line, --hover, --selected, --field, --elevated (menus
   and popovers, with their own --elevated-hover, --elevated-selected, --elevated-line), --danger, --warn, --success,
   --row-h, --msg-gap.
3. For one part of the window, I find its class with the person's screenshot or my computer-use tools and style it.
4. I check the result on screen (a screenshot of the window) and tell the person what changed and how to undo it.

## Three ready palettes

When the person wants a look rather than a single change, one of these is a good start; I write it whole and repeat
its dark block inside `@media (prefers-color-scheme: dark) { :root[data-theme=system] { … } }`.

```css
/* Ocean */
:root { --chrome: #eaf1f6; --sidebar: #eef4f8; --surface: #fbfdfe; --elevated: #fbfdfe; --elevated-hover: #e2ebf1; --elevated-selected: #d5e2eb; --elevated-line: #d3dee6; --text: #10212e; --secondary: #3e5566; --muted: #607686; --line: #d3dee6; --hover: #e2ebf1; --selected: #d5e2eb; --field: #c4d3de; --focus: #2f78a8; }
:root[data-theme=dark] { --chrome: #0e1a24; --sidebar: #112130; --surface: #15283a; --elevated: #1d3449; --elevated-hover: #274259; --elevated-selected: #2f4c66; --elevated-line: #3a5872; --text: #e4eef5; --secondary: #b9cad7; --muted: #8ea5b6; --line: #2a4258; --hover: #1c3347; --selected: #24405a; --field: #36536c; --focus: #5aa8dc; }

/* Forest */
:root { --chrome: #edf1eb; --sidebar: #f1f4ef; --surface: #fcfdfb; --elevated: #fcfdfb; --elevated-hover: #e4eae2; --elevated-selected: #d7e0d4; --elevated-line: #d5ddd3; --text: #18241b; --secondary: #435446; --muted: #627464; --line: #d5ddd3; --hover: #e4eae2; --selected: #d7e0d4; --field: #c6d1c3; --focus: #3d7a4f; }
:root[data-theme=dark] { --chrome: #121a14; --sidebar: #152018; --surface: #1a271d; --elevated: #233427; --elevated-hover: #2d4232; --elevated-selected: #354c3a; --elevated-line: #405a45; --text: #e5efe6; --secondary: #bccbbe; --muted: #93a796; --line: #2f4233; --hover: #213125; --selected: #2a3e2f; --field: #3a523f; --focus: #6cbf86; }

/* Sunset */
:root { --chrome: #f8efe9; --sidebar: #faf2ec; --surface: #fffbf8; --elevated: #fffbf8; --elevated-hover: #f3e3d9; --elevated-selected: #ecd5c7; --elevated-line: #ead8cd; --text: #2a1a14; --secondary: #5e4337; --muted: #7d6155; --line: #ead8cd; --hover: #f3e3d9; --selected: #ecd5c7; --field: #e0c6b6; --focus: #c4622d; }
:root[data-theme=dark] { --chrome: #1e1412; --sidebar: #231715; --surface: #2a1c19; --elevated: #392723; --elevated-hover: #45302b; --elevated-selected: #4f3832; --elevated-line: #5e443c; --text: #f5e9e3; --secondary: #dcc5ba; --muted: #b59a8e; --line: #4a332d; --hover: #362521; --selected: #45302a; --field: #5a3f37; --focus: #f08a52; }
```

A new view is a page: a file `<data>/pages/<name>.html` becomes a row on every tab area's "+" page (the global pane, each chat's area) and reaches the whole app (skill
`app-data-model`, with a small example). A tool for one conversation is a ```app mini-tool in the chat (tool `ui.help`, topic "app").
