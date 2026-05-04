'use client';

import React from 'react';
import { useState } from 'react';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { BarChart3, Home, LogOut, Menu, Trophy, User, Users, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

import { useAuth } from '@/AuthContext';

interface NavigationItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  iconSolid: React.ComponentType<{ className?: string }>;
  badge?: number;
  adminOnly?: boolean;
}

const navigation: NavigationItem[] = [
  {
    name: 'Dashboard',
    href: '/dashboard',
    icon: Home,
    iconSolid: Home,
  },
  {
    name: 'My Leagues',
    href: '/leagues',
    icon: Users,
    iconSolid: Users,
  },
  {
    name: 'Rankings',
    href: '/rankings',
    icon: BarChart3,
    iconSolid: BarChart3,
  },
  {
    name: 'Trade Centre',
    href: '/tradecentre',
    icon: Trophy,
    iconSolid: Trophy,
  },
  {
    name: 'Players',
    href: '/players',
    icon: User,
    iconSolid: User,
  },
];

interface MainSidebarProps {
  className?: string;
}

// Deferred design-system migration: this sidebar is only re-exported and is not mounted by
// the active app shell. Migrate the active navigation surface instead if that changes.
export default function MainSidebar({ className = '' }: MainSidebarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();
  const { user, logout } = useAuth();

  const toggleSidebar = () => setIsOpen(!isOpen);
  const closeSidebar = () => setIsOpen(false);

  const handleLogout = async () => {
    try {
      await logout();
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  if (!user) {
    return null; // Don't show sidebar if not authenticated
  }

  const isActive = (href: string) => {
    if (!pathname) return false;
    if (href === '/dashboard') {
      return pathname === '/dashboard' || pathname === '/';
    }
    return pathname.startsWith(href);
  };

  const sidebarContent = (
    <div className="flex h-full flex-col border-r border-border bg-card text-card-foreground">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-6">
        <Link href="/dashboard" className="flex items-center" onClick={closeSidebar}>
          <div className="flex-shrink-0">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <span className="text-sm font-bold text-primary-foreground">S</span>
            </div>
          </div>
          <div className="ml-3">
            <h1 className="text-lg font-bold text-foreground">Statly</h1>
            <p className="text-xs text-muted-foreground">Fantasy AFL</p>
          </div>
        </Link>

        {/* Mobile close button */}
        <button
          onClick={closeSidebar}
          className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
          aria-label="Close navigation menu"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-4 py-6" aria-label="Primary">
        {navigation.map((item) => {
          const active = isActive(item.href);
          const IconComponent = active ? item.iconSolid : item.icon;

          return (
            <Link
              key={item.name}
              href={item.href}
              onClick={closeSidebar}
              aria-current={active ? 'page' : undefined}
              className={`group flex items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                active
                  ? 'border-r-2 border-primary bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              }`}
            >
              <IconComponent
                className={`mr-3 h-5 w-5 flex-shrink-0 ${
                  active
                    ? 'text-primary'
                    : 'text-muted-foreground group-hover:text-accent-foreground'
                }`}
                aria-hidden="true"
              />
              <span className="flex-1">{item.name}</span>
              {item.badge && item.badge > 0 && (
                <span className="ml-2 rounded-full bg-destructive px-2 py-0.5 text-xs font-medium text-destructive-foreground">
                  {item.badge > 99 ? '99+' : item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer - User Profile */}
      <div className="border-t border-border px-4 py-4">
        <div className="flex items-center">
          <div className="flex-shrink-0">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
              {user.photoURL ? (
                <img src={user.photoURL} alt="Profile" className="h-8 w-8 rounded-full" />
              ) : (
                <span className="text-sm font-medium text-muted-foreground">
                  {user.displayName?.charAt(0) || user.email?.charAt(0) || 'U'}
                </span>
              )}
            </div>
          </div>
          <div className="ml-3 min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">
              {user.displayName || 'User'}
            </p>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          </div>
          <div className="ml-2 flex-shrink-0">
            <button
              onClick={handleLogout}
              className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile menu button */}
      <button
        onClick={toggleSidebar}
        className="fixed left-4 top-4 z-50 rounded-md border border-border bg-card p-2 text-muted-foreground shadow-lg hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
        aria-label="Open navigation menu"
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
      </button>

      {/* Desktop sidebar */}
      <div
        className={`hidden lg:fixed lg:inset-y-0 lg:z-40 lg:flex lg:w-64 lg:flex-col ${className}`}
      >
        {sidebarContent}
      </div>

      {/* Mobile sidebar overlay */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeSidebar}
              className="fixed inset-0 z-40 bg-overlay lg:hidden"
            />

            {/* Sidebar */}
            <motion.div
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: 'tween', duration: 0.3 }}
              className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col lg:hidden"
              role="dialog"
              aria-modal="true"
              aria-label="Mobile navigation"
            >
              {sidebarContent}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

// Hook for managing sidebar state globally
export function useSidebar() {
  return {
    // Add global sidebar state management if needed
  };
}
