'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@cupmemo/ui';
import {
  coffeeListResponseSchema,
  brewListResponseSchema,
  type Coffee,
  type Brew,
} from '@cupmemo/contracts';

type Kind = 'coffees' | 'brews';
type State =
  | { status: 'loading' | 'error' | 'unauthenticated' | 'unavailable' }
  | { status: 'ready'; coffees: Coffee[]; brews: Brew[]; hasMore: boolean };

export function CollectionView({ kind }: { kind: Kind }) {
  // A destination change cannot render rows belonging to the previous view.
  return <CollectionRequest key={kind} kind={kind} />;
}

function CollectionRequest({ kind }: { kind: Kind }) {
  const router = useRouter();
  const [attempt, setAttempt] = useState(0);
  const [offset, setOffset] = useState(0);
  const invalidate = useRef<(() => void) | null>(null);
  const [state, setState] = useState<State>({ status: 'loading' });
  function page(next: number) {
    if (!Number.isInteger(next) || next < 0 || next > 100000 || next % 20) return;
    invalidate.current?.();
    setState({ status: 'loading' });
    setOffset(next);
    setAttempt((value) => value + 1);
  }
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    invalidate.current = () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
    setState({ status: 'loading' });
    const timer = setTimeout(() => {
      active = false;
      controller.abort();
      setState({ status: 'error' });
    }, 3000);
    async function load() {
      try {
        const endpoint =
          kind === 'coffees'
            ? '/api/v1/coffees?limit=20&offset=0'
            : `/api/v1/brews?limit=20&offset=${offset}`;
        const response = await fetch(endpoint, {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
          redirect: 'error',
          signal: controller.signal,
        });
        if (!active) return;
        if (response.status === 401) {
          setState({ status: 'unauthenticated' });
          router.replace('/sign-in');
          router.refresh();
          return;
        }
        if (response.redirected) throw new Error('Collection unavailable');
        if (kind === 'brews' && response.status === 404) {
          setState({ status: 'unavailable' });
          return;
        }
        if (response.status !== 200) throw new Error('Collection unavailable');
        const body: unknown = await response.json();
        if (!active) return;
        if (kind === 'coffees') {
          const data = coffeeListResponseSchema.parse(body);
          if (
            data.pagination.limit !== 20 ||
            data.pagination.offset !== 0 ||
            data.coffees.length > 20
          )
            throw new Error('Unexpected page');
          setState({
            status: 'ready',
            coffees: data.coffees,
            brews: [],
            hasMore: data.pagination.hasMore,
          });
        } else {
          const data = brewListResponseSchema.parse(body);
          if (
            data.pagination.limit !== 20 ||
            data.pagination.offset !== offset ||
            data.brews.length > 20 ||
            new Set(data.brews.map((brew) => brew.id)).size !== data.brews.length
          )
            throw new Error('Unexpected page');
          setState({
            status: 'ready',
            coffees: [],
            brews: data.brews,
            hasMore: data.pagination.hasMore,
          });
        }
      } catch {
        if (active) setState({ status: 'error' });
      } finally {
        if (active) clearTimeout(timer);
      }
    }
    void load();
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [kind, attempt, offset, router]);

  return (
    <section
      className="collection"
      aria-labelledby="collection-title"
      aria-busy={state.status === 'loading'}
    >
      <h2 id="collection-title">{kind === 'coffees' ? 'On your shelf' : 'Your brew history'}</h2>
      <p className="collection-note">
        {kind === 'brews'
          ? 'Paged saved records, up to 20 at a time. Pages can shift with concurrent changes. History offsets are limited to 100,000.'
          : state.status === 'ready' && state.hasMore
            ? 'Only the 20 most recent records are shown.'
            : 'Your recent saved records, up to 20.'}
      </p>
      {state.status === 'loading' && <p role="status">Loading your {kind}…</p>}
      {state.status === 'unauthenticated' && <p role="status">Returning to sign in…</p>}
      {state.status === 'unavailable' && <p role="alert">Your brew history is unavailable.</p>}
      {state.status === 'error' && (
        <div>
          <p role="alert">We couldn’t load your {kind}. Please try again.</p>
          <Button
            variant="secondary"
            onClick={() => {
              invalidate.current?.();
              setState({ status: 'loading' });
              setAttempt((value) => value + 1);
            }}
          >
            Try again
          </Button>
        </div>
      )}
      {state.status === 'ready' && state.coffees.length === 0 && state.brews.length === 0 && (
        <div className="collection-empty">
          <p>
            {kind === 'coffees'
              ? 'No coffees yet'
              : offset
                ? 'No brews on this page.'
                : 'No brews yet'}
          </p>
          {kind === 'brews' && offset === 0 && (
            <>
              <p>Your first brew starts here. Record a recipe and what you noticed.</p>
              <a className="cm-button" href="/app/brews/new">
                Record a brew
              </a>
            </>
          )}
        </div>
      )}
      {state.status === 'ready' && (
        <ul className="collection-list">
          {state.coffees.map((coffee) => (
            <li className="collection-row" key={coffee.id}>
              <p className="coffee-roaster">{coffee.roaster}</p>
              <h3>{coffee.name}</h3>
              {(coffee.country || coffee.process) && (
                <p className="collection-note">
                  {[coffee.country, coffee.process].filter(Boolean).join(' · ')}
                </p>
              )}
              {coffee.roastDate && (
                <p className="collection-note">
                  Roasted <time dateTime={coffee.roastDate}>{coffee.roastDate}</time>
                </p>
              )}
              {coffee.tastingNotes.length > 0 && (
                <ul className="descriptor-list" aria-label="Roaster tasting notes">
                  {coffee.tastingNotes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
          {state.brews.map((brew) => (
            <li className="collection-row brew-row" key={brew.id}>
              <div>
                <h3>{brew.brewer}</h3>
                <time dateTime={brew.brewedAt}>
                  {new Date(brew.brewedAt).toLocaleString(undefined, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </time>
                <p className="collection-note">
                  {brew.grinder} · {brew.grindSetting} grind · {brew.waterTemperatureC}°C · 1:
                  {(brew.waterGrams / brew.doseGrams).toFixed(2)} · {brew.totalBrewTimeSeconds}s
                  including drawdown
                </p>
                <p className="collection-note">
                  Acidity {brew.acidity === null ? 'Not rated' : `${brew.acidity.toFixed(2)}/10`} ·
                  Body {brew.body === null ? 'Not rated' : `${brew.body.toFixed(2)}/10`} ·
                  Aftertaste{' '}
                  {brew.aftertaste === null ? 'Not rated' : `${brew.aftertaste.toFixed(2)}/10`}
                </p>
                <a
                  className="cm-button cm-button--secondary"
                  href={`/app/brews/${brew.id}`}
                  aria-label={`View brew · ${brew.brewer} · ${new Date(brew.brewedAt).toLocaleString()} · ${brew.id}`}
                >
                  View brew
                </a>
                <a
                  className="cm-button cm-button--secondary"
                  href={`/app/brews/${brew.id}/tasting`}
                  aria-label={`Edit tasting · ${brew.brewer} · ${new Date(brew.brewedAt).toLocaleString()} · ${brew.id}`}
                >
                  Edit tasting
                </a>
              </div>
              <p className="brew-score">
                <span className="visually-hidden">Overall score </span>
                {brew.overallScore.toFixed(2)}
                <span className="collection-note">/100</span>
              </p>
            </li>
          ))}
        </ul>
      )}
      {kind === 'brews' && (
        <div className="brew-segment" role="group" aria-label="History pages">
          <Button
            variant="secondary"
            disabled={
              offset === 0 || state.status === 'loading' || state.status === 'unauthenticated'
            }
            onClick={() => page(offset - 20)}
          >
            Previous
          </Button>
          <Button
            variant="secondary"
            disabled={state.status !== 'ready' || !state.hasMore || offset === 100000}
            onClick={() => page(offset + 20)}
          >
            Next
          </Button>
        </div>
      )}
    </section>
  );
}
