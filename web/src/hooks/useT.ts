import { useCallback } from 'react';
import { useAppState } from '../context/AppStore';
import { translate, type TKey } from '../services/i18n';

export function useT() {
  const lang = useAppState().settings.uiLanguage;
  return useCallback((key: TKey) => translate(lang, key), [lang]);
}
