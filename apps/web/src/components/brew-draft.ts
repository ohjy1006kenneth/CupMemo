import { brewCreateSchema, brewPatchSchema, type Brew, type BrewPatch } from '@cupmemo/contracts';

export const qualities = [
  ['fragranceAroma', 'Fragrance/Aroma'],
  ['flavor', 'Flavor'],
  ['aftertaste', 'Aftertaste'],
  ['acidity', 'Acidity'],
  ['body', 'Body'],
  ['balance', 'Balance'],
  ['sweetness', 'Sweetness'],
  ['overallImpression', 'Overall Impression'],
] as const;

export type Recipe = {
  brewer: string;
  grinder: string;
  grindSetting: string;
  doseGrams: string;
  waterGrams: string;
  waterTemperatureC: string;
  totalBrewTimeSeconds: string;
  pours: { waterGrams: string; startTimeSeconds: string }[];
};
export type Assessment = {
  tastingMode: 'quick' | 'sensory';
  overallScore: string;
  acidity: string | null;
  body: string | null;
  aftertaste: string | null;
  fragranceAroma: string | null;
  flavor: string | null;
  balance: string | null;
  sweetness: string | null;
  overallImpression: string | null;
  tastingTags: string[];
  notes: string;
};
export type Draft = { recipe: Recipe; localTime: string; assessment: Assessment };
export function initializeDraft(latest?: Brew, now = new Date()): Draft {
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  const recipe: Recipe = latest
    ? {
        brewer: latest.brewer,
        grinder: latest.grinder,
        grindSetting: latest.grindSetting,
        doseGrams: String(latest.doseGrams),
        waterGrams: String(latest.waterGrams),
        waterTemperatureC: String(latest.waterTemperatureC),
        totalBrewTimeSeconds: String(latest.totalBrewTimeSeconds),
        pours: latest.pours.map((p) => ({
          waterGrams: String(p.waterGrams),
          startTimeSeconds: String(p.startTimeSeconds),
        })),
      }
    : {
        brewer: 'V60',
        grinder: 'K-Ultra',
        grindSetting: '6.2',
        doseGrams: '15',
        waterGrams: '250',
        waterTemperatureC: '93',
        totalBrewTimeSeconds: '168',
        pours: [
          { waterGrams: '50', startTimeSeconds: '0' },
          { waterGrams: '100', startTimeSeconds: '45' },
          { waterGrams: '100', startTimeSeconds: '90' },
        ],
      };
  return {
    recipe,
    localTime: `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
    assessment: {
      tastingMode: 'quick',
      overallScore: '',
      acidity: null,
      body: null,
      aftertaste: null,
      fragranceAroma: null,
      flavor: null,
      balance: null,
      sweetness: null,
      overallImpression: null,
      tastingTags: [],
      notes: '',
    },
  };
}
export function localToUTC(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map((v) => Number(v ?? 0));
  if (
    !year ||
    year > 9999 ||
    !month ||
    month > 12 ||
    !day ||
    day > 31 ||
    hour! > 23 ||
    minute! > 59 ||
    second! > 59
  )
    return null;
  // setFullYear preserves years 0001–0099; native Date chooses the earlier DST overlap.
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(hour!, minute!, second!, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute ||
    date.getSeconds() !== second ||
    date.getUTCFullYear() < 1 ||
    date.getUTCFullYear() > 9999
  )
    return null;
  return date.toISOString();
}
export function hundredths(value: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const scaled = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(scaled) && scaled <= 9999999 ? scaled : null;
}
export function pourTotal(recipe: Recipe): number | null {
  let total = 0;
  for (const pour of recipe.pours) {
    const value = hundredths(pour.waterGrams);
    if (value === null || value === 0) return null;
    total += value;
  }
  return total;
}
function numeric(value: string) {
  return /^\d+(?:\.\d{1,2})?$/.test(value) ? Number(value) : NaN;
}
function assessmentInput(a: Assessment) {
  return {
    overallScore: numeric(a.overallScore),
    tastingMode: a.tastingMode,
    ...Object.fromEntries(
      qualities.map(([key]) => [key, a[key] === null ? null : numeric(a[key])]),
    ),
    tastingTags: [...a.tastingTags],
    notes: a.notes,
  };
}
export function parseDraft(coffeeId: string, draft: Draft, recipeOnly = false) {
  const r = draft.recipe,
    a = draft.assessment;
  return brewCreateSchema.safeParse({
    coffeeId,
    brewer: r.brewer,
    grinder: r.grinder,
    grindSetting: r.grindSetting,
    doseGrams: numeric(r.doseGrams),
    waterGrams: numeric(r.waterGrams),
    waterTemperatureC: numeric(r.waterTemperatureC),
    totalBrewTimeSeconds: numeric(r.totalBrewTimeSeconds),
    brewedAt: localToUTC(draft.localTime) ?? '',
    pours: r.pours.map((p) => ({
      waterGrams: numeric(p.waterGrams),
      startTimeSeconds: numeric(p.startTimeSeconds),
    })),
    // Internal recipe validation only: this placeholder never enters draft or POST.
    ...assessmentInput(recipeOnly ? { ...initializeDraft().assessment, overallScore: '0' } : a),
  });
}
export function assessmentFromBrew(brew: Brew): Assessment {
  return {
    tastingMode: brew.tastingMode,
    overallScore: String(brew.overallScore),
    acidity: brew.acidity === null ? null : String(brew.acidity),
    body: brew.body === null ? null : String(brew.body),
    aftertaste: brew.aftertaste === null ? null : String(brew.aftertaste),
    fragranceAroma: brew.fragranceAroma === null ? null : String(brew.fragranceAroma),
    flavor: brew.flavor === null ? null : String(brew.flavor),
    balance: brew.balance === null ? null : String(brew.balance),
    sweetness: brew.sweetness === null ? null : String(brew.sweetness),
    overallImpression: brew.overallImpression === null ? null : String(brew.overallImpression),
    tastingTags: [...brew.tastingTags],
    notes: brew.notes ?? '',
  };
}
export function parseAssessmentPatch(original: Brew, assessment: Assessment) {
  const normalized = brewPatchSchema.safeParse(assessmentInput(assessment));
  if (!normalized.success) return normalized;
  const baseline = brewPatchSchema.parse(assessmentInput(assessmentFromBrew(original)));
  const changed = Object.fromEntries(
    Object.entries(normalized.data).filter(
      ([key, value]) => JSON.stringify(value) !== JSON.stringify(baseline[key as keyof BrewPatch]),
    ),
  );
  // The API refuses an empty PATCH. A normalized no-op never crosses that boundary.
  if (Object.keys(changed).length === 0) return { success: true as const, data: null };
  return brewPatchSchema.safeParse(changed);
}
export function movePour(recipe: Recipe, index: number, direction: -1 | 1): Recipe {
  const other = index + direction;
  if (other < 0 || other >= recipe.pours.length) return recipe;
  const pours = recipe.pours.map((p) => ({ ...p }));
  [pours[index]!.waterGrams, pours[other]!.waterGrams] = [
    pours[other]!.waterGrams,
    pours[index]!.waterGrams,
  ];
  return { ...recipe, pours };
}
export function addPour(recipe: Recipe): Recipe {
  if (recipe.pours.length >= 32) return recipe;
  const total = pourTotal(recipe),
    water = hundredths(recipe.waterGrams);
  const remaining = total !== null && water !== null ? water - total : 0;
  const duration = numeric(recipe.totalBrewTimeSeconds),
    previous = numeric(recipe.pours.at(-1)?.startTimeSeconds ?? '0');
  if (
    !Number.isInteger(duration) ||
    !Number.isInteger(previous) ||
    duration < 0 ||
    duration > 86400 ||
    previous < 0 ||
    previous > duration
  )
    return recipe;
  return {
    ...recipe,
    pours: [
      ...recipe.pours,
      {
        waterGrams: remaining > 0 ? String(remaining / 100) : '5',
        startTimeSeconds: String(Math.min(previous + 45, duration)),
      },
    ],
  };
}
