import type { PolicySpec } from '../core/policy.js';
import type { RoleStore } from '../core/store.js';

export interface LogEvent {
  route: string;
  principal: string | null;
  allowed: boolean;
  durationMs: number;
}

export interface Config {
  policy: PolicySpec<any, any>;
  store: RoleStore;
  // Returns the active user's email, or null if it can't be resolved --
  // e.g. Session.getActiveUser().getEmail() in the real Apps Script adapter
  // (Phase 3). Injected so Phase 2's shipped middleware stays platform-agnostic
  // and testable with a fake.
  resolver: () => string | null;
  logger?: (event: LogEvent) => void;
  environment?: 'development' | 'production';
}

// Read at dispatch time, not composition time, same as the middleware chain
// itself -- so calling init() again (e.g. in a test between cases) takes
// effect on the next dispatch, not just the next module evaluation.
let config: Config | null = null;

export function init(c: Config): void {
  config = c;
}

export function getConfig(): Config {
  if (!config) {
    throw new Error('rbac.init() must be called before any route dispatches');
  }
  return config;
}

// Test-only escape hatch -- there is no other way to unset module state
// between test cases without it.
export function __resetConfigForTests(): void {
  config = null;
}
