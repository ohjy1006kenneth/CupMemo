# Online-only PWA (Refs #26)

Issue: https://github.com/ohjy1006kenneth/CupMemo/issues/26.
Primary HQ card: `t_898ccedd` (tenant `cupmemo`).

## Installation and identity

CupMemo is an **online-only** personal coffee brewing journal. Its stable
`/manifest.webmanifest` uses the current origin, root ID/start/scope, standalone
display, Clean Studio blue and the font-free CM monogram. Root scope intentionally
includes sign-in and sign-up: it grants neither authorization nor caching.
Opening the installed app uses the unchanged authoritative `/` session redirect.
No session opens sign-in; a valid session opens Beans. Fastify still owns all
identity and server-backed journal data.

Use public **HTTPS**, or localhost/loopback for local development. No insecure
origin flag is necessary or supported by this verification procedure.

- Desktop Chrome/Chromium: open CupMemo, then the browser menu's installation
  action (typically **Cast, save and share → Install page as app** or **Install
  CupMemo**). Confirm the CupMemo name/icon. Launch from the installed app entry.
- Android Chrome: open the HTTPS site, use the browser menu's **Install app** or
  **Add to Home screen**, and confirm the installation. Labels vary by version.
  Use the installed launcher entry, not a bookmark screenshot as standalone proof.
- iOS Safari: Share → **Add to Home Screen**. The title, 180px Apple icon and
  Apple web-app compatibility metadata are supplied. This is lightweight metadata
  compatibility, not a tested native iOS integration claim.

Browser menu installation is distinct from automatic promotion/engagement and
`beforeinstallprompt`. CupMemo has no install banner, custom prompt or promise
that the browser will automatically offer installation. A browser may also
install arbitrary sites: installation alone is not proof of manifest criteria.

## Online-only privacy and limitations

There is deliberately **no service worker**, offline shell, fetch interception,
private Cache Storage/IndexedDB/localStorage/sessionStorage, background sync or
queued mutation. Offline fresh navigation may show the browser's offline error.
There are no offline edits/saves or durable draft guarantees. A mounted draft is
only ephemeral memory; closing, reloading, browser eviction or a mobile crash can
lose it. The existing uncertain-save policy remains: inspect the real Journal
before attempting another write; installation adds no automatic resend.

Ordinary browser caching of public icons and Next static assets is not private
journal caching. Existing private API `no-store` and dynamic session checks remain
unchanged. The browser retains ordinary HttpOnly auth cookies as before; closing
an app window is not sign-out. Saved data lives in PostgreSQL and remains after
relaunch while the server is available. Sign out explicitly to revoke the session.
Installing multiple shortcuts does not create an independent security identity.
The unchanged Better Auth client may retain `better-auth.message` in localStorage
for cross-tab session-change notification (trigger, random client marker and
timestamp only). This is not a stored session/account, journal record or draft;
the server still validates identity. PWA configuration adds no browser storage.

## Assets and reproducibility

`apps/web/public/icons/monogram.svg` is an editable blue/white vector CM mark,
with no font dependency or external resource. All essential strokes fit within
the central 40%-radius maskable safe circle, with an opaque square background.
Separate 192/512 `any`, 512 `maskable` and 180 Apple PNGs are committed. With
frozen project dependencies and system Chromium 147.0.7727.101:

```sh
node scripts/generate-pwa-icons.mjs
corepack pnpm exec vitest run tests/pwa.test.mjs
```

The development-only generator rasterizes the SVG in system Chromium; no image
library or generator is shipped at runtime. Browser-version rasterization changes
may change bytes; review regenerated pixels and hashes rather than silently
replacing approved assets. Unit checks decode PNG scanlines/dimensions/opacity
and safe geometry; the real browser suite checks anonymous MIME/200 responses,
DOM metadata, decoded image sizes, parsed manifest and online-only privacy.

## Verification boundary

The exercised local target is system Chromium **147.0.7727.101 on Linux**.
Its native toolbar installation dialog and `chrome://apps` launcher were used;
experimental `PWA.install` was advertised but returned method-not-found at both
browser and page targets. The real installed window reported standalone mode;
signup/signin, Beans/Journal, create/sensory/detail/same-ID edit, persisted relaunch,
offline fresh-navigation failure and signout/relaunch denial were exercised.
The parsed manifest had no errors and Chromium's installability error list was
empty; automatic prompt engagement is not claimed. Native 200% zoom changed DPR
from 1 to 2 and content width from 1272 to 636, with CSS zoom unchanged at 1.
This desktop app's native minimum content width was 500px: narrower responsive
viewports are separately labeled browser emulation, not native phone windows.
Exact-head evidence is
retained on the primary card; independent technical and rendered visual review
and owner acceptance remain separate gates. Android-sized desktop viewports
are responsive checks, **not physical Android installation verification**.
Physical Android Chrome, physical iOS Safari, assistive screen-reader testing and
public-host HTTPS installation are **unverified/pending deployment-time checks**.
This outcome does not authorize production deployment or close those gates.

If the icon/name is stale, refresh while online and inspect the public manifest
and icons. On a disposable task profile only, uninstall/reinstall that owned app
and verify the parsed manifest again. Do not clear unrelated profiles, cookies,
shared fixtures or other installed apps. Browser-specific installation UI or
experimental CDP command limitations must be recorded, not bypassed with a fake
`--app` window, emulated display mode or placeholder installation.

References: [MDN installability](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable),
[Chrome menu installation criteria](https://developer.chrome.com/blog/update-install-criteria),
[experimental native PWA protocol](https://chromedevtools.github.io/devtools-protocol/tot/PWA/).
