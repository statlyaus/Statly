import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AdminWorkersPage from './page';

vi.mock('./AdminWorkersClient', () => ({
  default: () => <div>Admin worker controls</div>,
}));

describe('AdminWorkersPage', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does not render worker controls by default', async () => {
    render(await AdminWorkersPage());

    expect(screen.getByText(/Worker controls are not available/)).toBeInTheDocument();
    expect(screen.queryByText('Admin worker controls')).not.toBeInTheDocument();
  });

  it('renders worker controls only for the explicit local operator UI', async () => {
    vi.stubEnv('STATLY_RUNTIME_ENV', 'local');
    vi.stubEnv('STATLY_ENABLE_ADMIN_WORKER_UI', 'true');

    render(await AdminWorkersPage());

    expect(screen.getByText('Admin worker controls')).toBeInTheDocument();
    expect(screen.queryByText(/Worker controls are not available/)).not.toBeInTheDocument();
  });
});
