# Sentry Setup Guide

## Overview

Sentry has been configured in your Next.js application for error monitoring, performance tracking, and session replay.

## What's Been Configured

### 1. Core Sentry Integration

- ✅ Sentry React package installed
- ✅ Sentry Next.js plugin installed
- ✅ Basic configuration with your DSN
- ✅ Error boundary wrapper
- ✅ Utility functions for manual operations

### 2. Configuration Files Created

- `src/lib/sentry.ts` - Main Sentry initialization
- `src/lib/sentry-utils.ts` - Utility functions
- `src/components/SentryErrorBoundary.tsx` - Error boundary component
- `sentry.client.config.ts` - Client-side configuration
- `sentry.server.config.ts` - Server-side configuration
- `sentry.edge.config.ts` - Edge runtime configuration
- `.sentryclirc` - CLI configuration (needs your details)

### 3. Application Integration

- ✅ Root layout updated to initialize Sentry early
- ✅ Error boundary wrapping your entire app
- ✅ Performance monitoring enabled

## Required Actions

### 1. Update Organization and Project Names

You need to update the following files with your actual Sentry organization and project details:

**In `next.config.mjs`:**

```javascript
const sentryWebpackPluginOptions = {
  silent: true,
  org: 'YOUR_ACTUAL_ORG_NAME', // Replace this
  project: 'YOUR_ACTUAL_PROJECT_NAME', // Replace this
};
```

**In `.sentryclirc`:**

```ini
[defaults]
url=https://us.sentry.io/
org=YOUR_ACTUAL_ORG_NAME
project=YOUR_ACTUAL_PROJECT_NAME

[auth]
token=YOUR_AUTH_TOKEN
```

### 2. Get Your Sentry Auth Token

1. Go to [Sentry.io](https://sentry.io)
2. Navigate to Settings → Account → API → Auth Tokens
3. Create a new token with `project:write` scope
4. Copy the token and update `.sentryclirc`

### 3. Environment Variables (Optional)

You can add these to your `.env.local` file for environment-specific configuration:

```bash
NEXT_PUBLIC_SENTRY_DSN=https://6ffbb0f42b9432dc3e0ef0aff3c60f94@o4509945105481728.ingest.us.sentry.io/4509945108299776
SENTRY_ORG=your-org-name
SENTRY_PROJECT=your-project-name
SENTRY_AUTH_TOKEN=your-auth-token
```

## Features Enabled

### Error Monitoring

- Automatic error capture and reporting
- Error boundaries for graceful error handling
- User context tracking
- Breadcrumb tracking for debugging

### Performance Monitoring

- Transaction tracking
- Performance metrics
- Custom performance spans

### Session Replay

- Session recording (10% of sessions)
- Error session recording (100% of error sessions)

### Source Maps

- Automatic source map upload during builds
- Better error stack traces in production

## Usage Examples

### Manual Error Reporting

```typescript
import { captureError, setUser, addBreadcrumb } from '@/lib/sentry-utils';

// Set user context
setUser({ id: 'user123', email: 'user@example.com' });

// Add breadcrumb
addBreadcrumb('User clicked button', 'ui', 'info', { buttonId: 'submit' });

// Capture error manually
try {
  // Some operation
} catch (error) {
  captureError(error, { context: 'user-action' });
}
```

### Performance Monitoring

```typescript
import { startTransaction } from '@/lib/sentry-utils';

const transaction = startTransaction('API Call', 'http.request', { endpoint: '/api/data' });

// Your API call logic here

transaction.finish();
```

## Testing the Setup

1. **Build your application:**

   ```bash
   npm run build
   ```

2. **Check Sentry dashboard** for source map uploads

3. **Test error reporting** by intentionally throwing an error in development

4. **Verify performance monitoring** by checking the Performance tab in Sentry

## Troubleshooting

### Common Issues

1. **Source maps not uploading:**
   - Verify your auth token has correct permissions
   - Check organization and project names match exactly
   - Ensure `.sentryclirc` is in your project root

2. **Errors not appearing in Sentry:**
   - Verify DSN is correct
   - Check browser console for Sentry initialization errors
   - Ensure error boundary is properly wrapping your app

3. **Build failures:**
   - Check Sentry webpack plugin configuration
   - Verify all required packages are installed

## Support

- [Sentry Documentation](https://docs.sentry.io/)
- [Sentry Next.js Integration](https://docs.sentry.io/platforms/javascript/guides/nextjs/)
- [Sentry React Documentation](https://docs.sentry.io/platforms/javascript/guides/react/)

## Next Steps

1. Update the configuration files with your actual Sentry details
2. Test the setup in development
3. Deploy and verify production error reporting
4. Set up alerts and notifications in Sentry dashboard
5. Configure team access and permissions
