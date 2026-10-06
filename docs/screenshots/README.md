# Screenshot capture context

These are unedited captures of KeyHarbor's rendered Electron UI, using fictional data in a temporary encrypted vault. No personal vault data or working credentials are included.

- App source: `71c3615a18f5af2cc685344b17e12bc3f924e2d1` (version 2.0.0).
- Runtime: source build produced by `npm run build:desktop`, Electron 44.4.4, macOS 27.0.1.
- Appearance: dark theme, English locale, default font scale, Retina display.
- Main content viewport: 1440 × 838 logical pixels (2880 × 1676 PNG pixels).
- Approval viewport: 450 × 358 logical pixels (900 × 716 PNG pixels).
- Fixture: Harbor Shop, Payments API, Customer Portal, and Worker Service; each has separate dev, staging, and prod environments. The vault contains 51 synthetic secrets. Harbor Shop requires seven keys and deliberately omits SENTRY_DSN.
- Isolation: both the vault home directory and Electron user data were redirected into a task-specific temporary directory. Screen capture protection was disabled only in that demo profile; update checks and biometric unlock were also disabled.
- Capture method: Chromium's `Page.captureScreenshot` on the actual Electron windows. Images retain the complete rendered window content; native macOS window decorations are not included.

| Image | Captured state |
| --- | --- |
| `vault-overview.png` | Unlocked System vault, four projects in list view, actual aggregate counts. |
| `project-secrets.png` | Harbor Shop's dev environment with masked credentials and the DATABASE_URL inspector open. |
| `configuration-checks.png` | Expanded required-key checklist, missing SENTRY_DSN, secret inspector closed. |
| `access-approval.png` | Actual ApprovalGate prompt triggered by a localhost getSecret request for DATABASE_URL in dev. The request was denied after capture; no secret value was returned. |

To refresh these images, build the current app and create a separate encrypted demo vault with synthetic data. Navigate through the real UI and trigger the real approval flow. Keep values masked, visually inspect every capture, and update this context with the source revision, runtime, and viewport. Do not substitute generated mockups or alter production approval behavior for screenshots.
