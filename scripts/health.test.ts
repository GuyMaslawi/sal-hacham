import { describe, expect, it } from 'vitest';
import { assess, FROM_ISRAEL, report } from './health';

const chains = [
  { id: 'shufersal', name: 'שופרסל' },
  ...FROM_ISRAEL.map((id) => ({ id, name: id })),
];
// 2026-11-25 14:00 in Israel is 12:00 UTC.
const NOW = new Date('2026-11-25T12:00:00Z');
const index = (u: Record<string, string>, generatedAt = '2026-11-25T11:00:00Z') => ({
  generatedAt,
  chains,
  stores: Object.entries(u).map(([c, when]) => ({ c, u: when })),
});
const fresh = Object.fromEntries([['shufersal', '2026-11-25T05:00'], ...FROM_ISRAEL.map((id) => [id, '2026-11-25T05:00'])]);

describe('health check', () => {
  it('is quiet when everything is from today and the site is fresh', () => {
    expect(assess(index(fresh), NOW).problems).toEqual([]);
  });

  it('tolerates a weekend without new files (Friday morning to Sunday morning)', () => {
    const sunday = new Date('2026-11-29T05:00:00Z'); // 07:00 in Israel
    const friday = Object.fromEntries(Object.keys(fresh).map((k) => [k, '2026-11-27T06:00']));
    expect(assess(index(friday, '2026-11-29T04:30:00Z'), sunday).problems).toEqual([]);
  });

  it('names a chain that stopped publishing', () => {
    const h = assess(index({ ...fresh, shufersal: '2026-11-22T05:00' }), NOW);
    expect(h.problems).toHaveLength(1);
    expect(h.problems[0]).toContain('שופרסל');
  });

  it('points at the Mac when every chain it fetches is stale', () => {
    const old = Object.fromEntries(FROM_ISRAEL.map((id) => [id, '2026-11-22T05:00']));
    const h = assess(index({ ...fresh, ...old }), NOW);
    expect(h.problems).toHaveLength(1);
    expect(h.problems[0]).toContain('המק');
  });

  it('notices a site that has not been rebuilt', () => {
    const h = assess(index(fresh, '2026-11-24T20:00:00Z'), NOW);
    expect(h.problems[0]).toContain('האתר לא נבנה');
  });

  it('notices a chain missing from the site', () => {
    const { carrefour: _, ...rest } = fresh;
    expect(assess(index(rest), NOW).problems).toEqual(['carrefour: הרשת חסרה לגמרי באתר.']);
  });

  it('writes a report with the state of every chain', () => {
    const text = report(assess(index(fresh), NOW));
    expect(text).toContain('הכל תקין');
    expect(text).toContain('| שופרסל | 1 |');
  });
});
