'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/AuthContext';
import {
  HomeIcon,
  TrophyIcon,
  UserGroupIcon,
  ChartBarIcon,
  UserIcon,
  ArrowRightOnRectangleIcon,
  Bars3Icon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import {
  HomeIcon as HomeSolid,
  TrophyIcon as TrophySolid,
  UserGroupIcon as UserGroupSolid,
  ChartBarIcon as ChartBarSolid,
} from '@heroicons/react/24/solid';

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
    icon: HomeIcon,
    iconSolid: HomeSolid,
  },
  {
    name: 'My Leagues',
    href: '/leagues',
    icon: UserGroupIcon,
    iconSolid: UserGroupSolid,
  },
  {
    name: 'Rankings',
    href: '/rankings',
    icon: ChartBarIcon,
    iconSolid: ChartBarSolid,
  },
  {
    name: 'Waivers & Trades',
    href: '/waivers',
    icon: TrophyIcon,
    iconSolid: TrophySolid,
  },
  {
    name: 'Players',
    href: '/players',
    icon: UserIcon,
    iconSolid: UserIcon,
  },
];

interface MainSidebarProps {
  className?: string;
}

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
    <div className="flex h-full flex-col bg-white border-r border-gray-200">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-6 border-b border-gray-200">
        <Link href="/dashboard" className="flex items-center" onClick={closeSidebar}>
          <div className="flex-shrink-0">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white">
              <Image
                src="/logo-statly-shield.svg"
                alt="Statly logo"
                width={24}
                height={24}
                priority
                className="h-6 w-6 object-contain"
              />
            </div>
          </div>
          <div className="ml-3">
            <h1 className="text-lg font-bold text-gray-900">Statly</h1>
            <p className="text-xs text-gray-500">Fantasy AFL</p>
          </div>
        </Link>

        {/* Mobile close button */}
        <button
          onClick={closeSidebar}
          className="lg:hidden p-2 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100"
        >
          <XMarkIcon className="w-5 h-5" />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
        {navigation.map((item) => {
          const active = isActive(item.href);
          const IconComponent = active ? item.iconSolid : item.icon;

          return (
            <Link
              key={item.name}
              href={item.href}
              onClick={closeSidebar}
              className={`group flex items-center px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                active
                  ? 'bg-blue-50 text-blue-700 border-r-2 border-blue-700'
                  : 'text-gray-700 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              <IconComponent
                className={`mr-3 h-5 w-5 flex-shrink-0 ${
                  active ? 'text-blue-700' : 'text-gray-400 group-hover:text-gray-500'
                }`}
              />
              <span className="flex-1">{item.name}</span>
              {item.badge && item.badge > 0 && (
                <span className="ml-2 bg-red-500 text-white text-xs font-medium px-2 py-0.5 rounded-full">
                  {item.badge > 99 ? '99+' : item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer - User Profile */}
      <div className="border-t border-gray-200 px-4 py-4">
        <div className="flex items-center">
          <div className="flex-shrink-0">
            <div className="w-8 h-8 bg-gray-300 rounded-full flex items-center justify-center">
              {user.photoURL ? (
                <img src={user.photoURL} alt="Profile" className="w-8 h-8 rounded-full" />
              ) : (
                <span className="text-gray-600 font-medium text-sm">
                  {user.displayName?.charAt(0) || user.email?.charAt(0) || 'U'}
                </span>
              )}
            </div>
          </div>
          <div className="ml-3 flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">
              {user.displayName || 'User'}
            </p>
            <p className="text-xs text-gray-500 truncate">{user.email}</p>
          </div>
          <div className="ml-2 flex-shrink-0">
            <button
              onClick={handleLogout}
              className="p-1 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100"
              title="Sign out"
            >
              <ArrowRightOnRectangleIcon className="w-4 h-4" />
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
        className="lg:hidden fixed top-4 left-4 z-50 p-2 rounded-md bg-white shadow-lg border border-gray-200 text-gray-400 hover:text-gray-500"
      >
        <Bars3Icon className="w-5 h-5" />
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
              className="lg:hidden fixed inset-0 z-40 bg-black bg-opacity-50"
            />

            {/* Sidebar */}
            <motion.div
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: 'tween', duration: 0.3 }}
              className="lg:hidden fixed inset-y-0 left-0 z-50 w-64 flex flex-col"
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
