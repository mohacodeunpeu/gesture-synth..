import { describe, expect, it } from 'vitest';
import { en } from './en';
import { fr } from './fr';
import { translate } from './index';

describe('i18n', () => {
  it('French has every English key and no empty strings', () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(fr[key], key).toBeTruthy();
    }
  });

  it('keeps the same placeholders in both languages', () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
    for (const key of Object.keys(en) as (keyof typeof en)[]) expect(ph(fr[key]), key).toBe(ph(en[key]));
  });

  it('interpolates variables', () => {
    expect(translate('fr', 'imported', { name: 'WOW', pad: 3 })).toBe('« WOW » est sur le pad 3 ✅');
    expect(translate('en', 'modelLoading', { pct: 42 })).toBe('Loading hand tracking… 42%');
  });
});
