import { render, screen } from '@testing-library/react';
import { MotionConfigContext } from 'framer-motion';
import { useContext } from 'react';

import MotionPreferenceProvider from '../MotionPreferenceProvider';

function ReducedMotionSetting() {
  const { reducedMotion } = useContext(MotionConfigContext);
  return <span>{reducedMotion}</span>;
}

describe('MotionPreferenceProvider', () => {
  it('makes every framer-motion animation follow the operating system reduced-motion setting', () => {
    render(
      <MotionPreferenceProvider>
        <ReducedMotionSetting />
      </MotionPreferenceProvider>
    );

    expect(screen.getByText('user')).toBeInTheDocument();
  });
});
