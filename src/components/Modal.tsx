'use client';

import type { ReactNode } from 'react';
import UIModal from '@/components/ui/Modal';

// Adapter to keep legacy imports working while using the enhanced UI Modal
interface LegacyModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

export default function Modal({ open, onClose, children }: LegacyModalProps) {
  return (
    <UIModal isOpen={open} onClose={onClose}>
      {children}
    </UIModal>
  );
}
