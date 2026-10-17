import { useEffect, useState, type CSSProperties } from 'react';
import './miso.css';

export type MisoState = 'neutral' | 'thinking' | 'speaking' | 'puzzled' | 'pleased' | 'listening' | 'blink';

interface MisoProps {
  state?: MisoState;
  /** The square frame size. 140–170px suits the study companion panel. */
  size?: number;
  reducedMotion?: boolean;
}

const FRAMES: Record<MisoState, [number, number]> = {
  neutral: [0, 0],
  listening: [0, 0],
  thinking: [1, 0],
  speaking: [2, 0],
  puzzled: [0, 1],
  pleased: [1, 1],
  blink: [2, 1],
};

/** Discrete atlas expressions, with one gentle movement when an active state begins. */
export function Miso({ state = 'neutral', size = 152, reducedMotion = false }: MisoProps) {
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden);
  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);
  const [column, row] = FRAMES[state];
  const style: CSSProperties = {
    width: size,
    height: size,
    backgroundPosition: `${column * 50}% ${row * 100}%`,
  };

  return (
    <div
      className={`miso-character miso-character--${state}${reducedMotion || hidden ? ' miso-character--still' : ''}`}
      style={style}
      role="img"
      aria-label="Miso, your study companion"
      data-state={state}
    />
  );
}

export default Miso;
