import * as pdfjs from '/vendor/pdf.mjs';
import {LAYOUT_VERSION,analyzeRaster,buildReadingPage,typesetPage,paintRebuiltPage,extractNativeRows,inlineRuns} from '/rebuild.mjs';
import {protectTableText,protectInlineText,tableHeaderTranslations} from '/tables.mjs';
pdfjs.GlobalWorkerOptions.workerSrc='/vendor/pdf.worker.mjs';
window.readerReady=true;
const $=id=>document.getElementById(id),measure=document.createElement('canvas').getContext('2d');
let pdf=null,pageNumber=1,scale=1,filename='document',busy=false,deepseekConfigured=false,documentKey='',documentHash='',epoch=0,renderToken=0;
let translations=new Map(),layouts=new Map(),pageData=new Map(),activeTerm=null;
function status(text){$('status').textContent=text}
function controls(){
  const done=pdf&&translations.size===pdf.numPages;
  $('prev').disabled=!pdf||pageNumber<=1;$('next').disabled=!pdf||pageNumber>=pdf.numPages;
  for(const id of ['translate','translateAll'])$(id).disabled=!pdf||busy;
  for(const id of ['exportBoth','exportZh'])$(id).disabled=!done||busy;
  $('file').disabled=busy;$('professional').disabled=busy;$('deepseekButton').disabled=busy;
  $('pages').textContent='/ '+(pdf?.numPages||0);$('pageNo').max=pdf?.numPages||1;$('pageNo').value=pageNumber;$('zoom').textContent=Math.round(scale*100)+'%';
}
function cacheKey(){return 'datasheet-'+LAYOUT_VERSION+':'+documentHash+':'+($('professional').checked?'professional':'standard')+':'+(deepseekConfigured?'deepseek':'public')}
function saveTranslations(){try{if(documentKey)localStorage.setItem(documentKey,JSON.stringify([...translations]))}catch{status('本地存储空间不足；译文在当前页面中保留。')}}
async function reloadTranslationCache(){if(!pdf)return;documentKey=cacheKey();try{translations=new Map(JSON.parse(localStorage.getItem(documentKey)||'[]'))}catch{translations=new Map()}const shown=await render();controls();return shown}
async function openPdf(data,name){
  if(busy)return;
  const generation=++epoch;renderToken++;layouts=new Map();pageData=new Map();translations=new Map();
  try{
    status('正在读取 '+name);
    const hash=await crypto.subtle.digest('SHA-256',data.slice(0));
    const loaded=await pdfjs.getDocument({data,cMapUrl:'/pdf-assets/cmaps/',cMapPacked:true,standardFontDataUrl:'/pdf-assets/standard_fonts/',wasmUrl:'/pdf-assets/wasm/',iccUrl:'/pdf-assets/iccs/'}).promise;
    if(generation!==epoch){await loaded.destroy();return}
    const previous=pdf;pdf=loaded;if(previous)previous.destroy().catch(()=>{});
    documentHash=Array.from(new Uint8Array(hash)).map(x=>x.toString(16).padStart(2,'0')).join('');
    filename=name.replace(/\.pdf$/i,'');pageNumber=1;
    const first=await pdf.getPage(1);scale=Math.min(1.15,($('left').clientWidth-28)/first.getViewport({scale:1}).width);
    if(await reloadTranslationCache())status(name+' · '+pdf.numPages+' 页；已恢复 '+translations.size+' 页译文。'+(translations.has(pageNumber)?'':'右侧为重排预览，点击翻译后显示中文。'));
  }catch(error){if(generation===epoch)status('PDF 打开失败：'+error.message)}
}
async function openFile(file){if(!file||busy)return;if(!/\.pdf$/i.test(file.name)&&file.type!=='application/pdf'){status('请选择 PDF 文件。');return}await openPdf(await file.arrayBuffer(),file.name)}
function makeCanvas(w,h){const canvas=document.createElement('canvas');canvas.width=Math.ceil(w);canvas.height=Math.ceil(h);return canvas}
async function sourceCanvas(page,factor){const viewport=page.getViewport({scale:factor}),canvas=makeCanvas(viewport.width,viewport.height);canvas.pdfScale=factor;await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;return canvas}
function nativeRows(content,base,regions){
  return extractNativeRows(content,base,regions,pdfjs.Util.transform);
}
async function getPageData(n){
  if(pageData.has(n))return pageData.get(n);
  const generation=epoch,document=pdf;
  const promise=(async()=>{
    const page=await document.getPage(n),base=page.getViewport({scale:1}),factor=2.5,source=await sourceCanvas(page,factor);
    const analysis=analyzeRaster(source.getContext('2d').getImageData(0,0,source.width,source.height),base);
    const content=await page.getTextContent();let rows=nativeRows(content,base,analysis.regions);
    if(!rows.length){
      rows=[];
      for(const region of analysis.regions){
        if(generation!==epoch)throw Error('文档已切换');
        // Recognize figure labels too so the retained crop includes tick labels,
        // units and panel letters. buildReadingPage excludes them from translation.
        status('第 '+n+' 页正在识别分栏与自然段（'+(region.id+1)+'/'+analysis.regions.length+'）…');
        const crop=makeCanvas(region.width*factor,region.height*factor);
        crop.getContext('2d').drawImage(source,region.x*factor,region.y*factor,region.width*factor,region.height*factor,0,0,crop.width,crop.height);
        const image=await new Promise(resolve=>crop.toBlob(resolve,'image/png'));
        const response=await fetch('/api/ocr',{method:'POST',headers:{'Content-Type':'image/png','X-OCR-Layout':'column'},body:image});
        const data=await response.json();if(!response.ok)throw Error(data.error||'OCR 失败');
        rows.push(...data.rows.map(row=>({text:row.text,x:region.x+row.bbox.x0/factor,y:region.y+row.bbox.y0/factor,
          width:(row.bbox.x1-row.bbox.x0)/factor,height:(row.bbox.y1-row.bbox.y0)/factor,
          words:(row.words||[]).map(word=>({text:word.text,x:region.x+word.bbox.x0/factor,y:region.y+word.bbox.y0/factor,width:(word.bbox.x1-word.bbox.x0)/factor,height:(word.bbox.y1-word.bbox.y0)/factor})),
          regionId:region.id,paragraphId:region.id+':'+row.paragraphId})));
      }
    }
    if(generation!==epoch)throw Error('文档已切换');
    return {page,base,rows,analysis};
  })();
  pageData.set(n,promise);
  try{return await promise}catch(error){if(pageData.get(n)===promise)pageData.delete(n);throw error}
}
async function getLayout(n){
  const professional=$('professional').checked,key=n+':'+professional,generation=epoch;
  if(!layouts.has(key)){
    const promise=getPageData(n).then(({page,base,rows,analysis})=>({page,base,model:buildReadingPage(rows,analysis,base,{professional})}));
    layouts.set(key,promise);promise.catch(()=>{if(layouts.get(key)===promise)layouts.delete(key)});
  }
  const data=await layouts.get(key);
  if(generation!==epoch)throw Error('文档已切换');
  if(professional===$('professional').checked){const cached=translations.get(n);if(cached&&cached.length!==data.model.paragraphs.length){translations.delete(n);saveTranslations()}}
  return data;
}
async function render(){
  if(!pdf)return;
  const current=++renderToken,target=pageNumber,currentScale=scale,generation=epoch,dpr=window.devicePixelRatio||1;
  controls();restoreTerm();
  try{
    const page=await pdf.getPage(target),viewport=page.getViewport({scale:currentScale});
    const source=await sourceCanvas(page,currentScale*dpr);if(current!==renderToken||generation!==epoch)return;
    for(const id of ['original','translated']){const box=$(id);box.replaceChildren();box.style.width=viewport.width+'px';box.style.height=viewport.height+'px'}
    source.style.width=viewport.width+'px';source.style.height=viewport.height+'px';$('original').append(source);
    const {model}=await getLayout(target);if(current!==renderToken||generation!==epoch)return;
    const canvas=makeCanvas(source.width,source.height);canvas.style.width=viewport.width+'px';canvas.style.height=viewport.height+'px';$('translated').append(canvas);
    const placed=typesetPage(measure,model,translations.get(target));
    paintRebuiltPage(canvas.getContext('2d'),source,model,placed.filter(p=>p.sourceFallback),currentScale*dpr);
    const layer=document.createElement('div');layer.className='rebuilt-layer';$('translated').append(layer);
    for(const p of placed.filter(p=>!p.sourceFallback)){const div=document.createElement('div');div.className='rebuilt-paragraph';if(p.tableCell)div.dataset.tableCell='true';
      Object.assign(div.style,{left:p.x*currentScale+'px',top:p.y*currentScale+'px',width:p.width*currentScale+'px',fontSize:p.fontSize*currentScale+'px',lineHeight:p.lineHeight*currentScale+'px',fontWeight:p.heading?'600':'400'});
      p.lines.forEach((text,i)=>{const line=document.createElement('div');for(const run of inlineRuns(text)){const span=document.createElement('span');span.textContent=run.text;if(run.script)Object.assign(span.style,{fontSize:'70%',position:'relative',top:run.script==='sub'?'.54em':'-.22em'});line.append(span)}if(!i&&p.indent)line.style.paddingLeft=p.indent*currentScale+'px';div.append(line)});layer.append(div);
    }
    const selection=document.createElement('div');selection.className='text-layer';$('original').append(selection);
    for(const paragraph of model.paragraphs)for(const row of paragraph.sourceRows){const span=document.createElement('span');span.textContent=row.text;Object.assign(span.style,{left:row.x*currentScale+'px',top:row.y*currentScale+'px',width:row.width*currentScale+'px',height:row.height*1.2*currentScale+'px',fontSize:row.height*currentScale+'px'});selection.append(span)}
    controls();if($('status').textContent.startsWith('第 '+target+' 页正在识别'))status('第 '+target+' 页识别完成；'+(translations.has(target)?'已显示译文。':'右侧为重排预览，点击翻译后显示中文。'));return true;
  }catch(error){if(current===renderToken)status('页面识别失败：'+error.message);return false}
}
function splitRequest(text){
  const chunks=[];while(text.length>1400){let at=text.lastIndexOf(' ',1400);if(at<700)at=1400;chunks.push(text.slice(0,at));text=text.slice(at).trimStart()}if(text)chunks.push(text);return chunks;
}
async function translateNumber(n,model){
  if(translations.has(n))return;
  const inputs=[],owners=[],restorers=[];
  const result=Array(model.paragraphs.length).fill('');
  for(const p of model.paragraphs){
    const heading=p.tableCell&&tableHeaderTranslations.get(p.text.trim().replace(/\s+/g,' ').toUpperCase());
    if(heading){result[p.id]=heading;continue}
    for(const part of splitRequest(p.text)){const safe=p.tableCell?protectTableText(part):protectInlineText(part);inputs.push(safe.text);owners.push(p.id);restorers.push(safe.restore)}
  }
  for(let start=0;start<inputs.length;start+=12){
    status('正在翻译第 '+n+' 页（'+Math.min(start+12,inputs.length)+'/'+inputs.length+' 段）…');
    const response=await fetch('/api/translate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lines:inputs.slice(start,start+12),professional:$('professional').checked})});
    const data=await response.json();if(!response.ok)throw Error(data.error||'翻译请求失败');
    if(!Array.isArray(data.translations)||data.translations.length!==Math.min(12,inputs.length-start))throw Error('译文数量与原文不一致');
    data.translations.forEach((text,i)=>{result[owners[start+i]]+=(result[owners[start+i]]?' ':'')+restorers[start+i](text)});
  }
  translations.set(n,result);saveTranslations();
}
async function translatePage(){if(!pdf||busy)return;const n=pageNumber;busy=true;controls();try{const {model}=await getLayout(n);await translateNumber(n,model);await render();status('第 '+n+' 页完成，按 '+model.paragraphs.length+' 个自然段重新排版；图片与公式保留原图。')}catch(error){status('第 '+n+' 页翻译失败：'+error.message)}finally{busy=false;controls()}}
async function translateAll(){if(!pdf||busy)return;busy=true;controls();let active=1;try{for(;active<=pdf.numPages;active++){const {model}=await getLayout(active);if(translations.has(active))continue;await translateNumber(active,model);if(active===pageNumber)await render()}status('整份翻译完成，可以导出 PDF。')}catch(error){status('第 '+active+' 页翻译失败：'+error.message+'；已完成页已保留。')}finally{busy=false;controls()}}
async function exportPdf(bilingual){
  if(!pdf||busy||translations.size!==pdf.numPages)return;busy=true;controls();
  try{const output=await PDFLib.PDFDocument.create();
    for(let n=1;n<=pdf.numPages;n++){status('正在导出第 '+n+'/'+pdf.numPages+' 页…');const {page,base,model}=await getLayout(n),factor=2,original=await sourceCanvas(page,factor),chinese=makeCanvas(original.width,original.height);
      if(!translations.has(n))throw Error('第 '+n+' 页分块已更新，请重新翻译整份后导出');
      const placed=typesetPage(chinese.getContext('2d'),model,translations.get(n));paintRebuiltPage(chinese.getContext('2d'),original,model,placed,factor);
      const added=output.addPage([base.width*(bilingual?2:1),base.height]);
      if(bilingual){const image=await output.embedPng(original.toDataURL('image/png'));added.drawImage(image,{x:0,y:0,width:base.width,height:base.height})}
      const image=await output.embedPng(chinese.toDataURL('image/png'));added.drawImage(image,{x:bilingual?base.width:0,y:0,width:base.width,height:base.height});
    }
    const url=URL.createObjectURL(new Blob([await output.save()],{type:'application/pdf'})),link=document.createElement('a');link.href=url;link.download=filename+(bilingual?'-中英对照.pdf':'-中文版.pdf');link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);status('已导出 '+link.download);
  }catch(error){status('导出失败：'+error.message)}finally{busy=false;controls()}
}
async function refreshDeepSeek(){const response=await fetch('/api/deepseek/status'),data=await response.json();deepseekConfigured=data.configured;$('deepseekButton').textContent='DeepSeek API：'+(deepseekConfigured?'已配置':'未配置');$('deepseekUsage').textContent='本次服务用量：'+(data.usage?.total_tokens||0)+' tokens（输入 '+(data.usage?.prompt_tokens||0)+' / 输出 '+(data.usage?.completion_tokens||0)+'，'+(data.usage?.requests||0)+' 次请求）';$('deepseekRefresh').disabled=!deepseekConfigured}
async function refreshBalance(){if(!deepseekConfigured)return;$('deepseekBalance').textContent='正在查询账户余额…';try{const response=await fetch('/api/deepseek/balance'),data=await response.json();if(!response.ok)throw Error(data.error||'查询失败');$('deepseekBalance').textContent=data.balance_infos.length?'账户余额：'+data.balance_infos.map(x=>x.currency+' '+x.total_balance+'（赠送 '+x.granted_balance+'，充值 '+x.topped_up_balance+'）').join('；')+(data.is_available?'':'；当前不可用'):'余额接口未返回金额';await refreshDeepSeek()}catch(error){$('deepseekBalance').textContent='余额查询失败：'+error.message}}
function restoreTerm(){activeTerm?.remove();activeTerm=null}
async function revealSelection(pane){const selection=window.getSelection();if(!selection||selection.isCollapsed||selection.rangeCount!==1)return;const text=selection.toString().trim().replace(/\s+/g,' ');if(text.length>400||!/[A-Za-z]/.test(text))return;const range=selection.getRangeAt(0);if(!pane.contains(range.commonAncestorContainer))return;const rect=range.getBoundingClientRect(),box=pane.getBoundingClientRect(),target=pageNumber;restoreTerm();try{const response=await fetch('/api/term',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,professional:$('professional').checked})}),data=await response.json();if(!response.ok)throw Error(data.error||'翻译失败');if(target!==pageNumber)return;const div=document.createElement('div');div.className='selection-reveal';div.textContent=data.meaning;Object.assign(div.style,{left:Math.max(0,rect.left-box.left)+'px',top:Math.max(0,rect.top-box.top)+'px',width:Math.min(box.width,Math.max(rect.width,160))+'px',fontSize:'13px',padding:'2px'});pane.append(div);activeTerm=div;selection.removeAllRanges();div.addEventListener('mouseleave',restoreTerm,{once:true})}catch(error){status('选中文本翻译失败：'+error.message)}}
$('file').addEventListener('change',event=>{userOpened=true;openFile(event.target.files[0])});
const viewer=document.querySelector('.viewer');viewer.addEventListener('dragover',event=>{event.preventDefault();viewer.classList.add('dragging')});viewer.addEventListener('dragleave',()=>viewer.classList.remove('dragging'));viewer.addEventListener('drop',event=>{event.preventDefault();viewer.classList.remove('dragging');userOpened=true;openFile(event.dataTransfer.files[0])});
$('translate').onclick=translatePage;$('translateAll').onclick=translateAll;$('exportBoth').onclick=()=>exportPdf(true);$('exportZh').onclick=()=>exportPdf(false);
$('prev').onclick=()=>{if(pageNumber>1){pageNumber--;render()}};$('next').onclick=()=>{if(pdf&&pageNumber<pdf.numPages){pageNumber++;render()}};
$('pageNo').onchange=()=>{if(pdf){pageNumber=Math.max(1,Math.min(pdf.numPages,Number($('pageNo').value)||1));render()}};
$('minus').onclick=()=>{scale=Math.max(.4,scale-.15);render()};$('plus').onclick=()=>{scale=Math.min(3,scale+.15);render()};
$('professional').onchange=async()=>{if(!pdf){status('电子专业版：翻译表头、引脚说明与参数描述，保留数值和单位。');return}const enabled=$('professional').checked;busy=true;controls();try{await reloadTranslationCache()}finally{busy=false;controls()}if(enabled)await translatePage();else status('已切换普通模式，表格保留原图。')};
$('deepseekButton').onclick=()=>{$('deepseekKey').value='';$('deepseekMessage').textContent='';$('deepseekDialog').showModal();refreshDeepSeek().then(refreshBalance)};
$('deepseekRefresh').onclick=refreshBalance;$('deepseekCancel').onclick=()=>$('deepseekDialog').close();
$('deepseekSave').onclick=async()=>{try{const response=await fetch('/api/deepseek/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:$('deepseekKey').value.trim()})}),data=await response.json();if(!response.ok)throw Error(data.error||'保存失败');$('deepseekKey').value='';await refreshDeepSeek();await refreshBalance();await reloadTranslationCache();$('deepseekDialog').close();status('DeepSeek 已配置。')}catch(error){$('deepseekMessage').textContent=error.message}};
$('deepseekClear').onclick=async()=>{await fetch('/api/deepseek/config',{method:'DELETE'});$('deepseekKey').value='';$('deepseekDialog').close();await refreshDeepSeek();await reloadTranslationCache();status('DeepSeek 密钥已清除。')};
for(const id of ['original','translated'])$(id).addEventListener('mouseup',()=>revealSelection($(id)));
document.addEventListener('pointermove',event=>{if(activeTerm&&!activeTerm.contains(event.target))restoreTerm()});
let syncing=false;for(const [a,b]of [['left','right'],['right','left']])$(a).addEventListener('scroll',()=>{if(syncing)return;syncing=true;$(b).scrollTop=$(a).scrollTop;$(b).scrollLeft=$(a).scrollLeft;requestAnimationFrame(()=>syncing=false)});
let userOpened=false;controls();refreshDeepSeek().then(()=>fetch('/default.pdf')).then(response=>{if(!response.ok)throw Error('默认 PDF 不存在');return response.arrayBuffer()}).then(data=>{if(!userOpened)return openPdf(data,'example.pdf')}).catch(error=>status('默认文档打开失败：'+error.message+'；可选择自己的 PDF。'));
