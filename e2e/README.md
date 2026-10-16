# Morph end-to-end checks

Each check builds the app, runs it in Electron with a throwaway profile on the second monitor (if
there is one), and writes screenshots to `e2e/output/<check>/` (not in git).

| Command | What it checks |
| --- | --- |
| `npm run e2e:glass-menus` | the glass unit and city menus on the units page |
| `npm run e2e:glass-pickers` | the glass date and time pickers |
| `npm run e2e:flow` | the conversion flow: duplicate drops, convert all, stop during work, forged IPC refused, history, CSP (prints a JSON report, exit 1 on failure) |
| `npm run e2e:screenshots` | every screen in Hebrew at 1347×852 (settings and history copied from the real profile, read only) |

Safety: nothing here changes the PC.
- Settings and history are copied from the real profile into the throwaway one; the real profile is never written.
