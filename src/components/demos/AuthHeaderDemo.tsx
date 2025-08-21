'use client';

import { useState } from 'react';
import AuthHeader from '@/components/AuthHeader';
import { motion } from 'framer-motion';
import { 
  EyeIcon, 
  CodeBracketIcon,
  SparklesIcon,
  DevicePhoneMobileIcon,
  ShieldCheckIcon,
  UserGroupIcon
} from '@heroicons/react/24/outline';

export default function AuthHeaderDemo() {
  const [activeTab, setActiveTab] = useState<'overview' | 'features' | 'code'>('overview');

  const features = [
    {
      icon: <UserGroupIcon className="w-6 h-6" />,
      title: 'Rich User Profile',
      description: 'Comprehensive user information with avatar, email verification status, and account details'
    },
    {
      icon: <DevicePhoneMobileIcon className="w-6 h-6" />,
      title: 'Responsive Design',
      description: 'Fully responsive layout that works seamlessly across all device sizes'
    },
    {
      icon: <SparklesIcon className="w-6 h-6" />,
      title: 'Smooth Animations',
      description: 'Delightful micro-interactions powered by Framer Motion for enhanced UX'
    },
    {
      icon: <ShieldCheckIcon className="w-6 h-6" />,
      title: 'Security Focused',
      description: 'Secure Google OAuth integration with comprehensive error handling'
    }
  ];

  const codeExample = `'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/AuthContext';
import { 
  UserIcon, 
  ChevronDownIcon,
  ArrowRightOnRectangleIcon,
  UserCircleIcon,
  CogIcon,
  ShieldCheckIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon
} from '@heroicons/react/24/outline';

export default function AuthHeader() {
  const { user, loginWithGoogle, logout, loading } = useAuth();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Enhanced user experience with loading states,
  // error handling, and comprehensive user information
  
  return (
    <div className="relative">
      {user ? (
        <UserProfileDropdown 
          user={user}
          onLogout={handleLogout}
          isLoggingOut={isLoggingOut}
        />
      ) : (
        <GoogleSignInButton 
          onLogin={handleLogin}
          isLoggingIn={isLoggingIn}
        />
      )}
    </div>
  );
}`;

  return (
    <div className="min-h-screen bg-base-100 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 bg-primary/10 text-primary px-4 py-2 rounded-full text-sm font-medium mb-4"
          >
            <SparklesIcon className="w-4 h-4" />
            Authentication Component Demo
          </motion.div>
          
          <motion.h1
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-4xl font-bold text-base-content mb-4"
          >
            Enhanced AuthHeader Component
          </motion.h1>
          
          <motion.p
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-lg text-base-content/70 max-w-2xl mx-auto"
          >
            A comprehensive authentication header with modern design, rich user profiles, 
            smooth animations, and enterprise-grade security features.
          </motion.p>
        </div>

        {/* Tab Navigation */}
        <div className="flex justify-center mb-8">
          <div className="tabs tabs-boxed bg-base-200 p-1">
            <button
              className={`tab tab-lg gap-2 ${activeTab === 'overview' ? 'tab-active' : ''}`}
              onClick={() => setActiveTab('overview')}
            >
              <EyeIcon className="w-4 h-4" />
              Live Demo
            </button>
            <button
              className={`tab tab-lg gap-2 ${activeTab === 'features' ? 'tab-active' : ''}`}
              onClick={() => setActiveTab('features')}
            >
              <SparklesIcon className="w-4 h-4" />
              Features
            </button>
            <button
              className={`tab tab-lg gap-2 ${activeTab === 'code' ? 'tab-active' : ''}`}
              onClick={() => setActiveTab('code')}
            >
              <CodeBracketIcon className="w-4 h-4" />
              Code
            </button>
          </div>
        </div>

        {/* Tab Content */}
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3 }}
        >
          {activeTab === 'overview' && (
            <div className="space-y-8">
              {/* Live Demo */}
              <div className="card bg-base-200 shadow-xl">
                <div className="card-body">
                  <h2 className="card-title text-2xl mb-6 flex items-center gap-2">
                    <EyeIcon className="w-6 h-6 text-primary" />
                    Live Authentication Demo
                  </h2>
                  
                  <div className="bg-base-100 rounded-xl p-6 border border-base-300">
                    <div className="flex justify-between items-center">
                      <div>
                        <h3 className="text-lg font-semibold text-base-content mb-2">
                          Fantasy Sports Dashboard
                        </h3>
                        <p className="text-base-content/70">
                          Interactive authentication component
                        </p>
                      </div>
                      
                      {/* AuthHeader Component */}
                      <AuthHeader />
                    </div>
                  </div>

                  <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="alert alert-info">
                      <div>
                        <h4 className="font-semibold">When Signed Out</h4>
                        <p className="text-sm">Clean, prominent Google sign-in button with loading states</p>
                      </div>
                    </div>
                    <div className="alert alert-success">
                      <div>
                        <h4 className="font-semibold">When Signed In</h4>
                        <p className="text-sm">Rich user profile with dropdown menu and account details</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Component States */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="card bg-base-200 shadow-lg">
                  <div className="card-body">
                    <h3 className="card-title text-lg mb-4">Key Interactions</h3>
                    <ul className="space-y-3">
                      <li className="flex items-center gap-3">
                        <div className="w-2 h-2 bg-primary rounded-full"></div>
                        <span>Click the profile button to open user details</span>
                      </li>
                      <li className="flex items-center gap-3">
                        <div className="w-2 h-2 bg-primary rounded-full"></div>
                        <span>View comprehensive account information</span>
                      </li>
                      <li className="flex items-center gap-3">
                        <div className="w-2 h-2 bg-primary rounded-full"></div>
                        <span>Smooth animations and loading states</span>
                      </li>
                      <li className="flex items-center gap-3">
                        <div className="w-2 h-2 bg-primary rounded-full"></div>
                        <span>Toast notifications for user feedback</span>
                      </li>
                    </ul>
                  </div>
                </div>

                <div className="card bg-base-200 shadow-lg">
                  <div className="card-body">
                    <h3 className="card-title text-lg mb-4">Technical Features</h3>
                    <ul className="space-y-3">
                      <li className="flex items-center gap-3">
                        <div className="w-2 h-2 bg-secondary rounded-full"></div>
                        <span>Firebase Google OAuth integration</span>
                      </li>
                      <li className="flex items-center gap-3">
                        <div className="w-2 h-2 bg-secondary rounded-full"></div>
                        <span>TypeScript with strict type safety</span>
                      </li>
                      <li className="flex items-center gap-3">
                        <div className="w-2 h-2 bg-secondary rounded-full"></div>
                        <span>Accessibility-compliant design</span>
                      </li>
                      <li className="flex items-center gap-3">
                        <div className="w-2 h-2 bg-secondary rounded-full"></div>
                        <span>Responsive mobile-first approach</span>
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'features' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {features.map((feature, index) => (
                <motion.div
                  key={feature.title}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className="card bg-base-200 shadow-lg hover:shadow-xl transition-shadow duration-300"
                >
                  <div className="card-body">
                    <div className="flex items-center gap-4 mb-4">
                      <div className="p-3 bg-primary/10 text-primary rounded-xl">
                        {feature.icon}
                      </div>
                      <h3 className="card-title text-lg">{feature.title}</h3>
                    </div>
                    <p className="text-base-content/70">{feature.description}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          )}

          {activeTab === 'code' && (
            <div className="card bg-base-200 shadow-xl">
              <div className="card-body">
                <h2 className="card-title text-2xl mb-6 flex items-center gap-2">
                  <CodeBracketIcon className="w-6 h-6 text-primary" />
                  Implementation Code
                </h2>
                
                <div className="mockup-code">
                  <pre data-prefix="1"><code>{codeExample}</code></pre>
                </div>

                <div className="mt-6 alert alert-info">
                  <div>
                    <h4 className="font-semibold">Implementation Notes</h4>
                    <ul className="text-sm mt-2 space-y-1">
                      <li>• Uses Framer Motion for smooth animations</li>
                      <li>• Implements comprehensive error handling</li>
                      <li>• Includes loading states for better UX</li>
                      <li>• Fully typed with TypeScript</li>
                      <li>• Follows accessibility best practices</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          )}
        </motion.div>

        {/* Footer */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="text-center mt-12 p-6 bg-base-200 rounded-xl"
        >
          <p className="text-base-content/70">
            This enhanced AuthHeader component provides a complete authentication solution
            with modern design patterns, comprehensive user management, and enterprise-grade security.
          </p>
        </motion.div>
      </div>
    </div>
  );
}
