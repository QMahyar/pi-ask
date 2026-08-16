// Session-scoped single-active interaction guard for ask_user.

export class ActiveQuestionnaireLock {
  private owner: string | undefined;

  acquire(owner: string): boolean {
    if (!owner || this.owner !== undefined) return false;
    this.owner = owner;
    return true;
  }

  release(owner: string): void {
    this.releaseIfOwner(owner);
  }

  releaseIfOwner(owner: string): boolean {
    if (this.owner !== owner) return false;
    this.owner = undefined;
    return true;
  }

  isLocked(): boolean {
    return this.owner !== undefined;
  }

  getOwner(): string | undefined {
    return this.owner;
  }
}
