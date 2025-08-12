'use client';

import { useEffect, useState } from 'react';

interface CountdownTimerProps {
  initialSeconds: number;
  onExpire?: () => void;
}

export default function CountdownTimer({ initialSeconds, onExpire }: CountdownTimerProps) {
  const [seconds, setSeconds] = useState(initialSeconds);

  useEffect(() => {
    setSeconds(initialSeconds);
  }, [initialSeconds]);

  useEffect(() => {
    if (seconds <= 0) {
      onExpire?.();
      return;
    }
    const id = setInterval(() => setSeconds((s) => s - 1), 1000);
    return () => clearInterval(id);
  }, [seconds, onExpire]);

  return <span>{seconds}s</span>;
}
