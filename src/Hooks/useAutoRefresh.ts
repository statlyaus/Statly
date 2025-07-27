import { useEffect } from "react";

export function useAutoRefresh(
  callback: () => void,
  deps: any[] = [],
  delay: number = 5000,
  pause: boolean = false
) {
  useEffect(() => {
    if (pause) return;
    const interval = setInterval(callback, delay);
    return () => clearInterval(interval);
  }, [pause, delay, ...deps]);
}