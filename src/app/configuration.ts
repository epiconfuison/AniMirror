/** Serialize multi-store actions and invalidate work still waiting for file reads or an older action. */
export class ConfigurationQueue {
  private revision = 0;
  private tail: Promise<unknown> = Promise.resolve();
  get token(): number { return this.revision; }
  begin(): number { return ++this.revision; }
  isCurrent(token: number): boolean { return token === this.revision; }
  run(token: number, action: () => Promise<void>): Promise<boolean> {
    const result = this.tail.then(async () => {
      if (!this.isCurrent(token)) return false;
      await action();
      return this.isCurrent(token);
    });
    this.tail = result.catch(() => undefined);
    return result;
  }
}
