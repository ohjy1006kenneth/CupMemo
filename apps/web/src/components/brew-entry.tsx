'use client';

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@cupmemo/ui';
import {
  brewListResponseSchema,
  brewResponseSchema,
  coffeeListResponseSchema,
  type Coffee,
  type CoffeeListResponse,
} from '@cupmemo/contracts';
import { initializeDraft, parseDraft, type Draft, type Recipe } from './brew-draft';
import { RecipeEditor } from './recipe-editor';
import { QuickTastingEditor } from './quick-tasting-editor';

type Request = {
  controller: AbortController;
  timer: ReturnType<typeof setTimeout>;
  active: boolean;
};
function stop(current: Request | null) {
  if (!current) return;
  current.active = false;
  clearTimeout(current.timer);
  current.controller.abort();
}
export function BrewEntry() {
  const router = useRouter();
  const [offset, setOffset] = useState(0),
    [retry, setRetry] = useState(0);
  const [page, setPage] = useState<CoffeeListResponse | null>(null);
  const [selected, setSelected] = useState<Coffee | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null),
    [baseline, setBaseline] = useState<Recipe | null>(null);
  const [source, setSource] = useState('');
  const [phase, setPhase] = useState<'recipe' | 'taste'>('recipe');
  const [readStatus, setReadStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [writeStatus, setWriteStatus] = useState<'idle' | 'pending' | 'declined' | 'uncertain'>(
    'idle',
  );
  const [message, setMessage] = useState(''),
    [errors, setErrors] = useState<Record<string, string>>({});
  const [terminal, setTerminal] = useState(false);
  const mounted = useRef(false),
    read = useRef<Request | null>(null),
    write = useRef<Request | null>(null),
    locked = useRef(false),
    protect = useRef(false);
  protect.current = !!draft && !terminal;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stop(read.current);
      stop(write.current);
      protect.current = false;
    };
  }, []);
  const guarded = !!draft && !terminal;
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
    setDraft(null);
    setBaseline(null);
    setSelected(null);
    setPage(null);
    setSource('');
    setErrors({});
    setMessage('');
  }
  function unauthenticated() {
    locked.current = true;
    stop(read.current);
    stop(write.current);
    read.current = null;
    write.current = null;
    clear();
    setTerminal(true);
    router.replace('/sign-in');
    router.refresh();
  }
  useEffect(() => {
    if (terminal) return;
    setPage(null);
    setReadStatus('loading');
    const controller = new AbortController();
    const current: Request = { controller, active: true, timer: setTimeout(failed, 3000) };
    read.current = current;
    const active = () => mounted.current && current.active;
    function failed() {
      if (!active()) return;
      stop(current);
      if (read.current === current) read.current = null;
      setPage(null);
      setReadStatus('error');
    }
    async function load() {
      try {
        const url = selected
          ? `/api/v1/brews?coffeeId=${encodeURIComponent(selected.id)}&limit=1&offset=0`
          : `/api/v1/coffees?limit=20&offset=${offset}`;
        const response = await fetch(url, {
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
        if (response.status !== 200) {
          failed();
          return;
        }
        const body: unknown = await response.json();
        if (!active()) return;
        if (selected) {
          const result = brewListResponseSchema.safeParse(body);
          if (
            !result.success ||
            result.data.pagination.limit !== 1 ||
            result.data.pagination.offset !== 0 ||
            result.data.brews.length > 1 ||
            result.data.brews.some((b) => b.coffeeId !== selected.id)
          ) {
            failed();
            return;
          }
          const latest = result.data.brews[0];
          const next = initializeDraft(latest);
          setDraft(next);
          setBaseline(structuredClone(next.recipe));
          setSource(
            latest
              ? 'Based on your latest brew'
              : 'Starter recipe · editable prototype starter, not saved Gear or a recommendation',
          );
          setPhase('recipe');
        } else {
          const result = coffeeListResponseSchema.safeParse(body);
          if (
            !result.success ||
            result.data.pagination.limit !== 20 ||
            result.data.pagination.offset !== offset ||
            result.data.coffees.length > 20
          ) {
            failed();
            return;
          }
          setPage(result.data);
        }
        stop(current);
        if (read.current === current) read.current = null;
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
    // Navigation/auth are stable imperative effects, never draft-driven re-fetches.
  }, [selected, offset, retry, terminal]);
  useEffect(() => {
    if (draft) {
      document.getElementById('brew-title')?.focus();
    }
  }, [phase, !!draft]);
  function discard(changeCoffee: boolean) {
    if (
      guarded &&
      !window.confirm(
        writeStatus === 'pending' || writeStatus === 'uncertain'
          ? 'This brew may already have been saved. Leaving cannot roll back a save. Discard this draft?'
          : 'Discard your unsaved recipe and tasting?',
      )
    )
      return;
    stop(read.current);
    stop(write.current);
    read.current = null;
    write.current = null;
    clear();
    setWriteStatus('idle');
    setPhase('recipe');
    if (changeCoffee) {
      locked.current = false;
      setOffset(0);
      setRetry((value) => value + 1);
    } else {
      locked.current = true;
      setTerminal(true);
      router.replace('/app');
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mounted.current || write.current || locked.current || !draft || !selected) return;
    const result = parseDraft(selected.id, draft);
    if (!result.success) {
      const next: Record<string, string> = {};
      for (const issue of result.error.issues)
        next[String(issue.path[0] ?? 'recipe')] = 'Check this value.';
      setErrors(next);
      const first = Object.keys(next)[0];
      const control = first && event.currentTarget.elements.namedItem(first);
      if (control instanceof HTMLElement) control.focus();
      return;
    }
    setErrors({});
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
      setMessage('This brew may have been saved. Check your journal before recording it again.');
    }
    try {
      const response = await fetch('/api/v1/brews', {
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
        unauthenticated();
        return;
      }
      if ([400, 403, 404, 413, 415].includes(response.status)) {
        stop(current);
        write.current = null;
        setWriteStatus('declined');
        setMessage(
          response.status === 404
            ? 'The selected coffee is unavailable. This brew was not saved. Change coffee to deliberately discard and reselect.'
            : 'This brew was not saved. Check and correct your recipe or request before trying again.',
        );
        return;
      }
      if (response.status !== 201) {
        uncertain();
        return;
      }
      const body: unknown = await response.json();
      if (!active()) return;
      const parsed = brewResponseSchema.safeParse(body);
      if (!parsed.success || parsed.data.brew.coffeeId !== selected.id) {
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
  if (terminal) return <p role="status">Leaving brew entry…</p>;
  const pending = writeStatus === 'pending';
  const title = draft
    ? phase === 'recipe'
      ? 'Make it yours'
      : 'How did it taste?'
    : 'Choose a coffee';
  return (
    <div className="brew-entry">
      <h1 id="brew-title" tabIndex={-1}>
        {title}
      </h1>
      {selected && (
        <p className="auth-intro">
          {selected.roaster} · {selected.name}
        </p>
      )}
      {!draft ? (
        <>
          {readStatus === 'loading' && (
            <p role="status">
              {selected ? 'Loading your latest recipe…' : 'Loading your coffees…'}
            </p>
          )}
          {readStatus === 'error' && (
            <>
              <p className="form-error" role="alert">
                {selected
                  ? 'Your latest recipe could not be loaded. Retry before starting this brew.'
                  : 'Your coffees could not be loaded.'}
              </p>
              <Button
                onClick={() => {
                  stop(read.current);
                  setRetry((v) => v + 1);
                }}
              >
                Retry {selected ? 'latest recipe' : 'coffees'}
              </Button>
            </>
          )}
          {selected && (
            <Button variant="secondary" onClick={() => discard(true)}>
              Choose another coffee
            </Button>
          )}
          {page && !selected && (
            <>
              {page.coffees.length === 0 ? (
                <>
                  <p>No coffees yet</p>
                  <p>Add a coffee before recording a brew.</p>
                  <a className="cm-button cm-button--secondary" href="/app/coffees/new">
                    Add coffee
                  </a>
                </>
              ) : (
                <ul className="brew-choices">
                  {page.coffees.map((coffee) => (
                    <li key={coffee.id}>
                      <Button
                        variant="secondary"
                        className="brew-choice"
                        onClick={() => {
                          stop(read.current);
                          setPage(null);
                          setSelected(coffee);
                        }}
                      >
                        {coffee.roaster} · {coffee.name}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="brew-segment">
                <Button
                  variant="secondary"
                  disabled={offset === 0}
                  onClick={() => {
                    stop(read.current);
                    setPage(null);
                    setOffset((v) => v - 20);
                  }}
                >
                  Previous coffees
                </Button>
                <Button
                  variant="secondary"
                  disabled={!page.pagination.hasMore || offset + 20 > 100000}
                  onClick={() => {
                    stop(read.current);
                    setPage(null);
                    setOffset((v) => v + 20);
                  }}
                >
                  Next coffees
                </Button>
              </div>
              <p className="field-hint">
                One page of up to 20 coffees. Offset pages may shift when coffees change.
              </p>
            </>
          )}
        </>
      ) : (
        <>
          {phase === 'recipe' && baseline && selected && (
            <>
              <p className="brew-source">{source}</p>
              <RecipeEditor
                coffeeId={selected.id}
                draft={draft}
                baseline={baseline}
                onChange={setDraft}
                onContinue={() => {
                  setErrors({});
                  setPhase('taste');
                }}
              />
            </>
          )}
          {phase === 'taste' && (
            <>
              <Button variant="ghost" disabled={pending} onClick={() => setPhase('recipe')}>
                Back to recipe
              </Button>
              <QuickTastingEditor
                assessment={draft.assessment}
                onChange={(assessment) => {
                  if (!write.current) setDraft({ ...draft, assessment });
                }}
                pending={pending}
                locked={writeStatus === 'uncertain'}
                errors={errors}
                onSubmit={submit}
              />
            </>
          )}
          {message && (
            <p className="form-error" role="alert">
              {message}
            </p>
          )}
          {writeStatus === 'uncertain' && (
            <a className="cm-button cm-button--secondary" href="/app/journal">
              Check journal
            </a>
          )}
          {pending && (
            <p role="status">
              Saving brew… Leaving cannot roll back a save that may already have happened.
            </p>
          )}
          <Button variant="secondary" disabled={pending} onClick={() => discard(true)}>
            Change coffee
          </Button>
        </>
      )}
      <Button variant="secondary" onClick={() => discard(false)}>
        Cancel
      </Button>
    </div>
  );
}
