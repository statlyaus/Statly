'use client';

import type { ReactNode } from 'react';
import { useEffect } from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

export default function Modal({ open, onClose, children }: ModalProps) {
  // Handle Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (open) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop button for closing */}
      <button
        className="absolute inset-0 w-full h-full bg-transparent cursor-default"
        onClick={onClose}
        aria-label="Close modal"
        tabIndex={-1}
      />
      <div className="relative bg-white p-4 rounded shadow max-w-sm w-full" role="document">
        {children}
      </div>
    </div>
  );
}
