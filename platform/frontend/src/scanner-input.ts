// Keyboard-wedge scanners emit a fast burst. Slow typing never submits a scan.
export class ScannerBurst {
  private value = "";
  private firstAt = 0;
  private lastAt = 0;
  private overflow = false;
  reset() { this.value = ""; this.firstAt = 0; this.lastAt = 0; this.overflow = false; }
  private finish(minLength: number) {
    const value = this.value;
    const fast = !this.overflow && value.length >= minLength && (this.lastAt - this.firstAt) / Math.max(1, value.length - 1) <= 80;
    this.reset();
    return fast ? value : null;
  }
  push(key: string, at: number) {
    if (key === "Enter" || key === "Tab") return this.finish(4);
    if (this.overflow) return null;
    if (key.length !== 1) { this.reset(); return null; }
    if (this.value && at - this.lastAt > 120) this.reset();
    if (!this.value) this.firstAt = at;
    this.lastAt = at;
    this.value += key;
    if (this.value.length > 2048) this.overflow = true;
    return null;
  }
  flush(at: number) {
    if (!this.value || at - this.lastAt < 300) return null;
    return this.finish(6);
  }
}
