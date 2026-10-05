---
name: KeyHarbor — Vault Ledger
description: The Vault Ledger — a custody-desk logbook in pinned dark macOS materials.
colors:
  accent-blue: "#0A84FF"
  accent-blue-hover: "#0066CC"
  ledger-black: "#171717"
  raised-coal: "#1E1E1E"
  ledger-surface: "#242424"
  ledger-surface-lifted: "#2A2A2A"
  ledger-hairline: "#2E2E2E"
  ledger-hairline-soft: "#262626"
  ledger-ink: "#E6E6E6"
  ledger-ink-dim: "#A8A8A8"
  ledger-ink-faint: "#8A8A8A"
  signal-green: "#30D158"
  signal-amber: "#FF9F0A"
  signal-red: "#FF453A"
  signal-red-hover: "#D92D20"
  signal-gray: "#98989D"
  monogram-blue-tint: "#5EB2FF"
  monogram-violet-tint: "#D29DF7"
  signal-teal: "#64D2FF"
  signal-violet: "#BF5AF2"
typography:
  display:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  title:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.01em"
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.05em"
  mono:
    fontFamily: "ui-monospace, SF Mono, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.6
  state:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.4
  card:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.4
  metric:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "19px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.01em"
rounded:
  radius-4: "4px"
  radius-5: "5px"
  sm: "6px"
  radius-7: "7px"
  md: "8px"
  lg: "10px"
  xl: "12px"
  pill: "999px"
spacing:
  sm: "8px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.accent-blue}"
    textColor: "#FFFFFF"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  button-primary-hover:
    backgroundColor: "{colors.accent-blue-hover}"
    textColor: "#FFFFFF"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  button-secondary:
    backgroundColor: "{colors.ledger-surface}"
    textColor: "{colors.ledger-ink}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  button-danger:
    backgroundColor: "{colors.signal-red}"
    textColor: "#FFFFFF"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  button-danger-hover:
    backgroundColor: "{colors.signal-red-hover}"
    textColor: "#FFFFFF"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  pill-healthy:
    backgroundColor: "rgba(48, 209, 88, 0.13)"
    textColor: "{colors.signal-green}"
    rounded: "{rounded.pill}"
    padding: "0 10px"
    height: "24px"
  pill-rotate:
    backgroundColor: "rgba(255, 159, 10, 0.14)"
    textColor: "{colors.signal-amber}"
    rounded: "{rounded.pill}"
    padding: "0 10px"
    height: "24px"
  pill-expired:
    backgroundColor: "rgba(255, 69, 58, 0.13)"
    textColor: "{colors.signal-red}"
    rounded: "{rounded.pill}"
    padding: "0 10px"
    height: "24px"
  pill-config:
    backgroundColor: "rgba(152, 152, 157, 0.14)"
    textColor: "{colors.signal-gray}"
    rounded: "{rounded.pill}"
    padding: "0 10px"
    height: "24px"
  input-search:
    backgroundColor: "{colors.ledger-surface}"
    textColor: "{colors.ledger-ink}"
    rounded: "{rounded.md}"
    padding: "0 26px 0 30px"
    height: "32px"
  tag-chip:
    backgroundColor: "{colors.ledger-surface-lifted}"
    textColor: "{colors.ledger-ink-dim}"
    rounded: "{rounded.pill}"
    padding: "0 10px"
    height: "24px"
  project-card:
    backgroundColor: "{colors.raised-coal}"
    textColor: "{colors.ledger-ink}"
    rounded: "{rounded.xl}"
    padding: "14px 14px 12px"
  overview-metric:
    backgroundColor: "{colors.raised-coal}"
    textColor: "{colors.ledger-ink}"
    rounded: "{rounded.xl}"
    padding: "10px 16px"
---

# Design System: KeyHarbor — Vault Ledger

## Project secrets workspace — approved October 2, 2026

The project secrets screen adopts the supplied DevSec Ops Native reference; the Projects dashboard follows its own approved reference below, and other views retain Vault Ledger materials. This surface-specific contract supersedes the charcoal, macOS-blue, ruled-table, and system-font directions below for `src/views/project.html` and `src/project/*` only.

- **Materials:** navy canvas `#0F1420`, rail and inspector `#0B0F17`, secret rows `#141B2B`, lifted controls `#1A2337`, borders `#29364D` / `#1E293B`, text `#F1F5F9`, secondary `#B0BDD0`, metadata `#94A3B8`.
- **Signals:** cyan `#4CD7F6` for selection, green `#4EDEA3`, amber `#FBBF24`, red `#FB7185`; every state also has a text label. Primary actions use a restrained `#087E98` → `#245DD9` fill with readable white text.
- **Typography:** locally bundled Geist 400/500/600 for interface text and JetBrains Mono 400/500/600 for key names, values, tags, and code. Page title 26px; interface text 12–14px; compact metadata 10–11px. Font licenses accompany the assets.
- **Composition:** expandable 88px navigation rail / 232px labelled sidebar, project switcher in the workspace header, real Environment tabs, a search and action toolbar, existing readiness summary, descriptive secret rows, and a 340–380px copy-first inspector. Rows show descriptions and tags where present; no fictional metadata fills missing fields.
- **Responsive:** inspector becomes an overlay at 1100px; navigation collapses below 860px; Environment tabs become the native selector below 720px. The app minimum is 680px.
- **Product truth:** no hardware-enclave, leak-detection, percentage health, owner, deployment, or integration claims. Status derives from stored expiration and update timestamps; required-key readiness and recorded usage/history stay available. Native Electron window controls remain native.
- **Behavior:** retain masked secret values, reveal timer and blur handling, clipboard clearing, reviewed import, safe export, history, rotation, duplication, and environment management. `/` and Command/Ctrl+K focus search; arrows select rows; Enter enters the inspector; Escape dismisses the top layer. All controls remain labelled and focusable.

## Projects homepage — approved October 2, 2026

This surface-specific contract supersedes the dashboard sections below for `src/views/dashboard.html`, `src/dashboard/main.tsx`, and `src/styles/dashboard.css`.

- Navy canvas `#0A0D14`, sidebar/topbar `#0D111A`, cards `#131824`, controls `#0F1420` / `#1C2538`, borders `#1F293D` / `#29364D`, cyan `#4CD7F6`, foreground `#F1F5F9`, secondary `#B0BDD0`, metadata `#94A3B8`.
- Offline Geist interface text and JetBrains Mono counts, Environment badges, timestamps, and keyboard hints. Native window controls stay native.
- Expandable 248px sidebar / 88px rail, functional vault switcher, Projects / Activity / Settings navigation, honest unlocked and last-refreshed status. Below 860px navigation is an overlay drawer dismissed with Escape or the scrim.
- Search and actions share a compact topbar. The scrolling canvas has a Projects heading, four distinct statistics cards, All / Starred filters, grid/list controls, sorting, a three-column project grid that adapts to available content width, and a functional creation tile.
- Overview values come from the existing statistics bridge: Projects, Secrets, Expiring/Expired Secrets, and Recent Access. Hide statistics when disabled. Stored project records supply secret counts, Environment counts, and update timestamps; access logs supply optional last-accessed text.
- **Shared controls:** editable shadcn/ui Button, Input, Dialog, and Dropdown Menu components live in `src/renderer/ui`, with Radix behavior and locally compiled Tailwind utilities. Global reusable styles live in `common.css`; theme values live in `theme.css` under the opt-in `lk-ui-theme`. `ui.css` supplies Tailwind theme mappings and utilities without Preflight. Load common, theme, utilities, and page CSS in that order. The homepage, project secrets screen, Settings, Access Logs, and Vault reconciliation share these controls. Feature composition stays in page CSS; generic dialog controls and lifecycle handling belong in `src/renderer/ui`. Confirmations initially focus Cancel, and reconciliation requires an explicit decision.
- Preserve all vault flows, CLI management, lock, favorite pinning, safe project deletion, and keyboard project opening. Do not introduce enclave, integration, Docker, health percentage, or unrestricted clipboard-export claims/actions from the reference.

## Overview

**Creative North Star: "The Vault Ledger"**

A bound custody logbook translated into pinned dark macOS materials. The secrets screen is a custody desk, not a dashboard: the developer who owns a project's credentials scans every secret's state in one gaze, opens any single entry as the inspector's open page, and exposes a value only through a deliberate, time-boxed reading-room ceremony. Nothing destructive is ever one click away, and every visible state traces to real vault evidence — never invented metadata.

Density is compact and desktop-native: a 230px ledger index, a fluid ruled table, and a 380px open-page inspector, all held level by a single pinned footing strip of counts and sync time. The second shipped surface, the home dashboard, is the same world's launchpad: a 230px index beside a fluid main column with no right inspector, where vault health reads as one quiet strip and projects are the visual focus. Surfaces are flat charcoal tonal layers with 1px hairline rules; shadows appear only on overlays (menus, modals, drawers). Type is SF/Inter-like sans for UI with a mono face reserved for secrets material (key names, values, timestamps), and tabular numerals wherever times or counts appear.

**Key Characteristics:**

- Custody logbook topology: fixed index, ruled entries, open-page inspector, one pinned footing strip.
- Stamp-pill state language: always dot + text, never color-only.
- Masked by default: secrets read as bullets plus last four; exposure is one click and lamp-timed (30s countdown, auto-hide).
- Flat tonal depth: layered charcoals and hairlines, shadows reserved for floating layers.
- Honest data: Type, Status, Usage, and Audit derive only from vault contents, logs, and timestamps.
- Launchpad, not report: the dashboard shows health as a quiet strip and projects as compact cards — every count traces to real vault evidence.
- Hashed identity: project monograms derive their two initials and tint from the project name, never from status.

## Colors

Pinned charcoal ledger grounds with a single macOS blue voice; muted green/amber/red/gray speak only as state stamps.

### Primary

- **Ledger Blue** (#0A84FF, hover #0066CC): the one interactive voice — primary buttons, selection bar and tint, links, focus rings, checked states. Its rarity is the point.

### Neutral

- **Ledger Black** (#171717): app and table ground.
- **Raised Coal** (#1E1E1E): index, inspector, and modal grounds — one step above the table ground.
- **Ruled Surface** (#242424): inputs, value blocks, menu grounds, buttons at rest.
- **Lifted Surface** (#2A2A2A): hovers, active nav rows, type-icon tiles, tag chips.
- **Hairline** (#2E2E2E): structural borders (table header rule, inputs, menus, modals).
- **Soft Hairline** (#262626): faint entry dividers between ruled rows.
- **Ledger Ink** (#E6E6E6): primary text, key names.
- **Dim Ink** (#A8A8A8): secondary text, values at rest, descriptions.
- **Faint Ink** (#8A8A8A): tertiary text — labels, timestamps, hints, placeholders.

### Status signals (stamp-pill scoped)

- **Stamp Green** (#30D158 on rgba(48, 209, 88, 0.13)): Healthy.
- **Stamp Amber** (#FF9F0A on rgba(255, 159, 10, 0.14)): Rotate soon, needs-attention counts, reveal countdown.
- **Stamp Red** (#FF453A on rgba(255, 69, 58, 0.13), danger hover #D92D20): Expired, destructive actions.
- **Stamp Gray** (#98989D on rgba(152, 152, 157, 0.14)): Config — non-secret material.

### Monogram tints (project identity, scoped)

- **Identity Blue** (#5EB2FF on rgba(10, 132, 255, 0.14)): violet-leaning blue monogram tint.
- **Identity Violet** (#D29DF7 on a violet soft ground, base #BF5AF2): violet monogram tint.
- **Identity Teal** (#64D2FF on a teal soft ground): teal monogram tint.
- Project monograms pair two name-derived initials with one of six muted tones (blue / green / amber / violet / teal / gray): a soft tinted ground with tinted text. The green, amber, and gray tones speak in the ledger's existing signal hues; the blue, violet, and teal tones use the tints above.

### Named Rules

**The Lamp-Plus-Text Rule.** Status is never color-only: every stamp-pill pairs its dot with a text label (Healthy / Rotate soon / Expired / Config). **The One Voice Rule.** Ledger Blue is the only accent; greens, ambers, and reds appear solely as state stamps and danger actions, never as decoration. **The Hash-Not-Status Rule.** Monogram tints are identity derived from the project-name hash, never status: tints must not be read as health, and stamps must not borrow monogram tints.

## Typography

**Display Font:** System sans stack (with Segoe UI / Roboto fallback) **Body Font:** System sans stack (with Segoe UI / Roboto fallback) **Label/Mono Font:** ui-monospace, SF Mono, SFMono-Regular, Menlo, Consolas, monospace

**Character:** Quiet system-native sans for chrome; a precise mono voice reserved for secrets material. Tabular numerals keep times and counts level like ruled figures.

### Hierarchy

- **Display** (600, 24px, tight −0.02em): page title ("Secrets") only.
- **Title** (600, 16px): modal headings and section-level titles (16–18px range).
- **Body** (400, 12–14px): rows, menus, inspector prose, form fields.
- **Label** (600, 11px, 0.05em tracking, uppercase): table headers, dropdown group labels, index section labels.
- **Mono** (400, 12.5px, 1.6 line-height): key names, secret values (masked or revealed), timestamps, history entries. Times and counts always set with tabular numerals.
- **Metric** (600, 19px, tight −0.01em, tabular numerals): overview-strip numerals on the dashboard.
- **Card name** (600, 14px): dashboard project-card names (also the sidebar brand mark).
- **State title** (600, 15px): empty and no-results state headings.

### Named Rules

**The Mono-Is-Material Rule.** Mono type is reserved for secrets material (keys, values, timestamps) — never for marketing or chrome copy.

## Layout

Three columns at desktop width: a 230px ledger index (brand, project switcher, Secrets / Activity / Settings nav, All / Needs attention / Recently changed / Favorites views with live counts, sync line pinned to the bottom), a fluid center column (breadcrumb, title row with vault subtitle, toolbar, footing strip, ruled table), and a 380px inspector. The table uses one strict grid (Name 26 / Type 11 / Value 27 / Status 13 / Updated 12 / Actions 11) with a fixed 52px row height, sticky uppercase header, and a 640px minimum that scrolls horizontally rather than reflowing.

The Project screen keeps this presentation and its established CSS in `src/styles/project.css`. Its React entry, feature hooks, and typed components live in `src/project/main.tsx`, `src/project/review-state.ts`, and `src/project/components.tsx`; the Dashboard React entry lives in `src/dashboard/main.tsx`. Both React views share the typed preload bridge contract in `src/project/bridge.ts`. Vite builds these views and their local CSS/assets, while the six other views continue to use their existing vanilla renderer scripts.

Responsive behavior is contract, not suggestion: at or below 1100px the inspector becomes an overlay drawer with scrim; at or below 860px the index collapses behind a toggle and toolbar button labels collapse to icons; the app floor is 680px. One pinned footing strip (counts + updated time) holds level while entries scroll; status changes never move rows — selection is an inset 2px accent bar plus a 9% accent tint on the existing row.

The dashboard reuses the same index width (230px), collapse point (860px), and app floor (680px), but ships only two regions — index and fluid main column, no right inspector. Projects lay out in a responsive card grid (`repeat(auto-fill, minmax(300px, 1fr))`, 3→2→1 columns) with 12px gaps; under 860px the overview strip wraps 2×2 with the health state going full-width beneath a top divider. Lock has no dashboard visual (locking redirects), and there is no title-bar drag region (the native frame drags).

## Elevation & Depth

Flat by default; depth is conveyed through tonal layering (black → coal → surface → lifted) and 1px hairline rules, not shadows. Dashboard cards follow the same doctrine: hover lifts 1–2px (`translateY(-1px)`) with a more-visible border (soft hairline → hairline, ground rising to Ruled Surface) and introduces no new shadow.

### Shadow Vocabulary

- **Floating menu** (`box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45)`): dropdown menus only.
- **Dialog** (`box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5)`): modal dialogs only.
- **Drawer** (`box-shadow: -16px 0 48px rgba(0, 0, 0, 0.5)` right / `16px 0 48px` left): overlay inspector and collapsed index only.

### Named Rules

**The Flat-By-Default Rule.** Resting surfaces are flat tonal layers separated by hairlines. Shadows appear only when a layer floats above the ledger (menu, dialog, drawer, toast).

## Shapes

Gently rounded rectilinear forms throughout: inputs, buttons, and menus at 8px; value blocks, review lists, and history containers at 10px; modals and error cards at 12px; stamps and tag chips as full pills (999px). Type-icon tiles are small rounded squares (7–8px radius on 26–30px tiles). Row selection never rounds — it is an inset 2px accent bar on the row's leading edge, so the ruled grid stays visually unbroken. Danger is quarantined by separation (below a divider, in the overflow menu) rather than by shape. Small radii extend the ramp downward in size order: 4px for small inline keys (search ⌘K hint), 5px for the sidebar brand mark, 7px for icon wells and card action buttons; the 32px monogram tile itself stays at 8px.

## Components

### Buttons

Ledger-quiet at rest, blue only for the primary forward action.

- **Shape:** gently rounded (8px radius), fixed 32px height, 0 12px padding.
- **Primary:** Ledger Blue ground with white text; hover deepens to #0066CC.
- **Hover / Focus:** secondary and icon buttons lift from Ruled Surface to Lifted Surface; every control shows a visible 2px Ledger Blue focus ring (offset 2px).
- **Secondary / Icon / Danger:** secondary is Ruled Surface with Hairline border; icon-only is 32px square and always carries an accessible label plus tooltip; danger is Stamp Red ground (hover #D92D20) and lives apart — delete/duplicate-danger sit below a separator in the overflow menu.

### Stamp pills

The state language of the ledger: dot + text on a tinted ground, 24px height, full pill.

- **Healthy / Rotate soon / Expired / Config** map to Stamp Green / Amber / Red / Gray grounds listed in Colors.
- **Derivation (honest data):** Type comes from a name-signal match (secret/token/password/private/credential/passphrase, plus standalone auth/session/salt/key) else a plain-URL-without-credentials or plain-scalar (boolean/number) reads as Config — everything else defaults to Secret. Status comes only from real data: `expiresAt` past → Expired, within 7 days → Rotate soon; `updatedAt` older than 180 days → Rotate soon; Config rows always carry the Config pill.
- **State:** status changes re-stamp the pill in place; rows never reorder or displace on status change.

### Ruled table rows

- **Cells:** mono key name with type-icon tile (lock for Secret, file-text for Config), Type label, masked value (`••••••••` + last 4; Config values read plain), stamp-pill, relative updated time with absolute title, copy + overflow actions.
- **Selection:** `aria-selected` row gets inset 2px Ledger Blue bar + 9% accent tint; hover is Raised Coal. Favorite star reveals on hover/focus or when set (amber).
- **States:** loading spinner, error card with retry, empty state with New-secret action, no-results — all centered in the table region.

### Required configuration ledger

- A compact summary sits between the Project footing strip and secrets table. It reports Not configured, an explicit loading/error state, or “n of m required keys ready” with Missing / Empty / Expired counts.
- The expandable checklist uses ruled rows with mono key names, dot plus text status, and a small Add or Edit action for gaps. Required-key statuses remain separate from the Secret health pills and never show Secret values.
- Missing opens the existing Add Secret dialog with its name filled in; Empty and Expired open the existing edit dialog. Editing an expired Secret keeps its expiration until the user changes the expiry control.

### Inspector (open page)

- **Head:** type-icon tile, mono key title, relative-time subtitle; overflow menu (rotate, history, duplicate-to-project, delete below separator) + close.
- **Value block:** Ruled Surface card (10px) with mono value, Copy + Reveal actions; Reveal exposes plaintext immediately under a live 30-second amber countdown with auto-hide (also hides on window blur); copy fires a two-line toast noting the 30-second clipboard clear.
- **Sections:** description prose, Metadata grid (created / updated / version count / expires / vault), Tags chips, Usage (up to 3 access-category log lines mentioning the key), Audit (version-history entries — value-updated lines plus creation; no actors exist, so none are shown).

### Dropdown menus

Ruled Surface ground, Hairline border, 10px radius, floating-menu shadow; items 13px with icon + two-line label/description, checked option shows a blue check; danger items render in Stamp Red; a RECOMMENDED outline badge marks the safe-default export mode.

### Modals

Raised Coal ground, Hairline border, 12px radius, dialog shadow; 16px title with 13px secondary sub-line; fields are Ruled Surface with Hairline borders that take Ledger Blue on focus and Stamp Red on invalid with inline error text; actions right-aligned. Environment import uses Input and Review steps shared by Paste and File, with line diagnostics, masked values, explicit duplicate choices, protected defaults for changed and empty values, and a live import count; revealed values hide after 30 seconds or window blur. Required configuration follows the same Paste/File input conventions and Input → Review → Save sequence, but the review contains key names and completeness statuses only. Refresh lists added, removed, and unchanged names; clear review explains that Secrets remain. Version history lists masked entries with per-row show plus two-step restore (arm → confirm). Raw export pairs a red warning well with master-password re-authentication verified in the main process plus an audit event.

The Project heading also carries the selected Environment. Environment management creates empty collections, preserves identity on rename, and confirms deletion with its affected Secret count. Every Secret review labels the selected target. Credential exports cover that Environment; encrypted Project backup covers every Environment and is invalidated if any Project content changes while the native save picker is open. The stored `defaultEnvironmentId` is the omission target for CLI, HTTP, and MCP and does not follow desktop selection; renaming preserves it and deleting it requires an explicit replacement. Usage attribution matches structured Vault, Project, and Environment identity; historical records without Environment identity stay unscoped.

### Toasts

Bottom-right two-line cards (message + `.message-detail` line in secondary text) with success/error/warning icon wells; used for copy (with clipboard-clear notice), rotate, duplicate, import/export, and restore confirmations.

### Named Rules

**The Masked-By-Default Rule.** Secret values render as bullets plus last four everywhere until the reveal ritual runs; history rows follow the same rule per row. **The Danger-Quarantine Rule.** Destructive actions live below a separator in an overflow menu and confirm through a dedicated modal — never one click from the ledger. **The Reveal-on-Touch Rule.** Hover-only actions must also reveal on keyboard focus, when set, and on touch (`@media (hover: none)` forces them visible) — this covers dashboard card/row actions and the secrets-screen favorite star alike.

### Overview strip (dashboard)

A quiet single strip, not cards: Raised Coal ground, soft-hairline border, 12px radius, 6px vertical / 4px horizontal padding. Four metrics carry a 30px icon well (8px radius, Lifted Surface ground) with a 15px glyph, a 19px semibold tabular numeral, and a 12px secondary label; 1px soft-hairline vertical dividers separate metrics. The health state sits right-aligned past its own divider: an 8px dot plus 12.5px medium text ("Everything is healthy" in green, attention counts in amber/red) with an 11.5px faint sub-line. The expiring metric reads amber only above zero and red when expired entries exist. The whole strip hides when `showStatistics` is off.

### Project cards (dashboard)

Compact launchpad cards, 176–200px tall: Raised Coal ground, soft-hairline border, 12px radius, 14px sides / 12px bottom padding. Each card opens with a 32px monogram tile (8px radius, 13px semibold initials), the 14px semibold project name (ellipsis), and hover/focus/touch-visible actions — a star (amber when set) plus an overflow menu whose delete is danger-styled and confirm-guarded. The meta line reads "{n} secrets · Updated {time}" with tabular numerals and the singular "1 secret"; below it a 12px faint last-accessed line derived from access logs, omitted entirely when absent. Projects updated or accessed today carry a green Active-today pill (dot + text, reusing the stamp-pill language). Hover rises to Ruled Surface with a hairline border and a 1–2px lift; focus shows the 2px Ledger Blue ring. Cards are `role=link`: Enter/Space opens, and every icon-only action carries its accessible name via `data-i18n-aria`.

### List rows (dashboard)

The same data and actions in a compact 56px row: 28px monogram, 13.5px semibold name, 12px faint sub-line, right-aligned 12.5px tabular meta, and the same hover/focus/touch-visible star and overflow actions. Rows stack in a 12px-radius bordered container with soft-hairline dividers.

### Discovery controls (dashboard)

Sort (Recently updated default, Name A–Z, Most secrets — favorites pinned first) and a grid/list toggle live in the "Your projects" section header only. Search filters live with ⌘K/Ctrl+K focus; a search with no hits shows a no-results state with Clear search, and a vault with no projects shows an empty state with Add project. State headings set the 15px semibold state title.

### Vault switcher and surface chrome (dashboard)

The functional vault switcher (the "System" control) is preserved with all vault flows intact — list, switch, create, import, rename, remove — relocated to the sidebar. Shared additions shipped with this surface: the activity-pulse (`.lk-icon-activity`) and grid (`.lk-icon-grid`) icons as 24×24 stroke-2 SVGs registered as `.lk-icon-*` mask classes in `common.css`; the `data-i18n-aria` pattern for accessible names on icon-only controls; the touch-reveal rule above.

## Do's and Don'ts

Concrete guardrails grounded in the implemented ledger. New screens stay on-brand by honoring these.

### Do:

- **Do** load `common.css` first, then the page stylesheet, and scope page rules to the screen class so nothing leaks across pages.
- **Do** route every UI string through `i18n.t()` with keys in `src/locales/en.json`, including `aria-label`s via `data-i18n-aria`.
- **Do** render new icons as 24×24 stroke-2 SVGs matching the existing set and register them as `.lk-icon-*` mask classes in `common.css`.
- **Do** pair every status color with a text label, keep tabular numerals on times/counts, and keep mono type on secrets material.
- **Do** timebox every plaintext exposure (one-click reveal, 30s countdown, auto-hide, hide on blur) and confirm every destructive or raw-export action with main-process enforcement.
- **Do** keep the dashboard honest: omit the last-accessed line when access logs have nothing, hide the overview strip when statistics are off, and keep favorites pinned first in every sort.
- **Do** reveal hover-only actions on focus, when set, and on touch — never hover alone.

### Don't:

- **Don't** invent metadata the Vault doesn't have — Environment names are persisted user labels, not deployment status. Do not invent owners, actors, deploys, per-secret usage graphs, or file references; derive Usage from structured access logs and Audit from version history only.
- **Don't** move rows on status change, and don't add oversized cards, gradients, or heavy resting shadows to the ledger.
- **Don't** show raw secret values by default, commit imports without reviewed preview, or offer raw export without warning + re-authentication + audit event.
- **Don't** ship icon-only buttons without accessible labels and tooltips, and don't trap keyboard users — `/` focuses search, arrows move selection, Enter opens the inspector, Escape closes the topmost layer.
- **Don't** use monogram identity tints to signal state, turn the overview strip into cards, or show a locked-dashboard visual — lock redirects instead.
