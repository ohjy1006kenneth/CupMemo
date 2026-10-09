'use client';

import { useState } from 'react';
import { Button, Input } from '@cupmemo/ui';
import {
  addPour,
  hundredths,
  movePour,
  parseDraft,
  pourTotal,
  type Draft,
  type Recipe,
} from './brew-draft';

const brewers = ['V60', 'Origami', 'Switch', 'Kalita Wave'];
const grinders = ['K-Ultra', 'Comandante C40', 'Ode Gen 2'];
const fields = [
  ['doseGrams', 'Coffee dose (g)', 0.5, 0.01, 99999.99],
  ['waterGrams', 'Water (g)', 5, 0.01, 99999.99],
  ['waterTemperatureC', 'Temperature (°C)', 1, 0, 100],
  ['totalBrewTimeSeconds', 'Total brew time (seconds)', 5, 0, 86400],
] as const;
function adjusted(value: string, delta: number, min: number, max: number) {
  const scaled = hundredths(value);
  if (scaled === null) return null;
  const next = scaled + Math.round(delta * 100);
  return next >= min * 100 && next <= max * 100 ? String(next / 100) : null;
}
// Preserve all decimal notation digits rather than rounding the loaded setting.
function grindAdjusted(value: string, delta: number) {
  if (!/^\d+(?:\.\d+)?$/.test(value) || !Number.isFinite(Number(value))) return null;
  const places = Math.max(value.split('.')[1]?.length ?? 0, 1);
  if (places > 100) return null;
  const scale = 10n ** BigInt(places);
  const [whole, fraction = ''] = value.split('.');
  const next =
    BigInt(whole!) * scale +
    BigInt(fraction.padEnd(places, '0')) +
    BigInt(Math.round(delta * 10)) * (scale / 10n);
  if (next < 0n) return null;
  const digits = String(next).padStart(places + 1, '0');
  return `${digits.slice(0, -places)}.${digits.slice(-places)}`.replace(/\.?0+$/, '');
}
export function RecipeEditor({
  coffeeId,
  draft,
  baseline,
  onChange,
  onContinue,
}: {
  coffeeId: string;
  draft: Draft;
  baseline: Recipe;
  onChange: (draft: Draft) => void;
  onContinue: () => void;
}) {
  const r = draft.recipe;
  const [otherBrewer, setOtherBrewer] = useState(!brewers.includes(r.brewer));
  const [otherGrinder, setOtherGrinder] = useState(!grinders.includes(r.grinder));
  const [cumulative, setCumulative] = useState(false);
  const validation = parseDraft(coffeeId, draft, true);
  const errors: Record<string, string> = {};
  if (!validation.success)
    for (const issue of validation.error.issues) {
      const path = issue.path.join('.');
      errors[path || 'pours'] =
        'Check this value: text 1–200 characters; grams positive with up to 2 decimals; temperature 0–100; seconds whole 0–86400; local time valid; pours ordered and matching water.';
    }
  const total = pourTotal(r),
    water = hundredths(r.waterGrams);
  const mismatch = total !== null && water !== null && total !== water;
  function recipe(next: Recipe) {
    onChange({ ...draft, recipe: next });
  }
  function set(key: keyof Omit<Recipe, 'pours'>, value: string) {
    recipe({
      ...r,
      [key]: value,
      ...(key === 'grinder' && value !== r.grinder ? { grindSetting: '' } : {}),
    });
  }
  function pour(index: number, key: 'waterGrams' | 'startTimeSeconds', value: string) {
    recipe({ ...r, pours: r.pours.map((p, i) => (i === index ? { ...p, [key]: value } : p)) });
  }
  function error(key: string) {
    return errors[key] ? (
      <p className="form-error" id={`${key}-error`}>
        {errors[key]}
      </p>
    ) : null;
  }
  const changes = Object.entries(baseline)
    .filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(r[key as keyof Recipe]))
    .map(
      ([key, value]) =>
        `${key === 'pours' ? 'Pour schedule' : key}: ${key === 'pours' ? (value as Recipe['pours']).map((p) => `${p.waterGrams}g @ ${p.startTimeSeconds}s`).join(', ') : String(value)} → ${key === 'pours' ? r.pours.map((p) => `${p.waterGrams}g @ ${p.startTimeSeconds}s`).join(', ') : r[key as keyof Recipe]}`,
    );
  return (
    <form
      className="brew-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (validation.success) onContinue();
      }}
      onInvalid={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const first = Array.from(form.elements).find(
          (el) => el instanceof HTMLInputElement && !el.validity.valid,
        );
        if (first instanceof HTMLElement) first.focus();
      }}
    >
      {!validation.success && (
        <p className="form-error" role="alert">
          Check the recipe below before continuing. Pours must match water and start in order within
          the total brew time.
        </p>
      )}
      <div className="brew-grid">
        {(['brewer', 'grinder'] as const).map((key) => {
          const options = key === 'brewer' ? brewers : grinders;
          const other = key === 'brewer' ? otherBrewer : otherGrinder;
          const label = key === 'brewer' ? 'Brewer' : 'Grinder';
          return (
            <div className="field" key={key}>
              <label htmlFor={key}>{label}</label>
              <select
                className="cm-input"
                id={key}
                value={other ? 'Other' : r[key]}
                onChange={(event) => {
                  const value = event.target.value;
                  if (key === 'brewer') setOtherBrewer(value === 'Other');
                  else setOtherGrinder(value === 'Other');
                  set(key, value === 'Other' ? '' : value);
                }}
              >
                {options.map((v) => (
                  <option key={v}>{v}</option>
                ))}
                <option>Other</option>
              </select>
              {other && (
                <>
                  <label htmlFor={`${key}-other`}>Other {label.toLowerCase()} (required)</label>
                  <Input
                    id={`${key}-other`}
                    required
                    maxLength={200}
                    value={r[key]}
                    onChange={(event) => set(key, event.target.value)}
                    aria-invalid={!!errors[key]}
                    aria-describedby={errors[key] ? `${key}-error` : undefined}
                  />
                </>
              )}
              {error(key)}
            </div>
          );
        })}
      </div>
      <div className="brew-grid">
        {fields.map(([key, label, step, min, max]) => (
          <div className="field" key={key}>
            <label htmlFor={key}>{label}</label>
            <div className="brew-stepper">
              <Button
                variant="secondary"
                aria-label={`Decrease ${label}`}
                disabled={adjusted(r[key], -step, min, max) === null}
                onClick={() => set(key, adjusted(r[key], -step, min, max)!)}
              >
                −
              </Button>
              <Input
                id={key}
                type="number"
                required
                min={min}
                max={max}
                step={key === 'totalBrewTimeSeconds' ? 1 : 0.01}
                value={r[key]}
                onChange={(event) => set(key, event.target.value)}
                aria-invalid={!!errors[key]}
                aria-describedby={errors[key] ? `${key}-error` : undefined}
              />
              <Button
                variant="secondary"
                aria-label={`Increase ${label}`}
                disabled={adjusted(r[key], step, min, max) === null}
                onClick={() => set(key, adjusted(r[key], step, min, max)!)}
              >
                +
              </Button>
            </div>
            {error(key)}
          </div>
        ))}
        <div className="field brew-grind-field">
          <label htmlFor="grindSetting">Grind setting (required)</label>
          <div className="brew-stepper">
            <Button
              variant="secondary"
              aria-label="Decrease grind setting"
              disabled={
                !grinders.includes(r.grinder) ||
                grindAdjusted(r.grindSetting, r.grinder === 'K-Ultra' ? -0.1 : -1) === null
              }
              onClick={() =>
                set(
                  'grindSetting',
                  grindAdjusted(r.grindSetting, r.grinder === 'K-Ultra' ? -0.1 : -1)!,
                )
              }
            >
              −
            </Button>
            <Input
              id="grindSetting"
              required
              maxLength={200}
              value={r.grindSetting}
              onChange={(event) => set('grindSetting', event.target.value)}
              aria-invalid={!!errors.grindSetting}
              aria-describedby="grind-help grindSetting-error"
            />
            <Button
              variant="secondary"
              aria-label="Increase grind setting"
              disabled={
                !grinders.includes(r.grinder) ||
                grindAdjusted(r.grindSetting, r.grinder === 'K-Ultra' ? 0.1 : 1) === null
              }
              onClick={() =>
                set(
                  'grindSetting',
                  grindAdjusted(r.grindSetting, r.grinder === 'K-Ultra' ? 0.1 : 1)!,
                )
              }
            >
              +
            </Button>
          </div>
          <p id="grind-help" className="field-hint">
            Use your grinder’s notation. Changing grinder clears its setting; settings are never
            converted between models.
          </p>
          {error('grindSetting')}
        </div>
      </div>
      <div className="brew-ratio">
        Ratio{' '}
        <strong>
          {hundredths(r.doseGrams) && water !== null
            ? `1:${(Number(r.waterGrams) / Number(r.doseGrams)).toFixed(2)}`
            : '—'}
        </strong>{' '}
        · {r.grinder || 'Choose grinder'} notation
      </div>
      <div className="field">
        <label htmlFor="brewedAt">Brew date and time (local, required)</label>
        <Input
          id="brewedAt"
          type="datetime-local"
          required
          step={1}
          value={draft.localTime}
          onChange={(event) => onChange({ ...draft, localTime: event.target.value })}
          aria-invalid={!!errors.brewedAt}
          aria-describedby="time-help brewedAt-error"
        />
        <p id="time-help" className="field-hint">
          Your local calendar time, saved in UTC. A repeated daylight-saving time uses the browser’s
          earlier occurrence.
        </p>
        {error('brewedAt')}
      </div>
      {changes.length > 0 && <p className="brew-changes">Changed: {changes.join(' · ')}</p>}
      <section aria-labelledby="pours-heading">
        <h2 id="pours-heading">Your pours</h2>
        <p className="field-hint">
          Reordering moves water amounts between fixed chronological start-time slots. Total brew
          time includes drawdown.
        </p>
        <div className="brew-segment">
          <Button
            variant="secondary"
            aria-pressed={!cumulative}
            onClick={() => setCumulative(false)}
          >
            Add each pour
          </Button>
          <Button variant="secondary" aria-pressed={cumulative} onClick={() => setCumulative(true)}>
            Scale target
          </Button>
        </div>
        {r.pours.map((p, i) => (
          <div className="brew-pour" key={i}>
            <div className="brew-row">
              <h3>{i === 0 ? 'Bloom' : `Pour ${i + 1}`}</h3>
              <div className="brew-pour-actions">
                <Button
                  variant="secondary"
                  aria-label={`Move pour ${i + 1} earlier`}
                  disabled={i === 0}
                  onClick={() => recipe(movePour(r, i, -1))}
                >
                  ↑
                </Button>
                <Button
                  variant="secondary"
                  aria-label={`Move pour ${i + 1} later`}
                  disabled={i === r.pours.length - 1}
                  onClick={() => recipe(movePour(r, i, 1))}
                >
                  ↓
                </Button>
                <Button
                  variant="secondary"
                  aria-label={`Remove pour ${i + 1}`}
                  disabled={r.pours.length === 1}
                  onClick={() => recipe({ ...r, pours: r.pours.filter((_, j) => i !== j) })}
                >
                  Remove
                </Button>
              </div>
            </div>
            {cumulative && (
              <p>
                Scale target:{' '}
                {pourTotal({ ...r, pours: r.pours.slice(0, i + 1) }) === null
                  ? '—'
                  : String(pourTotal({ ...r, pours: r.pours.slice(0, i + 1) })! / 100)}{' '}
                g
              </p>
            )}
            <div className="field">
              <label htmlFor={`pour-${i}-water`}>Pour {i + 1} incremental water (g)</label>
              <div className="brew-stepper">
                <Button
                  variant="secondary"
                  aria-label={`Remove 5g from pour ${i + 1}`}
                  disabled={adjusted(p.waterGrams, -5, 0.01, 99999.99) === null}
                  onClick={() => pour(i, 'waterGrams', adjusted(p.waterGrams, -5, 0.01, 99999.99)!)}
                >
                  −
                </Button>
                <Input
                  id={`pour-${i}-water`}
                  type="number"
                  required
                  min={0.01}
                  max={99999.99}
                  step={0.01}
                  value={p.waterGrams}
                  onChange={(event) => pour(i, 'waterGrams', event.target.value)}
                  aria-invalid={!!errors[`pours.${i}.waterGrams`]}
                  aria-describedby={
                    errors[`pours.${i}.waterGrams`] ? `pours.${i}.waterGrams-error` : undefined
                  }
                />
                <Button
                  variant="secondary"
                  aria-label={`Add 5g to pour ${i + 1}`}
                  disabled={adjusted(p.waterGrams, 5, 0.01, 99999.99) === null}
                  onClick={() => pour(i, 'waterGrams', adjusted(p.waterGrams, 5, 0.01, 99999.99)!)}
                >
                  +
                </Button>
              </div>
              {error(`pours.${i}.waterGrams`)}
            </div>
            <div className="field">
              <label htmlFor={`pour-${i}-start`}>Pour {i + 1} start (seconds)</label>
              <Input
                id={`pour-${i}-start`}
                type="number"
                required
                min={0}
                max={86400}
                step={1}
                value={p.startTimeSeconds}
                onChange={(event) => pour(i, 'startTimeSeconds', event.target.value)}
                aria-invalid={!!errors[`pours.${i}.startTimeSeconds`]}
                aria-describedby={
                  errors[`pours.${i}.startTimeSeconds`]
                    ? `pours.${i}.startTimeSeconds-error`
                    : undefined
                }
              />
              {error(`pours.${i}.startTimeSeconds`)}
            </div>
          </div>
        ))}
        <Button
          variant="secondary"
          className="primary-button"
          disabled={r.pours.length >= 32}
          onClick={() => recipe(addPour(r))}
        >
          Add pour
        </Button>
        <p>
          Pours: {total === null ? '—' : total / 100} g · Recipe: {r.waterGrams || '—'} g
        </p>
        {error('pours')}
        {mismatch && (
          <>
            <p className="form-error">Pour total differs from the recipe water.</p>
            <Button
              variant="secondary"
              className="primary-button"
              disabled={total === null || total <= 0 || total > 9999999}
              onClick={() => set('waterGrams', String(total! / 100))}
            >
              Use pour total as water amount
            </Button>
          </>
        )}
      </section>
      <Button type="submit" disabled={!validation.success} className="primary-button">
        Continue to tasting
      </Button>
    </form>
  );
}
