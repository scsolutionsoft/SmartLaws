// Run with loadScript(name, window, App, document) and report(message) supplied by the host.
(() => {
 const assert=(value,message)=>{if(!value)throw Error(message);};
 const clone=x=>JSON.parse(JSON.stringify(x));
 const elements=new Map();
 const element=id=>{if(!elements.has(id))elements.set(id,{value:'',hidden:false,style:{},classList:{toggle(){}}});return elements.get(id);};
 const document={getElementById:id=>id==='studioPaperPreview'?null:element(id),querySelector:()=>null,querySelectorAll:()=>[]};
 const window={CourtRenderer:{renderDocumentPagesHtml:()=>''}};
 let stored=[];
 const App=window.App={state:{currentCaseId:1,currentDoc:null,currentClauses:[],templates:[],cases:[],lawyers:[]},
  getAccessibleDocuments:()=>stored,
  collectCurrentDocFromInputs(){const d=clone(this.state.currentDoc);for(const key of ['requesterFullName','signerName','signerRole','drafterName','typistName'])d[key]=element('ed'+key[0].toUpperCase()+key.slice(1)).value;return d;},
  loadDocumentIntoEditorState(d){this.state.currentDoc=clone(d);for(const key of ['requesterFullName','signerName','signerRole','drafterName','typistName'])element('ed'+key[0].toUpperCase()+key.slice(1)).value=d[key]||'';},
  syncEditorToPreview(){},populateStudioDropdowns(){},showToast(){},renderClausesEditorList(){},addClauseItem(){}};
 loadScript('court-form-editor.js',window,App,document);
 loadScript('profile-autofill.js',window,App,document);
 loadScript('studio-save.js',window,App,document);
 const E=window.CourtFormEditor;E.render=()=>{};
 const parties=[{id:101,partySide:'จำเลย',partyOrder:1,title:'นาย',fullName:'หนึ่ง ทดสอบ'},
                {id:102,partySide:'จำเลย',partyOrder:2,title:'นางสาว',fullName:'สอง ทดสอบ'}];
 const doc=(code,p,id)=>({id,caseId:1,formCode:code,partyId:p.id,requesterFullName:E.partyDisplayName(p),clausesJson:'[]',extraFieldsJson:JSON.stringify({SelectedPartyId:p.id,SelectedPartyName:E.partyDisplayName(p),SelectedPartyStatus:E.partyStatus(p)})});
 for(const code of ['(๔)','(๕)','(๖)','(๗)','(๙)','(๑๐)','(๑๑)','(๑๑ ก.)','(๑๒)','(๑๓)','(๑๔)','(๓๑)','(๓๒)','(๓๓)','(๓๔)','(๓๕)','(๓๖)','(๓๗)','(๓๘)','(๓๙)']){
  const first=doc(code,parties[0],501);stored=[clone(first)];E.caseParties=parties;
  App.loadDocumentIntoEditorState(first);
  E.selectCaseParty('102');
  assert(App.state.currentDoc.id===0,code+': dropdown must fork document');
  assert(App.state.currentDoc.partyId===102,code+': dropdown must keep party 2');
  assert(element('edRequesterFullName').value==='นางสาวสอง ทดสอบ',code+': prefix/name merge');
  assert(element('edSignerName').value==='นางสาวสอง ทดสอบ',code+': signature name includes prefix');
  assert(stored[0].partyId===101,code+': original party retained');
  App.loadDocumentIntoEditorState(first);
  window.ProfileAutofill.apply(parties[1],'','client');
  assert(App.state.currentDoc.id===0&&App.state.currentDoc.partyId===102,code+': quick fill must fork');
  assert(element('edSignerName').value==='นางสาวสอง ทดสอบ',code+': quick fill signature name includes prefix');
  assert(element('edSignerRole').value==='จำเลยที่ ๒',code+': quick fill role under signature');
  const merged=E.partySignatureNames({signerName:'สอง ทดสอบ',drafterName:'ทนาย ผู้เรียง',typistName:'เสมียน ผู้พิมพ์'},parties[1]);
  assert(merged.signerName==='นางสาวสอง ทดสอบ'&&!('drafterName'in merged)&&!('typistName'in merged),code+': preserve other signers');
  const allNames=E.partySignatureNames({signerName:'สอง ทดสอบ',drafterName:'สอง ทดสอบ',typistName:'นางสาวสอง ทดสอบ'},parties[1]);
  assert(Object.values(allNames).length===3&&Object.values(allNames).every(n=>n==='นางสาวสอง ทดสอบ'),code+': prefix all matching signature fields without duplication');
  const unsafe=doc(code,parties[1],501);unsafe.PartyId=101;
  window.StudioSave.prepareDocument(unsafe);
  assert(unsafe.id===0&&unsafe.partyId===102&&!('PartyId'in unsafe),code+': stale ID and duplicate JSON casing guarded');
  stored.push(doc(code,parties[1],502));
  App.loadDocumentIntoEditorState(first);E.selectCaseParty('102');
  if(['(๙)','(๑๑)','(๑๑ ก.)'].includes(code))assert(App.state.currentDoc.id===502,code+': restore correct existing party document');
  const savedSecond=stored.find(d=>d.id===502);savedSecond.signerName='ทนายคนเดิม';savedSecond.signerRole='ทนายจำเลย';savedSecond.signatureImageBase64='OLD_LAWYER_SIGNATURE';savedSecond.drafterName='ทนาย ผู้เรียง';savedSecond.typistName='เสมียน ผู้พิมพ์';
  App.loadDocumentIntoEditorState(first);
  window.ProfileAutofill.apply(parties[1],'','client');
  assert(element('edSignerName').value==='นางสาวสอง ทดสอบ'&&element('edSignerRole').value==='จำเลยที่ ๒',code+': restored draft must also replace main signer and role');
  assert(App.state.currentDoc.signerName==='นางสาวสอง ทดสอบ'&&App.state.currentDoc.signerRole==='จำเลยที่ ๒',code+': signer and role persist in document');
  if(['(๙)','(๑๑)','(๑๑ ก.)'].includes(code)){
   assert(App.state.currentDoc.id===502&&App.state.currentDoc.signatureImageBase64==='',code+': restored document keeps ID and removes other persons signature');
   assert(element('edDrafterName').value==='ทนาย ผู้เรียง'&&element('edTypistName').value==='เสมียน ผู้พิมพ์',code+': quick fill preserves drafter and typist');
  }
  let duplicate=false;try{window.StudioSave.prepareDocument(doc(code,parties[1],0));}catch{duplicate=true;}
  assert(duplicate,code+': do not silently overwrite existing document');
  const own=doc(code,parties[0],501);window.StudioSave.prepareDocument(own);assert(own.id===501,code+': ordinary edit keeps own ID');
  own.signerName=E.partyDisplayName(parties[0]);own.drafterName='ทนาย ผู้เรียง';own.typistName='เสมียน ผู้พิมพ์';own.signatureImageBase64='CLIENT_SIGNATURE';own.drafterSignatureBase64='LAWYER_SIGNATURE';own.typistSignatureBase64='CLERK_SIGNATURE';
  App.loadDocumentIntoEditorState(own);E.applyCaseParty(parties[0]);
  assert(App.state.currentDoc.signatureImageBase64==='CLIENT_SIGNATURE',code+': preserve same client electronic signature');
  E.applyCaseParty(parties[1]);
  assert(App.state.currentDoc.signatureImageBase64==='',code+': do not carry signature to another client');
  assert(App.state.currentDoc.drafterSignatureBase64==='LAWYER_SIGNATURE'&&App.state.currentDoc.typistSignatureBase64==='CLERK_SIGNATURE',code+': preserve drafter and typist signatures');
  assert(element('edDrafterName').value==='ทนาย ผู้เรียง'&&element('edTypistName').value==='เสมียน ผู้พิมพ์',code+': preserve drafter and typist identities');
  report('PASS '+code+': dropdown, quick fill, save guard, prefix, separate party IDs, duplicates');
 }
})();
