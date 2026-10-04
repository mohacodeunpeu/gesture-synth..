import { en, type Dict, type DictKey } from './en';
import { fr } from './fr';

export type Lang = 'fr' | 'en';
export type { DictKey };

const DICTS: Record<Lang, Dict> = { fr, en };

export function detectLang(): Lang {
  const langs = typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : [];
  return langs.some((l) => l?.toLowerCase().startsWith('fr')) ? 'fr' : 'en';
}

export function translate(lang: Lang, key: DictKey, vars?: Record<string, string | number>): string {
  let s: string = DICTS[lang][key] ?? DICTS.en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

export type TFn = (key: DictKey, vars?: Record<string, string | number>) => string;
