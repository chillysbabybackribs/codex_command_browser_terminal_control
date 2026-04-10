export const WINDOW_ROLES = ['command', 'browser', 'terminal'] as const;
export type WindowRole = typeof WINDOW_ROLES[number];
