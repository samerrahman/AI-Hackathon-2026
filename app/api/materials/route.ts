import JSZip from 'jszip';

export const runtime = 'nodejs';
const MAX_BYTES = 8 * 1024 * 1024;

function cleanText(value: string) {
  return value.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}

async function extractPptx(buffer: ArrayBuffer) {
  const zip = await JSZip.loadAsync(buffer);
  const slideNames = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((a,b)=>Number(a.match(/\d+/)?.[0])-Number(b.match(/\d+/)?.[0]));
  const slides: string[] = [];
  for (const name of slideNames.slice(0, 40)) {
    const xml = await zip.file(name)?.async('string');
    if (!xml) continue;
    const text = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((match) => match[1]).join(' ');
    if (text.trim()) slides.push(cleanText(text));
  }
  return slides.join('\n');
}

function inferSubject(text: string) {
  const value = text.toLowerCase();
  if (/code|variable|loop|algorithm|program|javascript|python/.test(value)) return 'Computer Science';
  if (/equation|fraction|geometry|algebra|calculate|number/.test(value)) return 'Math';
  if (/cell|energy|plant|atom|force|water|biology|chemistry|physics/.test(value)) return 'Science';
  if (/revolution|war|century|empire|government|civilization/.test(value)) return 'History';
  if (/metaphor|poem|novel|grammar|writing|literature/.test(value)) return 'English';
  return 'Other';
}

function inferTopic(filename: string, text: string) {
  const first = text.split(/\n|[.!?]/).map((line)=>line.trim()).find((line)=>line.length >= 4 && line.length <= 80);
  if (first) return first.replace(/^(lesson|chapter|unit)\s*\d*[:\-]?\s*/i,'').slice(0,80);
  return filename.replace(/\.(pptx?|txt|md|rtf)$/i,'').replace(/[_-]+/g,' ').trim().slice(0,80) || 'My class notes';
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get('material');
    if (!(file instanceof File)) return Response.json({error:'Choose a notes or PowerPoint file first.'},{status:400});
    if (file.size > MAX_BYTES) return Response.json({error:'Please choose a file smaller than 8 MB.'},{status:413});
    const lower = file.name.toLowerCase();
    let text = '';
    if (/\.(txt|md|rtf)$/.test(lower)) text = cleanText(await file.text());
    else if (lower.endsWith('.pptx')) text = await extractPptx(await file.arrayBuffer());
    else if (lower.endsWith('.ppt')) text = '';
    else return Response.json({error:'Use a TXT, Markdown, RTF, PPT, or PPTX file.'},{status:415});
    const topic = inferTopic(file.name,text);
    return Response.json({name:file.name,topic,subject:inferSubject(`${file.name} ${text}`),excerpt:text.slice(0,12000),slides:text?text.split('\n').length:0,note:text?'Material ready for your AI student.':'Older PPT detected. I used the filename for the topic; save as PPTX to include slide text.'});
  } catch {
    return Response.json({error:'I could not read that file. Try exporting it as PPTX or plain text.'},{status:422});
  }
}
