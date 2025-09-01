import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: "https://6ffbb0f42b9432dc3e0ef0aff3c60f94@o4509945105481728.ingest.us.sentry.io/4509945108299776",
  
  // Performance monitoring
  tracesSampleRate: 1.0,
  
  // Environment
  environment: process.env.NODE_ENV || "development",
  
  // Enable debug mode in development
  debug: process.env.NODE_ENV === "development",
});
