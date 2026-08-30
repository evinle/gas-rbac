// Type-only regression guard for the NoInfer fix in authorization.ts.
// `tsc --noEmit` fails this file if either line's error goes away --
// `@ts-expect-error` itself errors when the expected error doesn't happen.
// Not run by vitest; covered by `npm run typecheck`.
import { can, require } from '../../core/authorization.js';

const perms = new Set(['invoice:read', 'invoice:submit'] as const);

// @ts-expect-error -- 'invoice:aprove' is not in the set's literal type
can(perms, 'invoice:aprove');

// @ts-expect-error -- same check, for require
require(perms, 'invoice:aprove');

// Valid calls must still type-check with no error.
can(perms, 'invoice:read');
require(perms, 'invoice:submit');
