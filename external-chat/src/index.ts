import { ButtonRPCPayload, registerPlugin } from '@pexip/plugin-api'
import { version } from '../package.json'

function fireParentMessage(action: string, data?: Record<string, unknown>) {
  action = `pexip:plugin:external-chat/${action}`;

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

function renderButton() {
  button.update({
    ...buttonConfig,
    isActive: isChatAtive,
    tooltip: isChatAtive ? 'Close Chat' : 'Open Chat',
    badge: {
      isVisible: isBadgeVisible,
    },
  });
}

function setChatActive(isActive: boolean) {
  isChatAtive = isActive;
  renderButton();
}

function setBadgeVisible(isVisible: boolean) {
  isBadgeVisible = isVisible;
  renderButton();
}

// All parameters accepted by conference.dialOut (the Infinity `dial` body).
type DialOutParams = Parameters<typeof plugin.conference.dialOut>[0];

// Dial out to a destination on behalf of the top window and report the outcome back.
async function dialOut(params: DialOutParams) {
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

  if (!action?.startsWith('pexip:plugin:external-chat/')) {
    console.warn('plugin: external-chat received unknown message from parent:', data);
    return;
  }
  
  console.log(`plugin: external-chat receiving message from parent: ${action}`, data);

  switch (action.split('/').slice(-1)[0]) {
    case 'toggle-chat-button-state':
      setChatActive(data.active === true);
      break;
    case 'toggle-chat-badge':
      setBadgeVisible(data.visible === true);
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
