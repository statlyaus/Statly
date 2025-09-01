# Production Cleanup Tasks

## 1. Replace Console Statements

Find and replace all console.log with proper logging:

```bash
# Search for console statements
grep -r "console\." src/ --include="*.ts" --include="*.tsx"

# Replace with logger
# console.log → logger.info
# console.error → logger.error
# console.warn → logger.warn
```

## 2. Remove Development Features

- Remove development tools from login page
- Remove mock data creation buttons
- Remove development bypasses in `UnifiedDraftRoom` (replaces `DraftRoomClient`)
- Remove debug statements in all components

## 3. Replace Alert() Calls

All alert() calls need to be replaced with proper UI notifications:

- src/app/tradecentre/page.tsx:68
- src/app/drafts/create/page.tsx:47

## 4. Environment Configuration

Create production environment file with all required variables.

## 5. Security Headers

Add comprehensive security headers to next.config.mjs

## 6. Error Tracking

Implement Sentry or similar error tracking service.
