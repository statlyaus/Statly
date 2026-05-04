import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

import ForgotPasswordForm from './ForgotPasswordForm';

vi.mock('firebase/auth', () => ({
  sendPasswordResetEmail: vi.fn(),
}));

vi.mock('@/lib/firebaseClient', () => ({
  auth: {},
}));

describe('ForgotPasswordForm accessibility', () => {
  it('associates the visible email label with the email input', () => {
    render(<ForgotPasswordForm />);

    const emailInput = screen.getByLabelText(/email address/i);

    expect(emailInput).toHaveAttribute('id', 'email');
    expect(emailInput).toHaveAttribute('type', 'email');
  });
});
