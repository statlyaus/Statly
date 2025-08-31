'use client';

import React, { useEffect } from 'react';
import type { ReactNode } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { useFocusTrap, useEscapeKey, useClickOutside, useId, useReducedMotion } from '@/hooks/useAccessibility';

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
              aria-labelledby={title ? 'modal-title' : undefined}
              aria-describedby={description ? 'modal-description' : undefined}
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
                      <h3 id="modal-title" className="text-lg font-semibold text-gray-900">
                        {title}
                      </h3>
                    )}
                    {description && (
                      <p id="modal-description" className="mt-1 text-sm text-gray-500">
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
      button: 'bg-red-600 hover:bg-red-700 focus:ring-red-500',
      icon: '⚠️',
    },
    warning: {
      button: 'bg-yellow-600 hover:bg-yellow-700 focus:ring-yellow-500',
      icon: '⚠️',
    },
    info: {
      button: 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500',
      icon: 'ℹ️',
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
      <div className="mb-4">
        <div className="flex items-center">
          <span className="text-2xl mr-3">{style.icon}</span>
          <p className="text-gray-700">{message}</p>
        </div>
      </div>

      <div className="flex space-x-3 justify-end">
        <button
          type="button"
          onClick={onClose}
          disabled={loading}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {cancelText}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={loading}
          className={`px-4 py-2 text-sm font-medium text-white rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${style.button}`}
        >
          {loading ? (
            <div className="flex items-center">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
              Processing...
            </div>
          ) : (
            confirmText
          )}
        </button>
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
