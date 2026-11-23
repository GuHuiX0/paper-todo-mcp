import type { CreateTodoInput, TodoSource } from '../types.js';

/**
 * Placeholder interface for future external adapters (e.g., Microsoft Teams, Outlook).
 * Intentionally left unimplemented for now per project scope.
 */
export interface InboundAdapter {
  readonly id: TodoSource;
  readonly displayName: string;
  readonly enabled: boolean;
  pull?(): Promise<CreateTodoInput[]>;
}

export const adapters: InboundAdapter[] = [
  {
    id: 'teams',
    displayName: 'Microsoft Teams',
    enabled: false,
  },
  {
    id: 'outlook',
    displayName: 'Microsoft Outlook',
    enabled: false,
  },
];

export function listAdapters(): Array<{ id: TodoSource; displayName: string; enabled: boolean }> {
  return adapters.map(({ id, displayName, enabled }) => ({ id, displayName, enabled }));
}
