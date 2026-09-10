import { registerPlugin } from '@pexip/plugin-api'
import type { ButtonRPCPayload } from '@pexip/plugin-api'
import { version } from '../package.json'

// The protocol belongs to the page that hosts the chat, not to Pexip, so the namespace is Rocket.Chat's: any
// provider plugin sending these actions gets the same behaviour out of its call window.
const NAMESPACE = 'rocketchat:videoconf';

function fireParentMessage(action: string, data?: Record<string, unknown>): void {
  action = `${NAMESPACE}/${action}`;

  console.log(`plugin: external-chat sending message to parent: ${action}`, data);
  window.top?.postMessage({ action, ...data }, '*');
}

console.log(`plugin: external-chat loaded v${version}`);

let isChatAtive = false;
let isBadgeVisible = false;

const plugin = await registerPlugin({
  id: 'external-chat',
  version: 0,
});

const buttonConfig: ButtonRPCPayload['toolbar']['add'] = {
  position: 'toolbar',
  icon: 'IconChat',
  tooltip: 'Chat',
};

const button = await plugin.ui.addButton(buttonConfig);

function renderButton(): void {
  void button.update({
    ...buttonConfig,
    isActive: isChatAtive,
    tooltip: isChatAtive ? 'Close Chat' : 'Open Chat',
    badge: {
      isVisible: isBadgeVisible,
    },
  });
}

function setChatActive(isActive: boolean): void {
  isChatAtive = isActive;
  renderButton();
}

function setBadgeVisible(isVisible: boolean): void {
  isBadgeVisible = isVisible;
  renderButton();
}

// All parameters accepted by conference.dialOut (the Infinity `dial` body).
type DialOutParams = Parameters<typeof plugin.conference.dialOut>[0];

// Dial out to a destination on behalf of the top window and report the outcome back.
async function dialOut(params: DialOutParams): Promise<void> {
  try {
    const participant = await plugin.conference.dialOut(params);
    fireParentMessage('dial-out-success', {
      uuid: participant.uuid,
      displayName: participant.displayName,
    });
  } catch (error) {
    console.error('plugin: external-chat dial-out failed', error);
    fireParentMessage('dial-out-error', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

button.onClick.add(() => {
  fireParentMessage('toggle-chat', { active: !isChatAtive });
})

// Fired once the user has joined the call (passed preflight) and the in-meeting
// toolbar — including the Chat button — is visible and accessible.
plugin.events.connected.add(() => {
  fireParentMessage('connected');
});

// Fired when the call drops involuntarily (error / server-side disconnect).
plugin.events.disconnected.add((payload) => {
  fireParentMessage('disconnected', { userInitiated: false, ...payload });
});

// Fired when the user explicitly clicks "Leave". Web App 3 emits this instead of
// `disconnected` for user-initiated leaves, so we forward both as `disconnected`.
plugin.events.userInitiatedDisconnect.add(() => {
  fireParentMessage('disconnected', { userInitiated: true });
});

// Listen for the parent window telling us when to show/hide the unread badge.
window.addEventListener('message', (event: MessageEvent) => {
  // Only react to messages from the top window (the page embedding Web App 3),
  // not from this iframe itself or sibling frames.
  if (event.source !== window.top) {
    return;
  }

  if (event.data === null || typeof event.data !== 'object') {
    return;
  }

  const {action, ...data} = event.data as ({ action: string; } & Record<string, any>);

  if (!action?.startsWith(`${NAMESPACE}/`)) {
    console.warn('plugin: external-chat received unknown message from parent:', data);
    return;
  }
  
  console.log(`plugin: external-chat receiving message from parent: ${action}`, data);

  switch (action.split('/').slice(-1)[0]) {
    // The state of the host's chat panel, which is the source of truth for this button: clicking it only asks.
    case 'chat-state':
      setChatActive(data.active === true);
      break;
    // Whether that panel has anything unread. What it looks like here is this plugin's business — a badge.
    case 'chat-unread':
      setBadgeVisible(data.unread === true);
      break;
    case 'dial-out':
      void dialOut({
        // Required parameters.
        role: data.role,
        destination: data.destination,
        protocol: data.protocol,
        // Optional parameters.
        call_type: data.call_type,
        presentation_url: data.presentation_url,
        streaming: data.streaming,
        dtmf_sequence: data.dtmf_sequence,
        source: data.source,
        source_display_name: data.source_display_name,
        remote_display_name: data.remote_display_name,
        text: data.text,
        keep_conference_alive: data.keep_conference_alive,
      });
      break;
  }
});

fireParentMessage('ready');
