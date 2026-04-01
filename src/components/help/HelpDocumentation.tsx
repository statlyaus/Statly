'use client';

import React, { useState, useMemo } from 'react';

import {
  MagnifyingGlassIcon,
  BookOpenIcon,
  QuestionMarkCircleIcon,
  ChatBubbleBottomCenterTextIcon,
  VideoCameraIcon,
  DocumentTextIcon,
  StarIcon,
  PlayIcon,
} from '@heroicons/react/24/outline';
import { motion, AnimatePresence } from 'framer-motion';

import Button from '@/components/Button';
import FormField from '@/components/FormField';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Separator,
  UIInput,
  UISelect,
  UITextarea,
} from '@/components/ui';

// Types
interface HelpArticle {
  id: string;
  title: string;
  content: string;
  category: string;
  tags: string[];
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  readTime: number;
  rating: number;
  helpful: number;
  lastUpdated: Date;
}

interface VideoTutorial {
  id: string;
  title: string;
  description: string;
  duration: string;
  thumbnail: string;
  category: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  views: number;
  rating: number;
}

interface FAQ {
  id: string;
  question: string;
  answer: string;
  category: string;
  helpful: number;
}

interface HelpSystemProps {
  articles?: HelpArticle[];
  videos?: VideoTutorial[];
  faqs?: FAQ[];
  onSearchQuery?: (query: string) => void;
  onRateContent?: (contentId: string, rating: number) => void;
}

// Mock data
const mockArticles: HelpArticle[] = [
  {
    id: '1',
    title: 'Getting Started with AFL Fantasy',
    content: `# Getting Started with AFL Fantasy

AFL Fantasy is a game where you build a team of real AFL players and score points based on their real-life performances.

## How It Works

1. **Draft Your Team**: Select 30 players across 4 positions
2. **Set Your Lineup**: Choose your best 22 players each week
3. **Score Points**: Players earn points based on their statistics
4. **Make Trades**: Improve your team throughout the season

## Scoring System

Players earn points for various actions:
- **Disposals**: 1 point each
- **Kicks**: 3 points each
- **Marks**: 3 points each
- **Tackles**: 4 points each
- **Goals**: 6 points each

## Team Structure

Your team consists of:
- **8 Forwards**: Goal-scoring specialists
- **10 Midfielders**: The engine room
- **8 Defenders**: Defensive stalwarts
- **4 Rucks**: The big men

## Captain Selection

Choose a captain who scores double points and a vice-captain who scores 1.5x points.

Good luck and enjoy your AFL Fantasy journey!`,
    category: 'Getting Started',
    tags: ['basics', 'scoring', 'team structure'],
    difficulty: 'beginner',
    readTime: 5,
    rating: 4.8,
    helpful: 156,
    lastUpdated: new Date('2025-08-01'),
  },
  {
    id: '2',
    title: 'Advanced Trading Strategies',
    content: `# Advanced Trading Strategies

Maximize your team's potential with these advanced trading techniques.

## The Donut Strategy

Avoid "donuts" (zero scores) by:
- Monitoring injury reports
- Having bench coverage
- Using emergency players

## Price Prediction

Player prices change based on:
- Recent form (last 3 games)
- Ownership percentage
- Break-even points

## Timing Your Trades

Best times to trade:
- **Tuesday night**: After price changes
- **Wednesday**: Before lockouts
- **Thursday morning**: Final team news

## Popular Trade Targets

Look for players with:
- Improving role/position
- Easy upcoming fixtures
- Low ownership (POD potential)
- Strong break-even trends`,
    category: 'Trading',
    tags: ['advanced', 'strategy', 'pricing'],
    difficulty: 'advanced',
    readTime: 8,
    rating: 4.6,
    helpful: 89,
    lastUpdated: new Date('2025-07-28'),
  },
];

const mockVideos: VideoTutorial[] = [
  {
    id: '1',
    title: 'AFL Fantasy Basics: Your First Team',
    description:
      'Learn how to build your first AFL Fantasy team with this comprehensive beginner guide.',
    duration: '12:34',
    thumbnail: '/api/placeholder/300/200',
    category: 'Getting Started',
    difficulty: 'beginner',
    views: 15420,
    rating: 4.9,
  },
  {
    id: '2',
    title: 'Captain Selection Masterclass',
    description: 'Advanced strategies for choosing the perfect captain each week.',
    duration: '8:45',
    thumbnail: '/api/placeholder/300/200',
    category: 'Strategy',
    difficulty: 'intermediate',
    views: 8930,
    rating: 4.7,
  },
];

const mockFAQs: FAQ[] = [
  {
    id: '1',
    question: 'How many trades do I get per week?',
    answer:
      'You receive 2 trades per week, with a maximum of 30 trades for the entire season. Unused trades do not carry over.',
    category: 'Trading',
    helpful: 245,
  },
  {
    id: '2',
    question: 'When do player prices change?',
    answer:
      'Player prices update every Tuesday night at midnight, based on their recent performance and ownership levels.',
    category: 'Pricing',
    helpful: 189,
  },
  {
    id: '3',
    question: 'Can I change my captain after teams are announced?',
    answer:
      'Yes, you can change your captain and vice-captain until the first bounce of the round, typically Thursday night.',
    category: 'Team Selection',
    helpful: 167,
  },
];

export default function HelpDocumentation({
  articles = mockArticles,
  videos = mockVideos,
  faqs = mockFAQs,
  onSearchQuery,
  onRateContent: _onRateContent,
}: HelpSystemProps) {
  const [activeTab, setActiveTab] = useState<'articles' | 'videos' | 'faqs' | 'contact'>(
    'articles'
  );
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedArticle, setSelectedArticle] = useState<HelpArticle | null>(null);

  // Get unique categories
  const categories = useMemo(() => {
    const allCategories = [
      ...articles.map((a) => a.category),
      ...videos.map((v) => v.category),
      ...faqs.map((f) => f.category),
    ];
    return ['all', ...Array.from(new Set(allCategories))];
  }, [articles, videos, faqs]);

  // Filter content based on search and category
  const filteredArticles = useMemo(() => {
    return articles.filter((article) => {
      const matchesSearch =
        article.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        article.tags.some((tag) => tag.toLowerCase().includes(searchTerm.toLowerCase()));
      const matchesCategory = selectedCategory === 'all' || article.category === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [articles, searchTerm, selectedCategory]);

  const filteredVideos = useMemo(() => {
    return videos.filter((video) => {
      const matchesSearch =
        video.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        video.description.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCategory = selectedCategory === 'all' || video.category === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [videos, searchTerm, selectedCategory]);

  const filteredFAQs = useMemo(() => {
    return faqs.filter((faq) => {
      const matchesSearch =
        faq.question.toLowerCase().includes(searchTerm.toLowerCase()) ||
        faq.answer.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCategory = selectedCategory === 'all' || faq.category === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [faqs, searchTerm, selectedCategory]);

  const getDifficultyColor = (difficulty: string) => {
    switch (difficulty) {
      case 'beginner':
        return 'bg-green-100 text-green-800';
      case 'intermediate':
        return 'bg-yellow-100 text-yellow-800';
      case 'advanced':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const handleSearch = (query: string) => {
    setSearchTerm(query);
    onSearchQuery?.(query);
  };

  if (selectedArticle) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <button
          onClick={() => setSelectedArticle(null)}
          className="flex items-center gap-2 text-blue-600 hover:text-blue-700 mb-6"
        >
          ← Back to Help
        </button>

        <article className="bg-white rounded-xl shadow-lg p-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">{selectedArticle.title}</h1>
              <div className="flex items-center gap-4 mt-2 text-sm text-gray-600">
                <span>{selectedArticle.readTime} min read</span>
                <span
                  className={`px-2 py-1 rounded-full text-xs font-medium ${getDifficultyColor(selectedArticle.difficulty)}`}
                >
                  {selectedArticle.difficulty}
                </span>
                <span>Updated {selectedArticle.lastUpdated.toLocaleDateString()}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <StarIcon className="w-5 h-5 text-yellow-500" />
              <span className="font-medium">{selectedArticle.rating}</span>
              <span className="text-gray-500">({selectedArticle.helpful} helpful)</span>
            </div>
          </div>

          <div className="prose max-w-none">
            {selectedArticle.content.split('\n').map((line, index) => {
              if (line.startsWith('# ')) {
                return (
                  <h1 key={index} className="text-2xl font-bold mb-4">
                    {line.slice(2)}
                  </h1>
                );
              } else if (line.startsWith('## ')) {
                return (
                  <h2 key={index} className="text-xl font-semibold mb-3 mt-6">
                    {line.slice(3)}
                  </h2>
                );
              } else if (line.startsWith('- **')) {
                const match = line.match(/- \*\*(.*?)\*\*: (.*)/);
                if (match) {
                  return (
                    <div key={index} className="mb-2">
                      <strong>{match[1]}</strong>: {match[2]}
                    </div>
                  );
                }
              } else if (line.startsWith('- ')) {
                return (
                  <li key={index} className="mb-1">
                    {line.slice(2)}
                  </li>
                );
              } else if (line.trim()) {
                return (
                  <p key={index} className="mb-4">
                    {line}
                  </p>
                );
              }
              return null;
            })}
          </div>

          <Separator className="mt-8" />
          <div className="pt-6">
            <p className="text-gray-600 mb-4">Was this article helpful?</p>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                className="bg-green-100 text-green-700 hover:bg-green-200"
              >
                👍 Yes
              </Button>
              <Button variant="secondary" className="bg-red-100 text-red-700 hover:bg-red-200">
                👎 No
              </Button>
            </div>
          </div>
        </article>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-3xl font-bold text-gray-900">Help & Documentation</h1>
        <p className="text-gray-600 mt-2">Everything you need to master AFL Fantasy</p>
      </div>

      {/* Search */}
      <div className="max-w-2xl mx-auto">
        <div className="relative">
          <MagnifyingGlassIcon className="w-5 h-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
          <UIInput
            type="text"
            placeholder="Search help articles, videos, and FAQs..."
            value={searchTerm}
            onChange={(e) => handleSearch(e.target.value)}
            className="pl-10 text-lg"
          />
        </div>
      </div>

      {/* Category Filter */}
      <div className="flex justify-center">
        <div className="flex gap-2 p-1 bg-gray-100 rounded-lg">
          {categories.map((category) => (
            <button
              key={category}
              onClick={() => setSelectedCategory(category)}
              className={`px-4 py-2 rounded-md font-medium transition-colors capitalize ${
                selectedCategory === category
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {category}
            </button>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex space-x-1 bg-gray-100 p-1 rounded-lg max-w-2xl mx-auto">
        {[
          { id: 'articles', label: 'Articles', icon: DocumentTextIcon },
          { id: 'videos', label: 'Video Tutorials', icon: VideoCameraIcon },
          { id: 'faqs', label: 'FAQs', icon: QuestionMarkCircleIcon },
          { id: 'contact', label: 'Contact Support', icon: ChatBubbleBottomCenterTextIcon },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as typeof activeTab)}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        {activeTab === 'articles' && (
          <motion.div
            key="articles"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
          >
            {filteredArticles.map((article) => (
              <motion.div
                key={article.id}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-white rounded-xl shadow-lg p-6 cursor-pointer hover:shadow-xl transition-shadow"
                onClick={() => setSelectedArticle(article)}
              >
                <div className="flex items-start justify-between mb-4">
                  <BookOpenIcon className="w-8 h-8 text-blue-600" />
                  <span
                    className={`px-2 py-1 rounded-full text-xs font-medium ${getDifficultyColor(article.difficulty)}`}
                  >
                    {article.difficulty}
                  </span>
                </div>

                <h3 className="text-lg font-semibold text-gray-900 mb-2">{article.title}</h3>
                <p className="text-gray-600 text-sm mb-4">{article.category}</p>

                <div className="flex items-center justify-between text-sm text-gray-500">
                  <span>{article.readTime} min read</span>
                  <div className="flex items-center gap-1">
                    <StarIcon className="w-4 h-4 text-yellow-500" />
                    <span>{article.rating}</span>
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}

        {activeTab === 'videos' && (
          <motion.div
            key="videos"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
          >
            {filteredVideos.map((video) => (
              <motion.div
                key={video.id}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-white rounded-xl shadow-lg overflow-hidden cursor-pointer hover:shadow-xl transition-shadow"
              >
                <div className="relative">
                  <div className="w-full h-48 bg-gray-200 flex items-center justify-center">
                    <PlayIcon className="w-12 h-12 text-gray-400" />
                  </div>
                  <div className="absolute bottom-2 right-2 bg-black bg-opacity-75 text-white text-xs px-2 py-1 rounded">
                    {video.duration}
                  </div>
                  <span
                    className={`absolute top-2 left-2 px-2 py-1 rounded-full text-xs font-medium ${getDifficultyColor(video.difficulty)}`}
                  >
                    {video.difficulty}
                  </span>
                </div>

                <div className="p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">{video.title}</h3>
                  <p className="text-gray-600 text-sm mb-4">{video.description}</p>

                  <div className="flex items-center justify-between text-sm text-gray-500">
                    <span>{video.views.toLocaleString()} views</span>
                    <div className="flex items-center gap-1">
                      <StarIcon className="w-4 h-4 text-yellow-500" />
                      <span>{video.rating}</span>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}

        {activeTab === 'faqs' && (
          <motion.div
            key="faqs"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="bg-white rounded-xl shadow-lg overflow-hidden max-w-4xl mx-auto"
          >
            <Accordion type="single" className="px-6">
              {filteredFAQs.map((faq) => (
                <AccordionItem key={faq.id} value={faq.id} className="last:border-b-0">
                  <AccordionTrigger className="py-6 text-lg font-semibold text-gray-900">
                    {faq.question}
                  </AccordionTrigger>
                  <AccordionContent>
                    <p className="text-gray-600 mb-4">{faq.answer}</p>
                    <div className="flex items-center gap-4 text-sm text-gray-500">
                      <span className="bg-gray-100 px-2 py-1 rounded">{faq.category}</span>
                      <span>{faq.helpful} people found this helpful</span>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </motion.div>
        )}

        {activeTab === 'contact' && (
          <motion.div
            key="contact"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="bg-white rounded-xl shadow-lg p-8 max-w-2xl mx-auto"
          >
            <div className="text-center mb-8">
              <ChatBubbleBottomCenterTextIcon className="w-16 h-16 mx-auto text-blue-600 mb-4" />
              <h3 className="text-2xl font-bold text-gray-900 mb-2">Contact Support</h3>
              <p className="text-gray-600">Need help? We&apos;re here to assist you</p>
            </div>

            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField label="Name">
                  <UIInput id="contact-name" type="text" placeholder="Your name" />
                </FormField>
                <FormField label="Email">
                  <UIInput id="contact-email" type="email" placeholder="your@email.com" />
                </FormField>
              </div>

              <FormField label="Subject">
                <UISelect id="contact-subject">
                  <option>General Question</option>
                  <option>Technical Issue</option>
                  <option>Account Problem</option>
                  <option>Feature Request</option>
                  <option>Bug Report</option>
                </UISelect>
              </FormField>

              <FormField label="Message">
                <UITextarea
                  id="contact-message"
                  rows={5}
                  placeholder="Describe your issue or question..."
                />
              </FormField>

              <Button className="w-full">Send Message</Button>
            </div>

            <Separator className="mt-8" />
            <div className="pt-6 text-center">
              <p className="text-gray-600 mb-2">Prefer live chat?</p>
              <Button className="bg-green-600 hover:bg-green-700">Start Live Chat</Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
