import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { RETIRED_ROUTES } from './retired-routes';
import { canOpen, STAFF_ROLES } from './access';
import { ALL_PAGES } from './pages';

const APP = join(process.cwd(), 'app');
const pageAt = (path: string) => existsSync(join(APP, ...path.split('/').filter(Boolean), 'page.tsx'));
const sample = (path: string) => path.replace(/:[a-zA-Z]+/g, 'x').split('?')[0];

describe('retired routes', () => {
  it('have no page left at the old address', () => {
    for (const r of RETIRED_ROUTES) {
      if (r.source.includes(':')) continue;
      expect(pageAt(r.source), r.source).toBe(false);
    }
  });

  it('land where every role that could open the old page may open the new one', () => {
    for (const r of RETIRED_ROUTES) {
      for (const role of STAFF_ROLES) {
        if (canOpen(role, sample(r.source))) expect(canOpen(role, sample(r.destination)), `${role} ${r.source}`).toBe(true);
      }
    }
  });

  it('are listed once each', () => {
    const sources = RETIRED_ROUTES.map((r) => r.source);
    expect(new Set(sources).size).toBe(sources.length);
  });

  it('are not linked from the nav', () => {
    const sources = new Set(RETIRED_ROUTES.map((r) => r.source));
    for (const p of ALL_PAGES) expect(sources.has(p.href.split('?')[0]), p.href).toBe(false);
  });
});
