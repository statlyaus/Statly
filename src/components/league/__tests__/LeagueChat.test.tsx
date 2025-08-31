import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import LeagueChat from '../LeagueChat';

// Mock framer-motion
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
}));

// Mock heroicons
vi.mock('@heroicons/react/24/outline', () => ({
  ChatBubbleBottomCenterTextIcon: ({ className }: { className?: string }) => 
    <div data-testid="chat-icon" className={className} />,
  UserIcon: ({ className }: { className?: string }) => 
    <div data-testid="user-icon" className={className} />,
  PaperAirplaneIcon: ({ className }: { className?: string }) => 
    <div data-testid="send-icon" className={className} />,
}));

describe('LeagueChat', () => {
  it('renders chat component for authenticated user with canSend=true', () => {
    render(
      <LeagueChat 
        leagueId="league-123" 
        currentUserId="user-123" 
        canSend={true} 
      />
    );
    
    expect(screen.getByText('League Chat')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Type a message...')).toBeInTheDocument();
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('renders chat component for guest user with canSend=false', () => {
    render(
      <LeagueChat 
        leagueId="league-123" 
        currentUserId={undefined} 
        canSend={false} 
      />
    );
    
    expect(screen.getByText('League Chat')).toBeInTheDocument();
    expect(screen.getByText('Sign in to participate in chat')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Type a message...')).not.toBeInTheDocument();
  });

  it('disables sending when canSend is false even with userId', () => {
    render(
      <LeagueChat 
        leagueId="league-123" 
        currentUserId="user-123" 
        canSend={false} 
      />
    );
    
    expect(screen.getByText('You cannot send messages in this chat')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Type a message...')).not.toBeInTheDocument();
  });

  it('creates user-specific ref only when currentUserId is defined', () => {
    const { rerender } = render(
      <LeagueChat 
        leagueId="league-123" 
        currentUserId={undefined} 
        canSend={false} 
      />
    );
    
    // With guest user, user-specific div should not be present
    expect(screen.queryByTestId('user-specific-ref')).not.toBeInTheDocument();
    
    // Rerender with authenticated user
    rerender(
      <LeagueChat 
        leagueId="league-123" 
        currentUserId="user-123" 
        canSend={true} 
      />
    );
    
    // Now user-specific div should be present (but hidden)
    expect(document.querySelector('[style*="display: none"]')).toBeInTheDocument();
  });

  it('handles message sending when form is submitted', () => {
    render(
      <LeagueChat 
        leagueId="league-123" 
        currentUserId="user-123" 
        canSend={true} 
      />
    );
    
    const input = screen.getByPlaceholderText('Type a message...');
    const submitButton = screen.getByRole('button');
    
    // Type a message
    fireEvent.change(input, { target: { value: 'Hello world!' } });
    expect(input).toHaveValue('Hello world!');
    
    // Submit the form
    fireEvent.click(submitButton);
    
    // Input should be cleared after submission
    expect(input).toHaveValue('');
  });

  it('displays mock messages correctly', () => {
    render(
      <LeagueChat 
        leagueId="league-123" 
        currentUserId="user-123" 
        canSend={true} 
      />
    );
    
    // Check that mock messages are displayed
    expect(screen.getByText('Good luck everyone this season!')).toBeInTheDocument();
    expect(screen.getByText('Anyone else targeting Bontempelli early?')).toBeInTheDocument();
    expect(screen.getByText('Draft is tomorrow! Ready to dominate 🏆')).toBeInTheDocument();
  });
});