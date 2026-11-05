import { useEffect } from "react";
import { ScannerBurst } from "./scanner-input";
export function useScannerInput(onScan: (raw: string) => void) {
  useEffect(() => {
    const burst = new ScannerBurst();
    let timer: number | undefined;
    let previousTarget: EventTarget | null = null;
    const reset = () => { window.clearTimeout(timer); burst.reset(); previousTarget = null; };
    const listener = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const scanField = Boolean(target?.closest('[data-goods-in-scan="true"]'));
      const editing = Boolean(target?.closest('input, textarea, select, [contenteditable="true"], [role="combobox"]'));
      const modalOpen = [...document.querySelectorAll<HTMLElement>('.ant-modal-wrap')].some(element => element.getClientRects().length > 0);
      if (event.isComposing || event.repeat || event.ctrlKey || event.metaKey || event.altKey || (editing && !scanField) || modalOpen) {
        reset(); return;
      }
      // Shift is part of scanner input for uppercase letters and QR punctuation.
      if (event.key === "Shift") return;
      if (previousTarget !== event.target) { reset(); previousTarget = event.target; }
      window.clearTimeout(timer);
      const raw = burst.push(event.key, performance.now());
      if (raw) { event.preventDefault(); event.stopPropagation(); onScan(raw); return; }
      if (event.key.length === 1) timer = window.setTimeout(() => {
        const pending = burst.flush(performance.now());
        if (pending) onScan(pending);
      }, 320);
    };
    window.addEventListener("keydown", listener, true);
    window.addEventListener("blur", reset);
    return () => { reset(); window.removeEventListener("keydown", listener, true); window.removeEventListener("blur", reset); };
  }, [onScan]);
}
