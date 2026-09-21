/**
 * Centralized test selectors for e2e tests.
 *
 * All data-testid attributes are defined here, so UI refactors only need to
 * update one file, not every test.
 */

export const selectors = {
  // SessionControls main container
  sessionControls: '[data-testid="session-controls"]',

  // Turn countdown timer
  turnCountdown: '[data-testid="turn-countdown"]',

  // Current driver display
  currentDriver: '[data-testid="current-driver"]',

  // "You are driving" indicator (only visible to the driver)
  youAreDriving: '[data-testid="you-are-driving"]',

  // Turn number display
  turnNumber: '[data-testid="turn-number"]',

  // Manual driver picker (host-only, manual mode)
  manualDriverPicker: '[data-testid="manual-driver-picker"]',

  // Rotation order list (round-robin mode)
  rotationOrderList: '[data-testid="rotation-order-list"]',

  // Current next-up entry in rotation order (highlighted)
  rotationNextUp: '[data-testid="rotation-next-up"]',

  // Grace period banner (all participants)
  gracePeriodBanner: '[data-testid="grace-period-banner"]',

  // Grace period modal (host-only actions: reassign, extend, skip)
  gracePeriodModal: '[data-testid="grace-period-modal"]',

  // Host-disconnect indicator (visible without opening roster)
  hostDisconnectIndicator: '[data-testid="host-disconnect-indicator"]',

  // Control rejection/error banner (appears when action is rejected)
  controlRejectionBanner: '[data-testid="control-rejection-banner"]',

  // Session-ended screen (replaces editor when session ends)
  sessionEndedView: '[data-testid="session-ended-view"]',

  // Return to lobby button on session-ended screen
  returnToLobby: '[data-testid="return-to-lobby"]',

  // Early-end button (disabled when not allowed, enabled when allowed)
  earlyEndButton: '[data-testid="early-end-button"]',

  // Early-end disabled state explanation text
  earlyEndDisabledExplanation: '[data-testid="early-end-disabled-explanation"]',
} as const;
