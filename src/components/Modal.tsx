'use client';

import type { ReactNode, ComponentProps } from 'react';
import UIModal from '@/components/ui/Modal';
// Adapter to keep legacy imports working while using the enhanced UI Modal
interface LegacyModalProps
  extends Omit<ComponentProps<typeof UIModal>, 'isOpen' | 'onClose' | 'children'> {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

/**
 * @deprecated Removed in v1.4.0 (2025-09-30).
 * Migration: Use UI Modal props directly — replace `ModalProps` with `ComponentProps<typeof UIModal>` from `@/components/ui/Modal`.
 */
export type ModalProps = LegacyModalProps;

export default function Modal({ open, onClose, children, ...rest }: LegacyModalProps) {
  return (
    <UIModal isOpen={open} onClose={onClose} {...rest}>
      {children}
    </UIModal>
  );
}
