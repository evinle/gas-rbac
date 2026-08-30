export class AuthorizationError extends Error {
  constructor(public readonly perm: string) {
    super(`missing permission: ${perm}`);
    this.name = 'AuthorizationError';
  }
}
