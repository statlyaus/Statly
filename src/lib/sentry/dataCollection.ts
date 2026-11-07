// Sentry 11 replaced `sendDefaultPii` with `dataCollection`, whose defaults collect user info,
// cookies, headers, bodies, database query data, queue job arguments and local variables. This keeps
// the v10 behaviour without opt-in: errors and URLs reach Sentry, personal and request data do not.
export const privateSentryDataCollection = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: true,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  mcp: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
};
