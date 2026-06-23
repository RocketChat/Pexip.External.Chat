# Pexip External Chat Plugin

A [Pexip Web App 3](https://developer.pexip.com/docs/plugins/webapp-3/introduction)
plugin that adds a **Chat** toolbar button and bridges the meeting to an external
chat experience hosted by the page that embeds Web App 3 (the *top window*).

The plugin and the top window communicate over `window.postMessage`. The plugin
also exposes the Web App 3 `conference.dialOut` capability so the top window can
dial participants into the meeting.

```
┌──────────────────────────────┐
│ Top window (embedding page)  │
│                              │
│   ┌───────────────────────┐  │   postMessage (both directions)
│   │ Web App 3 (iframe)    │  │
│   │   ┌────────────────┐  │◄─┼────────────────────────────────┐
│   │   │ external-chat  │──┼──┼────────────────────────────────┘
│   │   │   plugin       │  │  │
│   │   └────────────────┘  │  │
│   └───────────────────────┘  │
└──────────────────────────────┘
```

## Repository layout

```
.
├── Makefile                       # build + package pipeline (run from repo root)
├── external-chat/                 # the plugin source (Vite + TypeScript)
│   ├── src/index.ts               # plugin entry point
│   └── package.json               # version is the source of truth for releases
└── webapp3/
    └── branding/
        ├── manifest.json          # Web App 3 branding manifest (registers the plugin)
        └── plugins/external-chat/ # built plugin is copied here by `make deploy`
```

> The plugin `id` in `external-chat/src/index.ts` (`registerPlugin({ id: 'external-chat' })`)
> **must** match the plugin `id` in `webapp3/branding/manifest.json` (`plugins[].id`).
> A mismatch causes Web App 3 to reject the plugin at load time.

---

## postMessage API

All messages — in both directions — share a single envelope: a flat object with
an `action` string plus any payload fields alongside it.

```js
{ action: 'pexip:plugin:external-chat/<name>', ...payloadFields }
```

Every `action` is namespaced with the `pexip:plugin:external-chat/` prefix.
Messages without that prefix are ignored (and logged as a warning).

### Security

The plugin only reacts to messages whose `event.source` is the **top window**.
Messages originating from the plugin's own iframe or sibling frames are dropped.
If your deployment has a fixed host origin, you should additionally gate on
`event.origin` in `src/index.ts` for defense in depth.

---

### Messages sent BY the plugin (plugin → top window)

Listen for these in the top window:

```js
window.addEventListener('message', (event) => {
  if (event.source !== document.querySelector('iframe#webapp3')?.contentWindow) return;
  const { action, ...data } = event.data ?? {};
  switch (action) {
    case 'pexip:plugin:external-chat/ready':            /* plugin is loaded */ break;
    case 'pexip:plugin:external-chat/connected':        /* user joined the call */ break;
    case 'pexip:plugin:external-chat/disconnected':     /* data.userInitiated, data.error, data.errorCode */ break;
    case 'pexip:plugin:external-chat/toggle-chat':      /* data.active */      break;
    case 'pexip:plugin:external-chat/dial-out-success': /* data.uuid, data.displayName */ break;
    case 'pexip:plugin:external-chat/dial-out-error':   /* data.message */     break;
  }
});
```

| Action | Payload | When |
| --- | --- | --- |
| `pexip:plugin:external-chat/ready` | _(none)_ | Plugin finished loading and registering (before the user joins). |
| `pexip:plugin:external-chat/connected` | _(none)_ | User joined the call (passed preflight); the in-meeting toolbar and Chat button are now visible/accessible. |
| `pexip:plugin:external-chat/disconnected` | `{ userInitiated: boolean, error?: string, errorCode?: string }` | User left or lost the call; the toolbar is no longer available. `userInitiated` is `true` when the user clicked **Leave**, `false` for an involuntary drop (in which case `error`/`errorCode` are set). |
| `pexip:plugin:external-chat/toggle-chat` | `{ active: boolean }` | User clicked the Chat toolbar button. `active` is the **requested** state (the opposite of the current one). |
| `pexip:plugin:external-chat/dial-out-success` | `{ uuid: string, displayName?: string }` | A `dial-out` request succeeded; the dialed participant joined. |
| `pexip:plugin:external-chat/dial-out-error` | `{ message: string }` | A `dial-out` request failed. |

> **Note:** Clicking the toolbar button only *notifies* the top window via
> `toggle-chat`. The button's active/tooltip state does **not** change on its own —
> the top window is the source of truth and must echo back
> `toggle-chat-button-state` (below) to update the button.

---

### Messages handled BY the plugin (top window → plugin)

Send these from the top window to the Web App 3 iframe:

```js
const iframe = document.querySelector('iframe#webapp3');
iframe.contentWindow.postMessage({
  action: 'pexip:plugin:external-chat/toggle-chat-badge',
  visible: true,
}, '*'); // use the Web App 3 origin instead of '*' in production
```

| Action | Payload | Effect |
| --- | --- | --- |
| `pexip:plugin:external-chat/toggle-chat-button-state` | `{ active: boolean }` | Sets the Chat button's active state and tooltip (`Close Chat` / `Open Chat`). |
| `pexip:plugin:external-chat/toggle-chat-badge` | `{ visible: boolean }` | Shows or hides the unread badge on the Chat button. |
| `pexip:plugin:external-chat/dial-out` | _dial parameters (see below)_ | Dials a destination into the conference via `conference.dialOut`. Replies with `dial-out-success` / `dial-out-error`. |

#### `dial-out` parameters

These map directly to the Pexip Infinity `dial` request body.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `role` | `'HOST' \| 'GUEST'` | ✅ | Privilege level of the dialed participant. |
| `destination` | `string` | ✅ | The target address to call. |
| `protocol` | `'sip' \| 'h323' \| 'rtmp' \| 'mssip' \| 'auto'` | ✅ | Protocol used to place the call. |
| `call_type` | `'video' \| 'video-only' \| 'audio'` | — | Limits the media content of the call. |
| `presentation_url` | `string` | — | For RTMP calls, sends presentation to a separate destination. |
| `streaming` | `'yes' \| 'no'` | — | Marks the participant as a streaming/recording device. |
| `dtmf_sequence` | `string` | — | DTMF tones to send once the call connects. |
| `source` | `string` | — | Source URI (must be valid for the conference). |
| `source_display_name` | `string` | — | Calling display name. |
| `remote_display_name` | `string` | — | Friendly name shown in participant lists / overlays. |
| `text` | `string` | — | Overlay text used instead of `remote_display_name`. |
| `keep_conference_alive` | `'keep_conference_alive' \| 'keep_conference_alive_if_multiple' \| 'keep_conference_alive_never'` | — | Whether the conference continues after others leave. |

Example:

```js
iframe.contentWindow.postMessage({
  action: 'pexip:plugin:external-chat/dial-out',
  role: 'GUEST',
  destination: 'alice@example.com',
  protocol: 'sip',
  call_type: 'video',
  remote_display_name: 'Alice',
}, '*');
```

> `conference.dialOut` resolves only once the dialed participant actually joins.
> Hard failures (e.g. an invalid URI) reject and produce `dial-out-error`, but a
> destination that simply never answers will neither resolve nor error.

---

## Setup

**Prerequisites:** Node.js 18+ (developed on Node 22) and npm.

```bash
cd external-chat
npm install
```

### Develop

```bash
npm start
```

Vite serves the plugin from `https://localhost:5173` (self-signed cert via
`vite-plugin-mkcert` — accept it in the browser once). You access it through your
Web App 3 URL configured to load the plugin from this dev server. See the
[Pexip setup guide](https://developer.pexip.com/docs/plugins/webapp-3/setup-guide-for-plugin-developers).

### Build (standalone)

```bash
npm run build   # outputs to external-chat/dist/
```

The current version is read from `external-chat/package.json` and is logged by the
plugin at runtime (`plugin: external-chat loaded v<version>`).

---

## Building & packaging with the Makefile

Run all `make` commands from the **repository root**. The pipeline bumps the
version, builds the plugin, copies it into the branding bundle, and produces a
versioned zip.

```bash
make            # same as `make package` — runs the full pipeline
```

### Targets

| Target | What it does |
| --- | --- |
| `make bump` | Bumps the **minor** version in `external-chat/package.json` (`npm version minor --no-git-tag-version` — no git commit or tag). |
| `make build` | Runs `bump`, then `npm run build` so the new version is embedded in the bundle. |
| `make deploy` | Runs `build`, then copies `external-chat/dist/` into `webapp3/branding/plugins/external-chat/`. |
| `make package` | Runs `deploy`, then zips the `webapp3/` folder into `external-chat-v<version>.zip` at the repo root. |
| `make all` | Alias for `make package` (the default target). |
| `make clean` | Removes `external-chat/dist/` and the deployed plugin folder. |

Dependency chain: `package → deploy → build → bump`.

### Output

`make` produces `external-chat-v<version>.zip` in the repo root, where `<version>`
is the freshly bumped value from `package.json` (e.g. `external-chat-v1.4.0.zip`).
The zip contains the full `webapp3/` branding bundle, ready to upload.

> ⚠️ **Every `make` (or `make build`/`deploy`/`package`) bumps the minor version**,
> because `build` depends on `bump`. To build *without* bumping, run
> `cd external-chat && npm run build` directly and copy `dist/` yourself.
