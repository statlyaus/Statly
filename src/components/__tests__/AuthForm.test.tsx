import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import AuthForm from '../AuthForm';
import { useAuth } from '@/AuthContext';

// Mock the AuthContext
vi.mock('@/AuthContext', () => ({
  useAuth: vi.fn(),
}));

// Mock useRouter
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

// Mock useNotification
vi.mock('@/hooks/useNotification', () => ({
  useNotification: () => ({
    notification: null,
    showNotification: vi.fn(),
  }),
  NotificationToast: ({ notification }: { notification: any }) => null,
}));

const mockAuthContext = {
  user: null,
  loading: false,
  login: vi.fn(),
  signup: vi.fn(),
  logout: vi.fn(),
  loginWithGoogle: vi.fn(),
  loginWithFacebook: vi.fn(),
  loginWithApple: vi.fn(),
};

describe('AuthForm', () => {
  beforeEach(() => {
    (useAuth as any).mockReturnValue(mockAuthContext);
  });

  it('shows mode switch by default in login mode', () => {
    render(<AuthForm initialMode="login" />);
    
    // Should show "Don't have an account? Sign up" text
    expect(screen.getByText("Don't have an account?")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign up' })).toBeInTheDocument();
  });

  it('shows mode switch by default in signup mode', () => {
    render(<AuthForm initialMode="signup" />);
    
    // Should show "Already have an account? Sign in" text
    expect(screen.getByText('Already have an account?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('hides mode switch when showModeSwitch is false in login mode', () => {
    render(<AuthForm initialMode="login" showModeSwitch={false} />);
    
    // Should NOT show the mode switch
    expect(screen.queryByText("Don't have an account?")).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign up' })).not.toBeInTheDocument();
  });

  it('hides mode switch when showModeSwitch is false in signup mode', () => {
    render(<AuthForm initialMode="signup" showModeSwitch={false} />);
    
    // Should NOT show the mode switch
    expect(screen.queryByText('Already have an account?')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('maintains proper form functionality when mode switch is hidden', () => {
    render(<AuthForm initialMode="login" showModeSwitch={false} />);
    
    // Should still show the main form elements
    expect(screen.getByLabelText('Email Address')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
    
    // Should show social login buttons
    expect(screen.getByText('Continue with Google')).toBeInTheDocument();
    expect(screen.getByText('Continue with Facebook')).toBeInTheDocument();
    expect(screen.getByText('Continue with Apple')).toBeInTheDocument();
  });

  it('maintains proper accessibility when mode switch is hidden', () => {
    render(<AuthForm initialMode="login" showModeSwitch={false} />);
    
    // Form should still be accessible
    const emailInput = screen.getByLabelText('Email Address');
    const passwordInput = screen.getByLabelText('Password');
    const submitButton = screen.getByRole('button', { name: 'Sign In' });
    
    expect(emailInput).toBeRequired();
    expect(passwordInput).toBeRequired();
    expect(submitButton).toHaveAttribute('type', 'submit');
  });
});
