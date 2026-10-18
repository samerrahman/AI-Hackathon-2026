/** Read only completed top-level fields and a partial JSON string, never raw JSON. */
export function readReplyPrefix(json: string): { fields: Record<string,unknown>; text: string } {
  const fields: Record<string,unknown>={};
  let i=0;
  const whitespace=()=>{while(/\s/.test(json[i]??'')&&i<json.length)i++;};
  whitespace();if(json[i++]!=='{')return{fields,text:''};
  while(i<json.length){
    whitespace();if(json[i]===','){i++;whitespace();}
    if(json[i]!== '"')break;
    const keyStart=i++;let escaped=false;
    while(i<json.length){const c=json[i++];if(escaped){escaped=false;continue;}if(c==='\\'){escaped=true;continue;}if(c==='"')break;}
    let key:string;try{key=JSON.parse(json.slice(keyStart,i));}catch{break;}
    whitespace();if(json[i++]!==':')break;whitespace();
    const start=i;
    if(key==='visibleText'&&json[i]==='"'){
      i++;let text='';
      while(i<json.length){
        const c=json[i++];if(c==='"')return{fields,text};
        if(c==='\\'){
          if(i>=json.length)break;
          const code=json[i++];
          if(code==='u'){const digits=json.slice(i,i+4);if(!/^[0-9a-f]{4}$/i.test(digits))break;text+=String.fromCharCode(parseInt(digits,16));i+=4;}
          else{const escapes:Record<string,string>={'"':'"','\\':'\\','/':'/',n:'\n',r:'\r',t:'\t',b:'\b',f:'\f'};if(!(code in escapes))break;text+=escapes[code];}
        }else text+=c;
      }
      // Avoid an incomplete surrogate at a chunk boundary.
      return{fields,text:text.replace(/[\uD800-\uDBFF]$/,'')};
    }
    let depth=0,inString=false;escaped=false;let complete=false;
    for(;i<json.length;i++){
      const c=json[i];
      if(inString){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')inString=false;continue;}
      if(c==='"'){inString=true;continue;}
      if(c==='['||c==='{')depth++;
      if(c===']'||c==='}'){if(depth===0){complete=true;break;}depth--;}
      if(c===','&&depth===0){complete=true;break;}
    }
    if(!complete)break;
    try{fields[key]=JSON.parse(json.slice(start,i));}catch{break;}
  }
  return{fields,text:''};
}
