import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type React from 'react';
import './miso.css';

export type MisoState = 'neutral' | 'thinking' | 'speaking' | 'puzzled' | 'pleased' | 'listening' | 'blink';

interface MisoProps {
  state?: MisoState;
  /** The square frame size. 140–170px suits the study companion panel. */
  size?: number;
  reducedMotion?: boolean;
  /** Click or press Enter to bounce. Turn off for small decorative avatars. */
  interactive?: boolean;
  /** Bounce on click only, outside the tab order: for repeated avatars such as the ones beside chat messages. */
  clickOnly?: boolean;
}

function Face({ state }: { state: MisoState }) {
  const eyes = state === 'blink'
    ? <><path className="stu-line" d="M34 57q8-7 15 0M67 54q10-8 19 0"/></>
    : <><ellipse className="stu-eye-white" cx="42" cy="53" rx="12" ry="13"/><ellipse className="stu-eye-white" cx="76" cy="49" rx="15" ry="17"/><circle className="stu-eye" cx={state === 'thinking'?46:43} cy={state === 'thinking'?48:54} r="5.5"/><circle className="stu-eye" cx={state === 'thinking'?81:76} cy={state === 'thinking'?43:50} r="7"/></>;
  const mouth = state === 'speaking'
    ? <ellipse className="stu-mouth" cx="60" cy="80" rx="10" ry="8"/>
    : <path className="stu-line stu-mouth-line" d={state === 'puzzled'||state === 'thinking'?'M43 81q9-9 18 0t18-1':'M41 77q19 20 38 0'}/>;
  return <>{eyes}{mouth}</>;
}

/** A deliberately simple, scalable student companion with stateful expressions. */
export function Miso({ state = 'neutral', size = 152, reducedMotion = false, interactive = true, clickOnly = false }: MisoProps) {
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden);
  const bounceTimer = useRef<number | null>(null);
  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);
  useEffect(() => () => { if(bounceTimer.current!==null)window.clearTimeout(bounceTimer.current); }, []);
  const style = { width: size, height: size } as CSSProperties;
  const bounce = (svg: SVGSVGElement) => {
    svg.classList.remove('miso-character--bounce');
    void svg.getBoundingClientRect();
    svg.classList.add('miso-character--bounce');
    if(bounceTimer.current!==null)window.clearTimeout(bounceTimer.current);
    bounceTimer.current=window.setTimeout(()=>svg.classList.remove('miso-character--bounce'),620);
  };
  return <svg className={`miso-character miso-character--${state}${reducedMotion || hidden ? ' miso-character--still' : ''}`} style={style} viewBox="0 0 120 120" data-state={state}
    {...(clickOnly
      ? { role: 'img', 'aria-label': 'Stu', 'data-clickable': true, onClick: (event: React.MouseEvent<SVGSVGElement>) => bounce(event.currentTarget) }
      : interactive
      ? { role: 'button', tabIndex: 0, 'aria-label': 'Bounce Stu', onClick: (event: React.MouseEvent<SVGSVGElement>) => bounce(event.currentTarget),
          onKeyDown: (event: React.KeyboardEvent<SVGSVGElement>) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); bounce(event.currentTarget); } } }
      : { role: 'img', 'aria-label': 'Stu' })}>
    <g className="stu-stretch">
      <circle className="stu-head" cx="60" cy="63" r="44"/>
      <path className="stu-curl" d="M57 20q7-13 17-5"/>
      <Face state={state}/>
    </g>
  </svg>;
}

export default Miso;
