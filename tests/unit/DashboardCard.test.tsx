import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import DashboardCard from '../../src/components/dashboard/DashboardCard';

describe('DashboardCard', () => {
  it('renders sanitized error state', () => {
    const { getByRole } = render(<DashboardCard title="Test" error="network offline" />);
    expect(getByRole('alert').textContent).toContain('Network error');
  });
});
