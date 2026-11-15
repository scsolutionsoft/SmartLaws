(() => {
 'use strict';
 const months=['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
 const pad=n=>String(n).padStart(2,'0');
 window.ThaiAppointmentDates={mount(root){
  root.querySelectorAll('input[type=date],input[type=month],input[type=datetime-local]').forEach(input=>{
   const kind=input.type,required=input.required,value=input.value;
   input.type='hidden';input.required=false;
   const box=document.createElement('span');box.className='cal-thai-date';box.setAttribute('role','group');
   const label=input.closest('label')?.textContent.trim()||'วันที่';box.setAttribute('aria-label',label);
   const parts={};
   function select(key,title,items){const el=document.createElement('select');el.dataset.datePart=key;el.setAttribute('aria-label',label+' — '+title);el.required=required;el.disabled=input.disabled;el.add(new Option(title,''));items.forEach(([v,text])=>el.add(new Option(text,v)));parts[key]=el;box.append(el);return el;}
   if(kind!=='month')select('day','วัน',Array.from({length:31},(_,i)=>[pad(i+1),i+1]));
   select('month','เดือน',months.map((m,i)=>[pad(i+1),m]));
   select('year','ปี พ.ศ.',Array.from({length:201},(_,i)=>[String(2000+i),'พ.ศ. '+(2543+i)]));
   if(kind==='datetime-local'){
    const text=document.createElement('span');text.textContent='เวลา';box.append(text);
    select('hour','ชั่วโมง',Array.from({length:24},(_,i)=>[pad(i),pad(i)]));
    select('minute','นาที',Array.from({length:60},(_,i)=>[pad(i),pad(i)]));
   }
   const match=value.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?(?:T(\d{2}):(\d{2}))?/);
   if(match){['year','month','day','hour','minute'].forEach((k,i)=>{if(parts[k])parts[k].value=match[i+1]||'';});}
   function days(){if(!parts.day||!parts.year.value||!parts.month.value)return;const max=new Date(Date.UTC(+parts.year.value,+parts.month.value,0)).getUTCDate();const old=parts.day.value;while(parts.day.options.length>1)parts.day.remove(1);for(let d=1;d<=max;d++)parts.day.add(new Option(d,pad(d)));parts.day.value=old?pad(Math.min(+old,max)):'';}
   days();
   box.addEventListener('change',event=>{event.stopPropagation();days();const complete=Object.values(parts).every(p=>p.value!=='');input.value=complete?parts.year.value+'-'+parts.month.value+(parts.day?'-'+parts.day.value:'')+(parts.hour?'T'+parts.hour.value+':'+parts.minute.value:''):'';
    // An unfinished date must not launch a range search or change the selected month.
    if(complete)input.dispatchEvent(new Event('change',{bubbles:true}));
   });
   input.after(box);
  });
 }};
})();
