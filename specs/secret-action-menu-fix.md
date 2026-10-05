# Secret row action menu placement

## MENU-1 — Keep row menu visible beside the inspector

Implementation: resolved Blocked by: none

The row dropdown currently loses its right alignment because the shared manager only flips at the window edge. With the inspector docked, it extends behind the drawer and is clipped by table scrolling. Preserve Project row-menu alignment inside the table; do not change unrelated dropdowns or lift background actions above an overlay scrim.

### Acceptance

- [x] Row menu fully visible and clickable with desktop inspector open or closed.
- [x] Minimum-size and bottom-row positioning remain operable; Edit, Escape and outside dismissal work.
- [x] Change remains local; existing feature edits preserved and no Git operations.

### Verification plan

Worker checks CSS/JS lint and diffcheck. Primary independently uses actual Project view in isolated Electron synthetic fixture at desktop/minimum size, asserts bounds and hit testing, clicks Edit and checks dismissal. No new low-value tests for this presentation fix.

Claim time: 2026-10-01T03:00:45.593411+00:00 Requested model: gpt-6-luna (medium) Review rounds: 0 Baseline: /private/tmp/localkeys-menu-baseline.json Worker: /root/luna_row_menu_fix

## Implementation evidence

Primary independently verified isolated actual Electron44.4.4 Project view with synthetic Secrets at1150×760 and680×500: menu bounds within table, elementFromPoint hit testing, Edit opens editor, Escape and outside dismiss, docked inspector open/closed, bottom-row upward placement. CSS lint and diffcheck pass. Existing115-test evidence reused: only five-line presentation rule and release notes changed. Requested gpt-6-luna medium, /root/luna_row_menu_fix, zero correction rounds. HEAD/index/branch and all unrelated dirty files match baseline.

Source SHA256: 70f0529089caaefb8ca18d81b3fd056565f3840c509c12b710fe29da73875663 Fixture /private/tmp/localkeys-completeness-verify/menu.cjs SHA256: a30e0e5be6cf277519e7eb53355977749f9ce80e963cb8aaa70409ec9cf2ca71
