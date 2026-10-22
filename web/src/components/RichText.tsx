import katex from 'katex';
import 'katex/dist/katex.min.css';
export function RichText({text}:{text:string}) {
  const pieces=text.split(/(\$\$[\s\S]*?\$\$|\$[^\n$]+\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\])/g);
  return <>{pieces.map((part,i)=>{
    const display=part.startsWith('$$')||part.startsWith('\\[');
    const math=part.startsWith('$')||part.startsWith('\\(')||part.startsWith('\\[');
    if(!math)return <span key={i}>{part}</span>;
    const formula=part.slice(display||part.startsWith('\\')?2:1,display||part.startsWith('\\')?-2:-1);
    return <span key={i} dangerouslySetInnerHTML={{__html:katex.renderToString(formula,{throwOnError:false,displayMode:display,trust:false,strict:'ignore'})}}/>;
  })}</>;
}
