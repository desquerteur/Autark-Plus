# Autark-Plus

**An independent, extended build of the Autark desktop app: an AI team with a personal manager, projects, account fallback and a customizable interface.**

Desktop (Windows, macOS, Linux) · Android and iPhone web app · headless Linux server mode · Apache-2.0

[![Autark-Plus: a project with its agents, branch state and a side chat with the project lead](docs/images/project-light.png)](docs/images/project-light.png)

**[Download](#download)** · **[Feature matrix](#feature-matrix)** · **[Explore the gallery](#screenshot-gallery)** · **[Test results](docs/TEST_RESULTS.md)** · **[Open points](#open-points)** · **[All documentation](docs/README.md)**

> **Autark-Plus is a standalone project by [Noriel (desquerteur)](https://github.com/desquerteur), not the original and not an official Autark release.**
> It is built on **Autark / OpenAutark by Teydra Lab** ([teydra/OpenAutark](https://github.com/teydra/OpenAutark), created by Stanislaus Hees,
> [openautark.com](https://openautark.com)), licensed under the Apache License 2.0. All credit for the foundation goes to the original authors:
> the agent runtime, the team model, memory, tasks, the apps and the website come from there. Everything described under
> [what Autark-Plus adds](#2-what-autark-plus-adds) was built on top by this project. The Apache notices, the copyright line and the
> licence texts are kept (see [License and credit](#license-and-credit)). The name "Autark" and its logo stay with their owners
> (Apache-2.0 section 6): Autark-Plus is an independent fork, not endorsed by Teydra.
> Want the original? Use [teydra/OpenAutark](https://github.com/teydra/OpenAutark) and its [downloads](https://openautark.com/download/).

## Contents

- [Introduction](#introduction)
- [Feature matrix](#feature-matrix): [original](#1-original-autark-features) · [Plus extras](#2-what-autark-plus-adds) · [original still missing](#3-original-features-still-missing-or-planned) · [Plus planned](#4-autark-plus-extras-still-planned)
- [Screenshot gallery](#screenshot-gallery)
- [Where things are](#where-things-are)
- [First launch and guided tour](#first-launch-and-guided-tour)
- [Try a task with a checkable answer](#try-a-task-with-a-checkable-answer)
- [Download](#download) · [Installing](#installing) · [Updates](#updates)
- Own pages: [Accounts, fallback and Gemini](docs/ACCOUNTS_AND_GEMINI.md) · [Linux headless](docs/LINUX_HEADLESS.md) · [Project isolation](docs/PROJECT_ISOLATION.md) · [Updates from this repository](docs/UPDATES.md)
- [Settings and privacy](#settings-and-privacy)
- [Tests and observed results](#tests-and-observed-results)
- [Open points](#open-points)
- [Building from source](#building-from-source) · [Repository layout](#repository-layout) · [The public library](#the-public-library)
- [Contributing and security](#contributing-and-security)
- [License and credit](#license-and-credit)

## Introduction

**Autark gives you an ongoing AI team instead of one chat window.** You talk to a personal manager; colleagues with roles, memory and
tasks do the work, and you inspect what comes back. Autark-Plus keeps that idea and adds the things that were missing in daily use:
working in several code projects at once, surviving a used-up AI plan, and an interface you can shape.

- **Projects:** a Projects tab with your folders, their branch and changed files, their agents and sessions. Type what should happen and an agent works in exactly that folder.
- **Account fallback:** with several plans or keys, a used-up account no longer stops the work; the next one stands in and the chat says so. Google Gemini accounts work side by side.
- **Access you choose:** read-only, ask first, automatic inside the project folder, or full access, per agent and per chat.
- **Your own look:** themes, drag-and-drop layout, chat tabs docked right, left, top, bottom or floating.
- **Calm multi-agent view, prompt queue, Stop button, dictate-and-send, a call screen that looks like a call.**
- **A guided start:** a four-step setup and a spotlight tour through the whole app.
- **Runs without a window on Linux** and updates itself from this repository.

Bring your own supported model access (Claude Code, Codex, Gemini, API keys or a local model server). Cloud models receive the prompts
sent to them; running the app on your PC does not make cloud inference local. Agents act with the access you give them: this is not a
sandbox, and not every action waits for approval unless you choose a mode that asks (see [Settings and privacy](#settings-and-privacy)).

Downloads and repository source are separate artifacts. Read each release's notes and checksums; a version label alone does not prove that a
binary was built from the source tag you are reading.

## Feature matrix

One place for everything: what comes from the original Autark, what Autark-Plus adds, and what is still missing or planned on either side.
As of **21 November 2026** (release **0.3.11**, `main` at `fda74c1`).

**Status:** ✅ **Done** – in the released 0.3.11 · ✅ **Done on main** – merged, ships with the next release ·
🔄 **In progress** – being built or merged · 🗓️ **Planned** – has an issue, not started · ⏭️ **Not taken** – on purpose, reason given

**Upstream:** Autark-Plus extras and fixes that fit the original are proposed to it as issues on [teydra/OpenAutark](https://github.com/teydra/OpenAutark/issues) (#7–#29, filed 21 November 2026); the *Upstream* column links the issue or says why a row was not proposed.

### 1. Original Autark features

These come from [Autark / OpenAutark by Teydra Lab](https://github.com/teydra/OpenAutark). Autark-Plus is built on the original's source of
11 November 2026 (the state before its 0.3.6), so every area below is in Autark-Plus. The original's own feature list is at
[openautark.com/product](https://openautark.com/product/). What the original added **after** that date is in [section 3](#3-original-features-still-missing-or-planned).

| Area | Features | Status |
| --- | --- | --- |
| **Your AI company** | Personal manager that builds the team; agents with names, avatars and their own `SYSTEM.md`; delegation between agents; an agent can split itself into parallel parts; bring in Claude Code subagents, `AGENTS.md` or CrewAI roles; invite people by link or QR code | ✅ Done |
| **Chats and work** | Direct and group chats; normal / important / quiet messages; Work inbox with *Auto* routing; My day; Team page; calendar (ICS feed, Google Calendar); send later and routines; to-dos that become widgets (recorder, teleprompter, timer, form); tables, charts and diagrams in answers; tabs beside the chat | ✅ Done |
| **Proactive by design** | Wake-ups from messages, tasks, timers, schedules and events; keeps running from the tray; start with Windows / at login; results checked against a done-condition; retries after a lost connection or used-up plan | ✅ Done |
| **The AI you already pay for** | Claude Code and Codex plans; Gemini CLI, Copilot CLI and Kimi Code over the Agent Client Protocol; engine, account, model and effort per turn with quota bars; soonest-reset quota first; context ledger across engines; API keys (OpenAI, Anthropic, Google, OpenRouter, Groq, Mistral, xAI, DeepSeek …) and local servers (Ollama, LM Studio, llama.cpp, vLLM); one model per use | ✅ Done |
| **An open system** | `settings.json` with comments, applied live; settings pages on that file; skills and memory as open Markdown files; providers through a file; a browser per chat and per agent; Files tab; `last-prompt.md`; the `wf` CLI and HTTP interface; `theme.css`; agents build their own WhatsApp / Telegram bridges | ✅ Done |
| **Reaches your real tools** | An agent's own off-screen browser with live view; computer use (Windows UI Automation, Linux AT-SPI); your Android phone over ADB; MCP servers in `connectors/mcp.json`; Settings › Apps catalog; any REST API; email over IMAP/SMTP; Telegram mirror | ✅ Done |
| **Memory that stays** | Search by meaning (local model or an embedding provider); a subconscious beside each agent; forget on request; context IDs with compaction and restore | ✅ Done |
| **Voice, phone and more PCs** | Dictation and calls (optionally OpenAI Realtime); local speech-to-text and read-aloud; Android app and iPhone web app over Remote ID; several PCs mirrored as one | ✅ Done |
| **Access, secrets and the brake** | Secrets only as `secret://` handles, masked in model text; the brake **Ctrl+Alt+Shift+X**; backups of the data folder and database before each update; the "how far may I go" first question | ✅ Done |
| **Yours, on your computer** | Data in one folder on your PC, open file formats, Apache-2.0 source | ✅ Done |

### 2. What Autark-Plus adds

Everything here is on top of the original; where the original already had a thing, it is not listed. Evidence links go to the commit.
"Unit-tested" means the matching tests pass ([test report](docs/TEST_RESULTS.md)); it does not mean every system was tried by hand.

| Feature | What it does | Status | Evidence | Still open | Upstream |
| --- | --- | --- | --- | --- | --- |
| **Projects tab** | Folders as projects with branch, changes, last commit, sessions and a "What should happen in …?" field; project lead (crown); side chat; project chip; command palette entries | ✅ Done | [9ab0945](https://github.com/desquerteur/Autark-Plus/commit/9ab0945), [64eaaa3](https://github.com/desquerteur/Autark-Plus/commit/64eaaa3), UI test [40ca9fc](https://github.com/desquerteur/Autark-Plus/commit/40ca9fc) | Not yet used for a long real coding session | [#7](https://github.com/teydra/OpenAutark/issues/7) |
| **Project isolation** | An agent in a project reaches only its project's agents and you ([page](docs/PROJECT_ISOLATION.md)) | ✅ Done | [27f2819](https://github.com/desquerteur/Autark-Plus/commit/27f2819) (22 tests) | Not exercised with live agents | [#8](https://github.com/teydra/OpenAutark/issues/8) |
| **Agent from a folder** | Pick, drag in or right-click a folder; the agent reads `CLAUDE.md` / `AGENTS.md` and the project's skills | ✅ Done | [82d540f](https://github.com/desquerteur/Autark-Plus/commit/82d540f) | - | [#9](https://github.com/teydra/OpenAutark/issues/9) |
| **Agent directory** | Every agent in one place, grouped by project, team or status | ✅ Done | [f310ffc](https://github.com/desquerteur/Autark-Plus/commit/f310ffc) | - | [#10](https://github.com/teydra/OpenAutark/issues/10) |
| **Accounts and fallback** | Several accounts per provider; account choice per chat and per agent; "If used up" order; effort slider ([page](docs/ACCOUNTS_AND_GEMINI.md)) | ✅ Done | [c2419fc](https://github.com/desquerteur/Autark-Plus/commit/c2419fc), [6635a01](https://github.com/desquerteur/Autark-Plus/commit/6635a01) (65 tests) | Merge with upstream's declining-model skip: [#35](https://github.com/desquerteur/Autark-Plus/issues/35) | [#11](https://github.com/teydra/OpenAutark/issues/11) |
| **Google Gemini accounts** | Sign in with Google (Gemini CLI installed for you) or an API key; several accounts; quota-aware | ✅ Done; sign-in hang fixed on main | [509b0e6](https://github.com/desquerteur/Autark-Plus/commit/509b0e6), fix [3fa2dca](https://github.com/desquerteur/Autark-Plus/commit/3fa2dca) ([#24](https://github.com/desquerteur/Autark-Plus/issues/24)) | In 0.3.11 the sign-in can still hang; the fix ships with the next release | [#12](https://github.com/teydra/OpenAutark/issues/12) |
| **Grok accounts** | Grok Build plan (SuperGrok / X Premium+) on the ACP engine; current xAI models | ✅ Done on main | [03322f3](https://github.com/desquerteur/Autark-Plus/commit/03322f3) ([#28](https://github.com/desquerteur/Autark-Plus/issues/28)) | - | [#13](https://github.com/teydra/OpenAutark/issues/13) |
| **Plan limit bars** | No empty "5-hour limit" bar for plans that report only a weekly window | ✅ Done on main | [b560c13](https://github.com/desquerteur/Autark-Plus/commit/b560c13) ([#25](https://github.com/desquerteur/Autark-Plus/issues/25)) | - | [#28](https://github.com/teydra/OpenAutark/issues/28) (bug fix) |
| **Access modes** | Read only, ask first, automatic in the project folder, full access; per agent and per chat; rules and approval requests | ✅ Done | [646cc7e](https://github.com/desquerteur/Autark-Plus/commit/646cc7e) | - | [#14](https://github.com/teydra/OpenAutark/issues/14) |
| **Personality** | Tone, address, language, emoji, length, free text; global and per agent; presets | ✅ Done | [f4301fe](https://github.com/desquerteur/Autark-Plus/commit/f4301fe) | - | [#15](https://github.com/teydra/OpenAutark/issues/15) |
| **Appearance and layout** | Own themes with live preview; layout by drag and drop; chat tabs dockable on every side; reset to default | ✅ Done | [abee4cb](https://github.com/desquerteur/Autark-Plus/commit/abee4cb), [af54b20](https://github.com/desquerteur/Autark-Plus/commit/af54b20) | Window test `chat-dock` fails here ([#27](https://github.com/desquerteur/Autark-Plus/issues/27)) | [#16](https://github.com/teydra/OpenAutark/issues/16) |
| **App-wide scale** | Text and UI size 80–150 %, separate for PC and phone, Ctrl +/−/0 | ✅ Done on main | [00d7e10](https://github.com/desquerteur/Autark-Plus/commit/00d7e10) ([#30](https://github.com/desquerteur/Autark-Plus/issues/30)) | - | [#17](https://github.com/teydra/OpenAutark/issues/17) |
| **One browser button** | One globe in the title row: the chat's tabs inside a chat, the global pane elsewhere | ✅ Done | [e2c49b8](https://github.com/desquerteur/Autark-Plus/commit/e2c49b8) | - | [#18](https://github.com/teydra/OpenAutark/issues/18) |
| **Connectors** | GitHub, Google, Notion, Slack, Discord, your own MCP server (stdio or HTTP), `mcpServers` JSON import; a closed local app shows as "not running" | ✅ Done (quiet Fusion status on main) | [087fa6a](https://github.com/desquerteur/Autark-Plus/commit/087fa6a), [bdd68b0](https://github.com/desquerteur/Autark-Plus/commit/bdd68b0) ([#26](https://github.com/desquerteur/Autark-Plus/issues/26)) | - | [#19](https://github.com/teydra/OpenAutark/issues/19), fix [#29](https://github.com/teydra/OpenAutark/issues/29) |
| **Skills from links** | Install from a GitHub URL, a `SKILL.md` or a ZIP, with preview and later updates | ✅ Done | [bb66882](https://github.com/desquerteur/Autark-Plus/commit/bb66882), live test [764fc70](https://github.com/desquerteur/Autark-Plus/commit/764fc70) | - | [#20](https://github.com/teydra/OpenAutark/issues/20) |
| **Composer** | Send turns into Stop while an agent works; per-chat prompt queue; dictate and send by itself | ✅ Done | [5cc53ca](https://github.com/desquerteur/Autark-Plus/commit/5cc53ca), [f149012](https://github.com/desquerteur/Autark-Plus/commit/f149012), [e0fe7a3](https://github.com/desquerteur/Autark-Plus/commit/e0fe7a3) | - | [#21](https://github.com/teydra/OpenAutark/issues/21) |
| **Calls** | A call screen that looks like a call: status, duration, mute, hang-up, call card with transcript | ✅ Done | [7a4f141](https://github.com/desquerteur/Autark-Plus/commit/7a4f141) | Not tested with a real voice model | [#22](https://github.com/teydra/OpenAutark/issues/22) |
| **Schedules tab** | Own sidebar and phone tab: list, form, plain-words rules, next runs, history, pause / run now / edit / delete; reminders for you | ✅ Done | [b478028](https://github.com/desquerteur/Autark-Plus/commit/b478028), [b700695](https://github.com/desquerteur/Autark-Plus/commit/b700695) ([#20](https://github.com/desquerteur/Autark-Plus/issues/20)) | Reminders in My day: [#34](https://github.com/desquerteur/Autark-Plus/issues/34) | [#23](https://github.com/teydra/OpenAutark/issues/23) |
| **Onboarding** | Four-step setup and a 24-step spotlight tour | ✅ Done | [bdd8353](https://github.com/desquerteur/Autark-Plus/commit/bdd8353) | Window test `spotlight-tour` not confirmed green ([#27](https://github.com/desquerteur/Autark-Plus/issues/27)) | [#24](https://github.com/teydra/OpenAutark/issues/24) |
| **Agents write as agents** | Chat tools always available; `wf` messages carry the agent's name; restarts capped; no inherited agent token in `shell.exec` | ✅ Done | [7c6be7c](https://github.com/desquerteur/Autark-Plus/commit/7c6be7c), [f4d8192](https://github.com/desquerteur/Autark-Plus/commit/f4d8192) ([#2](https://github.com/desquerteur/Autark-Plus/issues/2)) | - | [#25](https://github.com/teydra/OpenAutark/issues/25) |
| **Report issue → GitHub** | A feedback report becomes an issue in this repository, with a duplicate check | ✅ Done; look-up fix on main | [a4df521](https://github.com/desquerteur/Autark-Plus/commit/a4df521), fix [c195b66](https://github.com/desquerteur/Autark-Plus/commit/c195b66) ([#29](https://github.com/desquerteur/Autark-Plus/issues/29)) | In 0.3.11 a title with an open bracket can fail; fixed on main | Not proposed: fork-only (upstream has its own feedback receiver) |
| **Feedback** | Sent, confirmed with a number, failures visible and logged | ✅ Done | [6b2090e](https://github.com/desquerteur/Autark-Plus/commit/6b2090e) | No feedback receiver configured; reports go to GitHub issues instead | Not proposed: upstream 0.3.8 covers it |
| **Updates from this repository** | Source, channel and automatic check in Settings; Windows update helper without console windows; 0.3.10 → 0.3.11 updated by itself ([page](docs/UPDATES.md)) | ✅ Done | [3d00dd2](https://github.com/desquerteur/Autark-Plus/commit/3d00dd2), [074dda6](https://github.com/desquerteur/Autark-Plus/commit/074dda6), [3c0c762](https://github.com/desquerteur/Autark-Plus/commit/3c0c762) ([#1](https://github.com/desquerteur/Autark-Plus/issues/1)) | 0.3.8 cannot install updates by itself: install 0.3.11 once by hand | Fix [#27](https://github.com/teydra/OpenAutark/issues/27) (missing installer); the update source is fork-only, the helper console upstream fixed itself |
| **Local release builds** | One script builds Windows x64, macOS arm64/x64, Linux x64/arm64 (tar.gz, AppImage, deb) and the Android APK with checksums ([RELEASING](docs/RELEASING.md)) | ✅ Done | [e9000e3](https://github.com/desquerteur/Autark-Plus/commit/e9000e3), [3a0572a](https://github.com/desquerteur/Autark-Plus/commit/3a0572a) | GitHub Actions locked on this account, so builds run on the release PC | Not proposed: workaround, upstream builds in CI |
| **Headless Linux** | Run without a window as a service; pair a browser or phone with a link and code ([page](docs/LINUX_HEADLESS.md)) | ✅ Done | [8b6696b](https://github.com/desquerteur/Autark-Plus/commit/8b6696b) (11 tests) | **Not yet run on a real Linux host** | [#26](https://github.com/teydra/OpenAutark/issues/26) |

### 3. Original features still missing or planned

The original moved on from 0.3.6 to 0.3.16 after Autark-Plus branched off. All of it is being merged in one real `git merge` of the
original's 0.3.16 into Autark-Plus. The merge is done locally and is being tested; it is **not on `main` yet**. Every Autark-Plus
feature from section 2 stays; where both sides solve the same thing, the note says how they fit together.

| Original feature (version) | Status in Autark-Plus | Note |
| --- | --- | --- |
| Subconscious per turn: opens notes, keeps the model, adjusts effort (0.3.6) | 🔄 In progress (upstream merge) | Our effort slider stays your override |
| One context per agent across chats; condensed tool output; context folding after a step (0.3.6, 0.3.10) | 🔄 In progress (upstream merge) | Lower cost, fewer new sessions |
| Public skill library at library.openautark.com (0.3.6) | 🔄 In progress (upstream merge) | Sits beside *Skills from links* |
| `SYSTEM.md` is the whole prompt; new colleagues pick their name; parts start fresh from their brief (0.3.6) | 🔄 In progress (upstream merge) | Compatible with *Personality* |
| Live bar above the input, addressed messages, agent activity list (0.3.6) | 🔄 In progress (upstream merge) | Coexists with our prompt queue and Stop button |
| Manager greeting on first start, intro video (0.3.6) | 🔄 In progress (upstream merge) | Runs after our four-step setup |
| Phone: Codex/Claude sign-in, re-sign-in task, more PC settings (0.3.6) | 🔄 In progress (upstream merge) | |
| Dictation through the ChatGPT plan in one call; correction of the local fallback (0.3.6, 0.3.8) | 🔄 In progress (upstream merge) | Coexists with dictate-and-send |
| Quitting stays quit; updates always go through (0.3.6, 0.3.11) | 🔄 In progress (upstream merge) | Complements our update-helper fix ([#1](https://github.com/desquerteur/Autark-Plus/issues/1)) |
| Private closing text no longer leaks into a chat; two companies on one PC no longer share a port (0.3.7) | 🔄 In progress (upstream merge) | Bug fixes |
| Stop per agent beside the live line (0.3.8) | 🔄 In progress (upstream merge) | Extends our Send → Stop |
| Account rail with only accounts in use, "Paused on <PC>"; "why nothing can run" line (0.3.8) | 🔄 In progress (upstream merge) | Merged with our account pictures and fallback rows |
| One Claude Code / Codex login per PC for all companies; moving a Claude login between companies (0.3.8) | 🔄 In progress (upstream merge) | Our separate Gemini CLI homes stay |
| Feedback: auto-close, mark done, expiry, frozen-window report with painting, Ctrl+Shift+F, crash report (0.3.8) | 🔄 In progress (upstream merge) | *Report issue → GitHub* stays on top |
| Chats: partial copy, Copy/Reply, swipe to reply, record audio/video/photo, mask typed secrets (0.3.8) | 🔄 In progress (upstream merge) | |
| Team page with roles, sub-agent chats under the manager, work page and Stop across linked PCs (0.3.8) | 🔄 In progress (upstream merge) | |
| People & devices: add-person page, second CEO, pairing on any own device, direct Android connect (0.3.8) | 🔄 In progress (upstream merge) | |
| Settings: Security tab (full access / careful, text for every agent, change log), search in settings, export/import/delete companies (0.3.8) | 🔄 In progress (upstream merge) | Our per-agent access modes stay |
| Model choice and tool-call fixes; restart pause that never ended (0.3.8) | 🔄 In progress (upstream merge) | Bug fixes |
| Direct device-to-device over WebRTC; your own meeting server (0.3.10) | 🔄 In progress (upstream merge) | Fits headless Linux |
| About 95 % less phone traffic (0.3.10) | 🔄 In progress (upstream merge) | |
| Model stays with an agent; cost per turn; fewer messages, one tool call (0.3.10) | 🔄 In progress (upstream merge) | Our manual model / effort choice stays |
| Call voice as its own session; camera, screen and cut-out sharing in calls (0.3.10, 0.3.13) | 🔄 In progress (upstream merge) | Our call screen stays |
| My day 2: next steps, change log with undo, morning briefing; floating to-do button; search own chats; share a web tab (0.3.10) | 🔄 In progress (upstream merge) | Schedules reminders in My day: [#34](https://github.com/desquerteur/Autark-Plus/issues/34) |
| Account consent, extra usage per plan (0.3.10) | 🔄 In progress (upstream merge) | |
| A declining model is skipped for the turn (0.3.12) | 🔄 In progress (upstream merge) | One chain with our account fallback: [#35](https://github.com/desquerteur/Autark-Plus/issues/35) |
| Update another PC from Settings › Devices (0.3.13) | 🔄 In progress (upstream merge) | Uses our update source |
| Names as given; "CEO" / "You" not taken as your name; cancel a dictation; Claude Code self-update fix (0.3.13, 0.3.14) | 🔄 In progress (upstream merge) | Bug fixes |
| Android 0.3.15 – 0.3.17: bubble, to-do dot, ringing calls, wake PC, open app by name (0.3.9 – 0.3.15) | 🔄 In progress (upstream merge) | Our own APK build picks them up |
| Model picker with providers and full model IDs; side-tab and notification fixes (main after 0.3.16) | 🔄 In progress (upstream merge) | Merged with our model menu |
| Security modes *Trust AI* / *Secure mode* with switches the runtime enforces | 🗓️ Planned upstream | Not in the original's 0.3.16 source either; comes with a later merge. Our [access modes](#2-what-autark-plus-adds) cover per agent and chat today. Docs text: [#33](https://github.com/desquerteur/Autark-Plus/issues/33) |
| Signed Windows installer | 🗓️ Planned ([#31](https://github.com/desquerteur/Autark-Plus/issues/31)) | The original's certificate belongs to its publisher; Autark-Plus needs its own |
| macOS packages | ✅ Done in 0.4.0 ([#32](https://github.com/desquerteur/Autark-Plus/issues/32)) | arm64 and x64 zips, cross-built on Linux and ad-hoc signed; **not yet started on a real Mac** |
| Android APK carry-over feeds (android-v0.3.12 / Lite) | ⏭️ Not taken | Autark-Plus builds and ships its own APK with every release |
| Ownership and legal notice in the README | ⏭️ Not taken | This README credits and links the original instead ([License and credit](#license-and-credit)) |

### 4. Autark-Plus extras still planned

| Planned | Status | Issue | Upstream |
| --- | --- | --- | --- |
| Reminders from Schedules show up in My day | 🗓️ Planned | [#34](https://github.com/desquerteur/Autark-Plus/issues/34) | [#23](https://github.com/teydra/OpenAutark/issues/23) (in Schedules) |
| One fallback chain: used-up account and declining model in one ordered list | 🗓️ Planned (after the upstream merge) | [#35](https://github.com/desquerteur/Autark-Plus/issues/35) | [#11](https://github.com/teydra/OpenAutark/issues/11) (in Accounts) |
| Graphical live view of what every agent is doing (agent-office style) | 🗓️ Planned, on hold until approved | [#12](https://github.com/desquerteur/Autark-Plus/issues/12) | Not proposed: on hold |
| Fix the 22 failing Electron window tests | 🔄 In progress | [#27](https://github.com/desquerteur/Autark-Plus/issues/27) | Not proposed: our own test setup |
| Own Windows code-signing certificate | 🗓️ Planned | [#31](https://github.com/desquerteur/Autark-Plus/issues/31) | Not proposed: upstream signs its own builds |
| macOS packages | ✅ Done in 0.4.0 (not yet started on a real Mac) | [#32](https://github.com/desquerteur/Autark-Plus/issues/32), [68f5946](https://github.com/desquerteur/Autark-Plus/commit/68f5946) | Not proposed: upstream ships them |
| Security section in the docs (Trust AI / Secure mode) | 🗓️ Planned | [#33](https://github.com/desquerteur/Autark-Plus/issues/33) | Not proposed: the text comes from upstream |
| Run the headless installer once on a real Linux host | 🗓️ Planned | [#36](https://github.com/desquerteur/Autark-Plus/issues/36) | [#26](https://github.com/teydra/OpenAutark/issues/26) (in Headless) |

## Screenshot gallery

All captures come from a **clean demo profile** (empty data folder, built-in demo engine, no accounts, no personal data, a demo project
named *berry-shop*) of the 0.3.8 source on 19 November 2026. The demo engine only echoes text, so chat answers are not shown. Click an
image for the full size. How they were made: [docs/SCREENSHOTS.md](docs/SCREENSHOTS.md).

| Projects | Agent directory |
| --- | --- |
| [![Project page in the dark theme](docs/images/project-dark.png)](docs/images/project-dark.png) | [![All agents grouped by project](docs/images/team-light.png)](docs/images/team-light.png) |
| Branch, changes, agents with the project lead and sessions, and a side chat. | Every agent in one place, grouped by project, team or status. |

| Appearance and layout | Personality |
| --- | --- |
| [![Appearance with themes and layout](docs/images/settings-appearance-dark.png)](docs/images/settings-appearance-dark.png) | [![Personality settings](docs/images/settings-personality-light.png)](docs/images/settings-personality-light.png) |
| Themes, drag-and-drop layout, chat tabs dock and width. | Tone, address, language and your own instructions. |

| Models, accounts and fallback | Google Gemini |
| --- | --- |
| [![Models with providers, uses and fallback order](docs/images/settings-models-light.png)](docs/images/settings-models-light.png) | [![Add a Google Gemini account](docs/images/gemini-dialog.png)](docs/images/gemini-dialog.png) |
| Providers, which model does which job, and "If used up". | Sign in with Google or use an API key. |

| Connectors | Updates |
| --- | --- |
| [![Connectors catalog and own MCP server](docs/images/settings-apps-light.png)](docs/images/settings-apps-light.png) | [![Updates settings](docs/images/settings-updates-dark.png)](docs/images/settings-updates-dark.png) |
| GitHub, Google, Notion, Slack, Discord, your own MCP server or pasted JSON. | Source, channel and automatic checks. |

| Setup | Spotlight tour |
| --- | --- |
| [![First-run setup, step 1 of 4](docs/images/first-run.png)](docs/images/first-run.png) | [![Spotlight tour, step 1 of 24](docs/images/tour-1.png)](docs/images/tour-1.png) |
| Four steps; each can be skipped. | 24 steps; Settings has "Show the tour again". |

## Where things are

The left rail switches the main areas; the sidebar next to it lists what is in the area.

| Area | What you do there |
| --- | --- |
| **My day** | Calendar, what needs you, timeline |
| **Work** | What is running, reports, people and agents |
| **Chats** | Talk to your manager and your colleagues; the chat's tabs (browser, files, notes, media ...) dock where you want them |
| **Projects** | Folders with their agents and sessions; start a session by typing what should happen |
| **Team** | Every agent in one place; hire, open, or jump to its project |
| **Settings** | General, Appearance, Personality, Models, Calendar, Secrets, Connectors, Skills and memory, Devices, Feedback, Updates, About |

## First launch and guided tour

A new profile starts with a four-step setup: *About you* (language and name), *Connect an AI* (a plan, an API key or a local server),
*Connect your tools* and *Your first agent*. Every step explains itself in a line and can be skipped. A spotlight tour then walks through
the app in 24 steps; leave it any time. Both can be started again in **Settings → General → Getting started**
("Show the tour again", "Run setup again").

## Try a task with a checkable answer

Install Autark, connect your supported model account, and use a test workspace without sensitive files or accounts.
Then give your manager this task. The offers are fictional; no web research or sign-up is needed.

```text
Help me choose a booking tool for a four-person team. We need CSV export and can spend at most EUR 45/month.
Offline use would be nice, but is not required.

Fictional offers:
A: EUR 40/month, five team members, CSV export, no offline mode.
B: EUR 25/month, three team members, CSV export, no offline mode.
C: EUR 30/month, five team members, offline mode, no CSV export.

Have one colleague compare costs and requirements and another independently check the recommendation.
Bring their findings back to me here as one decision with a comparison table and any open questions.
Use only these facts. Do not browse, contact anyone, sign up, or buy anything.
```

**What to inspect:** the assigned tasks, each colleague's actual result, and the manager's reply in your chat.
Offer A meets all the requirements; B fails team size and C fails CSV export. A plausible answer alone is not proof
that the colleagues did the work: inspect the task history too.

For a second check, change the budget to EUR 32/month. Now none of the offers meets every requirement.
Does the team explain the conflict, or quietly drop a requirement? There is no promised runtime or parallelism here.
[Report what happened](https://github.com/desquerteur/Autark-Plus/issues/new), including failures.


## About the original Autark: coverage and interviews

- [The Register, 10 November 2026](https://www.theregister.com/ai-and-ml/2026/11/10/14-year-old-creates-tool-for-ai-agents-to-band-together-like-a-team/5308841):
  reporting on the project and its founder, including criticism of the security boundaries.
- [AI Business, 9 November 2026](https://aibusiness.vc/startups/openautark-teydra-lab-ai-agent-team-on-your-own-computer):
  a company-submitted written Partner Story, not an independent product test.

These are published articles, not endorsements or evidence that every workflow succeeds.

## Download

The links below always lead to the newest version.

| Device | File | Download |
|---|---|---|
| Windows 10/11 (x64) | `autark-windows-x64.exe` | [Download for Windows](https://github.com/desquerteur/Autark-Plus/releases/latest/download/autark-windows-x64.exe) |
| Mac (Apple silicon M1–M4 / Intel) | `autark-mac-arm64.zip`, `autark-mac-x64.zip` | [Apple silicon](https://github.com/desquerteur/Autark-Plus/releases/latest/download/autark-mac-arm64.zip) · [Intel](https://github.com/desquerteur/Autark-Plus/releases/latest/download/autark-mac-x64.zip) |
| Linux desktop (x64) | `autark-linux-x64.AppImage` | [Download AppImage](https://github.com/desquerteur/Autark-Plus/releases/latest/download/autark-linux-x64.AppImage) |
| Debian/Ubuntu desktop (x64 / arm64) | `autark-linux-amd64.deb`, `autark-linux-arm64.deb` | [x64](https://github.com/desquerteur/Autark-Plus/releases/latest/download/autark-linux-amd64.deb) · [arm64](https://github.com/desquerteur/Autark-Plus/releases/latest/download/autark-linux-arm64.deb) |
| Linux server (x64 / arm64) | `autark-linux-x64.tar.gz`, `autark-linux-arm64.tar.gz` | [x64](https://github.com/desquerteur/Autark-Plus/releases/latest/download/autark-linux-x64.tar.gz) · [arm64](https://github.com/desquerteur/Autark-Plus/releases/latest/download/autark-linux-arm64.tar.gz) – installed by `scripts/install-headless.sh` |
| Android phone | `autark-android.apk` | [Download for Android](https://github.com/desquerteur/Autark-Plus/releases/latest/download/autark-android.apk) |
| iPhone | – | A web app from your own PC (see below) |

- [Checksums (SHA-256)](https://github.com/desquerteur/Autark-Plus/releases/latest/download/SHA256SUMS.txt) for every file of
  the release, and [release.json](https://github.com/desquerteur/Autark-Plus/releases/latest/download/release.json) with what
  was checked for it and what was not.
- How releases are built and the Android APK is signed: [docs/RELEASING.md](docs/RELEASING.md).
- [All releases and their notes](https://github.com/desquerteur/Autark-Plus/releases).

Check a download on Windows with `Get-FileHash .\autark-windows-x64.exe` (PowerShell), on Mac and Linux with
`shasum -a 256 <file>`, and compare it with the line in `SHA256SUMS.txt`.

## Installing

### Linux server (Debian / Ubuntu)

Install the latest release as a system service, without a desktop or display:

```bash
curl -fsSL https://raw.githubusercontent.com/desquerteur/Autark-Plus/main/scripts/install-headless.sh | sudo bash
```

The installer verifies the release checksum, starts Autark as its own unprivileged user, and prints a pairing link/code.
The script runs as root: review it first if required by your server policy. See [server setup and removal](docs/headless-linux.md) and the [v0.4.0 runtime checks and limits](docs/releases/v0.4.0-runtime-tests.md). Debian/Ubuntu x64 systemd-container checks pass; native ARM64, a real Proxmox host and real Mac launch remain unverified.

### Desktop and Android

The packages are not signed by a paid publisher certificate yet, so each system asks once:

- **Windows:** SmartScreen may say "Windows protected your PC". Click **More info → Run anyway**. Autark installs for
  your user only, without administrator rights.

> **Already have Autark from the original (teydra/OpenAutark)? Read this first.** The original currently makes it hard
> to switch to this fork:
>
> - **Its uninstaller can fail.** Installing this fork over an app from the original stopped with "Die alten
>   Anwendungsdateien konnten nicht deinstalliert werden … : 2" (the old application files could not be uninstalled),
>   and running the original's `Uninstall Autark.exe` on its own aborted with the same code 2 – with no Autark process
>   running. Workaround: quit Autark, rename `%LOCALAPPDATA%\Programs\Autark` (e.g. to `Autark.old`), remove its entry
>   under `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall` (export it first), then run this installer.
> - **Its newer versions change your data so this fork cannot open it.** The original's app updates itself from the
>   original and ships database changes that are not in its public source (e.g. its 0.3.5 uses data schema 97; the
>   public source and this fork stop at 91). This fork then opens a repair screen ("Your data is from a newer
>   version"). **Restore** goes back to the copy from before that update – everything done since is not in it (it is
>   set aside in `%APPDATA%\Autark\before-repair-…`). To keep that data, stay on the original's app instead.
- **Mac:** take `autark-mac-arm64.zip` for Apple silicon (M1 and later) or `autark-mac-x64.zip` for Intel (Apple menu →
  About This Mac → Chip). Double-click the zip and drag **Autark** into Applications. The app is ad-hoc signed, without Apple notarization: the first start is refused once – open System
  Settings → Privacy & Security, scroll down and click **Open Anyway** (on macOS 14 and older: right-click Autark →
  **Open** → **Open**). If macOS says the app "is damaged", run `xattr -dr com.apple.quarantine /Applications/Autark.app`
  in Terminal once and start it again.
- **Linux:** make the AppImage executable (`chmod +x autark-linux-x64.AppImage`) and start it. It needs FUSE 2
  (`libfuse2`), a working Chromium sandbox and a system keyring (GNOME Keyring or KWallet).
- **Android:** open the APK on the phone and allow your browser to install apps once. Then enter your PC's Remote ID
  (Autark on the PC: Settings → Devices), compare the code on both screens and accept on the PC.
- **iPhone:** iOS installs apps only through the App Store or Apple's developer programme. Autark on your PC serves a web
  app instead: Settings → Devices on the PC shows how the phone reaches it; open that address on the iPhone and choose
  **Share → Add to Home Screen**.

## Updates

Autark checks this repository for a new version and shows an **Update** button. One click downloads it; when you are
idle, or when you click **Restart**, Autark saves your drafts and its agents' work, closes and installs it. On Windows a
small helper runs the installer silently and starts the new version (the window is gone for about a minute); on Linux
the AppImage is replaced in place; on a Mac Autark replaces its own app bundle where macOS allows it, otherwise the
button opens the download. The Android app compares its version with
[latest-android.json](https://github.com/desquerteur/Autark-Plus/releases/latest/download/latest-android.json) and offers the
new APK. Each step of a Windows or Linux update writes one line to `update-helper.log` in Autark's log folder
(`%APPDATA%\Autark\logs`, `~/.config/Autark/logs`). Source, channel and automatic checks are explained on
[Updates from this repository](docs/UPDATES.md); a headless Linux server updates with its installer script instead
([Linux headless](docs/LINUX_HEADLESS.md#updating)).

## Settings and privacy

**Where your data is.** Everything stays in Autark's data folder on your PC: `%APPDATA%\Autark` on Windows, `~/Library/Application Support/Autark`
on a Mac, `~/.config/Autark` on Linux (a headless server uses its own folder, see [Linux headless](docs/LINUX_HEADLESS.md)). Useful files in it:

| File or folder | What it holds |
| --- | --- |
| `settings.json` | Your settings (Appearance, Personality, routing and fallback order, onboarding state) |
| `theme.css` | Extra styling on top of the themes |
| `connectors/mcp.json` | Your MCP servers (the Connectors page writes it) |
| `update-source.json` | Where updates come from, channel, automatic check |
| `logs/` | `main.log`, `runtime.log`, `update-helper.log` |

Every Settings page has a file button that opens the file or folder behind it.

**Secrets.** API keys and passwords go into the secrets catalog, encrypted with the system keychain (Windows DPAPI, macOS Keychain,
Linux secret service). Agents see a secret's handle, never its value. Sign-ins to AI plans go through the providers' own tools; Autark does
not read their tokens. See [SECURITY.md](SECURITY.md).

**What leaves your PC.** Prompts go to the model provider you chose (a cloud model sees what you send it; a local model server does not
leave your network). Updates ask GitHub for the newest release of the repository set in Settings → Updates. Connectors talk to the services
you connected. Feedback is sent only when you press send in the feedback dialog, and only if a receiver is configured (this fork has none by
default). A search of the desktop app source finds no telemetry or analytics module.

**What agents may do.** Per agent and per chat you pick an access mode: *Read only*, *Ask first*, *Automatic in the project folder* or
*Full access*, plus allow/deny rules and an approval dialog (once, always for this agent, deny). *Full access* is the default of a plain chat
today and is **not a sandbox**; use *Ask first* or *Read only* when you try something new. Agents inside a project are additionally limited
to their project (see [Project isolation](docs/PROJECT_ISOLATION.md)).

## Tests and observed results

The full report is [docs/TEST_RESULTS.md](docs/TEST_RESULTS.md). The short version for 0.3.8 (19 November 2026, Windows 11, Node 26):

| Suite | Result |
| --- | --- |
| Typecheck (4 configs) and production build | pass |
| Unit tests (about 980 files) | 5589 pass, 0 fail, 7 skipped, after fixing 7 failures found in the run |
| End-to-end tests | 99 pass, 2 fail (one test that fails only when started from inside an Autark agent; passes 9/9 with the agent environment unset) |
| Window tests (real Electron windows) | 66 pass, **22 fail**, 1 skipped; not fixed, causes listed in the report |
| Feedback service, meeting server, website | 7/7, 10/10, 12/12 pass |
| Lint | not available (no linter configured) |
| Live provider tests, Android build, a real Linux install | **not run** |

A live smoke test of the installed 0.3.8 app found one failing flow (Gemini sign-in, see [open points](#open-points)) and otherwise
opened chats, work, my day, team, projects, settings, models, skills and updates without errors.

## Open points

What is not finished or not proven, as of 0.3.11 and `main` on 21 November 2026. The planned work is in the
[feature matrix](#4-autark-plus-extras-still-planned) and the [issues](https://github.com/desquerteur/Autark-Plus/issues).

- **Gemini sign-in can hang in 0.3.11.** *Sign in with Google* can stay on "Installing Gemini CLI …". This is fixed on `main` and ships with the next release ([#24](https://github.com/desquerteur/Autark-Plus/issues/24), [details](docs/ACCOUNTS_AND_GEMINI.md#known-problem)).
- **The original's 0.3.6 – 0.3.16 is not merged yet.** The merge is done locally and being tested ([section 3](#3-original-features-still-missing-or-planned)).
- **22 window tests fail** on the release PC. These are test-only failures ([#27](https://github.com/desquerteur/Autark-Plus/issues/27), [report](docs/TEST_RESULTS.md#still-open-22-failing-ui-window-tests-not-fixed)).
- **Headless Linux has not run on a real Linux host.** Only the start, pairing and the script's syntax were tested, on Windows ([#36](https://github.com/desquerteur/Autark-Plus/issues/36), [page](docs/LINUX_HEADLESS.md#what-was-not-tested)).
- **No feedback receiver** is configured. In-app reports go to GitHub issues through *Report issue* instead.
- **Installers are unsigned** ([#31](https://github.com/desquerteur/Autark-Plus/issues/31)), so Windows SmartScreen asks once (see [Installing](#installing)). The macOS apps (since 0.4.0) are ad-hoc signed without Apple notarization and **have not been started on a real Mac yet** ([#32](https://github.com/desquerteur/Autark-Plus/issues/32)).
- **0.3.8 does not install updates by itself.** Install 0.3.11 once by hand; from 0.3.10 on, updates install by themselves ([#1](https://github.com/desquerteur/Autark-Plus/issues/1)).
- **Switching from the original app is rough.** The original's uninstaller can fail and its newer data schema cannot be opened here (see the box under [Installing](#installing)).
- **Not run:** live provider tests (they cost money), lint.

## Building from source

### Desktop app (`apps/desktop`)

Needs [Node.js 24](https://nodejs.org/) and npm; Windows, macOS or Linux.

```sh
cd apps/desktop
npm ci
npm run build      # bundles main, preload, runtime, CLI and UI into app/
npm start          # starts the built app (npm run dev = build + start)
npm run check      # typecheck per layer, import boundaries, unit tests (a few minutes)
npm run test:e2e   # runtime end-to-end tests
npm run test:ui    # builds, then tests in real Electron windows
```

Installers (written to `apps/desktop/dist/`), each on its own system:

```sh
npm run package -- --win --x64        # Windows x64 NSIS installer
npm run package -- --linux --x64      # Linux x64 AppImage
npm run package -- --mac --universal  # macOS universal DMG and ZIP
```

One test file: `node --test test/unit/<area>/<file>.test.ts`. How the code is laid out:
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); the desktop app's own notes: [apps/desktop/README.md](apps/desktop/README.md).

### Android app (`apps/android`)

Needs JDK 17 and the Android SDK with platform 36 and build-tools 36.0.0 (`ANDROID_HOME` set). Gradle comes through the
wrapper.

```sh
cd apps/android
./gradlew :app:assembleDebug          # macOS/Linux; on Windows: .\gradlew.bat :app:assembleDebug
```

The debug APK lands in `app/build/outputs/apk/debug/` (package `com.teydralab.autark.android.preview`, signed with the
Android debug key, installs beside the release app). On Windows, `.\build.ps1` runs the host-side tests and the same
build; `.\test.ps1` runs only the host-side Java tests (after one Gradle build has cached BouncyCastle). A release build
takes your own key through the environment: `AUTARK_ANDROID_KEYSTORE`, `AUTARK_ANDROID_KEYSTORE_PASSWORD` and
`AUTARK_ANDROID_KEY_ALIAS`, then `./gradlew :app:assembleRelease` (`new-release-key.ps1` makes such a key on Windows).

### Website (`apps/website`)

```sh
cd apps/website
OFFLINE=1 node build.mjs   # writes dist/; without OFFLINE=1 it reads version and changelog from GitHub
```

### Meeting server (`services/remote-relay`)

The small, self-hostable meeting point that lets Autark PCs and phones in different networks find each other; it only
forwards encrypted bytes. `npm ci && npm start` (Node.js 24) or `docker build -t autark-meet services/remote-relay`;
details in [services/remote-relay/README.md](services/remote-relay/README.md).

## Repository layout

| Path | What it is |
|---|---|
| `apps/desktop/` | The Electron desktop app (TypeScript): agent runtime, UI, and the skills, prompts and modes it ships in `resources/` |
| `apps/android/` | The Android app, a thin client that shows the PC's phone interface through the encrypted device link |
| `apps/website/` | The product website, a dependency-free static site generator |
| `services/remote-relay/` | The meeting server for devices in different networks |
| `services/feedback/` | A discontinued feedback-receiver prototype, kept for reference only; the app does not use it ([its README](services/feedback/README.md)) |
| `scripts/desktop-release/` | Release-environment scripts for Linux and macOS builds |
| `library/` | The public library of skills and notes Autark's agents share ([library/README.md](library/README.md)) |
| `docs/` | [All documentation](docs/README.md): this fork's feature pages, [ARCHITECTURE.md](docs/ARCHITECTURE.md) (how the code is built) and [EXTERNAL_PROTOCOL.md](docs/EXTERNAL_PROTOCOL.md) (the `wf` CLI and the interface for scripts and bridges) |
| `.github/workflows/` | The release workflows and the automatic merge of `library/` pull requests |

## The public library

[`library/`](library/README.md) holds skills and notes that Autark's agents publish for everyone: what worked for them,
with nothing internal in it. Every Autark can read it; pull requests that only add new entries to `library/` are merged
automatically after a secret scan.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to build, test and send changes, and [SECURITY.md](SECURITY.md) for how
to report a vulnerability privately.


## License and credit

**Credit.** Autark-Plus is based on [teydra/OpenAutark](https://github.com/teydra/OpenAutark) (Autark by Teydra Lab, created by Stanislaus Hees;
Apache-2.0; [openautark.com](https://openautark.com)). Until 0.3.7 this repository was the GitHub fork desquerteur/OpenAutark, and its full
history is kept here. The original is the work of its authors; Autark-Plus is a separate project that adds its own features on top
(the table [What Autark-Plus adds](#2-what-autark-plus-adds)) and is neither affiliated with nor endorsed by Teydra.

**License.** The source code is licensed under the [Apache License 2.0](LICENSE), with the original copyright line
("Copyright 2026 Teydra") kept in [LICENSE.md](LICENSE.md). Changed files say that they were changed, and the existing notices are kept as the
license requires. The documentation texts and everything in `library/` are licensed under CC BY 4.0; [LICENSE.md](LICENSE.md) says exactly what is
under which license. [THIRD_PARTY_NOTICE.md](THIRD_PARTY_NOTICE.md) lists components that come with their own licenses.

**Name and logo.** The Apache License does not grant rights to the name "Autark", the Teydra names or the Autark logo (section 6). Autark-Plus
uses the name only to say what it is based on.

**Taking changes from here.** If you bring code, features or ideas from this repository into the original or any other copy of it, please say so
where it lands (commit message or pull request, and the release notes), for example:

> Taken from (or: inspired by) desquerteur/Autark-Plus – https://github.com/desquerteur/Autark-Plus

**Screenshots and documentation** in this README and `docs/` are made for this project from a demo profile and are under CC BY 4.0 like the rest of
the documentation.
