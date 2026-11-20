# Screenshots

Every image in `docs/images/` was captured on **19 November 2026** from the 0.3.8 source (commit `a2a69f1`), built locally, running in a **clean demo profile**:

- a fresh, empty data folder (nothing from a real installation, no accounts, no secrets, no chats, no personal data),
- the built-in **demo engine** (`WORKFORCE_FAKE_ENGINE=1`), which only echoes text; for that reason no chat answers are shown,
- a throwaway demo folder `C:\autark-demo\berry-shop` (one Git commit) as the example project, with two example agents named Ava and Ben,
- window 1440 x 900, with the system colour scheme forced to light or dark.

Nothing was edited afterwards. The capture script is a small Playwright-for-Electron script that opens the pages through their routes
(`#/projects/<id>`, `#/team`, `#/settings/<page>`) and takes window screenshots; the test suite in `apps/desktop/test/ui/` uses the same technique.
Real accounts, real projects and real conversations are never used for documentation images.

| File | Shows |
| --- | --- |
| `project-light.png`, `project-dark.png` | Projects tab: branch, changes, agents with project lead, sessions, side chat |
| `team-light.png` | All agents grouped by project |
| `settings-appearance-*.png` | Themes, layout, chat tabs dock |
| `settings-personality-*.png` | Personality settings |
| `settings-models-light.png`, `gemini-dialog.png` | Providers, uses with "If used up", adding a Gemini account |
| `settings-apps-light.png` | Connectors |
| `settings-updates-*.png` | Updates settings |
| `settings-skills-*.png` | Skills and memory |
| `first-run.png`, `tour-1.png` | Setup step 1 of 4, spotlight tour step 1 of 24 |

The demo profile shows "Deutsch" in the setup's language box because that is the default of the machine the captures were made on.
