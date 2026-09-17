import { registerPlugin, ParticipantActivities } from '@pexip/plugin-api'
import type { ButtonRPCPayload, InfinityParticipant, ParticipantID } from '@pexip/plugin-api'
import { version } from '../package.json'

// The protocol belongs to the page that hosts the chat, not to Pexip, so the namespace is Rocket.Chat's: any
// provider plugin sending these actions gets the same behaviour out of its call window.
const NAMESPACE = 'rocketchat:videoconf';

// Announced in `ready`. The host renders a control only for a feature named here, so every name on this list is a
// promise that the matching handler below exists and does what the protocol says it does.
const FEATURES = [
  'chat',
  'participants',
  'roster',
  'self',
  'mute',
  'mute-video',
  'admit',
  'disconnect',
  'spotlight',
  'raise-hand',
  'set-role',
  'transfer',
  'dtmf',
  'mute-all-guests',
];

function fireParentMessage(action: string, data?: Record<string, unknown>): void {
  action = `${NAMESPACE}/${action}`;

  console.log(`plugin: external-chat sending message to parent: ${action}`, data);
  window.top?.postMessage({ action, ...data }, '*');
}

console.log(`plugin: external-chat loaded v${version}`);

let isChatAtive = false;
let isBadgeVisible = false;
let areParticipantsActive = false;

const plugin = await registerPlugin({
  id: 'external-chat',
  version: 0,
});

const chatButtonConfig: ButtonRPCPayload['toolbar']['add'] = {
  position: 'toolbar',
  icon: 'IconChat',
  tooltip: 'Chat',
};

const chatButton = await plugin.ui.addButton(chatButtonConfig);

function renderChatButton(): void {
  void chatButton.update({
    ...chatButtonConfig,
    isActive: isChatAtive,
    tooltip: isChatAtive ? 'Close Chat' : 'Open Chat',
    badge: {
      isVisible: isBadgeVisible,
    },
  });
}

function setChatActive(isActive: boolean): void {
  isChatAtive = isActive;
  renderChatButton();
}

function setBadgeVisible(isVisible: boolean): void {
  isBadgeVisible = isVisible;
  renderChatButton();
}

/**
 * The people in the call are listed by the host too, for the same reason the chat is: the host knows who these
 * participants are as Rocket.Chat users, while this page knows them only as names on a roster. So the meeting's
 * own participant panel is hidden in the branding manifest and this button stands in its place.
 */
const participantsButtonConfig: ButtonRPCPayload['toolbar']['add'] = {
  position: 'toolbar',
  icon: 'IconGroup',
  tooltip: 'Participants',
};

const participantsButton = await plugin.ui.addButton(participantsButtonConfig);

function renderParticipantsButton(): void {
  void participantsButton.update({
    ...participantsButtonConfig,
    isActive: areParticipantsActive,
    tooltip: areParticipantsActive ? 'Close Participants' : 'Open Participants',
  });
}

function setParticipantsActive(isActive: boolean): void {
  areParticipantsActive = isActive;
  renderParticipantsButton();
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

// Everyone the conference has told us about, by uuid. Activities report only what changed, so the roster the host
// sees is those changes added up.
const roster = new Map<ParticipantID, InfinityParticipant>();

// A participant as the protocol describes one: what the host draws, plus the flags it has to gate its controls on.
function toRosterEntry(participant: InfinityParticipant): Record<string, unknown> {
  return {
    uuid: participant.uuid,
    displayName: participant.displayName ?? '',
    isWaiting: participant.isWaiting,
    isHost: participant.isHost,
    isMuted: participant.isMuted,
    isClientMuted: participant.isClientMuted,
    isCameraMuted: participant.isCameraMuted,
    isPresenting: participant.isPresenting,
    isSpotlight: participant.isSpotlight,
    raisedHand: participant.raisedHand,
    can: {
      control: participant.canControl,
      mute: participant.canMute,
      disconnect: participant.canDisconnect,
      transfer: participant.canTransfer,
      spotlight: participant.canSpotlight,
      fecc: participant.canFecc,
      raiseHand: participant.canRaiseHand,
      changeLayout: participant.canChangeLayout,
    },
  };
}

function publishRoster(): void {
  fireParentMessage('roster', { participants: [...roster.values()].map(toRosterEntry) });
}

// Ask the conference for something on the top window's behalf. The protocol answers none of these directly: the
// conference replies by changing, and the change comes back as a roster update. A rejection is a request the
// participant's own flags never allowed in the first place.
/**
 * Who a request is about, as Infinity wants it said: absent when it is about us.
 *
 * Only the three calls that accept an absent participant may be given this — the rest require one, and would be
 * asking about the conference rather than about anybody if it went missing.
 */
function subject(participantUuid: unknown): { participantUuid?: ParticipantID } {
  return participantUuid === selfUuid ? {} : { participantUuid: participantUuid as ParticipantID };
}

function request(name: string, call: Promise<unknown>): void {
  void call.catch((error: unknown) => {
    console.error(`plugin: external-chat ${name} failed`, error);
  });
}

chatButton.onClick.add(() => {
  fireParentMessage('toggle-chat', { active: !isChatAtive });
})

participantsButton.onClick.add(() => {
  fireParentMessage('toggle-participants', { active: !areParticipantsActive });
})

// Fired once the user has joined the call (passed preflight) and the in-meeting
// toolbar — including the Chat button — is visible and accessible.
plugin.events.connected.add(() => {
  fireParentMessage('connected');
  // Ask outright rather than trust that we were listening for the arrival of everyone already in the room.
  request('roster request', plugin.conference.requestParticipants({}));
});

// Fired when the call drops involuntarily (error / server-side disconnect).
plugin.events.disconnected.add((payload) => {
  roster.clear();
  fireParentMessage('disconnected', { userInitiated: false, ...payload });
});

// Fired when the user explicitly clicks "Leave". Web App 3 emits this instead of
// `disconnected` for user-initiated leaves, so we forward both as `disconnected`.
plugin.events.userInitiatedDisconnect.add(() => {
  roster.clear();
  fireParentMessage('disconnected', { userInitiated: true });
});

/**
 * This plugin's own participant, as Infinity numbers it.
 *
 * `mute`, `muteVideo` and `raiseHand` take the participant as optional where every other call requires it, and
 * leaving it out is how the client is told to fill in whoever is asking. The REST endpoints underneath all
 * require a participant either way, so this is a convenience rather than a different request — none of these is
 * a control over your own devices, and there is no call here that is. Muting yourself this way is the
 * conference being told to stop carrying you, not your microphone or camera being switched off.
 */
let selfUuid: ParticipantID | undefined;

// The local user's own state. The host needs it to know which of its controls are the user's own and which are
// exercised over somebody else.
plugin.events.me.add(({ participant }) => {
  selfUuid = participant.uuid;

  fireParentMessage('self', {
    participantUuid: participant.uuid,
    micMuted: participant.isMuted,
    camMuted: participant.isCameraMuted,
    clientMuted: participant.isClientMuted,
    isHost: participant.isHost,
    canControl: participant.canControl,
  });
});

// Somebody joined, left, or changed. The whole roster goes out each time: working out what actually changed is the
// host's business, and it is the half that kept the previous list.
plugin.events.participantsActivities.add((activities) => {
  for (const { activity } of activities) {
    if (activity.type === ParticipantActivities.Leave) {
      roster.delete(activity.participant.uuid);
    } else {
      roster.set(activity.participant.uuid, activity.participant);
    }
  }

  publishRoster();
});

// Listen for the parent window telling us about its chat panel, and asking for the controls we announced.
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
    // The same for the host's people panel, and for the same reason: the button reflects, it does not decide.
    case 'participants-state':
      setParticipantsActive(data.active === true);
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
    // The rest are host controls, each forwarded straight to Infinity under whatever Infinity calls the same
    // thing. Which of them a given participant accepts is what that participant's `can` flags in the roster say,
    // and Infinity is what enforces it — nothing is decided here.
    case 'mute':
      request(action, plugin.conference.mute({
        ...subject(data.participantUuid),
        mute: data.muted === true,
      }));
      break;
    case 'mute-video':
      request(action, plugin.conference.muteVideo({
        ...subject(data.participantUuid),
        muteVideo: data.muted === true,
      }));
      break;
    case 'admit':
      request(action, plugin.conference.admit({
        participantUuid: data.participantUuid,
      }));
      break;
    case 'disconnect':
      request(action, plugin.conference.disconnect({
        participantUuid: data.participantUuid,
      }));
      break;
    case 'spotlight':
      request(action, plugin.conference.spotlight({
        participantUuid: data.participantUuid,
        enable: data.active === true,
      }));
      break;
    case 'raise-hand':
      request(action, plugin.conference.raiseHand({
        ...subject(data.participantUuid),
        raise: data.raised === true,
      }));
      break;
    case 'set-role':
      request(action, plugin.conference.setRole({
        participantUuid: data.participantUuid,
        // A host is what the protocol calls it; a chair is what this endpoint calls it.
        role: data.role === 'host' ? 'chair' : 'guest',
      }));
      break;
    // Sends the participant off to another conference entirely. Guest unless asked otherwise, so that a transfer
    // can never quietly promote anybody, and an empty pin for a target that does not ask for one.
    case 'transfer':
      request(action, plugin.conference.transfer({
        participantUuid: data.participantUuid,
        destination: data.alias,
        role: data.role === 'host' ? 'host' : 'guest',
        pin: data.pin ?? '',
      }));
      break;
    case 'dtmf':
      request(action, plugin.conference.sendDTMF({
        participantUuid: data.participantUuid,
        digits: data.digits,
      }));
      break;
    case 'mute-all-guests':
      request(action, plugin.conference.muteAllGuests({
        mute: data.muted === true,
      }));
      break;
  }
});

fireParentMessage('ready', { features: FEATURES });
