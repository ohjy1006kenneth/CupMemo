// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef, useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import * as UI from '@cupmemo/ui';

afterEach(cleanup);

it('provides a native non-submitting button with forwarded ref and callbacks', () => {
  expect(typeof UI.Button).toBe('function');
  const ref = createRef<HTMLButtonElement>();
  const click = vi.fn();
  const submit = vi.fn((event) => event.preventDefault());
  render(
    <form onSubmit={submit}>
      <UI.Button ref={ref} onClick={click} name="action" className="caller">
        Continue
      </UI.Button>
    </form>,
  );
  const button = screen.getByRole('button', { name: 'Continue' });
  expect(ref.current).toBe(button);
  expect(button).toHaveAttribute('type', 'button');
  expect(button).toHaveAttribute('name', 'action');
  expect(button).toHaveClass('caller');
  button.focus();
  expect(button).toHaveFocus();
  fireEvent.click(button);
  expect(click).toHaveBeenCalledOnce();
  expect(submit).not.toHaveBeenCalled();
});

it('supports explicit submit and native disabled behavior for all variants', () => {
  const submit = vi.fn((event) => event.preventDefault());
  const click = vi.fn();
  render(
    <form onSubmit={submit}>
      <UI.Button type="submit">Save</UI.Button>
      <UI.Button variant="secondary" disabled onClick={click}>
        Unavailable
      </UI.Button>
      <UI.Button variant="ghost" title="Help">
        Help
      </UI.Button>
    </form>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(submit).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Unavailable' }));
  expect(click).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Unavailable' })).toBeDisabled();
  expect(screen.getByTitle('Help')).toHaveClass('cm-button--ghost');
});

it('forwards controlled input changes, ref, focus, constraints and error associations', () => {
  expect(typeof UI.Input).toBe('function');
  const ref = createRef<HTMLInputElement>();
  const change = vi.fn();
  function Controlled() {
    const [value, setValue] = useState('');
    return (
      <>
        <label htmlFor="email">Email</label>
        <UI.Input
          ref={ref}
          id="email"
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="email"
          aria-invalid="true"
          aria-describedby="error"
          value={value}
          onChange={(event) => {
            change(event.target.value);
            setValue(event.target.value);
          }}
        />
        <p id="error">Check email.</p>
      </>
    );
  }
  render(<Controlled />);
  const input = screen.getByLabelText('Email') as HTMLInputElement;
  expect(ref.current).toBe(input);
  input.focus();
  expect(input).toHaveFocus();
  expect(input.validity.valueMissing).toBe(true);
  fireEvent.change(input, { target: { value: 'invalid' } });
  expect(change).toHaveBeenCalledWith('invalid');
  expect(input.value).toBe('invalid');
  expect(input.validity.typeMismatch).toBe(true);
  expect(input).toHaveAttribute('maxlength', '254');
  expect(input).toHaveAttribute('autocomplete', 'email');
  expect(input).toHaveAccessibleDescription('Check email.');
});

it('preserves uncontrolled input values, numeric constraints and disabled state', () => {
  render(
    <UI.Input
      aria-label="Dose"
      type="number"
      min={1}
      max={100}
      step={0.5}
      defaultValue={15}
      disabled
    />,
  );
  const input = screen.getByRole('spinbutton') as HTMLInputElement;
  expect(input.value).toBe('15');
  expect(input.min).toBe('1');
  expect(input.max).toBe('100');
  expect(input.step).toBe('0.5');
  expect(input).toBeDisabled();
});

it('renders a caller-labelled native section and forwards its ref and props', () => {
  expect(typeof UI.Card).toBe('function');
  const ref = createRef<HTMLElement>();
  render(
    <UI.Card ref={ref} aria-labelledby="heading" className="caller" id="card">
      <h2 id="heading">Account</h2>
    </UI.Card>,
  );
  const card = screen.getByRole('region', { name: 'Account' });
  expect(card.tagName).toBe('SECTION');
  expect(ref.current).toBe(card);
  expect(card.id).toBe('card');
  expect(card).toHaveClass('caller');
});

it('renders labelled native navigation with real destinations and current-page semantics', () => {
  expect(typeof UI.Navigation).toBe('function');
  expect(typeof UI.NavigationLink).toBe('function');
  const navRef = createRef<HTMLElement>();
  const linkRef = createRef<HTMLAnchorElement>();
  const click = vi.fn((event) => event.preventDefault());
  const { container } = render(
    <UI.Navigation ref={navRef} aria-label="Example navigation" className="caller">
      <UI.NavigationLink ref={linkRef} href="#current" current onClick={click} title="Current">
        Current
      </UI.NavigationLink>
      <UI.NavigationLink href="#other" current={false} className="other">
        Other
      </UI.NavigationLink>
    </UI.Navigation>,
  );
  const nav = screen.getByRole('navigation', { name: 'Example navigation' });
  const link = screen.getByRole('link', { name: 'Current' });
  expect(navRef.current).toBe(nav);
  expect(linkRef.current).toBe(link);
  expect(link).toHaveAttribute('href', '#current');
  expect(link).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('link', { name: 'Other' })).not.toHaveAttribute('aria-current');
  expect(screen.getByRole('link', { name: 'Other' })).toHaveClass('other');
  link.focus();
  expect(link).toHaveFocus();
  fireEvent.click(link);
  expect(click).toHaveBeenCalledOnce();
  expect(container.querySelector('a button, button a, a a, [role="tab"]')).toBeNull();
});
