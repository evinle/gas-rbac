// Role assignments live in an injected store, not the policy file -- see
// PRD.md "Role definitions in code, assignments in a store". Default
// implementation is Script Properties in the Apps Script adapter (Phase 3);
// this interface is what Phase 1 tests against a fake.
export interface RoleStore<RoleName extends string = string> {
  getRoles(email: string): readonly RoleName[];
}
