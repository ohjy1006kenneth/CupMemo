'use client';

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@cupmemo/ui';
import { brewIdSchema, brewResponseSchema, type Brew, type BrewPatch } from '@cupmemo/contracts';
import { savedDraft, parseSavedPatch, patchMatches, type Draft } from './brew-draft';
import { QuickTastingEditor } from './quick-tasting-editor';
import { RecipeEditor } from './recipe-editor';

type Request = {
  controller: AbortController;
  timer: ReturnType<typeof setTimeout>;
  active: boolean;
};
function stop(request: Request | null) {
  if (!request) return;
  request.active = false;
  clearTimeout(request.timer);
  request.controller.abort();
}
export function SavedTastingEntry({ id }: { id: string }) {
  // Isolate previous private state synchronously on route changes, including late bodies.
  return <SavedTastingRequest key={id} id={brewIdSchema.safeParse(id).success ? id : null} />;
}
function SavedTastingRequest({ id }: { id: string | null }) {
  const router = useRouter();
  const [original, setOriginal] = useState<Brew | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [panel, setPanel] = useState<'recipe' | 'tasting'>('tasting');
  const [readStatus, setReadStatus] = useState<'loading' | 'error' | 'ready' | 'unavailable'>(
    id ? 'loading' : 'unavailable',
  );
  const [writeStatus, setWriteStatus] = useState<'idle' | 'pending' | 'declined' | 'uncertain'>(
    'idle',
  );
  const [attempt, setAttempt] = useState(0);
  const [terminal, setTerminal] = useState(false);
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const mounted = useRef(false),
    read = useRef<Request | null>(null),
    write = useRef<Request | null>(null),
    locked = useRef(false),
    protect = useRef(false);
  const delta = original && draft ? parseSavedPatch(original, draft) : null;
  const guarded =
    !terminal &&
    ((!!delta && (!delta.success || delta.data !== null)) ||
      writeStatus === 'pending' ||
      writeStatus === 'uncertain');
  protect.current = guarded;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stop(read.current);
      stop(write.current);
      protect.current = false;
    };
  }, []);
  useLayoutEffect(() => {
    if (!guarded) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (!protect.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [guarded]);
  function clear() {
    protect.current = false;
    setOriginal(null);
    setDraft(null);
    setErrors({});
    setMessage('');
  }
  function unavailable() {
    stop(read.current);
    stop(write.current);
    read.current = null;
    write.current = null;
    locked.current = true;
    clear();
    setReadStatus('unavailable');
    setWriteStatus('idle');
  }
  function unauthenticated() {
    unavailable();
    setTerminal(true);
    router.replace('/sign-in');
    router.refresh();
  }
  useEffect(() => {
    if (!id || terminal) return;
    clear();
    setReadStatus('loading');
    const controller = new AbortController();
    const current: Request = { controller, active: true, timer: setTimeout(failed, 3000) };
    read.current = current;
    const active = () => mounted.current && current.active;
    function failed() {
      if (!active()) return;
      stop(current);
      read.current = null;
      clear();
      setReadStatus('error');
    }
    async function load() {
      try {
        const response = await fetch(`/api/v1/brews/${id}`, {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
          redirect: 'error',
          signal: controller.signal,
        });
        if (!active()) return;
        if (response.redirected) {
          failed();
          return;
        }
        if (response.status === 401) {
          unauthenticated();
          return;
        }
        if (response.status === 404) {
          unavailable();
          return;
        }
        if (response.status !== 200) {
          failed();
          return;
        }
        const body: unknown = await response.json();
        if (!active()) return;
        const result = brewResponseSchema.safeParse(body);
        if (!result.success || result.data.brew.id !== id) {
          failed();
          return;
        }
        stop(current);
        read.current = null;
        setOriginal(result.data.brew);
        setDraft(savedDraft(result.data.brew));
        setReadStatus('ready');
      } catch {
        failed();
      }
    }
    void load();
    return () => {
      stop(current);
      if (read.current === current) read.current = null;
    };
  }, [id, attempt, terminal]);
  function cancel() {
    if (
      guarded &&
      !window.confirm(
        writeStatus === 'pending' || writeStatus === 'uncertain'
          ? 'This tasting may already have been updated. Leaving cannot roll back an update. Discard these changes?'
          : 'Discard your unsaved tasting changes?',
      )
    )
      return;
    stop(read.current);
    stop(write.current);
    read.current = null;
    write.current = null;
    locked.current = true;
    clear();
    setTerminal(true);
    router.replace('/app/journal');
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mounted.current || write.current || locked.current || !id || !original || !draft) return;
    const result = parseSavedPatch(original, draft);
    if (!result.success) {
      const next: Record<string, string> = {};
      for (const issue of result.error.issues)
        next[issue.path.join('.') || 'pours'] = 'Check this value.';
      const recipeKeys = [
        'brewer',
        'grinder',
        'grindSetting',
        'doseGrams',
        'waterGrams',
        'waterTemperatureC',
        'totalBrewTimeSeconds',
        'brewedAt',
        'pours',
      ];
      setPanel(
        Object.keys(next).some((key) => recipeKeys.includes(key.split('.')[0]!))
          ? 'recipe'
          : 'tasting',
      );
      setErrors(next);
      return;
    }
    setErrors({});
    if (result.data === null) {
      setMessage('No changes to save.');
      return;
    }
    const patch: BrewPatch = result.data;
    setMessage('');
    setWriteStatus('pending');
    const controller = new AbortController();
    const current: Request = { controller, active: true, timer: setTimeout(uncertain, 3000) };
    write.current = current;
    const active = () => mounted.current && current.active;
    function uncertain() {
      if (!active()) return;
      locked.current = true;
      stop(current);
      write.current = null;
      setWriteStatus('uncertain');
      setMessage(
        'This tasting may have been updated. Check your journal. Leaving cannot roll back a possible update.',
      );
    }
    try {
      const response = await fetch(`/api/v1/brews/${id}`, {
        method: 'PATCH',
        credentials: 'include',
        cache: 'no-store',
        redirect: 'error',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
        signal: controller.signal,
      });
      if (!active()) return;
      if (response.redirected) {
        uncertain();
        return;
      }
      if (response.status === 401) {
        unauthenticated();
        return;
      }
      if (response.status === 404) {
        unavailable();
        return;
      }
      if ([400, 403, 413, 415].includes(response.status)) {
        stop(current);
        write.current = null;
        setWriteStatus('declined');
        setMessage(
          'These changes were not saved. Check and correct your tasting or request before trying again.',
        );
        return;
      }
      if (response.status !== 200) {
        uncertain();
        return;
      }
      const body: unknown = await response.json();
      if (!active()) return;
      const parsed = brewResponseSchema.safeParse(body);
      if (!parsed.success) {
        uncertain();
        return;
      }
      const saved = parsed.data.brew;
      if (!patchMatches(original, saved, patch)) {
        uncertain();
        return;
      }
      locked.current = true;
      stop(current);
      write.current = null;
      clear();
      setTerminal(true);
      router.replace('/app/journal');
      router.refresh();
    } catch {
      uncertain();
    }
  }
  const pending = writeStatus === 'pending';
  return (
    <div className="brew-entry">
      <h1>{panel === 'recipe' ? 'Edit your brew' : 'Edit your tasting'}</h1>
      {terminal ? (
        <p role="status">Leaving tasting editor…</p>
      ) : (
        <>
          {readStatus === 'loading' && <p role="status">Loading your tasting…</p>}
          {readStatus === 'unavailable' && <p role="alert">This tasting is unavailable.</p>}
          {readStatus === 'error' && (
            <>
              <p className="form-error" role="alert">
                Your tasting could not be loaded.
              </p>
              <Button
                variant="secondary"
                onClick={() => {
                  stop(read.current);
                  setAttempt((v) => v + 1);
                }}
              >
                Retry tasting
              </Button>
            </>
          )}
          {readStatus === 'ready' && original && draft && (
            <>
              <p className="auth-intro">
                {original.brewer} ·{' '}
                <time dateTime={original.brewedAt}>
                  {new Date(original.brewedAt).toLocaleString(undefined, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </time>
              </p>
              <p className="field-hint">
                Editing this saved brew. Save changes includes both recipe and tasting.
              </p>
              <div className="brew-segment" role="group" aria-label="Saved brew editor">
                {(['recipe', 'tasting'] as const).map((value) => (
                  <Button
                    variant="secondary"
                    key={value}
                    disabled={pending}
                    aria-pressed={panel === value}
                    onClick={() => setPanel(value)}
                  >
                    {value === 'recipe' ? 'Recipe' : 'Tasting'}
                  </Button>
                ))}
              </div>
              {panel === 'recipe' ? (
                <RecipeEditor
                  coffeeId={original.coffeeId}
                  saved={original}
                  draft={draft}
                  baseline={savedDraft(original).recipe}
                  onChange={(value) => {
                    if (!write.current) setDraft(value);
                  }}
                  onContinue={() => {}}
                  pending={pending}
                  locked={writeStatus === 'uncertain'}
                  validationErrors={errors}
                  onSubmit={submit}
                />
              ) : (
                <QuickTastingEditor
                  saved
                  assessment={draft.assessment}
                  onChange={(value) => {
                    if (!write.current) {
                      setDraft({ ...draft, assessment: value });
                      if (writeStatus === 'idle') setMessage('');
                    }
                  }}
                  pending={pending}
                  locked={writeStatus === 'uncertain'}
                  errors={errors}
                  onSubmit={submit}
                />
              )}
              {message && (
                <p
                  role={writeStatus === 'idle' ? 'status' : 'alert'}
                  className={writeStatus === 'idle' ? 'field-hint' : 'form-error'}
                >
                  {message}
                </p>
              )}
              {pending && (
                <p role="status">Saving changes… Leaving cannot roll back a possible update.</p>
              )}
              {writeStatus === 'uncertain' && (
                <a className="cm-button cm-button--secondary" href="/app/journal">
                  Check journal
                </a>
              )}
              <Button variant="secondary" onClick={cancel}>
                Cancel changes
              </Button>
            </>
          )}
          {readStatus !== 'ready' && (
            <a className="cm-button cm-button--secondary" href="/app/journal">
              Return to journal
            </a>
          )}
        </>
      )}
    </div>
  );
}
