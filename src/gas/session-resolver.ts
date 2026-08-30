// Session.getEffectiveUser() returns the deployment owner for every visitor
// under execute-as-me -- see PRD.md "Identity comes from getActiveUser,
// never getEffectiveUser". getActiveUser() returns an empty string when the
// running user is outside the owner's domain or consent wasn't granted;
// that's the fail-closed signal, not an error to catch.
//
// `session` defaults to the real global but is a parameter so a test can
// pass a fake without stubbing `Session` itself -- see PRD.md Phase 3
// "testable without stubbing globals".
export function createSessionResolver(session: GoogleAppsScript.Base.Session = Session): () => string | null {
  return () => {
    const email = session.getActiveUser().getEmail();
    return email === '' ? null : email;
  };
}
