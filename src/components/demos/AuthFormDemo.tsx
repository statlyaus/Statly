'use client';

import { useState } from 'react';
import AuthForm from '@/components/AuthForm';
import { motion } from 'framer-motion';
import {
  EyeIcon,
  CodeBracketIcon,
  SparklesIcon,
  DevicePhoneMobileIcon,
  ShieldCheckIcon,
  UserGroupIcon,
  LockClosedIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';

export default function AuthFormDemo() {
  const [activeTab, setActiveTab] = useState<'overview' | 'features' | 'code'>('overview');
  const [demoMode, setDemoMode] = useState<'login' | 'signup'>('login');

  const features = [
    {
      icon: <ShieldCheckIcon className="w-6 h-6" />,
      title: 'Advanced Security',
      description:
        'Real-time validation, password strength indicators, and secure Google OAuth integration',
    },
    {
      icon: <UserGroupIcon className="w-6 h-6" />,
      title: 'Rich User Experience',
      description:
        'Smooth animations, loading states, error handling, and intuitive form interactions',
    },
    {
      icon: <DevicePhoneMobileIcon className="w-6 h-6" />,
      title: 'Responsive Design',
      description: 'Fully responsive layout optimized for mobile, tablet, and desktop experiences',
    },
    {
      icon: <SparklesIcon className="w-6 h-6" />,
      title: 'Modern UI Components',
      description: 'DaisyUI integration with elegant cards, animations, and accessibility features',
    },
    {
      icon: <LockClosedIcon className="w-6 h-6" />,
      title: 'Form Validation',
      description: 'Real-time email and password validation with helpful error messages',
    },
    {
      icon: <CheckCircleIcon className="w-6 h-6" />,
      title: 'Success Feedback',
      description: 'Toast notifications and visual feedback for successful authentication',
    },
  ];

  const codeExample = `'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/AuthContext';
import {
  EyeIcon,
  EyeSlashIcon,
  UserIcon,
  EnvelopeIcon,
  LockClosedIcon,
  ArrowRightOnRectangleIcon,
  UserPlusIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon
} from '@heroicons/react/24/outline';

interface AuthFormProps {
  initialMode?: 'login' | 'signup';
  onSuccess?: () => void;
  className?: string;
}

const AuthForm = ({ initialMode = 'login', onSuccess, className }: AuthFormProps) => {
  const { login, signup, user, logout, loginWithGoogle, loading } = useAuth();
  
  // Enhanced state management
  const [isSignup, setIsSignup] = useState(initialMode === 'signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [validation, setValidation] = useState({...});
  
  // Real-time validation with strength indicators
  const validatePassword = (password: string, isSignup: boolean) => {
    // Advanced password validation logic
  };
  
  const getPasswordStrength = (password: string) => {
    // Password strength calculation
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="card bg-base-100 shadow-xl"
    >
      {/* Enhanced form with validation, animations, and UX improvements */}
    </motion.div>
  );
};`;

  return (
    <div className="min-h-screen bg-base-100 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 bg-primary/10 text-primary px-4 py-2 rounded-full text-sm font-medium mb-4"
          >
            <LockClosedIcon className="w-4 h-4" />
            Authentication Form Demo
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-4xl font-bold text-base-content mb-4"
          >
            Enhanced AuthForm Component
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-lg text-base-content/70 max-w-3xl mx-auto"
          >
            A comprehensive authentication form with advanced validation, security features, smooth
            animations, and exceptional user experience design.
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
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Live Demo */}
              <div className="space-y-6">
                <div className="card bg-base-200 shadow-xl">
                  <div className="card-body">
                    <h2 className="card-title text-2xl mb-4 flex items-center gap-2">
                      <EyeIcon className="w-6 h-6 text-primary" />
                      Interactive Demo
                    </h2>

                    <div className="flex gap-2 mb-4">
                      <button
                        className={`btn btn-sm ${demoMode === 'login' ? 'btn-primary' : 'btn-outline'}`}
                        onClick={() => setDemoMode('login')}
                      >
                        Sign In Mode
                      </button>
                      <button
                        className={`btn btn-sm ${demoMode === 'signup' ? 'btn-primary' : 'btn-outline'}`}
                        onClick={() => setDemoMode('signup')}
                      >
                        Sign Up Mode
                      </button>
                    </div>

                    <div className="bg-base-100 rounded-xl p-4">
                      <AuthForm
                        initialMode={demoMode}
                        onSuccess={() => console.log('Demo: Authentication successful!')}
                        className="max-w-md mx-auto"
                      />
                    </div>
                  </div>
                </div>

                {/* Demo Instructions */}
                <div className="card bg-base-200 shadow-lg">
                  <div className="card-body">
                    <h3 className="card-title text-lg mb-4">Try These Features</h3>
                    <div className="space-y-3">
                      <div className="flex items-start gap-3">
                        <CheckCircleIcon className="w-5 h-5 text-success mt-0.5" />
                        <div>
                          <p className="font-medium">Real-time Validation</p>
                          <p className="text-sm text-base-content/70">
                            Type in the email field to see instant validation
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3">
                        <CheckCircleIcon className="w-5 h-5 text-success mt-0.5" />
                        <div>
                          <p className="font-medium">Password Strength</p>
                          <p className="text-sm text-base-content/70">
                            Switch to sign up mode and watch the password strength indicator
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3">
                        <CheckCircleIcon className="w-5 h-5 text-success mt-0.5" />
                        <div>
                          <p className="font-medium">Show/Hide Password</p>
                          <p className="text-sm text-base-content/70">
                            Click the eye icon to toggle password visibility
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3">
                        <CheckCircleIcon className="w-5 h-5 text-success mt-0.5" />
                        <div>
                          <p className="font-medium">Google Sign-in</p>
                          <p className="text-sm text-base-content/70">
                            Test the Google authentication button
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Feature Highlights */}
              <div className="space-y-6">
                <div className="card bg-base-200 shadow-lg">
                  <div className="card-body">
                    <h3 className="card-title text-lg mb-4">Key Improvements</h3>
                    <div className="grid grid-cols-1 gap-4">
                      <div className="stat bg-base-100 rounded-lg">
                        <div className="stat-figure text-primary">
                          <ShieldCheckIcon className="w-8 h-8" />
                        </div>
                        <div className="stat-title">Security</div>
                        <div className="stat-value text-2xl">Advanced</div>
                        <div className="stat-desc">Real-time validation & strength indicators</div>
                      </div>
                      <div className="stat bg-base-100 rounded-lg">
                        <div className="stat-figure text-secondary">
                          <SparklesIcon className="w-8 h-8" />
                        </div>
                        <div className="stat-title">Animations</div>
                        <div className="stat-value text-2xl">Smooth</div>
                        <div className="stat-desc">Framer Motion powered interactions</div>
                      </div>
                      <div className="stat bg-base-100 rounded-lg">
                        <div className="stat-figure text-accent">
                          <UserGroupIcon className="w-8 h-8" />
                        </div>
                        <div className="stat-title">Experience</div>
                        <div className="stat-value text-2xl">Premium</div>
                        <div className="stat-desc">Toast notifications & loading states</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="card bg-base-200 shadow-lg">
                  <div className="card-body">
                    <h3 className="card-title text-lg mb-4">Validation Features</h3>
                    <div className="space-y-3">
                      <div className="alert alert-info">
                        <ExclamationTriangleIcon className="w-5 h-5" />
                        <div>
                          <h4 className="font-semibold">Email Validation</h4>
                          <p className="text-sm">
                            Real-time email format checking with visual feedback
                          </p>
                        </div>
                      </div>
                      <div className="alert alert-warning">
                        <ArrowPathIcon className="w-5 h-5" />
                        <div>
                          <h4 className="font-semibold">Password Strength</h4>
                          <p className="text-sm">
                            Dynamic strength meter with requirements checklist
                          </p>
                        </div>
                      </div>
                      <div className="alert alert-success">
                        <CheckCircleIcon className="w-5 h-5" />
                        <div>
                          <h4 className="font-semibold">Confirmation Matching</h4>
                          <p className="text-sm">Real-time password confirmation validation</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'features' && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
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
            <div className="space-y-6">
              <div className="card bg-base-200 shadow-xl">
                <div className="card-body">
                  <h2 className="card-title text-2xl mb-6 flex items-center gap-2">
                    <CodeBracketIcon className="w-6 h-6 text-primary" />
                    Implementation Overview
                  </h2>

                  <div className="mockup-code">
                    <pre data-prefix="1">
                      <code>{codeExample}</code>
                    </pre>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="card bg-base-200 shadow-lg">
                  <div className="card-body">
                    <h3 className="card-title mb-4">Key Dependencies</h3>
                    <div className="space-y-2">
                      <div className="badge badge-primary gap-2">
                        <SparklesIcon className="w-3 h-3" />
                        framer-motion
                      </div>
                      <div className="badge badge-secondary gap-2">
                        <ShieldCheckIcon className="w-3 h-3" />
                        @heroicons/react
                      </div>
                      <div className="badge badge-accent gap-2">
                        <UserGroupIcon className="w-3 h-3" />
                        react
                      </div>
                      <div className="badge badge-info gap-2">
                        <LockClosedIcon className="w-3 h-3" />
                        firebase/auth
                      </div>
                    </div>
                  </div>
                </div>

                <div className="card bg-base-200 shadow-lg">
                  <div className="card-body">
                    <h3 className="card-title mb-4">Implementation Notes</h3>
                    <ul className="text-sm space-y-2">
                      <li className="flex items-start gap-2">
                        <CheckCircleIcon className="w-4 h-4 text-success mt-0.5" />
                        TypeScript with strict type safety
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircleIcon className="w-4 h-4 text-success mt-0.5" />
                        Accessibility-compliant ARIA labels
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircleIcon className="w-4 h-4 text-success mt-0.5" />
                        Responsive mobile-first design
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircleIcon className="w-4 h-4 text-success mt-0.5" />
                        Real-time validation with debouncing
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircleIcon className="w-4 h-4 text-success mt-0.5" />
                        Error boundary integration
                      </li>
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
          <p className="text-base-content/70 mb-4">
            This enhanced AuthForm component provides a complete authentication solution with
            enterprise-grade security, modern design patterns, and exceptional user experience.
          </p>
          <div className="flex justify-center gap-4">
            <div className="badge badge-outline">Real-time Validation</div>
            <div className="badge badge-outline">Password Strength</div>
            <div className="badge badge-outline">Google OAuth</div>
            <div className="badge badge-outline">Accessibility</div>
            <div className="badge badge-outline">TypeScript</div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
