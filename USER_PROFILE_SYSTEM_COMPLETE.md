# User Profile System Implementation

## Overview

I've implemented a comprehensive User Profile system that supports multiple league memberships with different settings per league, global and per-league watchlists, and user preferences management.

## Key Features

### ✅ Multi-League Support
- Users can be members of multiple leagues simultaneously
- Each league membership has its own settings and configuration
- Role-based access (OWNER, COMMISSIONER, MEMBER)
- Status tracking (ACTIVE, INVITED, DECLINED, REMOVED)

### ✅ Per-League Settings
- **League Format**: Classic, Draft, Keeper, Dynasty
- **Position Configuration**: Custom starting lineups and position limits
- **Scoring Preferences**: Standard, PPR, Half-PPR, or custom scoring
- **Trade Settings**: Trade deadlines, approval requirements, future picks
- **Waiver Settings**: Rolling, FAAB, or Priority systems
- **Notification Overrides**: League-specific notification preferences

### ✅ Watchlist Management
- **Global Watchlists**: Apply across all leagues
- **League-Specific Watchlists**: Tailored to individual leagues
- **Multiple Watchlists**: Users can create multiple lists per league
- **Shared Watchlists**: Option to share with other league members

### ✅ User Preferences
- **Global Settings**: Default format, scoring system, notifications
- **Privacy Settings**: Profile visibility, contact preferences
- **Display Preferences**: Theme, language, timezone, date format
- **Analytics Level**: Basic, Intermediate, Advanced features

## Architecture

### Core Services

#### 1. UserProfileService (`/src/services/userProfileService.ts`)
- Complete user profile management
- League membership operations
- Watchlist management
- Settings persistence
- Statistics aggregation

#### 2. useUserProfile Hook (`/src/hooks/useUserProfile.ts`)
- React state management for user profiles
- Real-time updates and optimistic UI
- League filtering and sorting
- Error handling and loading states

#### 3. API Routes
- **Profile Management**: `/api/user/profile/[userId]`
- **League Operations**: `/api/user/leagues`
- **Settings Management**: `/api/user/leagues/[leagueId]/settings`
- **Watchlist Operations**: `/api/user/watchlists`

#### 4. UI Components
- **UserProfileManager**: Complete profile management interface
- **League Management**: Join/leave leagues, update settings
- **Watchlist Management**: Create and manage player watchlists
- **Profile Settings**: Update personal information and preferences

## Data Structure

### User Profile
```typescript
interface UserProfile {
  id: string;
  userId: string;
  displayName: string;
  email: string;
  globalSettings: GlobalUserSettings;
  leagueMemberships: LeagueMembership[];
  watchlists: UserWatchlist[];
  preferences: UserPreferences;
}
```

### League Membership
```typescript
interface LeagueMembership {
  id: string;
  userId: string;
  leagueId: string;
  role: 'OWNER' | 'COMMISSIONER' | 'MEMBER';
  status: 'ACTIVE' | 'INVITED' | 'DECLINED' | 'REMOVED';
  memberName: string;
  leagueSettings: LeagueSpecificSettings;
  stats: MembershipStats;
  team?: TeamInfo;
}
```

### League-Specific Settings
```typescript
interface LeagueSpecificSettings {
  format: 'CLASSIC' | 'DRAFT' | 'KEEPER' | 'DYNASTY';
  positionConfig: PositionConfiguration;
  scoringPreferences: ScoringPreferences;
  tradeSettings: TradeSettings;
  waiverSettings: WaiverSettings;
  notificationOverrides: NotificationOverrides;
  watchlist: string[];
  customRankings?: CustomRankings;
}
```

## Usage Examples

### 1. Get User Profile with All Leagues
```typescript
const { profile, leagues, loading } = useUserProfile(userId);

// Filter active leagues
const activeLeagues = filterLeagues({ status: ['ACTIVE'] });

// Get specific league settings
const leagueSettings = getLeagueSettings(leagueId);
```

### 2. Join a League
```typescript
await joinLeague({
  leagueId: 'league-123',
  memberName: 'My Team Name',
  leagueSettings: {
    format: 'DRAFT',
    positionConfig: customPositions,
  },
  inviteCode: 'ABC123',
});
```

### 3. Update League Settings
```typescript
await updateLeagueSettings('league-123', {
  format: 'KEEPER',
  waiverSettings: {
    system: 'FAAB',
    budget: 100,
  },
});
```

### 4. Manage Watchlists
```typescript
// Create global watchlist
await updateWatchlist({
  name: 'Targets',
  playerIds: ['player1', 'player2'],
});

// Create league-specific watchlist
await updateWatchlist({
  leagueId: 'league-123',
  name: 'Draft Targets',
  playerIds: ['player3', 'player4'],
});
```

## Integration Points

### With Existing Systems
- **Authentication**: Uses existing user authentication system
- **League Management**: Integrates with existing league infrastructure
- **Player Data**: References existing player database
- **Notifications**: Extends existing notification system

### Database Integration
- **Firebase/Firestore**: For persistent storage
- **Redis**: For caching and session management
- **Real-time Updates**: WebSocket integration for live updates

## Next Steps

1. **Database Schema**: Implement Firestore collections for user profiles
2. **Authentication Integration**: Connect with existing auth system
3. **Player Integration**: Link with player database for watchlists
4. **Notification System**: Implement league-specific notifications
5. **Statistics Tracking**: Add performance metrics and analytics
6. **Migration Tools**: Migrate existing users to new profile system

## Benefits

### For Users
- **Personalized Experience**: Tailored settings per league
- **Better Organization**: Separate watchlists and preferences
- **Improved Management**: Easy league switching and settings
- **Enhanced Privacy**: Granular privacy controls

### For Platform
- **Scalability**: Supports unlimited leagues per user
- **Flexibility**: Accommodates different league formats
- **Analytics**: Rich user behavior data
- **Retention**: Better user engagement through personalization

This implementation provides a solid foundation for multi-league user management with room for future enhancements and integrations.
