import * as Sentry from "@sentry/react";

Sentry.init({
  dsn: "https://6ffbb0f42b9432dc3e0ef0aff3c60f94@o4509945105481728.ingest.us.sentry.io/4509945108299776",
  
  // Setting this option to true will send default PII data to Sentry.
  // For example, automatic IP address collection on events
  sendDefaultPii: true,

  // Performance monitoring
  tracesSampleRate: 1.0,
  
  // Session replay
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
  
  // Environment
  environment: process.env.NODE_ENV || "development",
  
  // Enable debug mode in development
  debug: process.env.NODE_ENV === "development",
});
