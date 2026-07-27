import type { HTMLAttributes, ReactNode } from 'react';
import { useState } from 'react';

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Modal from '@/components/ui/Modal';

vi.mock('framer-motion', async () => {
  const React = await vi.importActual<typeof import('react')>('react');

  type MotionDivProps = HTMLAttributes<HTMLDivElement> & {
    initial?: boolean | string;
    animate?: string;
    exit?: string;
    transition?: { duration?: number; type?: string };
    variants?: unknown;
  };

  const MotionDiv = React.forwardRef<HTMLDivElement, MotionDivProps>(
    ({ initial, animate, exit, transition, variants: _variants, ...props }, ref) => (
      <div
        ref={ref}
        data-motion-initial={initial === undefined ? undefined : String(initial)}
        data-motion-animate={animate}
        data-motion-exit={exit}
        data-motion-duration={transition?.duration}
        data-motion-type={transition?.type}
        {...props}
      />
    )
  );
  MotionDiv.displayName = 'MotionDiv';

  return {
    AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
    motion: { div: MotionDiv },
  };
});

function createMatchMediaResult(query: string, matches: boolean): MediaQueryList {
  return {
    matches,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as MediaQueryList;
}

beforeEach(() => {
  vi.spyOn(window, 'matchMedia').mockImplementation((query) =>
    createMatchMediaResult(query, false)
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

function ModalHarness() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setIsOpen(true)}>
        Open settings
      </button>
      <Modal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title="Settings"
        description="Update league settings"
      >
        <label>
          League name
          <input defaultValue="Statly League" />
        </label>
        <button type="button">Save settings</button>
      </Modal>
    </>
  );
}

describe('Modal accessibility', () => {
  it('traps focus and restores it to the opener when closed', async () => {
    render(<ModalHarness />);

    const opener = screen.getByRole('button', { name: 'Open settings' });
    opener.focus();
    fireEvent.click(opener);

    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    const closeButton = within(dialog).getByRole('button', { name: 'Close modal' });
    const saveButton = within(dialog).getByRole('button', { name: 'Save settings' });

    await waitFor(() => expect(closeButton).toHaveFocus());

    saveButton.focus();
    fireEvent.keyDown(saveButton, { key: 'Tab' });
    expect(closeButton).toHaveFocus();

    fireEvent.keyDown(closeButton, { key: 'Tab', shiftKey: true });
    expect(saveButton).toHaveFocus();

    fireEvent.click(closeButton);

    await waitFor(() => expect(opener).toHaveFocus());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('uses unique dialog, title, and description IDs', () => {
    render(
      <>
        <Modal isOpen onClose={() => undefined} title="First modal" description="First description">
          <button type="button">First action</button>
        </Modal>
        <Modal
          isOpen
          onClose={() => undefined}
          title="Second modal"
          description="Second description"
        >
          <button type="button">Second action</button>
        </Modal>
      </>
    );

    const dialogs = screen.getAllByRole('dialog');
    const [firstDialog, secondDialog] = dialogs;
    const firstTitleId = firstDialog.getAttribute('aria-labelledby');
    const secondTitleId = secondDialog.getAttribute('aria-labelledby');
    const firstDescriptionId = firstDialog.getAttribute('aria-describedby');
    const secondDescriptionId = secondDialog.getAttribute('aria-describedby');

    expect(firstDialog.id).not.toBe('');
    expect(secondDialog.id).not.toBe(firstDialog.id);
    expect(firstTitleId).not.toBe(secondTitleId);
    expect(firstDescriptionId).not.toBe(secondDescriptionId);
    expect(document.getElementById(firstTitleId ?? '')).toHaveTextContent('First modal');
    expect(document.getElementById(secondTitleId ?? '')).toHaveTextContent('Second modal');
    expect(document.getElementById(firstDescriptionId ?? '')).toHaveTextContent(
      'First description'
    );
    expect(document.getElementById(secondDescriptionId ?? '')).toHaveTextContent(
      'Second description'
    );
  });

  it('removes entrance and exit motion when reduced motion is requested', async () => {
    vi.mocked(window.matchMedia).mockImplementation((query) =>
      createMatchMediaResult(query, query === '(prefers-reduced-motion: reduce)')
    );

    render(
      <Modal isOpen onClose={() => undefined} title="Reduced motion modal">
        <button type="button">Continue</button>
      </Modal>
    );

    const dialog = screen.getByRole('dialog', { name: 'Reduced motion modal' });
    const backdrop = dialog.parentElement?.parentElement?.firstElementChild;

    await waitFor(() => expect(dialog).toHaveAttribute('data-motion-initial', 'false'));
    expect(dialog).not.toHaveAttribute('data-motion-exit');
    expect(dialog).toHaveAttribute('data-motion-duration', '0');
    expect(backdrop).not.toHaveClass('transition-opacity');
  });
});
