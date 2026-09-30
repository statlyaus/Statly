import { fireEvent, render, screen } from '@testing-library/react';
import { sendPasswordResetEmail } from 'firebase/auth';
import { vi } from 'vitest';

import ForgotPasswordForm from './ForgotPasswordForm';

vi.mock('firebase/auth', () => ({ sendPasswordResetEmail: vi.fn() }));
vi.mock('@/lib/firebase/clientAuth', () => ({ auth: {} }));

const DAISY_CLASSES =
  /\b(card-body|form-control|label-text|input-bordered|alert-error|alert-success|btn-primary|base-content|bg-base-100)\b/;

function submit(email: string) {
  fireEvent.change(screen.getByLabelText('Email Address'), { target: { value: email } });
  fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
}

describe('ForgotPasswordForm', () => {
  it('styles the form with Statly tokens rather than unloaded DaisyUI classes', () => {
    const { container } = render(<ForgotPasswordForm />);

    expect(container.innerHTML).not.toMatch(DAISY_CLASSES);
    expect(screen.getByRole('button', { name: 'Send reset link' })).toHaveClass('bg-brand-bar');
    expect(screen.getByLabelText('Email Address')).toHaveAttribute('autocomplete', 'email');
  });

  it('announces the neutral confirmation after a reset request', async () => {
    vi.mocked(sendPasswordResetEmail).mockResolvedValueOnce(undefined);
    render(<ForgotPasswordForm />);

    submit('manager@example.com');

    expect(await screen.findByRole('status')).toHaveTextContent(
      'If an account exists for this email, a password reset link has been sent.'
    );
  });

  it('announces a failed reset request as an alert', async () => {
    vi.mocked(sendPasswordResetEmail).mockRejectedValueOnce(new Error('network'));
    render(<ForgotPasswordForm />);

    submit('manager@example.com');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "We couldn't send the reset link. Check your connection and try again."
    );
  });
});
