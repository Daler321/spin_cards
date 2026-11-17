import type { AdminRole } from '@spincards/shared';

export type Section =
  | 'dashboard'
  | 'configs'
  | 'users'
  | 'broadcasts'
  | 'pool'
  | 'payments'
  | 'flags'
  | 'audit'
  | 'seasons'
  | 'settings'
  | 'admins'
  | 'texts';

/** Sections per role (the server enforces the same rules; owner sees everything). */
export const SECTIONS: { id: Section; roles: AdminRole[] }[] = [
  { id: 'dashboard', roles: ['analyst'] },
  { id: 'configs', roles: ['analyst'] },
  { id: 'users', roles: ['support'] },
  { id: 'broadcasts', roles: ['support'] },
  { id: 'pool', roles: ['support', 'analyst'] },
  { id: 'payments', roles: ['support'] },
  { id: 'flags', roles: ['analyst'] },
  { id: 'audit', roles: [] },
  { id: 'seasons', roles: ['support', 'analyst'] },
  { id: 'settings', roles: [] },
  { id: 'admins', roles: [] },
  { id: 'texts', roles: [] },
];

export function allowed(role: AdminRole, section: Section): boolean {
  return (
    role === 'owner' || (SECTIONS.find((s) => s.id === section)?.roles.includes(role) ?? false)
  );
}
