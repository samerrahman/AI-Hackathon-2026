import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const bounded='Boundedness keeps the terms in a finite interval, but a bounded sequence can alternate and does not have to converge.';
async function sample(page:Page,subject:'analysis'|'research'='analysis'){
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'Try a sample session'}).click();
  await page.getByRole('button',{name:subject==='analysis'?'Sequences & convergence Real analysis':'Experiments & causal claims Research methods'}).click();
  await expect(page.getByRole('button',{name:'Start teaching'})).toBeEnabled();
  await page.getByRole('button',{name:'Start teaching'}).click();
  await expect(page.locator('.conversation-current h2')).not.toBeEmpty();
  await expect(page.getByRole('button',{name:'Give me a hint'})).toBeEnabled();
}
async function answer(page:Page,text:string){
  await page.getByRole('textbox',{name:'Your explanation'}).fill(text);
  await page.getByRole('button',{name:'Send explanation'}).click();
  await expect(page.getByRole('textbox',{name:'Your explanation'})).toHaveValue('');
  await expect(page.getByRole('button',{name:'Give me a hint'})).toBeEnabled();
}

test('sample: real PDF, correction, source highlights, pause/resume and recap',async({page})=>{
  const faults:string[]=[];page.on('pageerror',e=>faults.push(e.message));
  await page.goto('/',{waitUntil:'domcontentloaded'});await page.screenshot({path:'artifacts/miso-welcome.png',fullPage:true});
  await sample(page);
  await expect(page.locator('.textLayer span').first()).toBeVisible();
  const textLine=page.locator('.textLayer span').filter({hasText:'A real sequence is an ordered list'}).first();
  const box=await textLine.boundingBox();expect(box).toBeTruthy();
  await page.mouse.move(box!.x+2,box!.y+box!.height/2);await page.mouse.down();
  await page.mouse.move(box!.x+box!.width-2,box!.y+box!.height/2,{steps:8});await page.mouse.up();
  await expect(page.locator('.selection-bar')).toBeVisible();
  await page.getByRole('button',{name:'Clear passage context'}).click();
  await answer(page,bounded);await expect(page.locator('.conversation-current')).toContainText('Check my understanding');
  await answer(page,bounded);await answer(page,bounded);
  await expect(page.getByRole('button',{name:'Let me correct that'})).toBeVisible();
  await expect(page.locator('.source-highlight')).toHaveCount(0);
  await page.getByRole('button',{name:'Show me in the notes'}).click();
  await expect(page.locator('.source-quote-card')).toBeVisible();
  expect(await page.locator('.source-highlight').count()).toBeGreaterThan(0);
  const relative=await page.locator('.source-highlight').first().getAttribute('style');
  await page.getByRole('button',{name:'Zoom in',exact:true}).click();
  await expect(page.locator('.source-highlight').first()).toHaveAttribute('style',relative!);
  await page.screenshot({path:'artifacts/miso-workspace.png',fullPage:true});
  await page.setViewportSize({width:1024,height:768});
  await expect(page.locator('.concept-sidebar')).toBeHidden();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'artifacts/miso-tablet.png',fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await answer(page,'No. A bounded sequence can alternate between minus one and one, so boundedness does not imply convergence.');
  await expect(page.locator('.conversation-current h2')).toContainText('a bounded sequence may still oscillate and fail to converge');
  await expect(page.getByRole('button',{name:'Let me correct that'})).toHaveCount(0);
  await page.getByRole('button',{name:'Pause session'}).click();
  await expect(page.getByRole('button',{name:'Resume session'})).toBeVisible();
  await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Resume session'}).click();
  await expect(page.locator('.conversation-current h2')).toContainText('a bounded sequence may still oscillate and fail to converge');
  await page.getByRole('button',{name:'Give me a hint'}).click();
  await expect(page.locator('.conversation-current')).toContainText('alternates');
  await page.getByRole('button',{name:'End session'}).click();
  await expect(page.getByRole('heading',{name:'Mix-ups you worked through'})).toBeVisible();
  await expect(page.locator('.recap-page')).toContainText('a bounded sequence may still oscillate');
  await page.screenshot({path:'artifacts/miso-recap.png',fullPage:true});
  expect(faults).toEqual([]);
});

test('accepting a false paraphrase resolves before recap without praise',async({page})=>{
  await sample(page);await answer(page,bounded);await answer(page,bounded);await answer(page,bounded);
  await answer(page,'Yes, that sounds right.');
  await expect(page.locator('.conversation-current h2')).toContainText('alternates');
  await page.getByRole('button',{name:'End session'}).click();
  await expect(page.locator('.resolution-card')).toContainText('may still oscillate and fail to converge');
  await expect(page.getByRole('heading',{name:'Worth another pass'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Mix-ups you worked through'})).toHaveCount(0);
});

test('research demo, typed path when voice is unavailable, narrow screen and reduced motion',async({page})=>{
  await page.route('**/api/config',async route=>{const response=await route.fetch();await route.fulfill({json:{...await response.json(),voiceAvailable:false,voiceProvider:'StepFun'}});});
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});
  await sample(page,'research');
  await page.getByRole('button',{name:'Start explaining'}).click();
  await expect(page.getByRole('alert')).toContainText('Voice is not configured');
  await answer(page,'Random sampling concerns who enters the study; random assignment allocates participants to treatment groups.');
  await expect(page.locator('.conversation-current')).toContainText('Random sampling');
  await expect(page.locator('.conversation-current h2')).toContainText('Assignment alone does not make a volunteer sample representative.');
  expect(await page.locator('.miso-character').evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'artifacts/miso-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'Notes',exact:true}).click();
  await expect(page.locator('.document-paper')).toBeVisible();
  await page.getByRole('button',{name:'Next page',exact:true}).click();
  await expect(page.getByRole('spinbutton',{name:'Page number'})).toHaveValue('2');
  await page.getByRole('button',{name:'Conversation',exact:true}).click();
  await page.getByRole('textbox',{name:'Your explanation'}).fill('Draft stays when I read.');
  await page.getByRole('button',{name:'Notes',exact:true}).click();
  await page.getByRole('button',{name:'Conversation',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Your explanation'})).toHaveValue('Draft stays when I read.');
});

test('fresh pasted notes stay honest without keys and all persisted data can be deleted',async({page})=>{
  await page.route('**/api/config',async route=>{const response=await route.fetch();await route.fulfill({json:{...await response.json(),liveAvailable:false,voiceAvailable:false}});});
  await page.route('**/api/turn',async route=>route.fulfill({status:503,json:{error:'Live study needs STEPFUN_API_KEY on the server.'}}));
  await page.goto('/',{waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Paste notes',exact:true}).click();
  await page.getByLabel('Title',{exact:true}).fill('Moss and moisture');
  await page.getByLabel('Lecture text').fill('Capillary storage retains moisture in narrow spaces. In our moss sample, wider gaps reduced retention. This observation does not establish that every species responds identically. The instrument measured retained water after ten minutes, not lifetime survival.');
  await page.getByRole('button',{name:'Add these notes'}).click();
  await page.getByRole('button',{name:'Prepare my session'}).click();
  await expect(page.getByText('Your notes are ready. Live conversation needs a connection.')).toBeVisible();
  await page.getByText('Choose a page range or add a concept').click();
  await page.getByRole('textbox',{name:'New concept title'}).fill('Capillary storage');await page.getByRole('button',{name:'Add concept',exact:true}).click();
  await page.getByRole('button',{name:'Start teaching'}).click();
  await expect(page.locator('.pasted-document-heading')).toContainText('Moss and moisture');
  await page.getByRole('textbox',{name:'Your explanation'}).fill('Capillary storage retains moisture in narrow spaces.');
  await page.getByRole('button',{name:'Send explanation'}).click();
  await expect(page.getByRole('alert')).toContainText('STEPFUN_API_KEY');
  await expect(page.getByRole('textbox',{name:'Your explanation'})).toHaveValue('Capillary storage retains moisture in narrow spaces.');
  await page.getByRole('button',{name:'Study settings'}).click();
  await page.getByRole('button',{name:'Delete saved session and uploaded files'}).click();
  await page.getByRole('button',{name:'Delete session & files',exact:true}).click();
  // Deletion drains outstanding saves and clears two IndexedDB stores. Wait for
  // the completed UI transition before reloading, rather than aborting the task.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Try a sample session'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Resume session'})).toHaveCount(0);
  const counts=await page.evaluate(async()=>Promise.all([
    ['miso-local-v1','session'],['miso-documents-v1','documents'],
  ].map(([name,store])=>new Promise<number>((resolve,reject)=>{
    const open=indexedDB.open(name);open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{const db=open.result;const transaction=db.transaction(store,'readonly');const count=transaction.objectStore(store).count();transaction.oncomplete=()=>{db.close();resolve(count.result);};transaction.onerror=()=>{db.close();reject(transaction.error);};};
  }))));
  expect(counts).toEqual([0,0]);
  await Promise.all([page.waitForResponse('**/api/config'),page.reload({waitUntil:'domcontentloaded'})]);
  await expect(page.getByRole('button',{name:'Resume session'})).toHaveCount(0);
});

test('multiple uploaded PDFs remain separate; invalid file is recoverable',async({page})=>{
  await page.route('**/api/config',async route=>{const response=await route.fetch();await route.fulfill({json:{...await response.json(),liveAvailable:false}});});
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await page.getByLabel('Choose PDF files').setInputFiles({name:'broken.pdf',mimeType:'application/pdf',buffer:Buffer.from('not a real PDF')});
  await page.getByRole('button',{name:'Prepare my session'}).click();await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button',{name:'Remove broken.pdf'}).click();
  await page.getByLabel('Choose PDF files').setInputFiles([resolve('public/examples/Sequences_and_Convergence.pdf'),resolve('public/examples/Experiments_and_Causal_Claims.pdf')]);
  await page.getByRole('button',{name:'Prepare my session'}).click();
  await expect(page.getByText('2 documents · 6 pages')).toBeVisible();
  await page.getByRole('button',{name:'Browse the original notes'}).click();
  await page.getByLabel('Choose source document').selectOption({label:'Experiments_and_Causal_Claims.pdf'});
  await expect(page.locator('.textLayer')).toContainText('random');
  await expect(page.getByRole('spinbutton',{name:'Page number'})).toHaveValue('1');
});

test('microphone denial leaves the draft and typed pipeline intact',async({page})=>{
  await page.route('**/api/config',async route=>{
    const response=await route.fetch();const config=await response.json();
    await route.fulfill({json:{...config,voiceAvailable:true}});
  });
  await page.addInitScript(()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Permission denied','NotAllowedError');};});
  await sample(page);
  await page.getByRole('textbox',{name:'Your explanation'}).fill(bounded);
  await page.getByRole('button',{name:'Start explaining'}).click();
  await expect(page.getByRole('alert')).toContainText('Microphone access was not allowed');
  await expect(page.getByRole('textbox',{name:'Your explanation'})).toHaveValue(bounded);
  await page.getByRole('button',{name:'Send explanation'}).click();
  await expect(page.locator('.conversation-current')).toContainText('Check my understanding');
});

test('late assessment is discarded when the student revises a pending explanation',async({page})=>{
  await sample(page);
  let release:()=>void=()=>{};
  const wait=new Promise<void>(resolve=>{release=resolve;});
  let intercepted:()=>void=()=>{};
  const reached=new Promise<void>(resolve=>{intercepted=resolve;});
  await page.route('**/api/turn',async route=>{
    const response=await route.fetch();intercepted();await wait;
    await route.fulfill({response}).catch(()=>{});
  });
  await page.getByRole('textbox',{name:'Your explanation'}).fill(bounded);
  await page.getByRole('button',{name:'Send explanation'}).click();await reached;
  await page.getByRole('textbox',{name:'Your explanation'}).fill('A newer correction that I am still writing.');
  release();await page.unroute('**/api/turn');
  await expect(page.getByRole('textbox',{name:'Your explanation'})).toHaveValue('A newer correction that I am still writing.');
  await expect(page.locator('.conversation-current')).not.toContainText('Check my understanding');
});
