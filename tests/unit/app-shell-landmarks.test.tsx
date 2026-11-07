import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AppLayout from '@/components/navigation/AppLayout';

const mocks = vi.hoisted(() => ({
  pathname: '/leagues',
  user: { uid: 'user-1', displayName: 'Robert', email: 'robert@example.test' } as {
    uid: string;
    displayName: string;
    email: string;
  } | null,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('next/image', () => ({
  default: ({ alt }: { alt: string }) => <span role="img" aria-label={alt} />,
}));

vi.mock('@/AuthContext', () => ({
  useAuth: () => ({ user: mocks.user, logout: vi.fn(), loading: false }),
}));

vi.mock('@/components/PlayerSearch', () => ({
  default: () => <input aria-label="Search players" />,
}));

vi.mock('@/components/navigation/LeagueSwitcher', () => ({
  default: () => <div>League switcher</div>,
}));

function renderShell() {
  return render(
    <AppLayout>
      <div>Route content</div>
    </AppLayout>
  );
}

describe('app shell landmarks', () => {
  beforeEach(() => {
    mocks.pathname = '/leagues';
  });

  it('renders exactly one main element and points the skip link at it', () => {
    renderShell();

    const mains = screen.getAllByRole('main');
    expect(mains).toHaveLength(1);
    expect(mains[0].tagName).toBe('MAIN');
    expect(mains[0]).toHaveAttribute('id', 'main-content');
    expect(mains[0]).toHaveTextContent('Route content');
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute(
      'href',
      '#main-content'
    );
  });

  it('exposes the primary navigation as a navigation landmark', () => {
    renderShell();

    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: /Tools/ })).toBeInTheDocument();
  });
});

describe('Tools menu', () => {
  beforeEach(() => {
    mocks.pathname = '/leagues';
  });

  it('reports its expanded state and controls the menu it opens', () => {
    renderShell();

    const trigger = screen.getByRole('button', { name: /Tools/ });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const menuId = trigger.getAttribute('aria-controls');
    expect(menuId).toBeTruthy();
    expect(document.getElementById(menuId as string)).toBeInTheDocument();

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes on Escape and returns focus to the trigger', () => {
    renderShell();

    const trigger = screen.getByRole('button', { name: /Tools/ });
    fireEvent.click(trigger);
    const menuId = trigger.getAttribute('aria-controls') as string;
    const firstItem = document.getElementById(menuId)?.querySelector('a');
    firstItem?.focus();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });

    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });

  it('closes on an outside click', () => {
    renderShell();

    const trigger = screen.getByRole('button', { name: /Tools/ });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    fireEvent.mouseDown(screen.getByText('Route content'));

    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('app route pages', () => {
  it('leave the main landmark to the app layout', () => {
    const appDir = join(process.cwd(), 'src/app/(app)');
    const layoutPath = join(appDir, 'layout.tsx');
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(path);
        } else if (/\.(tsx|jsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          if (path !== layoutPath && /<main[\s>]/.test(readFileSync(path, 'utf8'))) {
            offenders.push(relative(process.cwd(), path));
          }
        }
      }
    };
    walk(appDir);

    expect(offenders).toEqual([]);
  });
});
