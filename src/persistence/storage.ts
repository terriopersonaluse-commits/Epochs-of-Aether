// Browser storage for save slots. Every call tolerates storage being unavailable.
const PREFIX = 'eoa.save.';
export const SLOTS = ['auto', '1', '2', '3'] as const;
export type Slot = (typeof SLOTS)[number];

export function storageAvailable(): boolean {
  try {
    const k = '__eoa_probe__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

export function writeSlot(slot: Slot, text: string): boolean {
  try {
    localStorage.setItem(PREFIX + slot, text);
    return true;
  } catch {
    return false;
  }
}

export function readSlot(slot: Slot): string | null {
  try {
    return localStorage.getItem(PREFIX + slot);
  } catch {
    return null;
  }
}

export function clearSlot(slot: Slot): void {
  try {
    localStorage.removeItem(PREFIX + slot);
  } catch {
    /* storage unavailable */
  }
}
