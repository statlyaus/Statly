'use client';

import React, { useEffect } from 'react';
import type { ReactNode } from 'react';

import { XMarkIcon } from '@heroicons/react/24/outline';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';

import {
  useFocusTrap,
  useEscapeKey,
  useClickOutside,
  useId,
  useReducedMotion,
} from '@/hooks/useAccessibility';

// Modal sizes
export type ModalSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'full';

// Modal variants
export type ModalVariant = 'default' | 'centered' | 'slide-over' | 'bottom-sheet';

// Modal component props
interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  size?: ModalSize;
  variant?: ModalVariant;
  closeOnOverlayClick?: boolean;
  closeOnEscape?: boolean;
  showCloseButton?: boolean;
  className?: string;
  overlayClassName?: string;
  contentClassName?: string;
  footer?: ReactNode;
  persistent?: boolean;
  zIndex?: number;
}

// Size configurations
const SIZE_CONFIG: Record<ModalSize, string> = {
  xs: 'max-w-xs',
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  full: 'max-w-full mx-4',
};

// Animation variants
const BACKDROP_VARIANTS = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

const MODAL_VARIANTS = {
  default: {
    hidden: { opacity: 0, scale: 0.95, y: 20 },
    visible: { opacity: 1, scale: 1, y: 0 },
    exit: { opacity: 0, scale: 0.95, y: 20 },
  },
  centered: {
    hidden: { opacity: 0, scale: 0.8 },
    visible: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.8 },
  },
  slideOver: {
    hidden: { opacity: 0, x: '100%' },
    visible: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: '100%' },
  },
  bottomSheet: {
    hidden: { opacity: 0, y: '100%' },
    visible: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: '100%' },
  },
};

export default function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
  size = 'md',
  variant = 'default',
  closeOnOverlayClick = true,
  closeOnEscape = true,
  showCloseButton = true,
  className = '',
  overlayClassName = '',
  contentClassName = '',
  footer,
  persistent = false,
  zIndex = 50,
}: ModalProps) {
  // Accessibility hooks
  const _modalId = useId('modal');
  const _titleId = useId('modal-title');
  const _descriptionId = useId('modal-description');
  const _focusTrapRef = useFocusTrap(isOpen);
  const _clickOutsideRef = useClickOutside(() => {
    if (closeOnOverlayClick && !persistent) {
      onClose();
    }
  }, isOpen);
  const _prefersReducedMotion = useReducedMotion();

  // Handle escape key
  useEscapeKey(() => {
    if (closeOnEscape && !persistent) {
      onClose();
    }
  }, isOpen);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = 'unset';
      };
    }
  }, [isOpen]);

  // Handle overlay click
  const handleOverlayClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && closeOnOverlayClick && !persistent) {
      onClose();
    }
  };

  // Handle close button click
  const handleCloseClick = () => {
    if (!persistent) {
      onClose();
    }
  };

  // Get animation variants based on variant
  const getModalVariants = () => {
    switch (variant) {
      case 'centered':
        return MODAL_VARIANTS.centered;
      case 'slide-over':
        return MODAL_VARIANTS.slideOver;
      case 'bottom-sheet':
        return MODAL_VARIANTS.bottomSheet;
      default:
        return MODAL_VARIANTS.default;
    }
  };

  // Get container classes based on variant
  const getContainerClasses = () => {
    const baseClasses = 'fixed inset-0 flex';

    switch (variant) {
      case 'slide-over':
        return `${baseClasses} justify-end`;
      case 'bottom-sheet':
        return `${baseClasses} items-end justify-center`;
      case 'centered':
        return `${baseClasses} items-center justify-center`;
      default:
        return `${baseClasses} items-center justify-center p-4`;
    }
  };

  // Get modal classes based on variant and size
  const getModalClasses = () => {
    const baseClasses = 'relative bg-white rounded-lg shadow-xl';

    switch (variant) {
      case 'slide-over':
        return `${baseClasses} h-full w-full max-w-md`;
      case 'bottom-sheet':
        return `${baseClasses} w-full max-w-lg mx-4 mb-4`;
      default:
        return `${baseClasses} w-full ${SIZE_CONFIG[size]}`;
    }
  };

  if (!isOpen) return null;

  const modalContent = (
    <AnimatePresence>
      {isOpen && (
        <div className={`fixed inset-0 z-${zIndex} ${className}`} style={{ zIndex }}>
          {/* Backdrop */}
          <motion.div
            variants={BACKDROP_VARIANTS}
            initial="hidden"
            animate="visible"
            exit="hidden"
            className={`fixed inset-0 bg-black bg-opacity-50 transition-opacity ${overlayClassName}`}
            onClick={handleOverlayClick}
          />

          {/* Modal container */}
          <div className={getContainerClasses()}>
            <motion.div
              variants={getModalVariants()}
              initial="hidden"
              animate="visible"
              exit="exit"
              transition={{ type: 'spring', damping: 25, stiffness: 500 }}
              className={`${getModalClasses()} ${contentClassName}`}
              role="dialog"
              aria-modal="true"
              aria-labelledby={title ? _titleId : undefined}
              aria-describedby={description ? _descriptionId : undefined}
            >
              {/* Header */}
              {(title || showCloseButton) && (
                <div
                  className={`flex items-start justify-between p-6 ${
                    variant === 'bottom-sheet' ? 'pb-4' : 'border-b border-gray-200'
                  }`}
                >
                  <div className="flex-1">
                    {title && (
                      <h3 id={_titleId} className="text-lg font-semibold text-gray-900">
                        {title}
                      </h3>
                    )}
                    {description && (
                      <p id={_descriptionId} className="mt-1 text-sm text-gray-500">
                        {description}
                      </p>
                    )}
                  </div>

                  {showCloseButton && (
                    <button
                      type="button"
                      onClick={handleCloseClick}
                      className="ml-4 text-gray-400 hover:text-gray-600 transition-colors"
                      aria-label="Close modal"
                    >
                      <XMarkIcon className="w-6 h-6" />
                    </button>
                  )}
                </div>
              )}

              {/* Content */}
              <div
                className={`${
                  (title || showCloseButton) && !footer
                    ? 'p-6 pt-0'
                    : (title || showCloseButton) && footer
                      ? 'px-6'
                      : !footer
                        ? 'p-6'
                        : 'px-6 pt-6'
                }`}
              >
                {children}
              </div>

              {/* Footer */}
              {footer && (
                <div
                  className={`px-6 py-4 ${
                    variant === 'bottom-sheet' ? 'pt-4' : 'border-t border-gray-200'
                  }`}
                >
                  {footer}
                </div>
              )}
            </motion.div>
          </div>
        </div>
      )}
    </AnimatePresence>
  );

  // Render in portal to avoid z-index issues
  if (typeof window !== 'undefined') {
    return createPortal(modalContent, document.body);
  }

  return null;
}

// Confirmation modal hook and component
interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info';
  loading?: boolean;
}

export function ConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'info',
  loading = false,
}: ConfirmationModalProps) {
  const variantStyles = {
    danger: {
      accent: 'bg-red-100 text-red-700 ring-red-200',
      button: 'bg-red-600 hover:bg-red-700 focus:ring-red-500',
      label: 'High impact',
    },
    warning: {
      accent: 'bg-amber-100 text-amber-700 ring-amber-200',
      button: 'bg-amber-600 hover:bg-amber-700 focus:ring-amber-500',
      label: 'Needs confirmation',
    },
    info: {
      accent: 'bg-blue-100 text-blue-700 ring-blue-200',
      button: 'bg-slate-900 hover:bg-slate-800 focus:ring-slate-500',
      label: 'Confirm action',
    },
  };

  const style = variantStyles[variant];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="sm"
      closeOnOverlayClick={!loading}
      closeOnEscape={!loading}
      persistent={loading}
    >
      <div className="space-y-5">
        <div className="space-y-3">
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] ring-1 ${style.accent}`}
          >
            {style.label}
          </span>
          <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
            <div
              className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ring-1 ${style.accent}`}
              aria-hidden="true"
            >
              {variant === 'danger' ? (
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.268 19c-.77.833.192 2.5 1.732 2.5z"
                  />
                </svg>
              ) : variant === 'warning' ? (
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4m0 4h.01M4.93 19h14.14c1.54 0 2.5-1.67 1.73-2.5L13.73 4c-.77-.83-1.96-.83-2.73 0L3.2 16.5c-.77.83.19 2.5 1.73 2.5z"
                  />
                </svg>
              ) : (
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              )}
            </div>
            <div className="min-w-0">
              <p className="text-base font-semibold leading-8 text-slate-900">{title}</p>
              <p className="mt-2 text-sm leading-7 text-slate-600">{message}</p>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`inline-flex min-h-11 items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold text-white transition focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${style.button}`}
          >
            {loading ? (
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"></div>
                Processing...
              </div>
            ) : (
              confirmText
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// Hook for managing modal state
export function useModal(initialState = false) {
  const [isOpen, setIsOpen] = React.useState(initialState);

  const open = React.useCallback(() => setIsOpen(true), []);
  const close = React.useCallback(() => setIsOpen(false), []);
  const toggle = React.useCallback(() => setIsOpen((prev) => !prev), []);

  return {
    isOpen,
    open,
    close,
    toggle,
    setIsOpen,
  };
}

// Hook for confirmation modals
export function useConfirmation() {
  const [confirmationState, setConfirmationState] = React.useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    variant?: 'danger' | 'warning' | 'info';
    confirmText?: string;
    cancelText?: string;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  const [loading, setLoading] = React.useState(false);

  const confirm = React.useCallback(
    (options: {
      title: string;
      message: string;
      onConfirm: () => void | Promise<void>;
      variant?: 'danger' | 'warning' | 'info';
      confirmText?: string;
      cancelText?: string;
    }) => {
      setConfirmationState({
        isOpen: true,
        ...options,
      });
    },
    []
  );

  const handleConfirm = React.useCallback(async () => {
    try {
      setLoading(true);
      await confirmationState.onConfirm();
      setConfirmationState((prev) => ({ ...prev, isOpen: false }));
    } catch (error) {
      console.error('Confirmation action failed:', error);
    } finally {
      setLoading(false);
    }
  }, [confirmationState]);

  const handleClose = React.useCallback(() => {
    if (!loading) {
      setConfirmationState((prev) => ({ ...prev, isOpen: false }));
    }
  }, [loading]);

  const ConfirmationModalComponent = React.useMemo(
    () => (
      <ConfirmationModal
        isOpen={confirmationState.isOpen}
        onClose={handleClose}
        onConfirm={handleConfirm}
        title={confirmationState.title}
        message={confirmationState.message}
        variant={confirmationState.variant}
        confirmText={confirmationState.confirmText}
        cancelText={confirmationState.cancelText}
        loading={loading}
      />
    ),
    [confirmationState, handleClose, handleConfirm, loading]
  );

  return {
    confirm,
    ConfirmationModal: ConfirmationModalComponent,
    loading,
  };
}
