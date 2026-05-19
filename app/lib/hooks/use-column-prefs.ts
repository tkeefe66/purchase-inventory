'use client';
import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_PREFS, loadColumnPrefs, saveColumnPrefs, type ColumnPrefs } from '../columns.js';

export interface UseColumnPrefs {
  prefs: ColumnPrefs;
  setPrefs: (next: ColumnPrefs) => void;
  reset: () => void;
}

export function useColumnPrefs(): UseColumnPrefs {
  // Server-side render uses defaults; the client hydrates from localStorage.
  const [prefs, setPrefsState] = useState<ColumnPrefs>(DEFAULT_PREFS);

  useEffect(() => {
    setPrefsState(loadColumnPrefs());
  }, []);

  const setPrefs = useCallback((next: ColumnPrefs) => {
    setPrefsState(next);
    saveColumnPrefs(next);
  }, []);

  const reset = useCallback(() => {
    setPrefsState(DEFAULT_PREFS);
    saveColumnPrefs(DEFAULT_PREFS);
  }, []);

  return { prefs, setPrefs, reset };
}
