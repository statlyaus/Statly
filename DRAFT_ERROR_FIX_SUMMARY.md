# [Archived] Draft Container "Failed to fetch" Error - RESOLVED

> **Note**: `DraftContainer` has been replaced by `UnifiedDraftRoom`. This error scenario applied only to the deprecated component and is retained here for historical reference. The current `UnifiedDraftRoom` implementation handles draft lookups without this issue.

## Problem Summary

Users were experiencing a recurring "Failed to fetch" error in the DraftContainer component, which was appearing in the browser console every 5 seconds with the following stack trace:

```
TypeError: Failed to fetch
DraftContainer.useCallback[fetchLobbyState]
DraftContainer.useEffect.interval
```

## Root Cause Analysis

The issue was occurring because:

1. **Users were accessing invalid draft URLs** - URLs like `/drafts/some-invalid-id` where the draft doesn't exist in the database
2. **Poor error handling** - The component was treating all API responses as "network errors" even when the server properly returned a 500 status with "Draft not found"
3. **Continuous polling** - The component continued to poll the API every 5 seconds even when the draft was confirmed to not exist
4. **Misleading error messages** - Users saw "Failed to fetch" instead of a clear "Draft not found" message

## Solution Implemented

### 1. Enhanced Error Detection

- **Before**: All non-200 responses were treated as generic "Failed to fetch" errors
- **After**: Specific detection of "Draft not found" errors (status 500 with "Draft not found" message)

### 2. Improved Error Messages

- **Before**: Generic "Failed to fetch" error shown to users
- **After**: Clear, helpful error page with:
  - "Draft Not Found" heading
  - Explanation that the draft doesn't exist or was deleted
  - Links to view available drafts and draft center
  - Option to retry

### 3. Smart Polling Management

- **Before**: Continued polling every 5 seconds regardless of error type
- **After**: Stops polling when "Draft not found" error is detected to prevent unnecessary server load

### 4. Better User Experience

- **Before**: Confusing error with no clear resolution path
- **After**:
  - Clear error page with actionable options
  - Direct links to test-draft page to find valid drafts
  - Link to draft center for navigation

## Code Changes Made

### DraftContainer.tsx

1. **Enhanced error detection logic**:

   ```typescript
   if (
     response.status === 404 ||
     (response.status === 500 && errorData.error?.message?.includes('Draft not found'))
   ) {
     setError('DRAFT_NOT_FOUND');
   }
   ```

2. **Special error UI for draft not found**:
   - Custom error page with helpful messaging
   - Links to available drafts and draft center
   - Visual error icon for better UX

3. **Improved polling logic**:
   ```typescript
   if (!isForced && error !== 'DRAFT_NOT_FOUND') {
     // Don't poll if draft not found
     fetchLobbyState();
   }
   ```

## Testing Results

### Valid Draft IDs

- ✅ Working correctly with real draft IDs like `cmei9md7800047g6exlumofkt`
- ✅ Proper lobby state loading and display
- ✅ Timer and draft functionality working

### Invalid Draft IDs

- ✅ Clear "Draft Not Found" error page
- ✅ No more continuous "Failed to fetch" errors
- ✅ Helpful navigation links provided
- ✅ Polling stops to prevent server load

## Available Valid Drafts

Users can find valid draft URLs by visiting `/test-draft` which shows:

- List of all existing drafts in the database
- Direct "Enter Draft" links for each
- Debug links for troubleshooting

## API Endpoints for Testing

- `/api/drafts/list` - List all available drafts
- `/api/drafts/[id]/debug` - Debug specific draft details
- `/api/drafts/[id]/lobby` - Lobby state for specific draft

## Resolution Status: ✅ COMPLETE

- Error properly identified and categorized
- User experience significantly improved
- Server load reduced by stopping unnecessary polling
- Clear navigation paths provided for users

The "Failed to fetch" error has been resolved and replaced with proper error handling and user guidance.
