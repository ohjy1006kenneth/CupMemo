'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@cupmemo/ui';
import {
  brewIdSchema,
  brewResponseSchema,
  coffeeResponseSchema,
  type Brew,
  type Coffee,
} from '@cupmemo/contracts';
import { qualities } from './brew-draft';

type Read<T> = { status: 'loading' | 'error' | 'unavailable' } | { status: 'ready'; value: T };
export function BrewDetail({ id }: { id: string }) {
  return <DetailRequest key={id} id={brewIdSchema.safeParse(id).success ? id : null} />;
}
function DetailRequest({ id }: { id: string | null }) {
  const router = useRouter();
  const [brew, setBrew] = useState<Read<Brew>>({ status: id ? 'loading' : 'unavailable' });
  const [coffee, setCoffee] = useState<Read<Coffee>>({ status: 'loading' });
  const [brewAttempt, setBrewAttempt] = useState(0);
  const [coffeeAttempt, setCoffeeAttempt] = useState(0);
  const [terminal, setTerminal] = useState(false);
  const cancelBrew = useRef<(() => void) | null>(null);
  const cancelCoffee = useRef<(() => void) | null>(null);
  function signin() {
    cancelBrew.current?.();
    cancelCoffee.current?.();
    setBrew({ status: 'unavailable' });
    setCoffee({ status: 'unavailable' });
    setTerminal(true);
    router.replace('/sign-in');
    router.refresh();
  }
  useEffect(() => {
    if (!id || terminal) return;
    let active = true;
    const controller = new AbortController();
    const stop = () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
    const failed = () => {
      if (active) {
        stop();
        setBrew({ status: 'error' });
      }
    };
    const timer = setTimeout(failed, 3000);
    cancelBrew.current = stop;
    setBrew({ status: 'loading' });
    setCoffee({ status: 'loading' });
    async function load() {
      try {
        const response = await fetch(`/api/v1/brews/${id}`, {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
          redirect: 'error',
          signal: controller.signal,
        });
        if (!active) return;
        if (response.redirected) {
          failed();
          return;
        }
        if (response.status === 401) {
          signin();
          return;
        }
        if (response.status === 404) {
          stop();
          setBrew({ status: 'unavailable' });
          return;
        }
        if (response.status !== 200) {
          failed();
          return;
        }
        const body: unknown = await response.json();
        if (!active) return;
        const parsed = brewResponseSchema.safeParse(body);
        if (!parsed.success || parsed.data.brew.id !== id) {
          failed();
          return;
        }
        stop();
        setBrew({ status: 'ready', value: parsed.data.brew });
      } catch {
        failed();
      }
    }
    void load();
    return stop;
  }, [id, brewAttempt, terminal]);
  const coffeeId = brew.status === 'ready' ? brew.value.coffeeId : null;
  useEffect(() => {
    if (!coffeeId || terminal) return;
    let active = true;
    const controller = new AbortController();
    const stop = () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
    const failed = () => {
      if (active) {
        stop();
        setCoffee({ status: 'error' });
      }
    };
    const timer = setTimeout(failed, 3000);
    cancelCoffee.current = stop;
    setCoffee({ status: 'loading' });
    async function load() {
      try {
        const response = await fetch(`/api/v1/coffees/${coffeeId}`, {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
          redirect: 'error',
          signal: controller.signal,
        });
        if (!active) return;
        if (response.redirected) {
          failed();
          return;
        }
        if (response.status === 401) {
          signin();
          return;
        }
        if (response.status === 404) {
          stop();
          setCoffee({ status: 'unavailable' });
          return;
        }
        if (response.status !== 200) {
          failed();
          return;
        }
        const body: unknown = await response.json();
        if (!active) return;
        const parsed = coffeeResponseSchema.safeParse(body);
        if (!parsed.success || parsed.data.coffee.id !== coffeeId) {
          failed();
          return;
        }
        stop();
        setCoffee({ status: 'ready', value: parsed.data.coffee });
      } catch {
        failed();
      }
    }
    void load();
    return stop;
  }, [coffeeId, coffeeAttempt, terminal]);
  const b = brew.status === 'ready' ? brew.value : null;
  return (
    <div className="brew-entry brew-detail">
      <h1>Your brew</h1>
      {terminal ? (
        <p role="status">Returning to sign in…</p>
      ) : (
        <>
          {brew.status === 'loading' && <p role="status">Loading your brew…</p>}
          {brew.status === 'unavailable' && <p role="alert">This brew is unavailable.</p>}
          {brew.status === 'error' && (
            <>
              <p role="alert">Your brew could not be loaded.</p>
              <Button
                variant="secondary"
                onClick={() => {
                  cancelBrew.current?.();
                  cancelCoffee.current?.();
                  setBrew({ status: 'loading' });
                  setCoffee({ status: 'loading' });
                  setBrewAttempt((v) => v + 1);
                }}
              >
                Retry brew
              </Button>
            </>
          )}
          {b && (
            <>
              <section aria-labelledby="coffee-context-heading">
                <h2 id="coffee-context-heading">Your coffee</h2>
                {coffee.status === 'loading' && <p role="status">Loading coffee context…</p>}
                {coffee.status === 'ready' && (
                  <>
                    <p className="coffee-roaster">{coffee.value.roaster}</p>
                    <h3>{coffee.value.name}</h3>
                  </>
                )}
                {(coffee.status === 'error' || coffee.status === 'unavailable') && (
                  <>
                    <p role="alert">Coffee context is unavailable.</p>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        cancelCoffee.current?.();
                        setCoffee({ status: 'loading' });
                        setCoffeeAttempt((v) => v + 1);
                      }}
                    >
                      Retry coffee context
                    </Button>
                  </>
                )}
              </section>
              <time dateTime={b.brewedAt}>
                {new Date(b.brewedAt).toLocaleString(undefined, {
                  dateStyle: 'medium',
                  timeStyle: 'medium',
                })}
              </time>
              <section aria-labelledby="recipe-heading">
                <h2 id="recipe-heading">Recipe</h2>
                <dl className="brew-facts">
                  <dt>Brewer</dt>
                  <dd>{b.brewer}</dd>
                  <dt>Grinder</dt>
                  <dd>{b.grinder}</dd>
                  <dt>Grind setting</dt>
                  <dd>{b.grindSetting}</dd>
                  <dt>Coffee dose</dt>
                  <dd>{b.doseGrams} g</dd>
                  <dt>Water</dt>
                  <dd>{b.waterGrams} g</dd>
                  <dt>Temperature</dt>
                  <dd>{b.waterTemperatureC}°C</dd>
                  <dt>Derived ratio</dt>
                  <dd>1:{(b.waterGrams / b.doseGrams).toFixed(2)}</dd>
                  <dt>Total brew time</dt>
                  <dd>{b.totalBrewTimeSeconds} seconds including drawdown</dd>
                </dl>
                <h3>Your pours</h3>
                <ol className="brew-detail-pours">
                  {b.pours.map((p, i) => (
                    <li key={p.position}>
                      Pour {i + 1}: +{p.waterGrams} g at {p.startTimeSeconds}s · Scale target{' '}
                      {b.pours
                        .slice(0, i + 1)
                        .reduce((sum, pour) => sum + Math.round(pour.waterGrams * 100), 0) /
                        100}{' '}
                      g
                    </li>
                  ))}
                </ol>
              </section>
              <section aria-labelledby="assessment-heading">
                <h2 id="assessment-heading">Tasting</h2>
                <p>Overall score</p>
                <p className="brew-score">{b.overallScore.toFixed(2)} /100</p>
                <p>Saved mode: {b.tastingMode}</p>
                <p className="field-hint">
                  Optional quality /10. Your overall /100 score is independent.
                </p>
                <dl className="brew-facts">
                  {qualities.map(([key, label]) => (
                    <div key={key}>
                      <dt>{label}</dt>
                      <dd>{b[key] === null ? 'Not rated' : `${b[key].toFixed(2)} /10`}</dd>
                    </div>
                  ))}
                </dl>
                <ul className="descriptor-list" aria-label="Tasting tags">
                  {b.tastingTags.map((tag) => (
                    <li key={tag}>{tag}</li>
                  ))}
                </ul>
                <h3>Written notes</h3>
                <p className="brew-written-notes">{b.notes ?? 'No tasting notes'}</p>
              </section>
              <a className="cm-button cm-button--primary" href={`/app/brews/${b.id}/tasting`}>
                Edit brew
              </a>
            </>
          )}
        </>
      )}
      <a className="cm-button cm-button--secondary" href="/app/journal">
        Return to journal
      </a>
    </div>
  );
}
