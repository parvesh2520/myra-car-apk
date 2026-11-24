import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react';
import type { AppState } from '../types';
import { createDefaultState } from '../data/defaults';
import { loadState, saveState } from '../services/storage';
import { createActions, type Actions, type Updater } from './actions';

interface StoreValue {
  state: AppState;
  actions: Actions;
}

const StoreContext = createContext<StoreValue | null>(null);

const reducer = (state: AppState, fn: Updater) => fn(state);

/**
 * Single source of truth for the infotainment system. Every page reads the same
 * climate, media, navigation and profile state, so a change made by voice, the
 * home cards or a full page is reflected everywhere at once.
 */
export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [state, update] = useReducer(reducer, undefined, () => loadState(createDefaultState()));
  const actions = useMemo(() => createActions(update), []);

  useEffect(() => {
    const id = window.setTimeout(() => saveState(state), 250);
    return () => window.clearTimeout(id);
  }, [state]);

  const value = useMemo(() => ({ state, actions }), [state, actions]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside <AppStoreProvider>');
  return ctx;
}

export const useAppState = () => useStore().state;
export const useActions = () => useStore().actions;
