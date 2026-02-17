import { useState } from 'react';
import { useWSEvent } from '../hooks/useWebSocket';

interface Props {
  connected: boolean;
}

export default function LiveFeedIndicator({ connected }: Props) {
  const [lastEvent, setLastEvent] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);

  useWSEvent('feedback:new', (event) => {
    setLastEvent(`New feedback: ${event.payload.agentId}`);
    setFlash(true);
    setTimeout(() => setFlash(false), 600);
  });

  return (
    <span
      className="live-feed-indicator"
      title={connected ? (lastEvent ?? 'Live feed connected') : 'Live feed disconnected'}
      aria-label={connected ? 'Live feed connected' : 'Live feed disconnected'}
    >
      <span
        className={`live-dot ${connected ? 'connected' : 'disconnected'} ${flash ? 'flash' : ''}`}
        style={{
          display: 'inline-block',
          width: 7,
          height: 7,
          borderRadius: '50%',
          backgroundColor: connected ? 'var(--success)' : 'var(--danger)',
          marginRight: 6,
          boxShadow: connected
            ? (flash ? '0 0 8px 2px var(--success)' : '0 0 4px 1px rgba(74, 222, 128, 0.4)')
            : '0 0 4px 1px rgba(239, 68, 68, 0.4)',
          transition: 'box-shadow 0.3s ease',
          animation: connected && !flash ? 'pulse-live 2s infinite' : 'none',
        }}
      />
      <span
        style={{
          fontSize: '0.68rem',
          color: connected ? 'var(--success)' : 'var(--danger)',
          fontWeight: 600,
          letterSpacing: '0.06em',
        }}
      >
        {connected ? 'LIVE' : 'OFFLINE'}
      </span>
    </span>
  );
}
