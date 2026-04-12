import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Ensure React is in scope for classic JSX tests if any rely on it
// With jsx: automatic this is usually not required, but some tests might assume it
import * as React from 'react';

const reactForJsx = React;

vi.mock('server-only', () => ({}));
