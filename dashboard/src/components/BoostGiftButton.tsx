import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Gift } from 'lucide-react';

interface BoostGiftButtonProps {
  onBoostClick: (e: React.MouseEvent) => void;
}

export default function BoostGiftButton({ onBoostClick }: BoostGiftButtonProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number } | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const updatePosition = useCallback(() => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    setTooltipPos({
      top: rect.top - 8,
      left: rect.left + rect.width / 2,
    });
  }, []);

  const handleMouseEnter = () => {
    timeoutRef.current = setTimeout(() => {
      updatePosition();
      setShowTooltip(true);
    }, 300);
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setShowTooltip(false);
  };

  useLayoutEffect(() => {
    if (showTooltip) updatePosition();
  }, [showTooltip, updatePosition]);

  useEffect(() => {
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); };
  }, []);

  return (
    <>
      <button
        ref={btnRef}
        className="boost-gift-btn"
        onClick={(e) => {
          e.stopPropagation();
          onBoostClick(e);
        }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        aria-label="Boost this skill"
      >
        <Gift className="boost-gift-icon" />
      </button>
      {showTooltip && tooltipPos && createPortal(
        <div
          className="boost-gift-tooltip"
          style={{ top: tooltipPos.top, left: tooltipPos.left }}
        >
          Stake to boost. Unlock priority routing, higher revenue share, and verified trust.
        </div>,
        document.body,
      )}
    </>
  );
}
