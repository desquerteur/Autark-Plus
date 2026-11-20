# Autark desktop – style

The app's look comes from the theme tokens in `src/ui/styles/tokens.css` (light, dark and the person's own themes,
AF-008). Components use tokens only – no hard-coded colors. This file lists what each area uses; add to it when a
screen's look changes.

## Base (all screens)

| What | Token / value |
|---|---|
| Font | `--font` (UI), `--mono` (paths, SHAs, code) |
| Text | `--text`; secondary `--secondary`; quiet `--muted` |
| Surfaces | `--surface` (cards), `--field` (inputs, composers), `--sidebar` |
| Lines | `--line`; on hover `--elevated-line` |
| States | hover `--hover`, selected `--selected`, focus ring `--focus` (2 px) |
| Signals | `--warn` (changes), `--danger` (missing / destructive), `--success`, `--update` (drop target) |
| Radii | `--r-sm` rows, `--r-md` drop outlines, `--r-lg` cards, `--r-composer` composers |
| Shadows | `--shadow-composer` for composers |
| Row text | `.row-title` 14/20, `.row-preview` 12/18 muted (chat.css) |

## Projects (AF-018) – `src/ui/styles/projects.css`

- **Rail / phone tab:** icon `folders` (assets/icons/folders.svg), after Chats.
- **Sidebar list:** rows min-height 48 px, padding 0 8 px, radius `--r-sm`; folder icon 16 px in `--secondary`;
  pin 12 px `--muted`; changed-files badge 18 px high, radius 9 px, `--warn` on 18 % `--warn`. Sessions of the open
  project indent 22 px with a 1 px `--line` guide, 13 px text, a 6 px `--muted` dot (spinner while working).
- **Drop target:** 2 px dashed `--update` at 60 %, offset −6 px, radius `--r-md`.
- **Start page:** column max 640 px, padding 48/24 px; title 24/32 600; lead 14/22 `--secondary`; cards in a grid
  `minmax(240px, 1fr)`, gap 12 px, max 880 px; card padding 14/16 px, 1 px `--line`, radius `--r-lg`, `--surface`.
- **Project page:** column max 760 px, gap 20 px, padding 24 px. The session field is the page's focus: `--field`,
  1 px `--line` (focus: `--focus`), radius `--r-composer`, `--shadow-composer`, 16/24 text, min 96 px high, a primary
  "Start session" button. Facts as a 110 px label column (`--secondary`) and a value column, 13/20.
- **Narrow (≤ 640 px):** paddings 16 px, facts stack in one column.
- **Agents and side chat (AF-020):** an "Agents" section on the page – rows radius `--r-sm` (hover `--hover`, the
  chatting one `--selected`), avatar 28 px with its status, name 13/18 600, line 12/16 `--muted`, then two small icon
  cells: crown (lead; pressed in `--update`) and agent page. The lead comes first with a "Lead" pill: 18 px high,
  radius 9 px, crown 12 px, 11 px 600 `--update` on 16 % `--update`. Beside the page the side chat: width
  clamp(360 px, 46 %, 560 px), 1 px `--line` on its left, a 52 px top line (avatar, name with the pill, status line,
  "Open as full chat"), then the chat column (messages, composer) like the chat view. A main zone under 760 px stacks
  the chat under the page (45 % / 55 %); the phone has no side chat – an agent opens its 1:1.

## Agent directory (AF-017) – `src/ui/styles/agent-directory.css`

- **Place:** `#/team`'s main page (desktop; the org chart stays in the sidebar, with an "All agents" row on top), a tab
  "All agents" beside "Org chart" on the phone. Column max 980 px, padding 24/clamp(16 px, 4vw, 40 px).
- **Head:** title 20/28 600 with the count in `--muted`; lead 13/20 `--secondary`; search 36 px high, 1 px `--line`,
  radius `--r-md`; filter chips 28 px, radius 14 px, pressed = `--text` fill on `--surface` text; Group by as 28 px
  segments (pressed `--selected` + `--shadow-raised`).
- **Rows:** one bordered list per group (1 px `--line`, radius `--r-lg`), rows min 72 px, grid avatar 36 px · name/role/
  status · project/team/hired · actions. A new hire: row tinted 7 % `--update`, an 18 px `--update` "New" pill. Status
  dot 7 px: working `--success`, waiting `--warn`, error `--danger`, idle `--muted`. Project as a 22 px pill (dashed
  and `--muted` for "No project"). Buttons `.button.small` (28 px, 12 px text). ≤ 860 px: meta and actions move under
  the name.
- **"New agent" card in the chat:** 1 px `--line` with a 3 px `--update` left edge, radius `--r-lg`, avatar 36 px,
  kicker "New agent:" in `--update` 12 px 600, facts 12/18 `--secondary`, actions on the right (below on the phone).
- **Agent names as links:** in messages underlined in `--update`, 600; in Team activity and the agent tree only a
  hover underline in `--update`.

## Dictation countdown (AF-017, Autark-Plus#18)
- **Chip:** over the composer's action-row spacer, 42 px from the left (after Plus), absolute so no cell moves; 26 px
  high, radius 13 px, padding 0 10/0 8 px, 1 px `--line`, `--surface`, 12 px `--secondary` ("Sending · Cancel");
  hover `--text` on `--hover`. A 2 px `--focus` bar along its bottom shrinks to zero in 2 s (none with reduced motion).
- **Mic while a take runs (chat composer):** the 36 px cell shows `check` (Done) instead of `stop`; Send stays enabled.

## Title row – one browser button – `src/ui/shell/WindowBar.tsx`, `src/ui/styles/shell.css`

- The title row has **one** browser button: the `globe` icon (18 px) in the frame's 32 px cell at the right end, right before the feedback cell (`.frame-workspace-cell`, same place on every page; no other cell moves).
- In a chat it is **Chat tabs** (`data-cell="browser"`): it opens and closes the chat's tabs, shows as pressed while they are open, and gets a dot when an agent's new tab is waiting. The chat header no longer has its own globe; only Call stays next to the title.
- On other pages it shows and hides the global browser pane (`data-cell="workspace"`, "Show/Hide browser").
- One browser at a time: in a chat, opening the chat's tabs closes a global pane that was opened elsewhere.
- The `browsers` icon is gone from the title row.

## Schedules (#20) – `src/ui/styles/schedules-tab.css`
- Destination "Schedules" (icon `alarm`) sits between Projects and Team in the rail and as a phone tab; its pages follow the Projects tab's layout (sidebar list, start page with cards, page with a 680 px column).
- Sidebar row: 16 px kind icon, title (`.row-title`), rule in words and next run (`.row-preview`, muted); a paused row's title is `--muted`; the open row uses `--selected`, hover `--hover`.
- Start page and cards: same tokens as the Projects cards (`--surface`, `--line`, `--r-lg`, hover `--hover` / `--elevated-line`).
- Form: one column, 14 px gaps, labels 13 px `--secondary`, the rule fields reuse the composer's `.schedule-bar` rules (rows wrap here); the line above Save is `--muted`, errors `--danger`.
- Page: title 24/32 semibold, facts as a two-column list (90 px label), history rows 13/20 with a 1 px `--line` rule; outcome `failed` is `--danger`, `skipped` and `ended` are `--warn`. A routine's run ends in a 12 px text button "Task" ("Open task" when skipped) at the row's right edge that opens the task in Work.
- Kind "For me" (a timer – the person's own reminder): no agent, chat or Important; the text field reads "Remind me of".
- Phone (≤ 640 px): 16 px side padding, facts stack.

## Report issue (Autark-Plus) – `src/ui/feedback/IssuePreview.tsx`, `src/ui/styles/feedback.css`
- Where: under the result line of the feedback form (a saved report that did not go to the team) and in Settings › Feedback › Review.
- Box: 12px padding, 1px `--line` border, `--r-sm` radius, `--sidebar` background; children 8px apart.
- Head: title 13px/600 `--text` (one line, ellipsis), repository 12px `--muted` beside it.
- Labels: pills, 1px `--line`, 11px `--secondary`, 18px high.
- Body preview ("What goes out"): monospace 12/16px `--secondary`, max 160px high with its own scroll, pre-wrap.
- Ticks: the feedback checkboxes (`.feedback-check`) – "Page it happened on", "Log excerpt (warnings, redacted)"; both off by default.
- Hint: 11/16px `--muted`; action: one primary button ("Create issue" with a GitHub app, else "Open on GitHub").
- Filed: state pill (open: `--success` on 14% of it; closed: `--muted` on 16%), repository, ghost "Open".
