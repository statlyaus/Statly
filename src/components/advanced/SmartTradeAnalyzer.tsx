'use client';

import React, { useState } from 'react';

import { motion, AnimatePresence } from 'framer-motion';

import { TeamLogo } from '@/components/TeamLogo';
import { Badge, Modal, useModal } from '@/components/ui';

// Types
interface Player {
  id: string;
  name: string;
  team: string;
  position: string;
  averageScore: number;
  price: number;
  ownership: number;
  form: number[];
  injuryRisk: 'low' | 'medium' | 'high';
  upcomingFixtures: {
    round: number;
    opponent: string;
    venue: 'home' | 'away';
    difficulty: 1 | 2 | 3 | 4 | 5;
  }[];
}

interface TradeRecommendation {
  id: string;
  type: 'upgrade' | 'downgrade' | 'sideways';
  playerOut: Player;
  playerIn: Player;
  costDifference: number;
  projectedScoreGain: number;
  riskScore: number;
  reasoning: string[];
  confidence: number;
}

interface SmartTradeAnalyzerProps {
  currentTeam?: Player[];
  availableTrades?: number;
  budget?: number;
  onExecuteTrade?: (playerOut: Player, playerIn: Player) => void;
}

// Mock data
const mockPlayers: Player[] = [
  {
    id: '1',
    name: 'Marcus Bontempelli',
    team: 'Western Bulldogs',
    position: 'MID',
    averageScore: 118,
    price: 650000,
    ownership: 67,
    form: [125, 110, 132, 98, 115],
    injuryRisk: 'low',
    upcomingFixtures: [
      { round: 15, opponent: 'Carlton', venue: 'home', difficulty: 3 },
      { round: 16, opponent: 'Collingwood', venue: 'away', difficulty: 4 },
      { round: 17, opponent: 'North Melbourne', venue: 'home', difficulty: 1 },
    ],
  },
  {
    id: '2',
    name: 'Touk Miller',
    team: 'Gold Coast',
    position: 'MID',
    averageScore: 112,
    price: 580000,
    ownership: 23,
    form: [89, 125, 134, 108, 121],
    injuryRisk: 'low',
    upcomingFixtures: [
      { round: 15, opponent: 'Brisbane', venue: 'away', difficulty: 4 },
      { round: 16, opponent: 'Adelaide', venue: 'home', difficulty: 2 },
      { round: 17, opponent: 'West Coast', venue: 'home', difficulty: 1 },
    ],
  },
];

const mockRecommendations: TradeRecommendation[] = [
  {
    id: '1',
    type: 'upgrade',
    playerOut: mockPlayers[1],
    playerIn: mockPlayers[0],
    costDifference: 70000,
    projectedScoreGain: 8.5,
    riskScore: 2,
    reasoning: [
      'Bontempelli has superior scoring consistency',
      'Easier upcoming fixture difficulty',
      'Higher captaincy upside',
    ],
    confidence: 85,
  },
];

export default function SmartTradeAnalyzer({
  currentTeam: _currentTeam = [],
  availableTrades = 2,
  budget = 50000,
  onExecuteTrade,
}: SmartTradeAnalyzerProps) {
  const [activeTab, setActiveTab] = useState<'recommendations' | 'analyzer' | 'comparison'>(
    'recommendations'
  );
  const [selectedPlayerOut, setSelectedPlayerOut] = useState<Player | null>(null);
  const [selectedPlayerIn, setSelectedPlayerIn] = useState<Player | null>(null);
  const [analysisType, setAnalysisType] = useState<'short-term' | 'long-term'>('short-term');

  const modal = useModal();

  const getTradeTypeIcon = (type: TradeRecommendation['type']) => {
    switch (type) {
      case 'upgrade':
        return '↗️';
      case 'downgrade':
        return '↘️';
      case 'sideways':
        return '↔️';
      default:
        return '🔄';
    }
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 80) return 'text-success';
    if (confidence >= 60) return 'text-warning';
    return 'text-destructive';
  };

  const getInjuryRiskColor = (risk: Player['injuryRisk']) => {
    switch (risk) {
      case 'low':
        return 'text-success';
      case 'medium':
        return 'text-warning';
      case 'high':
        return 'text-destructive';
    }
  };

  const calculateFormTrend = (form: number[]) => {
    if (form.length < 2) return 0;
    const recent = form.slice(-3);
    const earlier = form.slice(0, -3);
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const earlierAvg =
      earlier.length > 0 ? earlier.reduce((a, b) => a + b, 0) / earlier.length : recentAvg;
    return recentAvg - earlierAvg;
  };

  const renderPlayerCard = (player: Player, isSelected: boolean = false) => {
    const formTrend = calculateFormTrend(player.form);

    return (
      <motion.div
        layout
        className={`bg-white rounded-lg border-2 p-4 cursor-pointer transition-all ${
          isSelected ? 'border-info/20 shadow-lg' : 'border-border hover:border-border'
        }`}
      >
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="font-semibold text-foreground">{player.name}</div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              {player.team ? <TeamLogo team={player.team} size={16} withCircle decorative /> : null}
              <span>{player.team}</span>
              <Badge variant="outline" size="sm">
                {player.position}
              </Badge>
            </div>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold text-info">{player.averageScore}</div>
            <div className="text-xs text-muted-foreground">Avg</div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 text-sm mb-3">
          <div>
            <div className="text-muted-foreground">Price</div>
            <div className="font-medium">${(player.price / 1000).toFixed(0)}k</div>
          </div>
          <div>
            <div className="text-muted-foreground">Ownership</div>
            <div className="font-medium">{player.ownership}%</div>
          </div>
          <div>
            <div className="text-muted-foreground">Form</div>
            <div
              className={`font-medium ${formTrend > 0 ? 'text-success' : formTrend < 0 ? 'text-destructive' : 'text-muted-foreground'}`}
            >
              {formTrend > 0 ? '📈' : formTrend < 0 ? '📉' : '➡️'}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">Risk:</span>
            <span className={getInjuryRiskColor(player.injuryRisk)}>{player.injuryRisk}</span>
          </div>
          <div className="flex -space-x-1">
            {player.upcomingFixtures.slice(0, 3).map((fixture, idx) => (
              <div
                key={idx}
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                  fixture.difficulty <= 2
                    ? 'bg-success/10 text-success'
                    : fixture.difficulty === 3
                      ? 'bg-warning/10 text-warning'
                      : 'bg-destructive/10 text-destructive'
                }`}
                title={`Round ${fixture.round} vs ${fixture.opponent} (${fixture.venue})`}
              >
                {fixture.difficulty}
              </div>
            ))}
          </div>
        </div>
      </motion.div>
    );
  };

  const renderRecommendationCard = (recommendation: TradeRecommendation) => (
    <motion.div
      key={recommendation.id}
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-lg border border-border p-6 hover:shadow-md transition-shadow"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{getTradeTypeIcon(recommendation.type)}</span>
          <div>
            <div className="font-semibold text-foreground capitalize">
              {recommendation.type} Trade
            </div>
            <div className="text-sm text-muted-foreground">
              {recommendation.playerOut.name} → {recommendation.playerIn.name}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className={`text-lg font-bold ${getConfidenceColor(recommendation.confidence)}`}>
            {recommendation.confidence}%
          </div>
          <div className="text-xs text-muted-foreground">Confidence</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="space-y-2">
          <div className="text-sm font-medium text-foreground">Out</div>
          {renderPlayerCard(recommendation.playerOut)}
        </div>
        <div className="space-y-2">
          <div className="text-sm font-medium text-foreground">In</div>
          {renderPlayerCard(recommendation.playerIn)}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-4 p-3 bg-muted rounded-lg">
        <div className="text-center">
          <div className="text-lg font-bold text-info">
            {recommendation.costDifference > 0 ? '+' : ''}$
            {(recommendation.costDifference / 1000).toFixed(0)}k
          </div>
          <div className="text-xs text-muted-foreground">Cost Impact</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-success">
            +{recommendation.projectedScoreGain.toFixed(1)}
          </div>
          <div className="text-xs text-muted-foreground">Projected Gain</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-warning">{recommendation.riskScore}/5</div>
          <div className="text-xs text-muted-foreground">Risk Score</div>
        </div>
      </div>

      <div className="mb-4">
        <div className="text-sm font-medium text-foreground mb-2">Analysis</div>
        <ul className="space-y-1">
          {recommendation.reasoning.map((reason, idx) => (
            <li key={idx} className="text-sm text-muted-foreground flex items-start gap-2">
              <span className="text-success mt-0.5">✓</span>
              {reason}
            </li>
          ))}
        </ul>
      </div>

      <button
        onClick={() => {
          modal.open();
          setSelectedPlayerOut(recommendation.playerOut);
          setSelectedPlayerIn(recommendation.playerIn);
        }}
        className="w-full bg-info hover:bg-info text-white py-2 px-4 rounded-lg font-medium transition-colors"
      >
        Execute Trade
      </button>
    </motion.div>
  );

  const executeTrade = () => {
    if (selectedPlayerOut && selectedPlayerIn) {
      onExecuteTrade?.(selectedPlayerOut, selectedPlayerIn);
      modal.close();
      setSelectedPlayerOut(null);
      setSelectedPlayerIn(null);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Smart Trade Analyzer</h1>
          <p className="text-muted-foreground mt-1">AI-powered trade recommendations and analysis</p>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-sm">
            <span className="text-muted-foreground">Available Trades:</span>
            <span className="font-semibold text-info ml-1">{availableTrades}</span>
          </div>
          <div className="text-sm">
            <span className="text-muted-foreground">Budget:</span>
            <span className="font-semibold text-success ml-1">
              ${(budget / 1000).toFixed(0)}k
            </span>
          </div>
        </div>
      </div>

      {/* Analysis Type Selector */}
      <div className="flex items-center gap-4 mb-6">
        <span className="text-sm font-medium text-foreground">Analysis Focus:</span>
        <div className="flex space-x-1 bg-muted p-1 rounded-lg">
          {[
            { id: 'short-term', label: 'Next 3 Rounds' },
            { id: 'long-term', label: 'Rest of Season' },
          ].map((option) => (
            <button
              key={option.id}
              onClick={() => setAnalysisType(option.id as typeof analysisType)}
              className={`px-4 py-2 rounded-md font-medium transition-colors ${
                analysisType === option.id
                  ? 'bg-white text-info shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex space-x-1 bg-muted p-1 rounded-lg mb-6">
        {[
          { id: 'recommendations', label: 'AI Recommendations' },
          { id: 'analyzer', label: 'Manual Analyzer' },
          { id: 'comparison', label: 'Player Comparison' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as typeof activeTab)}
            className={`flex-1 px-4 py-2 rounded-md font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-white text-info shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <AnimatePresence mode="wait">
        {activeTab === 'recommendations' && (
          <motion.div
            key="recommendations"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            {mockRecommendations.length > 0 ? (
              <div className="space-y-6">{mockRecommendations.map(renderRecommendationCard)}</div>
            ) : (
              <div className="text-center py-12">
                <div className="text-muted-foreground text-lg mb-2">No recommendations available</div>
                <div className="text-muted-foreground">Your team looks optimized for now!</div>
              </div>
            )}
          </motion.div>
        )}

        {activeTab === 'analyzer' && (
          <motion.div
            key="analyzer"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="text-center py-12"
          >
            <div className="text-muted-foreground text-lg mb-2">Manual Trade Analyzer</div>
            <div className="text-muted-foreground">Select players to analyze potential trades</div>
          </motion.div>
        )}

        {activeTab === 'comparison' && (
          <motion.div
            key="comparison"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="text-center py-12"
          >
            <div className="text-muted-foreground text-lg mb-2">Player Comparison Tool</div>
            <div className="text-muted-foreground">Compare up to 4 players side by side</div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Trade Confirmation Modal */}
      <Modal isOpen={modal.isOpen} onClose={modal.close} title="Confirm Trade" size="md">
        {selectedPlayerOut && selectedPlayerIn && (
          <div className="space-y-4">
            <div className="text-center">
              <div className="text-lg font-semibold text-foreground mb-2">
                {selectedPlayerOut.name} → {selectedPlayerIn.name}
              </div>
              <div className="text-sm text-muted-foreground">
                This will use 1 of your {availableTrades} available trades
              </div>
            </div>

            <div className="bg-muted rounded-lg p-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-muted-foreground">Cost Impact</div>
                  <div className="font-medium">
                    ${((selectedPlayerIn.price - selectedPlayerOut.price) / 1000).toFixed(0)}k
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Projected Gain</div>
                  <div className="font-medium text-success">
                    +{(selectedPlayerIn.averageScore - selectedPlayerOut.averageScore).toFixed(1)}{' '}
                    pts
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={modal.close}
                className="flex-1 px-4 py-2 border border-border text-foreground rounded-lg hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={executeTrade}
                className="flex-1 px-4 py-2 bg-info text-white rounded-lg hover:bg-info"
              >
                Confirm Trade
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
