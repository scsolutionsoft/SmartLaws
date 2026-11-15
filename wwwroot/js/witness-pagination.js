/* Form 15: measure the header/footer and fill the available A4 table area. */
(() => {
 const R=CourtRenderer;
 R.renderWitnessForm15=function(doc,lawCase,witnesses,extra,t){
  const source=Array.isArray(witnesses)?witnesses:[];
  const decode=value=>{const el=document.createElement('textarea');el.innerHTML=String(value??'');return el.value;};
  const rows=source.map((r,i)=>({index:i,values:[r.OrderNo??r.orderNo??i+1,r.WitnessNameAndDesc??r.witnessNameAndDesc??r.Content??r.content??'',r.AddressText??r.addressText??'',r.Note??r.note??''].map(v=>decode(t(v)))}));
  const columns='<colgroup><col style="width:10%"><col style="width:46%"><col style="width:32%"><col style="width:12%"></colgroup>';
  const head='<thead><tr><th>อันดับ</th><th>ชื่อและสกุลพยาน / เอกสารวัตถุพยาน</th><th>บ้านเลขที่ หมู่ที่ ถนน ซอย<br>ตำบล/แขวง อำเภอ/เขต จังหวัด</th><th>หมายเหตุ<br>(นำ/หมาย)</th></tr></thead>';
  const total=String(extra.TotalWitnessCount??'').trim()?t(extra.TotalWitnessCount):t(source.length);
  const header=`<div class="witness-front-header">${this.renderCommonHeader(doc,lawCase,t)}<div class="witness-requester">ข้าพเจ้า <span class="court-dotted-line">${t(doc.requesterFullName||'')}</span> ${t(doc.requesterStatus||doc.lawyerRoleInDoc||'')}</div><div>ขอระบุพยานของข้าพเจ้ารวม <span class="court-dotted-line">${total}</span> อันดับ ตามบัญชีตารางข้างล่างนี้</div></div>`;
  const footer=(front,flip=false)=>`<div class="witness-page-footer">${this.renderCenteredSigRow(doc.signatureImageBase64,t(doc.signerName||doc.requesterFullName||''),'ผู้ระบุ')}${front?`<div style="text-align:right">${flip?'(พลิก)':'&nbsp;'}</div><div class="witness-note">หมายเหตุ กรณีเด็กอายุไม่เกิน ๑๘ ปี ให้ระบุด้วย เพื่อประสานงานในการสืบพยานเด็ก</div>`:''}</div>`;
  const mm=96/25.4,measure=document.createElement('div');
  measure.className='court-page court-witness-paged witness-front';
  measure.style.cssText='position:fixed;left:-10000px;top:0;visibility:hidden;transform:none;margin:0;';
  measure.innerHTML=header+footer(true,true);document.body.append(measure);
  const origin=measure.getBoundingClientRect().top;
  const frontTop=measure.querySelector('.witness-front-header').getBoundingClientRect().bottom-origin+3*mm;
  const frontBottom=measure.querySelector('.witness-page-footer').getBoundingClientRect().top-origin-5*mm;
  measure.innerHTML=footer(false);
  const nextBottom=measure.querySelector('.witness-page-footer').getBoundingClientRect().top-origin-1*mm;
  measure.remove();
  const rowHtml=(r,slots=0)=>{const tr=document.createElement('tr');if(r.index>=0)tr.dataset.witnessIndex=r.index;else tr.dataset.witnessBlank='true';if(slots)tr.style.height=(13*slots)+'mm';r.values.forEach(v=>{const td=document.createElement('td');td.textContent=v||'\u00a0';tr.append(td);});return tr.outerHTML;};
  const probe=document.createElement('table');probe.className='court-witness-paged-table';probe.style.cssText='position:fixed;left:-10000px;top:0;width:172mm;visibility:hidden;';document.body.append(probe);
  probe.innerHTML=columns+head;const headingHeight=probe.getBoundingClientRect().height;
  const unit=13*mm,pages=[];let current=[],used=0;
  const frontSpace=Math.max(unit,frontBottom-frontTop-headingHeight-2);
  const nextSpace=Math.max(unit,nextBottom-15*mm-headingHeight-2);
  const frontCapacity=Math.max(1,Math.floor(frontSpace/unit));
  const nextCapacity=Math.max(1,Math.min(18,Math.floor((nextSpace+2)/unit)));
  const capacity=()=>pages.length?nextCapacity:frontCapacity;
  const height=r=>{probe.innerHTML=columns+'<tbody>'+rowHtml(r)+'</tbody>';return probe.getBoundingClientRect().height;};
  const finish=()=>{while(used<capacity()){current.push({row:{index:-1,values:['','','','']},slots:1});used++;}pages.push(current);current=[];used=0;};
  const place=r=>{const slots=Math.max(1,Math.ceil((height(r)-1)/unit));
   if(slots>capacity()){
    if(current.length){finish();place(r);return;}
    if(r.values.some(v=>Array.from(v).length>1)){
     const parts=r.values.map((v,i)=>{if(i===0)return[v,''];const graphemes=Array.from(new Intl.Segmenter('th',{granularity:'grapheme'}).segment(v),x=>x.segment);const mid=Math.ceil(graphemes.length/2);return[graphemes.slice(0,mid).join(''),graphemes.slice(mid).join('')];});
     place({...r,values:parts.map(p=>p[0])});place({...r,values:parts.map(p=>p[1])});return;
    }
   }
   if(used+slots>capacity()){finish();place(r);return;}
   current.push({row:r,slots});used+=slots;
  };
  try{rows.forEach(place);if(current.length||!pages.length)finish();}finally{probe.remove();}
  return pages.map((page,index)=>`<div class="court-page court-witness-paged ${index?'witness-continuation':'witness-front'}" data-witness-page="${index+1}">
   ${index?`<div class="witness-page-number">บัญชีพยาน (ต่อ) · หน้า ${t(index+1)}</div>`:header}
   <table class="court-witness-paged-table witness-page-table" style="top:${index?15*mm:frontTop}px;height:${headingHeight+(index?nextSpace:frontSpace)}px">${columns}${head}<tbody>${page.map(r=>rowHtml(r.row,r.slots)).join('')}</tbody></table>
   ${footer(index===0,pages.length>1)}
  </div>`).join('');
 };
})();
