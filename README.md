# BAR TIME — 見える時間

A Japanese, browser-local visual timer PWA. Buildless HTML/CSS/ES modules, with no third-party runtime dependencies or analytics.

Revision 2 uses the official VBT5 front/top/color photos and its manual as references. Versioned asset URLs prevent the original service worker from mixing old scripts with the new HTML.

Revision 3 adds a presentation-only focus view with a visible exit and optional, user-initiated browser fullscreen. All four digital glyphs now share one integer-grid SVG viewport, avoiding separate scaling and baseline alignment. Timers and saved settings are unchanged.

Official references:
- https://www.kingjim.co.jp/sp/visual-bar-timer/vbt5/
- https://www.kingjim.co.jp/resource-files/download/manual/vbt5m.pdf

The Web interface intentionally adds direct time inputs and a separate accessible reset. Power is a screen/pause control, not physical battery power. It does not claim to reproduce battery life, device environment specifications, or guaranteed background alarms.

## Features
- Countdown up to 99:50; count-up up to 99:59.
- Work/rest repeats (1–99 work cycles), with rest only between work periods.
- Ten discrete LCD segments, separate bar/digital windows, lemon/mint/marine/ice case colors.
- Six top controls arranged like the reference, plus accessible direct inputs/reset.
- Finite 3-second transition / 10-second completion alarm and LED episodes; mute retains visual signals.
- Timestamp-based elapsed time and pause/resume persisted on the same browser.
- Optional Screen Wake Lock and platform-aware installation guide.
- Focus display hides surrounding controls without resetting or pausing the timer; browser fullscreen gracefully handles unsupported or denied requests.
- PWA manifest, PNG/maskable/apple icons and offline service-worker shell.

## Verification
Run `npm test` and `npm run check`.

68 automated checks cover timer boundaries and background recovery, manifest assets, service-worker auth/cache handling, focus/fullscreen actions and asynchronous cancellation, and UI actions in a simulated DOM. Digit geometry is checked across all 6,000 possible display values. Simulated-DOM tests are not browser tests.

Actual Playwright/Chromium testing was attempted on 2026-10-19, but this execution environment denied Chromium's local socket; the supported escalation route also failed before launch. Therefore visual rendering, real-device installation and actual offline navigation are not verified by that attempt.

## Limitations
Mobile browsers may suspend pages and audio in the background or while locked. This app calculates the correct elapsed time when reopened; it cannot guarantee an alarm with the page closed. No notification permission is requested. Saved state is device/browser-local and not synced. Device clock changes can affect elapsed wall time.

This application is publicly available on GitHub Pages. The service worker caches only allowlisted static assets and marker-validated generic HTML, never auth pages or arbitrary URLs. Online authorization responses are returned as-is rather than replaced with cached HTML. A downloaded offline copy and browser-local settings remain accessible to anyone who can use that device; the in-app guide explains this and offers local deletion.

## Deployment
Static source is `dist/`. Run `npm test` and `npm run check`, then `npm run pages` to copy it to `docs/`. GitHub Pages publishes `main:/docs` at https://oharato.github.io/bar-time/. No runtime dependencies or build step are required.

Browser storage and service-worker caches are isolated by deployment path. No settings or timer state are sent to a server.

Independent design, not affiliated with a physical timer manufacturer.
