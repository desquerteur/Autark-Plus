# Autark v0.3.8 – full test report

Date: 2026-11-19 · PC: a Windows 11 PC (Windows 11, Node 26.12.1, screen 1536x960 scaled) · Repo: `desquerteur/OpenAutark`, branch `noriel/main` fast-forwarded to tag `v0.3.8` (`ed8f25a`), then 4 local fix commits on top (not pushed, not tagged).
The running Autark app was not touched; all runs used temp data dirs (`WORKFORCE_TEST_DATA`, `mkdtemp`).

## Summary

| Suite | Result | Notes |
|---|---|---|
| Typecheck (`npm run typecheck`, 4 tsconfigs) | **pass** | also after the fixes (the new test pulled `services/feedback` into the check and exposed one more error, fixed) |
| Production build (`npm run build`) | **pass** | main, preload, runtime, cli, wf, meet, ui, hosted in ~21 s |
| Windows installer package (`npm run package`) | not re-run for 0.3.8 | built and verified for 0.3.7 earlier; `test/installer/nsis-build.test.mjs` 9/9 pass |
| Unit (`npm test`, ~980 files) | first run 5595 tests: 5581 pass / **7 fail** / 7 skip → after fixes **5596 tests: 5589 pass / 0 fail / 7 skip** | final run done with `AUTARK_AGENT_TOKEN`/`AUTARK_DATA` unset (see "Environment") |
| E2E (`npm run test:e2e`, 47 files) | 104 tests: 99 pass / 2 fail / 3 skip | the 2 fails are one test (`wf-cli`): environment, passes 9/9 with the agent env unset |
| UI / Electron window tests (`npm run test:ui`, 74 files, Playwright-Electron) | **89 tests: 66 pass / 22 fail / 1 skip** (first run 88: 63/24/1) | open, see below |
| `services/feedback` | first 2 of 4 files failed to load → fixed, **7/7 pass** | real bug |
| `services/remote-relay` | **10/10 pass** | needed `npm ci` in the service dir (see below) |
| `apps/website` | 11/12 → **12/12 pass** | stale test vs. repo move |
| Lint | not available | no lint script / ESLint / Biome in the repo |
| `test:live` (real provider accounts, costs money) | **not run** | needs live accounts |
| Android (`apps/android`, Gradle) | **not run** | no Android SDK run here |

## New 0.3.8 parts (targeted run, all green)

| Feature | Tests | Result |
|---|---|---|
| AF-023 account fallback (candidates, account-choice, fallback chain, turn limits/status, fallback-order UI, recent-actions) | 65 | 65 pass |
| AF-024 Gemini accounts (accounts, login files, login sync, ACP providers, plan-setup UI) | 40 | 40 pass |
| AF-025 headless Linux (`headless-parts`, `headless-start`, `install-headless`) + `bash -n scripts/install-headless.sh` | 11 | 11 pass, script syntax ok |
| AF-026 project isolation | 22 | 22 pass |

Not covered by a passing automated test: a real Gemini turn with a real Google login (Gemini CLI is installed on this PC, but no real turn was run: no spend/login); a real Linux headless install (no Linux host).
The AF-024 *window* test (`af024-gemini-window`) fails here: see UI table.

## Failures found and fixed (commits on `noriel/main`, local only)

| # | Failure | Cause | Fix | Commit |
|---|---|---|---|---|
| 1 | `services/feedback` tests `inbox`, `setup` could not load | `services/feedback/src/input.ts` imports `FEEDBACK_IMAGE_LIMIT` from the desktop contract; it was never defined (since the first public snapshot) | defined `FEEDBACK_IMAGE_LIMIT = 1_000_000` + new unit test `test/unit/feedback/image-limit.test.ts` | e5a275e |
| 2 | typecheck error after adding that test | `services/feedback/src/types.ts` imports `FeedbackSubmission`, also never defined | added the interface to `feedback-delivery.ts` | 446c541 |
| 3 | `generate-http-sent` (2 tests) | **real bug on Node ≥ 26**: Node keeps its real fetch agent under `undici.globalDispatcher.2`; `.1` is a `Dispatcher1Wrapper`. `mediaDispatcher()` returned undefined, so media/video calls lost their 10-minute socket timeouts and kept Node's default | `mediaDispatcher()` reads `.2` first, then `.1` (`src/runtime/media/generate-http.ts`) | e5a275e |
| 4 | `recent-actions` failover test | stale test: AF-023 deliberately changed failover from "once" to a chain over every account | test now expects the chain acc_1 → acc_2 → acc_3 | e5a275e |
| 5 | `stylesheets` (2 tests) | `agent-directory.css` had no `Never:` header; `model-menu.css` had a literal `rgb()` fallback although `--shadow-raised` is a token | header added, fallback removed | e5a275e |
| 6 | `workflow-paths` | test only recognised `desktop.yml`/`build.yml`; the fork's workflow is `build-desktop.yml` | pattern extended | e5a275e |
| 7 | `apps/website` file-links test | releases moved to `desquerteur/Autark-Plus` in 0.3.7 (`src/config.mjs`) | test expects `desquerteur/Autark-Plus` | a2a69f1 |
| 8 | UI: `app-upload`, `references` | stale: receipt text now names the take; "Start thread" menu item | tests updated, both pass | 4ee4fd1 |
| 9 | UI: `settings-pages`, `skill-links` | partly stale (new nav pages Appearance/Personality/Updates; `data-tour="skills"` now also on the nav button; AF-023 "If used up" rows share `.use-row`) | selectors/lists updated; both still fail later in the test (see below) | 4ee4fd1 |

## Environment-caused failures (not product bugs)

- `shell.exec … identity` (unit) and `wf-cli … default app data dir` (e2e): they fail when `AUTARK_AGENT_TOKEN` / `AUTARK_DATA` are set, which is always the case for a test started by an agent inside Autark. With both unset: pass.
- `services/remote-relay`: all tests threw "Server is not a constructor" because a stray old `ws` in `C:\Users\norie\node_modules` shadowed the missing service dependency. `npm ci` in `services/remote-relay` fixed it. Note for CI/docs: the service needs its own install.
- `node_modules/electron` had no binary (postinstall not run); ran `node node_modules/electron/install.js` (the UI suite cannot start otherwise).
- UI `work-stop-tray` (global emergency-stop shortcut "not registered"): the running Autark already owns that global shortcut.
- UI `af024-gemini-window`: the test assumes no Gemini CLI; here it is installed (`%APPDATA%\npm\gemini.cmd`), so "Sign in with Google" starts a real sign-in and "API key" stays disabled while it runs. Note: running it may have started Gemini's real sign-in flow in the background (nothing was signed in).

## Still open: 22 failing UI window tests (not fixed)

All deterministic on rerun. Not root-caused one by one; likely groups:

- Window-size / display scaling (screen is 1536x960): `change-app` (viewport width), `quota-refresh`, `update-entry` (phone width), `feedback-button` and `feedback-not-set-up` (642 vs 640 px), `voice-settings` (expectStable moved), probably `spotlight-tour`, `shell-columns`, `stability`.
- Stale versus newer UI: `settings-pages` ("Automatic" row gone), `skill-links` (no "Back" button in the link dialog).
- Timeouts with no clear cause yet: `chat-dock`, `chrome-features`, `feedback-inbox`, `pages`, `people`, `personal-tabs`, `providers-file`, `tasks-later`, `timer-snooze`.
- Environment: `work-stop-tray`, `af024-gemini-window` (above).

Whether these also fail on the unmodified upstream/earlier tags was not checked. They are window tests only; the matching unit/e2e suites for the same features pass.

## Reproduce

```
cd apps/desktop
npm run typecheck && npm run build
env -u AUTARK_AGENT_TOKEN -u AUTARK_DATA npm test        # ~25 min
npm run test:e2e                                         # ~8 min
node node_modules/electron/install.js && npm run test:ui # ~25 min
(cd ../../services/feedback && npm test); (cd ../remote-relay && npm ci && npm test); node --test ../website/test/
```

## Live smoke test of the installed 0.3.8 app (read-only)

A second check ran against the installed Windows app (19 November 2026), using UI Automation and the logs; nothing was changed or restarted.
Chats, work view, my day, team (13 agents), projects (8, with branches and sessions), Settings → General, Models (three connected accounts),
Skills and memory (43 skills) and Updates (including "Check now") all worked. Findings:

| Result | Finding |
| --- | --- |
| **Fail** | *Google Gemini → Sign in with Google* stayed on "Installing Gemini CLI ..." after the CLI was installed; no sign-in link, and the half-added account had no row. See [Accounts, fallback and Gemini](ACCOUNTS_AND_GEMINI.md#known-problem). The API-key path was not checked |
| Warn | The Fusion connector logs `McpTransportError` at every start when Fusion 360 is not running (harmless) |
| Warn | "feedback sending is not set up" at every start: expected, this fork has no feedback receiver |
| Minor | A "Needs you" header was German in an otherwise English UI and its count did not match the list |
| Minor | The "5-hour limit" bar is empty for all accounts (probably no data, but it looks broken) |
| Minor (fixed in 0.3.10) | Update checks ran about once a minute, although the setting said "every few minutes" – the hint now names the real intervals |
| Not tested | Files, About and Secrets pages in the UI; renderer console errors |
