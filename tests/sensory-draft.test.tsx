import { expect, it } from 'vitest';
import { initializeDraft, parseDraft } from '../apps/web/src/components/brew-draft';
const id = '00000000-0000-4000-8000-000000000001';
const qualities = [
  'fragranceAroma',
  'flavor',
  'aftertaste',
  'acidity',
  'body',
  'balance',
  'sweetness',
  'overallImpression',
] as const;
it('initializes quick with all eight explicitly absent qualities and no seeded overall', () => {
  const a = initializeDraft().assessment;
  expect(a).toMatchObject({ tastingMode: 'quick', overallScore: '', tastingTags: [], notes: '' });
  for (const key of qualities) expect(a[key as keyof typeof a]).toBeNull();
});
it('posts the same independent expanded values even after collapsing quick', () => {
  const draft = initializeDraft();
  Object.assign(draft.assessment, {
    overallScore: '0',
    tastingMode: 'sensory',
    fragranceAroma: '8.25',
    overallImpression: '7.75',
    acidity: '0',
  });
  const result = parseDraft(id, draft);
  expect(result.success).toBe(true);
  if (result.success)
    expect(result.data).toMatchObject({
      overallScore: 0,
      tastingMode: 'sensory',
      fragranceAroma: 8.25,
      overallImpression: 7.75,
      acidity: 0,
    });
  Object.assign(draft.assessment, { tastingMode: 'quick' });
  const collapsed = parseDraft(id, draft);
  if (collapsed.success)
    expect(collapsed.data).toMatchObject({
      tastingMode: 'quick',
      fragranceAroma: 8.25,
      overallImpression: 7.75,
    });
  else expect(collapsed.success).toBe(true);
});
it.each(qualities)(
  'validates hidden %s without clearing invalid text or confusing null and zero',
  (key) => {
    for (const value of ['', '-0.25', '10.25', '8.1', 'Infinity', 'NaN']) {
      const draft = initializeDraft();
      Object.assign(draft.assessment, { overallScore: '87.25', [key]: value });
      expect(parseDraft(id, draft).success, `${key}=${value}`).toBe(false);
      expect(draft.assessment[key as keyof typeof draft.assessment]).toBe(value);
    }
    for (const value of [null, '0', '8.25', '10']) {
      const draft = initializeDraft();
      Object.assign(draft.assessment, { overallScore: '87.25', [key]: value });
      const result = parseDraft(id, draft);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data[key]).toBe(value === null ? null : Number(value));
    }
  },
);
