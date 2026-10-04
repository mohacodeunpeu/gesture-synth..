import { useCallback } from 'react';
import { translate, type DictKey, type TFn } from '../i18n';
import { useSettings } from '../store/settingsStore';

export function useT(): TFn {
  const lang = useSettings((s) => s.lang);
  return useCallback((key: DictKey, vars?: Record<string, string | number>) => translate(lang, key, vars), [lang]);
}
