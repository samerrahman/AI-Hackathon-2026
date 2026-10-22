/** Every new interaction owns a revision. Late work cannot commit to newer context. */
export class TurnGate {
  private revision = Date.now() * 1000;
  private controller?: AbortController;
  begin() { this.cancel(); this.controller = new AbortController(); return { revision: this.revision, signal: this.controller.signal }; }
  cancel() { this.revision += 1; this.controller?.abort(); }
  current(revision: number) { return revision === this.revision; }
}
