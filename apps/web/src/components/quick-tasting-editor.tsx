'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { Button, Input } from '@cupmemo/ui';
import { qualities, type Assessment } from './brew-draft';

const tags = ['Floral', 'Peach', 'Citrus', 'Berry', 'Chocolate', 'Nutty', 'Sweet', 'Dry finish'];
export function QuickTastingEditor({
  assessment,
  onChange,
  pending,
  locked,
  errors: validationErrors,
  onSubmit,
  saved = false,
}: {
  assessment: Assessment;
  onChange: (value: Assessment) => void;
  pending: boolean;
  locked: boolean;
  errors: Record<string, string>;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  saved?: boolean;
}) {
  const [nativeErrors, setNativeErrors] = useState<Record<string, string>>({});
  const errors = { ...validationErrors, ...nativeErrors };
  const form = useRef<HTMLFormElement>(null);
  const visible =
    assessment.tastingMode === 'sensory'
      ? qualities
      : qualities
          .filter(([key]) => ['acidity', 'body', 'aftertaste'].includes(key))
          .sort(
            ([a], [b]) =>
              ['acidity', 'body', 'aftertaste'].indexOf(a) -
              ['acidity', 'body', 'aftertaste'].indexOf(b),
          );
  useLayoutEffect(() => {
    const first = Object.keys(validationErrors)[0];
    if (!first) return;
    if (qualities.some(([key]) => key === first) && !visible.some(([key]) => key === first)) {
      onChange({ ...assessment, tastingMode: 'sensory' });
      return;
    }
    const control = form.current?.elements.namedItem(first);
    if (control instanceof HTMLElement) control.focus();
  }, [validationErrors, assessment.tastingMode]);
  function change(key: keyof Assessment, value: string | string[] | null) {
    if (!pending) {
      setNativeErrors((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      onChange({ ...assessment, [key]: value });
    }
  }
  function score(delta: number) {
    const current = assessment.overallScore === '' ? 0 : Number(assessment.overallScore);
    if (!Number.isFinite(current)) return;
    const next = Math.max(0, Math.min(100, current + delta));
    change('overallScore', String(next));
  }
  return (
    <form
      ref={form}
      className="brew-editor"
      aria-busy={pending}
      onSubmit={onSubmit}
      onInvalid={(event) => {
        event.preventDefault();
        const first = Array.from(event.currentTarget.elements).find(
          (el) => el instanceof HTMLInputElement && !el.validity.valid,
        );
        if (first instanceof HTMLElement) first.focus();
        const control = event.target as HTMLInputElement;
        if (control.name)
          setNativeErrors((current) => ({ ...current, [control.name]: 'Check this value.' }));
      }}
    >
      {Object.keys(errors).length > 0 && (
        <p className="form-error" role="alert">
          Check your score and tasting fields before saving.
        </p>
      )}
      <div className="brew-segment" role="group" aria-label="Tasting detail level">
        {(['quick', 'sensory'] as const).map((mode) => (
          <Button
            key={mode}
            type="button"
            variant="secondary"
            disabled={pending}
            aria-pressed={assessment.tastingMode === mode}
            onClick={() => change('tastingMode', mode)}
          >
            {mode === 'quick' ? 'Quick rating' : 'Sensory Detail'}
          </Button>
        ))}
      </div>
      <p className="field-hint">
        Sensory Detail is optional. Quick evaluation is all you need to save.
      </p>
      <section className="brew-score-entry" aria-labelledby="score-heading">
        <h2 id="score-heading">Your overall score</h2>
        <p className="field-hint">Independent personal assessment, not an average of qualities.</p>
        <div className="field">
          <label htmlFor="overallScore">Overall score /100 (required)</label>
          <div className="brew-stepper">
            <Button
              variant="secondary"
              disabled={pending}
              aria-label="Decrease overall score"
              onClick={() => score(-0.25)}
            >
              −0.25
            </Button>
            <Input
              id="overallScore"
              name="overallScore"
              type="number"
              required
              min={0}
              max={100}
              step={0.25}
              readOnly={pending}
              value={assessment.overallScore}
              onChange={(event) => change('overallScore', event.target.value)}
              aria-invalid={!!errors.overallScore}
              aria-describedby="score-help overallScore-error"
            />
            <Button
              variant="secondary"
              disabled={pending}
              aria-label="Increase overall score"
              onClick={() => score(0.25)}
            >
              +0.25
            </Button>
          </div>
          <p id="score-help" className="field-hint">
            0–100 in quarters. From blank, + selects 0.25 and − selects 0.
          </p>
          <label className="visually-hidden" htmlFor="overallScore-range">
            Adjust overall score
          </label>
          <input
            id="overallScore-range"
            type="range"
            min={0}
            max={100}
            step={0.25}
            disabled={pending}
            value={assessment.overallScore === '' ? 0 : assessment.overallScore}
            onChange={(event) => change('overallScore', event.target.value)}
          />
          {errors.overallScore && (
            <p id="overallScore-error" className="form-error">
              Enter an overall score from 0–100 in quarter points.
            </p>
          )}
        </div>
      </section>
      <section aria-labelledby="quick-heading">
        <h2 id="quick-heading">
          {assessment.tastingMode === 'quick' ? 'Three quick details' : 'Sensory Detail'}
        </h2>
        <p className="field-hint">
          Optional quality · /10. Not intensity; zero is a rating, not missing.
        </p>
        {visible.map(([key, label]) => {
          const value = assessment[key];
          return (
            <div className="brew-quality field" key={key}>
              <div className="brew-row">
                <h3>{label}</h3>
                {value === null ? <span>Not rated</span> : <output>{value || '—'} /10</output>}
              </div>
              {value === null ? (
                <Button variant="secondary" disabled={pending} onClick={() => change(key, '0')}>
                  Add {label} rating
                </Button>
              ) : (
                <>
                  <label htmlFor={key}>{label} quality /10</label>
                  <Input
                    id={key}
                    name={key}
                    type="number"
                    required
                    min={0}
                    max={10}
                    step={0.25}
                    readOnly={pending}
                    value={value}
                    onChange={(event) => change(key, event.target.value)}
                    aria-invalid={!!errors[key]}
                    aria-describedby={errors[key] ? `${key}-error` : undefined}
                  />
                  <label className="visually-hidden" htmlFor={`${key}-range`}>
                    Adjust {label} quality
                  </label>
                  <input
                    id={`${key}-range`}
                    type="range"
                    min={0}
                    max={10}
                    step={0.25}
                    disabled={pending}
                    value={value === '' ? 0 : value}
                    onChange={(event) => change(key, event.target.value)}
                  />
                  <Button variant="secondary" disabled={pending} onClick={() => change(key, null)}>
                    Clear {label} rating
                  </Button>
                </>
              )}
              {errors[key] && (
                <p id={`${key}-error`} className="form-error">
                  Choose 0–10 in quarter points or clear this rating.
                </p>
              )}
            </div>
          );
        })}
      </section>

      <section aria-labelledby="tags-heading">
        <h2 id="tags-heading">What did you notice?</h2>
        <div className="brew-tags">
          {[...new Set([...tags, ...assessment.tastingTags])].map((tag) => (
            <Button
              key={tag}
              variant="secondary"
              disabled={pending}
              aria-pressed={assessment.tastingTags.includes(tag)}
              onClick={() =>
                change(
                  'tastingTags',
                  assessment.tastingTags.includes(tag)
                    ? assessment.tastingTags.filter((t) => t !== tag)
                    : [...assessment.tastingTags, tag],
                )
              }
            >
              {tag}
            </Button>
          ))}
        </div>
      </section>
      <div className="field">
        <label htmlFor="notes">Tasting notes (optional)</label>
        <textarea
          id="notes"
          name="notes"
          className="cm-input coffee-notes"
          rows={4}
          maxLength={5000}
          readOnly={pending}
          value={assessment.notes}
          onChange={(event) => change('notes', event.target.value)}
          aria-invalid={!!errors.notes}
          aria-describedby={errors.notes ? 'notes-error' : undefined}
        />
        {errors.notes && (
          <p className="form-error" id="notes-error">
            Use at most 5000 characters.
          </p>
        )}
      </div>
      <Button type="submit" disabled={pending || locked} className="primary-button">
        {saved
          ? pending
            ? 'Saving changes…'
            : 'Save changes'
          : pending
            ? 'Saving brew…'
            : 'Save brew & tasting'}
      </Button>
    </form>
  );
}
