'use client';

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input } from '@cupmemo/ui';
import { coffeeCreateSchema, coffeeResponseSchema } from '@cupmemo/contracts';

const fields = [
  ['roaster', 'Roaster'],
  ['name', 'Coffee name'],
  ['country', 'Country'],
  ['region', 'Region'],
  ['producer', 'Producer'],
  ['farmStation', 'Farm / station'],
  ['variety', 'Variety'],
  ['process', 'Process'],
  ['elevation', 'Elevation'],
  ['roastDate', 'Roast date'],
  ['tastingNotes', 'Roaster tasting notes'],
] as const;
type Field = (typeof fields)[number][0];
type Draft = Record<Field, string>;
type Request = {
  controller: AbortController;
  timer: ReturnType<typeof setTimeout>;
  active: boolean;
};
const emptyDraft: Draft = {
  roaster: '',
  name: '',
  country: '',
  region: '',
  producer: '',
  farmStation: '',
  variety: '',
  process: '',
  elevation: '',
  roastDate: '',
  tastingNotes: '',
};
function fieldMessage(field: Field) {
  const label = fields.find(([key]) => key === field)![1];
  if (field === 'roaster' || field === 'name')
    return `Enter ${label.toLowerCase()} using 1–200 characters.`;
  if (field === 'roastDate') return 'Enter a valid calendar date or leave it empty.';
  if (field === 'tastingNotes')
    return 'Use up to 32 different notes, one per line, with at most 100 characters each. Repeated notes after trimming are not allowed (case-sensitive).';
  return `Use at most 500 characters for ${label.toLowerCase()}.`;
}

export function CoffeeForm() {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [status, setStatus] = useState<
    'idle' | 'pending' | 'declined' | 'uncertain' | 'unauthenticated'
  >('idle');
  const [message, setMessage] = useState('');
  const request = useRef<Request | null>(null);
  const locked = useRef(false);
  const mounted = useRef(false);
  const protect = useRef(false);
  const dirty = Object.values(draft).some((value) => value !== '');
  const pending = status === 'pending';
  const guarded = dirty || pending || status === 'uncertain';
  protect.current = guarded;
  function stopRequest() {
    const current = request.current;
    if (current) {
      current.active = false;
      clearTimeout(current.timer);
      current.controller.abort();
      request.current = null;
    }
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stopRequest();
    };
  }, []);
  useEffect(() => {
    if (!guarded) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (!protect.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [guarded]);
  function leave() {
    if (
      guarded &&
      !window.confirm(
        pending || status === 'uncertain'
          ? 'This coffee may already have been saved. Leaving cannot roll back a save. Discard this draft and return to your shelf?'
          : 'Discard your unsaved coffee details and return to your shelf?',
      )
    )
      return;
    stopRequest();
    locked.current = true;
    protect.current = false;
    setDraft(emptyDraft);
    setStatus('idle');
    router.replace('/app');
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (request.current || locked.current || !mounted.current) return;
    const result = coffeeCreateSchema.safeParse({
      ...draft,
      roastDate: draft.roastDate || null,
      tastingNotes: draft.tastingNotes
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    });
    if (!result.success) {
      const next: Partial<Record<Field, string>> = {};
      for (const issue of result.error.issues) {
        const key = issue.path[0] as Field;
        if (key in emptyDraft) next[key] = fieldMessage(key);
      }
      setErrors(next);
      const first = fields.find(([key]) => next[key]);
      const control = first && event.currentTarget.elements.namedItem(first[0]);
      if (control instanceof HTMLElement) control.focus();
      return;
    }
    setErrors({});
    setMessage('');
    setStatus('pending');
    const controller = new AbortController();
    const current: Request = {
      controller,
      active: true,
      timer: setTimeout(() => {
        uncertain();
      }, 3000),
    };
    request.current = current;
    const active = () => mounted.current && current.active;
    function uncertain() {
      if (!active()) return;
      locked.current = true;
      stopRequest();
      setStatus('uncertain');
      setMessage('This coffee may have been saved. Check your shelf before adding it again.');
    }
    try {
      const response = await fetch('/api/v1/coffees', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        redirect: 'error',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(result.data),
        signal: controller.signal,
      });
      if (!active()) return;
      if (response.redirected) {
        uncertain();
        return;
      }
      if (response.status === 401) {
        locked.current = true;
        stopRequest();
        protect.current = false;
        setDraft(emptyDraft);
        setStatus('unauthenticated');
        router.replace('/sign-in');
        router.refresh();
        return;
      }
      if ([400, 403, 413, 415].includes(response.status)) {
        stopRequest();
        setStatus('declined');
        setMessage(
          response.status === 400
            ? 'This coffee was not added. Check your details and correct them before trying again.'
            : 'This coffee was not added. Check your details and request before trying again.',
        );
        return;
      }
      if (response.status !== 201) {
        uncertain();
        return;
      }
      const body: unknown = await response.json();
      if (!active()) return;
      if (!coffeeResponseSchema.safeParse(body).success) {
        uncertain();
        return;
      }
      locked.current = true;
      stopRequest();
      protect.current = false;
      setDraft(emptyDraft);
      setStatus('idle');
      router.replace('/app');
      router.refresh();
    } catch {
      uncertain();
    }
  }
  if (status === 'unauthenticated') return <p role="status">Returning to sign in…</p>;
  return (
    <form
      className="coffee-form"
      onSubmit={submit}
      aria-busy={pending}
      onInvalid={(event) => {
        event.preventDefault();
        const control = event.target as HTMLInputElement;
        const first = Array.from(control.form?.elements ?? []).find(
          (element) => element instanceof HTMLInputElement && !element.validity.valid,
        );
        if (first instanceof HTMLElement) first.focus();
        const key = control.name as Field;
        setErrors((value) => ({ ...value, [key]: fieldMessage(key) }));
      }}
    >
      {Object.values(errors).some(Boolean) && (
        <p className="form-error" role="alert">
          Check the highlighted fields before adding this coffee.
        </p>
      )}
      {fields.map(([key, label]) => {
        const required = key === 'roaster' || key === 'name';
        const props = {
          id: key,
          name: key,
          value: draft[key],
          readOnly: pending,
          'aria-invalid': !!errors[key],
          'aria-describedby':
            [key === 'tastingNotes' ? 'notes-help' : '', errors[key] ? `${key}-error` : '']
              .filter(Boolean)
              .join(' ') || undefined,
          onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
            if (request.current) return;
            setDraft((value) => ({ ...value, [key]: event.target.value }));
            setErrors((value) => ({ ...value, [key]: undefined }));
          },
        };
        return (
          <div className="field" key={key}>
            <label htmlFor={key}>
              {label} ({required ? 'required' : 'optional'})
            </label>
            {key === 'tastingNotes' ? (
              <textarea {...props} className="cm-input coffee-notes" rows={4} />
            ) : (
              <Input
                {...props}
                type={key === 'roastDate' ? 'date' : 'text'}
                required={required}
                pattern={required ? '.*\\S.*' : undefined}
                maxLength={key === 'roastDate' ? undefined : required ? 200 : 500}
              />
            )}
            {key === 'tastingNotes' && (
              <p className="field-hint" id="notes-help">
                One descriptor per line. Up to 32 notes, 100 characters each; no repeated notes.
                These are roaster notes, not your tasting assessment.
              </p>
            )}
            {errors[key] && (
              <p id={`${key}-error`} className="form-error">
                {errors[key]}
              </p>
            )}
          </div>
        );
      })}
      {message && (
        <p className="form-error" role="alert">
          {message}
        </p>
      )}
      {status === 'uncertain' && (
        <a className="cm-button cm-button--secondary" href="/app">
          Check coffee shelf
        </a>
      )}
      {pending && (
        <p role="status">
          Adding coffee… Leaving cannot roll back a save that may already have happened.
        </p>
      )}
      <div className="coffee-actions">
        <Button type="submit" disabled={pending || status === 'uncertain'}>
          {pending ? 'Adding coffee…' : 'Add coffee to shelf'}
        </Button>
        <Button variant="secondary" onClick={leave}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
