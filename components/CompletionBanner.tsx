import React from 'react';

type CompletionBannerProps = {
  isComplete: boolean;
  onReset?: () => void;
};

export default function CompletionBanner({ isComplete, onReset }: CompletionBannerProps) {
  if (!isComplete) return null;
  return (
    <div
      style={{
        background: '#4caf50',
        color: '#fff',
        padding: '1rem',
        textAlign: 'center',
        borderRadius: 8,
        margin: '1rem 0',
      }}
    >
      <h2>Congratulations! You’ve completed your team.</h2>
      {onReset && (
        <button
          onClick={onReset}
          style={{
            marginTop: 12,
            padding: '0.5rem 1rem',
            borderRadius: 4,
            border: 'none',
            background: '#fff',
            color: '#4caf50',
            cursor: 'pointer',
          }}
        >
          Reset Team
        </button>
      )}
    </div>
  );
}
