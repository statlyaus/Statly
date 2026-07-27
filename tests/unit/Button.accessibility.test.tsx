import type { AnchorHTMLAttributes, ReactNode } from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import Button from '@/components/Button';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@/hooks/useAccessibility', () => ({
  useReducedMotion: () => true,
}));

describe('Button accessibility', () => {
  it('makes a disabled link-style button inert and removes it from sequential focus', () => {
    const onClick = vi.fn();
    render(
      <Button href="/dashboard" disabled onClick={onClick}>
        Dashboard
      </Button>
    );

    const button = screen.getByRole('button', { name: 'Dashboard' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAttribute('tabindex', '-1');
    expect(button).toHaveClass('cursor-not-allowed', 'opacity-50');

    fireEvent.click(button);

    expect(onClick).not.toHaveBeenCalled();
  });

  it('makes a loading link-style button inert', () => {
    const onClick = vi.fn();
    render(
      <Button href="/dashboard" loading loadingText="Opening dashboard" onClick={onClick}>
        Dashboard
      </Button>
    );

    const button = screen.getByRole('button', { name: 'Opening dashboard' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAttribute('tabindex', '-1');

    fireEvent.click(button);

    expect(onClick).not.toHaveBeenCalled();
  });

  it('preserves activation and keyboard focus for an enabled link-style button', () => {
    const onClick = vi.fn();
    render(
      <Button href="#dashboard" onClick={onClick}>
        Dashboard
      </Button>
    );

    const button = screen.getByRole('button', { name: 'Dashboard' });
    expect(button).toHaveAttribute('aria-disabled', 'false');
    expect(button).not.toHaveAttribute('tabindex', '-1');

    fireEvent.click(button);

    expect(onClick).toHaveBeenCalledOnce();
  });

  it('preserves native disabled-button behavior', () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Save
      </Button>
    );

    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toBeDisabled();

    fireEvent.click(button);

    expect(onClick).not.toHaveBeenCalled();
  });
});
