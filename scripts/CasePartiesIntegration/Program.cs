using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Dapper;
using Microsoft.Data.SqlClient;
using SmartLaws.Web.Models;
using SmartLaws.Web.Services;
var prefix="partyfixture"+Guid.NewGuid().ToString("N")[..10];var password=Guid.NewGuid().ToString("N");
var testBaseUrl=Environment.GetEnvironmentVariable("SMARTLAWS_TEST_BASE_URL")??"http://localhost:5088";
using var db=new SqlConnection(JsonNode.Parse(await File.ReadAllTextAsync("appsettings.json"))!["ConnectionStrings"]!["DefaultConnection"]!.GetValue<string>());await db.OpenAsync();
HttpClient Session()=>new(new HttpClientHandler{CookieContainer=new()}){BaseAddress=new(testBaseUrl)};
using var owner=Session();using var other=Session();using var client=Session();
void Check(bool b,string message){if(!b)throw new Exception(message);}
async Task<JsonNode> Send(HttpClient http,string path,object body,HttpMethod? method=null){using var r=await http.SendAsync(new HttpRequestMessage(method??HttpMethod.Post,path){Content=JsonContent.Create(body)});var text=await r.Content.ReadAsStringAsync();if(!r.IsSuccessStatusCode)throw new Exception(path+": "+text.Split("HEADERS")[0]);return string.IsNullOrEmpty(text)?new JsonObject():JsonNode.Parse(text)!;}
try{
 foreach(var (http,suffix) in new[]{(owner,"owner"),(other,"other")}){await Send(http,"/api/auth/register",new{username=prefix+suffix,passwordHash=password,fullName=prefix+suffix,licenseNo="TEST"});await Send(http,"/api/auth/login",new{username=prefix+suffix,password});}
 var lc=new LawCase{CourtName="Fixture court",BlackCaseNo=prefix,PlaintiffName="TEST",DefendantName="TEST and 20 defendants",LawyerRole="ทนายจำเลย",PartyCountsJson="{\"จำเลย\":20,\"โจทก์\":1}",InitialParties=[new(){PartySide="จำเลย",PartyOrder=2,FullName=prefix+"Two",IsOurClient=true},new(){PartySide="จำเลย",PartyOrder=7,FullName=prefix+"Seven",IsOurClient=true}]};
 lc.InitialParties[1].PartyOrder=2;Check((await owner.PostAsJsonAsync("/api/cases",lc)).StatusCode==HttpStatusCode.BadRequest,"Duplicate orders rejected atomically");
 Check(await db.ExecuteScalarAsync<int>("SELECT UsedCasesCount FROM SL_UserAccounts WHERE Username=@username",new{username=prefix+"owner"})==0,"Failed creation consumes no credit");
 lc.InitialParties[1].PartyOrder=7;var created=await Send(owner,"/api/cases",lc);int caseId=(int)created["id"]!;
 Check(await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_CaseParties WHERE CaseId=@caseId AND IsOurClient=1",new{caseId})==2,"Case and represented parties created together");
 Check((string)created["representingPartyOrder"]! == "จำเลยที่ ๒ และจำเลยที่ ๗","Representation text derived from actual party orders");
 Check((await other.GetAsync($"/api/cases/{caseId}/parties")).StatusCode==HttpStatusCode.NotFound,"Other lawyer cannot view roster");
 var parties=(await db.QueryAsync<CaseParty>("SELECT * FROM SL_CaseParties WHERE CaseId=@caseId ORDER BY PartyOrder",new{caseId})).ToList();
 var seven=parties[1];var account=await Send(owner,$"/api/client-management/{caseId}",new{partyId=seven.Id,citizenId="7234567890123"});
 await Send(client,"/api/auth/login",new{username="7234567890123",password="7234567890123"});await Send(client,"/api/client/password",new{currentPassword="7234567890123",newPassword=password,confirmPassword=password});await Send(client,"/api/auth/login",new{username="7234567890123",password});
 var version=await db.ExecuteScalarAsync<int>("SELECT PartyVersion FROM SL_LawCases WHERE Id=@caseId",new{caseId});
 var inputs=parties.Select(p=>new CaseParties.PartyInput(p.Id,p.PartySide,p.PartyOrder,p.FullName,p.Id==seven.Id?"7234567890123":"",p.Phone,p.IsOurClient)).ToList();
 var roster=new CaseParties.RosterInput(version,"ทนายจำเลย",new(){{"จำเลย",20},{"โจทก์",1}},inputs);
 Check((await other.PutAsJsonAsync($"/api/cases/{caseId}/parties",roster)).StatusCode==HttpStatusCode.NotFound,"Other lawyer cannot change roster");
 inputs[1]=inputs[1] with{IsOurClient=false};inputs.Add(new(0,"จำเลย",12,prefix+"Twelve","","",true));
 await Send(owner,$"/api/cases/{caseId}/parties",roster,HttpMethod.Put);
 Check((await client.GetAsync($"/api/client/home?caseId={caseId}")).StatusCode==HttpStatusCode.Unauthorized,"Ending representation disables client case access");
 Check(await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_ClientCaseLinks WHERE PartyId=@Id AND IsActive=0",seven)==1,"Account link retained inactive");
 Check(await db.ExecuteScalarAsync<int>("SELECT UsedCasesCount FROM SL_UserAccounts WHERE Username=@username",new{username=prefix+"owner"})==1,"Adding parties consumes no extra credit");
 Check((await owner.PutAsJsonAsync($"/api/cases/{caseId}/parties",roster)).StatusCode==HttpStatusCode.Conflict,"Stale editor rejected");
 var summary=await owner.GetFromJsonAsync<JsonNode>($"/api/cases/{caseId}/quick-fill?source=self");Check(((string)summary!["statusText"]!).Contains("๑๒")&&!((string)summary["statusText"]!).Contains("๗"),"Quick-fill uses only active represented parties");
 var last=(await db.QueryAsync<CaseParty>("SELECT * FROM SL_CaseParties WHERE CaseId=@caseId ORDER BY PartyOrder",new{caseId})).ToList();
 var currentVersion=await db.ExecuteScalarAsync<int>("SELECT PartyVersion FROM SL_LawCases WHERE Id=@caseId",new{caseId});
 var missing=new CaseParties.RosterInput(currentVersion,"ทนายจำเลย",roster.Counts,[new(last[0].Id,"จำเลย",2,last[0].FullName,"","",true)]);
 Check((await owner.PutAsJsonAsync($"/api/cases/{caseId}/parties",missing)).StatusCode==HttpStatusCode.BadRequest,"Cannot drop existing party and lose linked history");
 lc.Id=caseId;lc.RepresentingPartyOrder="wrong";lc.LawyerRole="ทนายโจทก์";await Send(owner,$"/api/cases/{caseId}",lc,HttpMethod.Put);
 Check(await db.ExecuteScalarAsync<string>("SELECT LawyerRole FROM SL_LawCases WHERE Id=@caseId",new{caseId})=="ทนายจำเลย","General edit cannot overwrite roster role");
 Console.WriteLine("PASS: atomic case+parties, 2/7 of 20, duplicate and stale guards, owner isolation, add/edit without credits, end representation/access, accurate quick-fill and history retention.");
}finally{
 await db.ExecuteAsync("""
 SELECT Id,LawyerProfileId INTO #U FROM SL_UserAccounts WHERE Username LIKE @pattern OR FullName LIKE @pattern;
 SELECT Id INTO #C FROM SL_LawCases WHERE PrimaryLawyerId IN(SELECT LawyerProfileId FROM #U);
 DELETE FROM SL_ClientChat WHERE CaseId IN(SELECT Id FROM #C);
 DELETE FROM SL_ClientShares WHERE CaseId IN(SELECT Id FROM #C);
 DELETE FROM SL_ClientCaseLinks WHERE CaseId IN(SELECT Id FROM #C);
 DELETE FROM SL_ClientIdentities WHERE UserId IN(SELECT Id FROM #U);
 DELETE FROM SL_CaseParties WHERE CaseId IN(SELECT Id FROM #C);
 DELETE FROM SL_LawCases WHERE Id IN(SELECT Id FROM #C);
 DELETE FROM SL_Sessions WHERE UserId IN(SELECT Id FROM #U);
 DELETE FROM SL_AuditLog WHERE UserId IN(SELECT Id FROM #U);
 DELETE FROM SL_UserAccounts WHERE Id IN(SELECT Id FROM #U);
 DELETE FROM SL_LawyerProfiles WHERE Id IN(SELECT LawyerProfileId FROM #U);
 """,new{pattern=prefix+"%"});
}
