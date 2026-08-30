// Type-only regression guard for threading Perm through requires()/use() --
// see PRD.md/README "threading Perm through requires and middleware".
// `tsc --noEmit` fails this file if the expected error goes away.
// Not run by vitest; covered by `npm run typecheck`.
import { typedRbac_, type Rbac } from '../../runtime/rbac.js';

type Perm = 'invoice:read' | 'invoice:submit';

const rbac: Rbac<Perm> = typedRbac_<Perm>();

// @ts-expect-error -- 'invoice:raed' is not in Perm
rbac.requires('listInvoices', 'invoice:raed', () => []);

// Valid calls must still type-check with no error.
rbac.requires('listInvoices', 'invoice:read', () => []);
rbac.anyone('ping', () => 'pong');
