'use client';

import { useCallback, useEffect, useState } from 'react';

type Status = 'loading' | 'success' | 'failure';

export function ApiStatus() {
  const [status, setStatus] = useState<Status>('loading');
  const [attempt, setAttempt] = useState(0);

  const checkApi = useCallback(async (signal: AbortSignal) => {
    setStatus('loading');
    try {
      const response = await fetch('/api/v1/health', { signal, cache: 'no-store' });
      if (!response.ok) throw new Error('API unavailable');
      const body: unknown = await response.json();
      if (
        typeof body !== 'object' ||
        body === null ||
        !('status' in body) ||
        body.status !== 'ok'
      ) {
        throw new Error('Unexpected API response');
      }
      setStatus('success');
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setStatus('failure');
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void checkApi(controller.signal);
    return () => controller.abort();
  }, [attempt, checkApi]);

  const labels: Record<Status, string> = {
    loading: 'Checking API connection…',
    success: 'API connected',
    failure: 'API unavailable',
  };

  return (
    <section className="status-panel" aria-labelledby="connection-heading" aria-live="polite">
      <h2 id="connection-heading">Development API status</h2>
      <p data-status={status} role="status">
        {labels[status]}
      </p>
      {status === 'failure' && <p>Start the API service, then retry the connection.</p>}
      <button
        className="retry-button"
        type="button"
        onClick={() => setAttempt((value) => value + 1)}
      >
        Retry connection
      </button>
    </section>
  );
}
