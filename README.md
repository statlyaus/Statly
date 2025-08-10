# Statly - Fantasy AFL Platform

This is a fantasy sports platform for the Australian Football League (AFL), built with Next.js, React, TypeScript, and Firebase.

## Tech Stack

*   **Framework**: [Next.js](https://nextjs.org/)
*   **Language**: [TypeScript](https://www.typescriptlang.org/)
*   **Styling**: [Tailwind CSS](https://tailwindcss.com/)
*   **Authentication & Database**: [Firebase](https://firebase.google.com/)
*   **Linting**: [ESLint](https://eslint.org/)
*   **Formatting**: [Prettier](https://prettier.io/)

## Getting Started

### Prerequisites

1.  Node.js (v18 or later)
2.  `npm` or your favorite package manager
3.  A Firebase project.

### Installation

1.  Clone the repository.
2.  Install dependencies: `npm install`
3.  Create a `.env.local` file in the root of the project and add your Firebase configuration keys. You can get these from your Firebase project settings.

### Environment Variables

The application and helper scripts rely on the following environment variables:

```bash
# Firebase web config used by the Next.js app
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=...

# Service account JSON used by scripts in the Scripts/ directory
GOOGLE_SERVICE_ACCOUNT='{"type":"service_account",...}'
```

`GOOGLE_SERVICE_ACCOUNT` should contain the raw JSON for a Firebase service account. You can set it on the command line, for example:

```bash
export GOOGLE_SERVICE_ACCOUNT="$(cat path/to/serviceAccountKey.json)"
```

### Running the Development Server

Run the following command to start the development server:

```bash
npm run dev
```
