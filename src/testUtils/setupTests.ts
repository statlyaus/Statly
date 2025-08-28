import '@testing-library/jest-dom';

// Ensure React is in scope for classic JSX tests if any rely on it
// With jsx: automatic this is usually not required, but some tests might assume it
import * as React from 'react';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const reactForJsx = React;


