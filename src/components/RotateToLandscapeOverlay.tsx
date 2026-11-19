import React, { useEffect, useState } from 'react';
import { RotateCw, Smartphone } from 'lucide-react';
import { t } from '../i18n/translations';
import { useGameStore } from '../store/useGameStore';
import { enableRotateScreen, useViewportMode } from '../utils/useViewportMode';

export const RotateToLandscapeOverlay: React.FC = () => {
  const language = useGameStore((s) => s.language);
  // Smartphones only: tablets, desktops and narrowed desktop windows never see this prompt
  const { isSmartphonePortrait } = useViewportMode();
  const [dismissed, setDismissed] = useState(false);
  const [manualRotateHint, setManualRotateHint] = useState(false);
  const [autoLockTried, setAutoLockTried] = useState(false);
  const [autoLocked, setAutoLocked] = useState(false);

  // Run enable-rotate as soon as a portrait smartphone is detected; succeeds silently in PWA/fullscreen
  useEffect(() => {
    if (!isSmartphonePortrait || autoLockTried) return;
    setAutoLockTried(true);
    void enableRotateScreen(false).then(setAutoLocked);
  }, [isSmartphonePortrait, autoLockTried]);

  if (!isSmartphonePortrait || dismissed || autoLocked) {
    return null;
  }

  const handleRotateToLandscape = async () => {
    const locked = await enableRotateScreen(true);
    if (!locked) setManualRotateHint(true);
  };

  return (
    <div
      data-testid="rotate-to-landscape-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rotate-landscape-heading"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#1C3529]/85"
    >
      <div className="w-full max-w-sm max-h-[92vh] overflow-y-auto rounded-2xl bg-[#FAF5EA] border border-[#244D3B]/25 shadow-2xl p-6 text-center space-y-4">
        {/* Clean Brand SVG Phone Rotation Graphic */}
        <div className="mx-auto w-20 h-20 rounded-2xl bg-[#D9E8C8]/70 border border-[#244D3B]/20 flex items-center justify-center relative">
          <svg
            width="52"
            height="52"
            viewBox="0 0 56 56"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <rect
              x="16"
              y="8"
              width="20"
              height="32"
              rx="3.5"
              fill="#FAF5EA"
              stroke="#244D3B"
              strokeWidth="2.2"
              strokeDasharray="3 2"
            />
            <rect
              x="14"
              y="22"
              width="32"
              height="20"
              rx="3.5"
              fill="#ED9B53"
              stroke="#244D3B"
              strokeWidth="2.4"
            />
            <circle cx="41.5" cy="32" r="1.6" fill="#244D3B" />
            <path
              d="M38 11C43.5 11.8 47 15.6 47 20"
              stroke="#244D3B"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
            <path
              d="M44.5 18.2L47 21L49.5 18.2"
              stroke="#244D3B"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[#6E9B72]">
            <Smartphone className="w-3.5 h-3.5" />
            <span>{t(language, 'Mobile View', 'Tampilan Ponsel')}</span>
          </div>
          <h2
            id="rotate-landscape-heading"
            className="font-display text-xl font-bold text-[#244D3B]"
          >
            {t(language, 'Rotate to Landscape', 'Putar ke Mode Lanskap')}
          </h2>
          <p className="text-xs text-[#355446] leading-relaxed">
            {t(
              language,
              'Dimsumpreneur’s 3D kitchen, station controls, and dual-thumb gameplay look and feel best in landscape orientation.',
              'Dapur 3D Dimsumpreneur, kontrol stasiun, dan navigasi sentuh paling lega dimainkan dalam posisi lanskap (mendatar).',
            )}
          </p>
        </div>

        {manualRotateHint && (
          <div className="rounded-xl bg-[#FFF3DC] border border-[#ED9B53]/70 px-3 py-2 text-[11px] font-medium text-[#92400E] leading-snug">
            {t(
              language,
              'Auto-lock is restricted by your browser. Please enable screen auto-rotate and turn your device sideways.',
              'Rotasi otomatis dibatasi oleh browser. Aktifkan rotasi layar di ponsel lalu miringkan perangkat Anda.',
            )}
          </div>
        )}

        <div className="space-y-2 pt-1">
          <button
            type="button"
            data-testid="rotate-landscape-btn"
            onClick={handleRotateToLandscape}
            className="w-full inline-flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-[#ED9B53] hover:bg-[#DF883D] text-[#1C3529] font-bold text-sm shadow-sm cursor-pointer transition-colors"
          >
            <RotateCw className="w-4 h-4" />
            <span>{t(language, 'Rotate to Landscape', 'Putar ke Mode Lanskap')}</span>
          </button>

          <button
            type="button"
            data-testid="continue-portrait-btn"
            onClick={() => setDismissed(true)}
            className="w-full py-2.5 px-4 rounded-xl bg-white border border-[#244D3B]/20 hover:bg-[#D9E8C8]/60 text-[#244D3B] font-semibold text-xs cursor-pointer transition-colors"
          >
            {t(language, 'Continue in Portrait', 'Lanjut Mode Potret')}
          </button>
        </div>
      </div>
    </div>
  );
};
