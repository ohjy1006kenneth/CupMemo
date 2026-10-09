import { expect, it } from 'vitest';
import {
  addPour,
  hundredths,
  initializeDraft,
  localToUTC,
  movePour,
  parseDraft,
  pourTotal,
} from '../apps/web/src/components/brew-draft';
const id = '00000000-0000-4000-8000-000000000001';
it('initializes an explicit prototype recipe with a once-captured local time and blank independent assessment', () => {
  const draft = initializeDraft(undefined, new Date('2026-10-08T12:34:56Z'))!;
  expect(draft).not.toBeNull();
  expect(draft.recipe).toMatchObject({
    brewer: 'V60',
    grinder: 'K-Ultra',
    grindSetting: '6.2',
    doseGrams: '15',
    waterGrams: '250',
    totalBrewTimeSeconds: '168',
  });
  expect(draft.assessment).toEqual({
    overallScore: '',
    acidity: null,
    body: null,
    aftertaste: null,
    tastingTags: [],
    notes: '',
  });
  expect(localToUTC(draft.localTime)).toBe('2026-10-08T12:34:56.000Z');
  expect(parseDraft(id, draft, true).success).toBe(true);
  expect(parseDraft(id, draft).success).toBe(false);
  draft.assessment.overallScore = '0';
  expect(parseDraft(id, draft).success).toBe(true);
});
it.each(['', ' ', 'NaN', 'Infinity', '-1', '1e2', '0.001', '9999999999'])(
  'rejects invalid decimal spelling %s before hundredths arithmetic',
  (value) => {
    expect(hundredths(value)).toBeNull();
  },
);
it('uses exact integer hundredths for ordinary decimals without masking excess precision', () => {
  expect(hundredths('0.29')).toBe(29);
  expect(hundredths('0.1')).toBe(10);
  const draft = initializeDraft()!;
  draft.recipe.waterGrams = '0.39';
  draft.recipe.pours = [
    { waterGrams: '0.1', startTimeSeconds: '0' },
    { waterGrams: '0.29', startTimeSeconds: '0' },
  ];
  expect(pourTotal(draft.recipe)).toBe(39);
  expect(parseDraft(id, draft, true).success).toBe(true);
  draft.recipe.waterGrams = '0.3901';
  expect(parseDraft(id, draft, true).success).toBe(false);
});
it.each([
  '2027-02-29T10:00:00',
  '2026-04-31T10:00:00',
  '0000-01-01T00:00:00',
  '2026-01-01T24:00:00',
  '',
])('rejects impossible local calendar %s', (value) => {
  expect(localToUTC(value)).toBeNull();
});
it('reorders incremental amounts while preserving chronological start slots and source immutability', () => {
  const recipe = initializeDraft()!.recipe;
  const moved = movePour(recipe, 0, 1);
  expect(moved.pours).toEqual([
    { waterGrams: '100', startTimeSeconds: '0' },
    { waterGrams: '50', startTimeSeconds: '45' },
    { waterGrams: '100', startTimeSeconds: '90' },
  ]);
  expect(recipe.pours[0].waterGrams).toBe('50');
  expect(movePour(recipe, 0, -1)).toEqual(recipe);
});
it('adds remaining positive water or explicit 5g without changing total, bounded to duration and 32 pours', () => {
  const recipe = initializeDraft()!.recipe;
  recipe.waterGrams = '250.29';
  recipe.totalBrewTimeSeconds = '100';
  const next = addPour(recipe);
  expect(next.pours.at(-1)).toEqual({ waterGrams: '0.29', startTimeSeconds: '100' });
  expect(next.waterGrams).toBe('250.29');
  expect(addPour(next).pours.at(-1)?.waterGrams).toBe('5');
  next.pours = Array.from({ length: 32 }, () => ({ waterGrams: '1', startTimeSeconds: '0' }));
  expect(addPour(next).pours).toHaveLength(32);
});
it('rejects invalid schedule, required text, blank numeric values, and nonquarter scores without repair', () => {
  const draft = initializeDraft()!;
  draft.assessment.overallScore = '87.1';
  expect(parseDraft(id, draft).success).toBe(false);
  draft.assessment.overallScore = '87.25';
  draft.assessment.acidity = '0';
  const valid = parseDraft(id, draft);
  expect(valid.success).toBe(true);
  if (valid.success)
    expect(valid.data).toMatchObject({
      overallScore: 87.25,
      acidity: 0,
      body: null,
      tastingMode: 'quick',
    });
  draft.recipe.pours[1].startTimeSeconds = '169';
  expect(parseDraft(id, draft, true).success).toBe(false);
  draft.recipe.pours[1].startTimeSeconds = '45';
  draft.recipe.grinder = '   ';
  expect(parseDraft(id, draft, true).success).toBe(false);
  draft.recipe.grinder = 'Custom';
  draft.recipe.waterTemperatureC = '';
  expect(parseDraft(id, draft, true).success).toBe(false);
});
