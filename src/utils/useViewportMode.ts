import { useEffect, useState } from 'react';

export interface ViewportMode {
  width: number;
  height: number;
  isTouchDevice: boolean;
  isMobilePortrait: boolean;
  isShortLandscape: boolean;
  isCompactViewport: boolean;
}

function readViewportMode(): ViewportMode {
  if (typeof window === 'undefined') {
    return {
      width: 1280,
      height: 720,
      isTouchDevice: false,
      isMobilePortrait: false,
      isShortLandscape: false,
      isCompactViewport: false,
    };
  }

  const width = window.innerWidth || 1280;
  const height = window.innerHeight || 720;
  const isTouchDevice =
    'ontouchstart' in window ||
    (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) ||
    Boolean(window.matchMedia?.('(pointer: coarse)')?.matches);

  const isMobilePortrait = width < 640 && height > width;
  const isShortLandscape = width >= 560 && width > height && height <= 520;
  const isCompactViewport = isMobilePortrait || isShortLandscape || width < 640;

  return {
    width,
    height,
    isTouchDevice,
    isMobilePortrait,
    isShortLandscape,
    isCompactViewport,
  };
}

export function useViewportMode(): ViewportMode {
  const [mode, setMode] = useState<ViewportMode>(readViewportMode);

  useEffect(() => {
    const update = () => {
      setMode(readViewportMode());
    };

    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  return mode;
}
