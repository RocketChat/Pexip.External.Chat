// Every string the plugin shows in the meeting UI. One language is baked into each build (`PLUGIN_LANG`, see
// vite.config.ts), so a customer gets their language without patching the bundle.
const en = {
  chatTooltip: 'Chat',
  openChat: 'Open Chat',
  closeChat: 'Close Chat',
  participantsTooltip: 'Participants',
  openParticipants: 'Open Participants',
  closeParticipants: 'Close Participants',
  screenShareNotAllowed: 'Screen sharing is not available to you in this meeting',
};

export type Translation = typeof en;

const de: Translation = {
  chatTooltip: 'Chat',
  openChat: 'Chat öffnen',
  closeChat: 'Chat schließen',
  participantsTooltip: 'Teilnehmer',
  openParticipants: 'Teilnehmerliste öffnen',
  closeParticipants: 'Teilnehmerliste schließen',
  screenShareNotAllowed: 'Die Bildschirmfreigabe ist in diesem Meeting für dich nicht verfügbar.',
};

export const translations: Record<string, Translation> = { en, de };
