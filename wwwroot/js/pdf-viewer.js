(() => {
    'use strict';
    const A=App, open=A.openPopupFileViewer.bind(A), close=A.closePopupFileViewer.bind(A);
    let controller=null, objectUrl=null, generation=0;
    function reset(){generation++;controller?.abort();controller=null;if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=null;}
    A.closePopupFileViewer=function(){reset();close();};
    A.openPopupFileViewer=async function(options){
        reset();
        if((options.storageType||'PDF')!=='PDF')return open(options);
        const current=generation,src=options.dataBase64||options.url||'';
        open({...options,storageType:'PDF',dataBase64:'',url:''});
        const body=document.getElementById('popupViewerBody'),download=document.getElementById('popupViewerDownloadBtn');
        body.innerHTML='<div class="sl-loader" role="status">กำลังโหลดไฟล์ PDF…</div>';
        controller=new AbortController();
        try {
            if(!src)throw Error('รายการนี้ยังไม่มีไฟล์ PDF กรุณาอัปโหลดไฟล์ต้นฉบับเข้าคลังสำนวน');
            const response=await fetch(src,{signal:controller.signal});
            if(!response.ok){
                const details=await response.json().catch(()=>null);
                if(details?.message)throw Error(details.message+(details.reference?` (รหัสอ้างอิง ${details.reference})`:''));
                if(response.status===401)throw Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
                if(response.status===403)throw Error('บัญชีนี้ไม่มีสิทธิ์อ่านไฟล์ในสำนวนนี้');
                if(response.status===404)throw Error('ไม่พบไฟล์ต้นฉบับ รายการนี้อาจเป็นลิงก์จากเครื่องเดิม กรุณาอัปโหลด PDF เข้าคลังสำนวน');
                throw Error(`โหลดไฟล์ไม่สำเร็จ (${response.status}) กรุณาลองใหม่`);
            }
            const blob=await response.blob();
            if(await blob.slice(0,5).text()!=='%PDF-')throw Error('ข้อมูลที่ได้รับไม่ใช่ไฟล์ PDF ที่อ่านได้ กรุณาตรวจสอบไฟล์ต้นฉบับ');
            if(current!==generation)return;
            objectUrl=URL.createObjectURL(new Blob([blob],{type:'application/pdf'}));
            download.href=objectUrl;download.download=(options.title||'เอกสาร').replace(/[\\/:*?"<>|]/g,'_').replace(/\.pdf$/i,'')+'.pdf';download.classList.remove('hidden');
            body.innerHTML='<div style="width:100%;height:100%;min-height:0;display:flex;flex-direction:column;gap:8px"><p class="sl-muted">หากเบราว์เซอร์ไม่แสดงเอกสาร ให้กดดาวน์โหลดเพื่อเปิดด้วยโปรแกรมอ่าน PDF</p><iframe title="PDF Reader" style="width:100%;flex:1;min-height:400px;border:1px solid #cbd5e1;border-radius:12px;background:white"></iframe></div>';
            body.querySelector('iframe').src=objectUrl;
        } catch(error) {
            if(current!==generation||error.name==='AbortError')return;
            body.innerHTML='<div class="sl-card" role="alert" style="max-width:540px"><h3>ไม่สามารถเปิดเอกสารได้</h3><p data-pdf-error style="line-height:1.8"></p><button type="button" class="sl-button primary">ลองโหลดอีกครั้ง</button></div>';
            body.querySelector('[data-pdf-error]').textContent=error.message;
            body.querySelector('button').onclick=()=>this.openPopupFileViewer(options);
        }
    };
})();
