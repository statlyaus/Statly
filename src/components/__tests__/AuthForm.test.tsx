import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  NotificationToast: () => null,
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

  afterEach(() => {
    vi.resetAllMocks();
    vi.restoreAllMocks();
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

  it('shows authenticated UI when user is logged in', () => {
    const authenticatedMockContext = {
      ...mockAuthContext,
      user: {
        uid: 'test-user-id',
        email: 'test@example.com',
        displayName: 'Test User',
        photoURL: null,
        emailVerified: true,
        metadata: {
          creationTime: '2023-01-01T00:00:00.000Z',
          lastSignInTime: '2023-06-01T00:00:00.000Z'
        }
      }
    };
    
    (useAuth as any).mockReturnValue(authenticatedMockContext);
    
    render(<AuthForm initialMode="login" />);
    
    // Should show authenticated UI
    expect(screen.getByText('Welcome back!')).toBeInTheDocument();
    expect(screen.getByText('Test User')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign Out' })).toBeInTheDocument();
    expect(screen.getByText('Authenticated')).toBeInTheDocument();
  });

  it('handles form submission with valid credentials', async () => {
    const user = userEvent.setup();
    const mockLogin = vi.fn().mockResolvedValue(undefined);
    const mockOnSuccess = vi.fn();
    
    (useAuth as any).mockReturnValue({
      ...mockAuthContext,
      login: mockLogin
    });

    render(<AuthForm initialMode="login" onSuccess={mockOnSuccess} />);

    // Fill in valid credentials
    await user.type(screen.getByLabelText('Email Address'), 'test@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');

    // Submit form
    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('test@example.com', 'password123');
    });
  });

  it('shows validation errors for empty email and password', async () => {
    const user = userEvent.setup();
    
    render(<AuthForm initialMode="login" />);

    // Try to submit without filling anything
    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(screen.getByText('Email is required')).toBeInTheDocument();
      expect(screen.getByText('Password is required')).toBeInTheDocument();
    });
  });

  it('shows validation error for invalid email format', async () => {
    const user = userEvent.setup();
    
    render(<AuthForm initialMode="login" />);

    // Enter invalid email
    await user.type(screen.getByLabelText('Email Address'), 'invalid-email');
    await user.type(screen.getByLabelText('Password'), 'password123');

    await waitFor(() => {
      expect(screen.getByText('Please enter a valid email address')).toBeInTheDocument();
    });
  });

  it('shows password strength indicator in signup mode', async () => {
    const user = userEvent.setup();
    
    render(<AuthForm initialMode="signup" />);

    const passwordInput = screen.getByLabelText('Password');
    await user.type(passwordInput, 'weak');

    expect(await screen.findByText(/Password strength/i)).toBeInTheDocument();
    // Expect exact standalone token "Weak" rather than substring
    const strengthLabel = await screen.findByText(/\bWeak\b/i);
    expect(strengthLabel).toBeInTheDocument();

    // Test stronger password
    await user.clear(passwordInput);
    await user.type(passwordInput, 'StrongPassword123!');

    await waitFor(() => expect(screen.queryByText(/\bWeak\b/i)).toBeNull());
    expect(await screen.findByText(/\bStrong\b/i)).toBeInTheDocument();
  });

  it('validates password confirmation in signup mode', async () => {
    const user = userEvent.setup();
    
    render(<AuthForm initialMode="signup" />);

    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.type(screen.getByLabelText('Confirm Password'), 'different123');

    await waitFor(() => {
      expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
    });
  });

  it('handles social login button clicks', async () => {
    const user = userEvent.setup();
    const mockLoginWithGoogle = vi.fn().mockResolvedValue(undefined);
    const mockLoginWithFacebook = vi.fn().mockResolvedValue(undefined);
    const mockLoginWithApple = vi.fn().mockResolvedValue(undefined);
    
    (useAuth as any).mockReturnValue({
      ...mockAuthContext,
      loginWithGoogle: mockLoginWithGoogle,
      loginWithFacebook: mockLoginWithFacebook,
      loginWithApple: mockLoginWithApple
    });

    render(<AuthForm initialMode="login" />);

    // Test Google login
    await user.click(screen.getByText('Continue with Google'));
    expect(mockLoginWithGoogle).toHaveBeenCalled();

    // Test Facebook login
    await user.click(screen.getByText('Continue with Facebook'));
    expect(mockLoginWithFacebook).toHaveBeenCalled();

    // Test Apple login
    await user.click(screen.getByText('Continue with Apple'));
    expect(mockLoginWithApple).toHaveBeenCalled();
  });

  it('displays error when API call fails', async () => {
    const user = userEvent.setup();
    const mockLogin = vi.fn().mockRejectedValue(new Error('Login failed'));
    
    (useAuth as any).mockReturnValue({
      ...mockAuthContext,
      login: mockLogin
    });

    render(<AuthForm initialMode="login" />);

    await user.type(screen.getByLabelText('Email Address'), 'test@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(screen.getByText('Login failed')).toBeInTheDocument();
    });
  });
});
