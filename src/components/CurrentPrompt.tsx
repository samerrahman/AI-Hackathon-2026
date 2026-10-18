import { useEffect, useId, useState } from 'react';
import { RichText } from './RichText';

/** Long explanations expand explicitly so the response controls remain easy to reach. */
export function CurrentPrompt({text}:{text:string}) {
  const [expanded,setExpanded]=useState(false);
  const id=useId();
  const long=text.length>220;
  useEffect(()=>setExpanded(false),[text]);
  return <div className="current-prompt">
    <h2 id={id} className={`prompt-text ${long&&!expanded?'prompt-collapsed':''}`}><RichText text={text}/></h2>
    {long&&<button className="text-button expand-prompt" aria-expanded={expanded} aria-controls={id} onClick={()=>setExpanded(value=>!value)}>{expanded?'Show less':'Read full response'}</button>}
  </div>;
}
