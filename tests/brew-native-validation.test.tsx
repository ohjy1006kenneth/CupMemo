// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { QuickTastingEditor } from '../apps/web/src/components/quick-tasting-editor';
afterEach(cleanup);
it('native invalid quarter feedback focuses the overall control and authors inline error and alert', () => {
  render(
    <QuickTastingEditor
      assessment={{
        overallScore: '87.1',
        acidity: null,
        body: null,
        aftertaste: null,
        tastingTags: [],
        notes: '',
      }}
      onChange={vi.fn()}
      pending={false}
      locked={false}
      errors={{}}
      onSubmit={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save brew & tasting' }));
  expect(screen.getByLabelText('Overall score /100 (required)')).toHaveFocus();
  expect(screen.getByRole('alert')).toHaveTextContent('Check your score');
  expect(screen.getByText('Enter an overall score from 0–100 in quarter points.')).toBeVisible();
});
