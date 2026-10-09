'use client';

import { useEffect, useState } from 'react';
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
  | { status: 'loading' | 'error' | 'unauthenticated' }
  | { status: 'ready'; coffees: Coffee[]; brews: Brew[]; hasMore: boolean };

export function CollectionView({ kind }: { kind: Kind }) {
  // A destination change cannot render rows belonging to the previous view.
  return <CollectionRequest key={kind} kind={kind} />;
}

function CollectionRequest({ kind }: { kind: Kind }) {
  const router = useRouter();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<State>({ status: 'loading' });
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
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
            : '/api/v1/brews?limit=20&offset=0';
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
        if (!response.ok || response.redirected) throw new Error('Collection unavailable');
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
            data.pagination.offset !== 0 ||
            data.brews.length > 20
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
  }, [kind, attempt, router]);

  return (
    <section
      className="collection"
      aria-labelledby="collection-title"
      aria-busy={state.status === 'loading'}
    >
      <h2 id="collection-title">{kind === 'coffees' ? 'On your shelf' : 'Recent brews'}</h2>
      <p className="collection-note">
        {state.status === 'ready' && state.hasMore
          ? 'Only the 20 most recent records are shown.'
          : 'Your recent saved records, up to 20.'}
      </p>
      {state.status === 'loading' && <p role="status">Loading your {kind}…</p>}
      {state.status === 'unauthenticated' && <p role="status">Returning to sign in…</p>}
      {state.status === 'error' && (
        <div>
          <p role="alert">We couldn’t load your {kind}. Please try again.</p>
          <Button
            variant="secondary"
            onClick={() => {
              setState({ status: 'loading' });
              setAttempt((value) => value + 1);
            }}
          >
            Try again
          </Button>
        </div>
      )}
      {state.status === 'ready' && state.coffees.length === 0 && state.brews.length === 0 && (
        <p className="collection-empty">{kind === 'coffees' ? 'No coffees yet' : 'No brews yet'}</p>
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
    </section>
  );
}
