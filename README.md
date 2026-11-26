# Pexip External Chat Plugin

A [Pexip Web App 3](https://developer.pexip.com/docs/plugins/webapp-3/introduction)
plugin that adds a **Chat** toolbar button and bridges the meeting to an external
chat experience hosted by the page that embeds Web App 3 (the *top window*) —
Rocket.Chat's conference window, whose `useProviderPlugin` is the other half of
the protocol below.

The plugin and the top window communicate over `window.postMessage`. Beyond the
chat bridge, the plugin publishes the meeting's participant roster and the local
user's own state, and exposes Web App 3's conference controls — mute, admit,
disconnect, spotlight, raised hands, role changes, transfers, DTMF and dial-out — so the top
window can render a participants panel of its own.

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
{ action: 'rocketchat:videoconf/<name>', ...payloadFields }
```

Every `action` is namespaced with the `rocketchat:videoconf/` prefix. Messages
without that prefix are ignored (and logged as a warning).

The namespace is the host's rather than Pexip's on purpose: the protocol belongs
to the page that hosts the chat, so a plugin for another video provider sending
these same actions gets the same behaviour from that page with nothing new on its
side. Unknown actions are ignored at both ends, so either half can learn a new
message without breaking the other.

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
    case 'rocketchat:videoconf/ready':            /* data.features */    break;
    case 'rocketchat:videoconf/connected':        /* user joined the call */ break;
    case 'rocketchat:videoconf/disconnected':     /* data.userInitiated, data.error, data.errorCode */ break;
    case 'rocketchat:videoconf/toggle-chat':      /* data.active */      break;
    case 'rocketchat:videoconf/self':             /* the local user's state */ break;
    case 'rocketchat:videoconf/roster':           /* data.participants */ break;
    case 'rocketchat:videoconf/dial-out-success': /* data.uuid, data.displayName */ break;
    case 'rocketchat:videoconf/dial-out-error':   /* data.message */     break;
    case 'rocketchat:videoconf/select-new-host':  /* the last host pressed Leave */ break;
  }
});
```

| Action | Payload | When |
| --- | --- | --- |
| `rocketchat:videoconf/ready` | `{ features: Feature[] }` | Plugin finished loading and registering (before the user joins). The **capability announcement** — see [Features](#features). |
| `rocketchat:videoconf/connected` | _(none)_ | User joined the call (passed preflight); the in-meeting toolbar and Chat button are now visible/accessible. |
| `rocketchat:videoconf/disconnected` | `{ userInitiated: boolean, error?: string, errorCode?: string }` | User left or lost the call; the toolbar is no longer available. `userInitiated` is `true` when the user clicked **Leave**, `false` for an involuntary drop (in which case `error`/`errorCode` are set). |
| `rocketchat:videoconf/toggle-chat` | `{ active: boolean }` | User clicked the Chat toolbar button. `active` is the **requested** state (the opposite of the current one). |
| `rocketchat:videoconf/self` | `{ participantUuid: string, micMuted: boolean, camMuted: boolean, clientMuted: boolean, isHost: boolean, canControl: boolean }` | The local user's own state changed. `micMuted` is the conference's mute of them; `clientMuted` is what their own mic button did. |
| `rocketchat:videoconf/roster` | `{ participants: PluginParticipant[] }` | Anybody joined, left, or changed. The **whole** list goes out every time — see [PluginParticipant](#pluginparticipant). |
| `rocketchat:videoconf/dial-out-success` | `{ uuid: string, displayName?: string }` | A `dial-out` request succeeded; the dialed participant joined. |
| `rocketchat:videoconf/dial-out-error` | `{ message: string }` | A `dial-out` request failed. |
| `rocketchat:videoconf/select-new-host` | _(none)_ | The only host pressed the meeting's **Leave** button while others are still in the call. The leave was held back — see [Handing over before leaving](#handing-over-before-leaving). |

> **Note:** Clicking the toolbar button only *notifies* the top window via
> `toggle-chat`. The button's active/tooltip state does **not** change on its own —
> the top window is the source of truth and must send `chat-state` (below) to
> update the button. It sends it whenever its panel changes, however it changed, so
> the button follows a panel closed from the host's own UI too.

---

### Messages handled BY the plugin (top window → plugin)

Send these from the top window to the Web App 3 iframe:

```js
const iframe = document.querySelector('iframe#webapp3');
iframe.contentWindow.postMessage({
  action: 'rocketchat:videoconf/chat-unread',
  unread: true,
}, '*'); // use the Web App 3 origin instead of '*' in production
```

| Action | Payload | Effect |
| --- | --- | --- |
| `rocketchat:videoconf/chat-state` | `{ active: boolean }` | The host's chat panel is open or closed. Sets the Chat button's active state and tooltip (`Close Chat` / `Open Chat`). |
| `rocketchat:videoconf/chat-unread` | `{ unread: boolean }` | The host's chat panel has unread messages, or no longer does. Shown here as a badge on the Chat button. |
| `rocketchat:videoconf/mute` | `{ participantUuid: string, muted: boolean }` | Mutes or unmutes that participant's microphone. |
| `rocketchat:videoconf/mute-video` | `{ participantUuid: string, muted: boolean }` | Mutes or unmutes that participant's camera. |
| `rocketchat:videoconf/admit` | `{ participantUuid: string }` | Admits a participant waiting in the lobby (`isWaiting`). |
| `rocketchat:videoconf/disconnect` | `{ participantUuid: string }` | Removes that participant from the conference. |
| `rocketchat:videoconf/spotlight` | `{ participantUuid: string, active: boolean }` | Spotlights that participant, or drops the spotlight. |
| `rocketchat:videoconf/raise-hand` | `{ participantUuid: string, raised: boolean }` | Puts that participant's hand up, or takes it down. |
| `rocketchat:videoconf/participants-state` | `{ active: boolean }` | Whether the host's people panel is open, which is what the Participants button reflects. |

`mute`, `mute-video` and `raise-hand` are the three things a participant can do to themselves, and Infinity
takes the participant as optional for exactly those. A request naming the local participant is forwarded with
the participant left out, which is how Infinity is told the subject is the caller — naming yourself instead
asks a host to act on a participant, which is a different request and not necessarily one you may make about
yourself.
| `rocketchat:videoconf/set-role` | `{ participantUuid: string, role: 'host' \| 'guest' }` | Promotes or demotes that participant. |
| `rocketchat:videoconf/transfer` | `{ participantUuid: string, alias: string, role?: 'host' \| 'guest', pin?: string }` | Sends that participant to the conference at `alias`. `role` defaults to `guest`, so a transfer never quietly promotes anyone; `pin` is the *target* conference's, omitted when it does not ask for one. |
| `rocketchat:videoconf/dtmf` | `{ participantUuid: string, digits: string }` | Sends DTMF tones to that participant (a dialed-in endpoint). |
| `rocketchat:videoconf/mute-all-guests` | `{ muted: boolean }` | Mutes or unmutes every guest at once. |
| `rocketchat:videoconf/dial-out` | _dial parameters (see below)_ | Dials a destination into the conference via `conference.dialOut`. Replies with `dial-out-success` / `dial-out-error`. |
| `rocketchat:videoconf/leave` | _(none)_ | Leaves the call, exactly as pressing the meeting's **Leave** button does. The answer to `select-new-host`. |
| `rocketchat:videoconf/screen-share` | `{ allowed: boolean }` | Whether the local user may start sharing their screen. See [Restricting screen sharing](#restricting-screen-sharing). |
| `rocketchat:videoconf/refresh-roster` | _(none)_ | Asks Infinity for the conference's participant list and publishes a `roster` built from it. Infinity never tells the plugin when somebody leaves the lobby, so the top window sends this when it learns of a change some other way. |

None of the participant controls reply. The conference answers by *changing*, and the
change reaches the top window as the next `roster`. A request Pexip refuses is logged
in the plugin's console and otherwise silent — which is why the top window is expected
to gate on the `can.*` flags rather than send and hope.

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
  action: 'rocketchat:videoconf/dial-out',
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

### Features

`ready` carries the list of features this plugin implements. The top window renders a
control only for a feature named there, so a plugin for another provider that supports
less simply announces less, and the host's UI shrinks to fit with nothing new on its
side.

This plugin announces all of them:

```js
['chat', 'roster', 'self', 'mute', 'mute-video', 'admit', 'disconnect',
 'spotlight', 'raise-hand', 'set-role', 'transfer', 'dtmf', 'mute-all-guests',
 'participants', 'dial-out', 'leave', 'screen-share']
```

`chat` covers the toolbar button and the `toggle-chat` / `chat-state` / `chat-unread`
exchange; `roster` and `self` are the two messages the plugin publishes; the rest each
name the inbound action of the same name. `leave` also covers the `select-new-host` the
plugin sends before it.

### Handing over before leaving

When the local user is a host, nobody else in the call is (participants waiting in the lobby
don't count), and at least one other participant is there, pressing the meeting's own **Leave**
button doesn't leave. The plugin stops the press and sends `select-new-host` instead, so the top
window can ask the user to pick a new host:

1. To hand over, the top window sends `set-role` with `role: 'host'` for the chosen participant.
2. Whether or not anyone was promoted ("leave anyway"), it then sends `leave`. The plugin presses
   Leave itself, and the call ends the usual way with `disconnected` and `userInitiated: true`.
3. If the user changes their mind, the top window sends nothing and they stay in the call.

Any other press of Leave goes through untouched.

The plugin API has no hook for this, so the plugin finds the button by the test id Web App 3
gives it (`[data-testid="button-leave"]`) and listens for its clicks on the meeting page itself.
That only works because the branding manifest gives the plugin
`"sandboxValues": ["allow-same-origin"]`, and it ties this feature to the deployed Web App 3
version. If the plugin can't reach the page, or the button is renamed, Leave works as it always
did and nobody is asked anything.

### Restricting screen sharing

Screen sharing is allowed until the top window says otherwise. To decide per user, from
whatever it knows about them, the top window sends `screen-share` once it has seen `ready`, and
again whenever its answer changes:

```js
iframe.contentWindow.postMessage({
  action: 'rocketchat:videoconf/screen-share',
  allowed: false,
}, '*');
```

While sharing isn't allowed, the meeting's own screen-share button is taken off the toolbar. A
presentation that is already running keeps it, so that it can still be stopped; taking the permission
away doesn't end it, and the button goes once the presentation does.

This uses the same access to the meeting page as [handing over before leaving](#handing-over-before-leaving):
the plugin adds a stylesheet of its own to that page hiding `[data-testid="button-start-presentation"]`,
which needs the same `allow-same-origin` sandbox value and is tied to the deployed Web App 3 version.
As a backstop, a press of that button that gets through anyway is stopped, with a toast telling the
user that screen sharing isn't available to them. If the plugin can't reach the page, or the button
is renamed, screen sharing works as it always did.

> **Note:** Only the button is taken away. Infinity is never told, so this is not a security
> boundary — a participant who gets a presentation out some other way is not stopped.

### `PluginParticipant`

One entry of the `roster` list.

```ts
type PluginParticipant = {
  uuid: string;
  displayName: string;
  /** In the lobby, waiting to be admitted. */
  isWaiting: boolean;
  isHost: boolean;
  /** Muted by the conference. */
  isMuted: boolean;
  /** Muted in their own client — what their own mic button did. */
  isClientMuted: boolean;
  isCameraMuted: boolean;
  isPresenting: boolean;
  isSpotlight: boolean;
  raisedHand: boolean;
  /** Pexip's per-participant permission flags, passed through unchanged. */
  can: { control: boolean; mute: boolean; disconnect: boolean; transfer: boolean;
         spotlight: boolean; fecc: boolean; raiseHand: boolean; changeLayout: boolean };
};
```

**Showing a control.** The top window should offer one only when the feature is in
`ready.features` *and* that participant's own `can.*` flag allows it. Anything else is
a button whose every press comes back `403`.

`displayName` is whatever Pexip has for the participant, and `''` when it has nothing;
it is the only identity the plugin publishes. Matching a participant to a user of the
host application is the host's job, by name.

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
npm run build                    # outputs to external-chat/dist/ (English)
PLUGIN_LANG=de npm run build     # same, with German UI strings
```

The current version is read from `external-chat/package.json` and is logged by the
plugin at runtime (`plugin: external-chat loaded v<version>`).

---

## Building & packaging with the Makefile

Run all `make` commands from the **repository root**.

```bash
make            # full release: bump the minor version, build, then package
make package    # build & package using the CURRENT version (no bump)
make package PLUGIN_LANG=de   # same, with German UI strings
```

### Language

The tooltips and toasts the plugin shows are baked into the build in one language, picked with
`PLUGIN_LANG` (`en` by default, or `de`). The strings live in
[`external-chat/src/translations.ts`](external-chat/src/translations.ts); to add a language, add a
dictionary there and list it in `translations` — TypeScript fails the build if it misses a string,
and an unknown `PLUGIN_LANG` fails it too. The plugin logs its language at startup
(`plugin: external-chat loaded v<version> (<lang>)`).

### Targets

| Target | What it does | Bumps version? |
| --- | --- | --- |
| `make release` | Bumps the version, then runs `package`. | ✅ |
| `make all` | Alias for `make release` (the default target). | ✅ |
| `make bump` | Bumps the **minor** version in `external-chat/package.json` (`npm version minor --no-git-tag-version` — no git commit or tag). | ✅ |
| `make build` | Runs `npm run build` with `PLUGIN_LANG`. | — |
| `make deploy` | Runs `build`, then copies `external-chat/dist/` into `webapp3/branding/plugins/external-chat/`. | — |
| `make package` | Runs `deploy`, then zips the `webapp3/` folder into `external-chat-v<version>.zip` (`-<lang>` is added for any language but English) at the repo root, using the current `package.json` version. Replaces an existing zip of that name. | — |
| `make clean` | Removes `external-chat/dist/` and the deployed plugin folder. | — |

Dependency chains: `release → bump → package → deploy → build`. Only `release`,
`all`, and `bump` change the version — `build`/`deploy`/`package` use the current
one, so **CI and one-off packaging never bump** (CI runs `make package`).

### Output

`make` produces `external-chat-v<version>.zip` in the repo root, where `<version>`
is the value in `package.json` (e.g. `external-chat-v1.4.0.zip`) — freshly bumped
by `make`/`make release`, or unchanged by `make package`. A non-English build adds
the language: `external-chat-v<version>-de.zip`. The zip contains the full
`webapp3/` branding bundle, ready to upload.

## Continuous integration

`.github/workflows/ci.yml` runs on pushes to `main`, on pull requests, and on
manual dispatch. It installs dependencies (`npm ci`), then runs **lint**,
**typecheck** (`tsc --noEmit`), and **`make package`** for English and German (build +
zip, **no version bump**). The resulting `external-chat-v<version>.zip` and
`external-chat-v<version>-de.zip` are uploaded as one downloadable workflow artifact
named `external-chat-v<version>`.

## Releasing

`.github/workflows/release.yml` is a **manually triggered** workflow
(Actions → *Release* → *Run workflow*). It reads the current version from
`external-chat/package.json`, builds the English and German zips (`make package`, no
bump), then creates a `v<version>` git tag and a GitHub release with
`external-chat-v<version>.zip` and `external-chat-v<version>-de.zip` attached as assets. Release notes are
auto-generated from the changes since the previous release.

Typical flow:

```bash
make bump                 # 1. bump the minor version in package.json
git commit -am "release"  # 2. commit the bump (and push)
# 3. run the "Release" workflow from the Actions tab
```

If a release for the current version already exists, the workflow fails with a
reminder to bump first (it never overwrites an existing tag/release).
