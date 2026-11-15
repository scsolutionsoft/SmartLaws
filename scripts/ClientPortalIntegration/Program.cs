using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using System.IO.Compression;
using Dapper;
using Microsoft.Data.SqlClient;

var prefix="portaltest"+Guid.NewGuid().ToString("N")[..12];
var testBaseUrl=Environment.GetEnvironmentVariable("SMARTLAWS_TEST_BASE_URL")??"http://localhost:5088";
var password=Guid.NewGuid().ToString("N");
const string initial="1234567890123"; // Synthetic fixture, not a person's identifier.
var config=JsonNode.Parse(await File.ReadAllTextAsync("appsettings.json"))!;
using var db=new SqlConnection(config["ConnectionStrings"]!["DefaultConnection"]!.GetValue<string>());await db.OpenAsync();
HttpClient Session()=>new(new HttpClientHandler{CookieContainer=new CookieContainer()}){BaseAddress=new Uri(testBaseUrl)};
using var lawyer=Session();using var outsider=Session();using var client=Session();using var second=Session();using var anonymous=Session();
void Check(bool yes,string message){if(!yes)throw new Exception(message);}
async Task<JsonNode> Send(HttpClient c,string path,object body,HttpMethod? method=null){var r=await c.SendAsync(new HttpRequestMessage(method??HttpMethod.Post,path){Content=JsonContent.Create(body)});if(!r.IsSuccessStatusCode)throw new Exception($"{path}: {(int)r.StatusCode} {await r.Content.ReadAsStringAsync()}");var text=await r.Content.ReadAsStringAsync();return string.IsNullOrWhiteSpace(text)?new JsonObject():JsonNode.Parse(text)!;}
async Task Login(HttpClient c,string username,string pass)=>await Send(c,"/api/auth/login",new{username,password=pass});
try{
 await Send(lawyer,"/api/auth/register",new{username=prefix,passwordHash=password,fullName=prefix,licenseNo="TEST",email=prefix+"@example.invalid"});await Login(lawyer,prefix,password);
 await Send(outsider,"/api/auth/register",new{username=prefix+"other",passwordHash=password,fullName=prefix+"other",licenseNo="TEST",email=prefix+"other@example.invalid"});await Login(outsider,prefix+"other",password);
 var c1=await Send(lawyer,"/api/cases",new{courtName="Fixture Court",blackCaseNo=prefix,blackCaseYear="2569",plaintiffName="TEST",defendantName="TEST"});int caseId=(int)c1["id"]!;
 var c2=await Send(lawyer,"/api/cases",new{courtName="Other Court",blackCaseNo=prefix,blackCaseYear="2569",plaintiffName="TEST",defendantName="TEST"});int otherCase=(int)c2["id"]!;
 var p1=await Send(lawyer,"/api/parties",new{caseId,fullName=prefix+"ClientA",isOurClient=true});int partyId=(int)p1["id"]!;
 var p2=await Send(lawyer,"/api/parties",new{caseId,fullName=prefix+"ClientB",partyOrder=2,isOurClient=true});int party2=(int)p2["id"]!;
 var p3=await Send(lawyer,"/api/parties",new{caseId=otherCase,fullName=prefix+"ClientC",isOurClient=true});int party3=(int)p3["id"]!;
 Check((await outsider.PostAsJsonAsync($"/api/client-management/{caseId}",new{partyId,citizenId=initial})).StatusCode==HttpStatusCode.NotFound,"Only case owner creates clients");
 var account=await Send(lawyer,$"/api/client-management/{caseId}",new{partyId,citizenId=initial});int clientId=(int)account["userId"]!;string username=(string)account["username"]!;
 Check(username==initial,"National ID is username");
 var account2=await Send(lawyer,$"/api/client-management/{caseId}",new{partyId=party2,citizenId="2234567890123"});int secondId=(int)account2["userId"]!;
 // Exercise conversion/merge of a legacy case-number account with historical chat.
 var legacyId=await db.QuerySingleAsync<int>("INSERT INTO SL_UserAccounts(Username,PasswordHash,FullName,Role,AccountStatus) OUTPUT INSERTED.Id VALUES(@name,@hash,@name,'Client','Active')",new{name=prefix+"Legacy",hash=SmartLaws.Web.Services.AccountSecurity.Hash(initial)});
 await db.ExecuteAsync("INSERT INTO SL_ClientIdentities(UserId) VALUES(@legacyId); INSERT INTO SL_ClientCaseLinks(UserId,CaseId,PartyId) VALUES(@legacyId,@otherCase,@party3); INSERT INTO SL_ClientChat(ClientUserId,CaseId,SenderId,Body,RequestId) VALUES(@legacyId,@otherCase,@legacyId,'Legacy history',NEWID())",new{legacyId,otherCase,party3}); var account3=await Send(lawyer,$"/api/client-management/{otherCase}",new{partyId=party3,citizenId=initial});
 Check(await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_ClientChat WHERE ClientUserId=@clientId AND CaseId=@otherCase AND SenderId=@clientId AND Body='Legacy history'",new{clientId,otherCase})==1,"Legacy chat moves to verified identity"); Check((string)account2["username"]! != username&&(int)account3["userId"]! == clientId,"One identity links multiple cases");
 Check((await lawyer.PostAsJsonAsync($"/api/client-management/{caseId}",new{partyId,citizenId=initial})).StatusCode==HttpStatusCode.OK,"Repeated linking is idempotent");
 var stored=await db.QuerySingleAsync("SELECT PasswordHash,CitizenId,MaxCasesQuota FROM SL_UserAccounts WHERE Id=@clientId",new{clientId});Check(((string)stored.PasswordHash).StartsWith("AQAAAA")&&(string)stored.CitizenId==""&&(int)stored.MaxCasesQuota==0,"Initial password hashed; no plaintext identifier or credit allocation");
 Check((await anonymous.GetAsync($"/api/client/home?caseId={caseId}")).StatusCode==HttpStatusCode.Unauthorized,"Anonymous denied");
 await Login(client,username,initial);
 Check((await client.GetAsync($"/api/client/home?caseId={caseId}")).StatusCode==HttpStatusCode.Forbidden,"Initial password cannot view case data");
 var me=await client.GetFromJsonAsync<JsonNode>("/api/auth/me");Check((bool)me!["mustChangePassword"]!&&me["passwordHash"]==null,"Safe client identity and mandatory password change");
 await Send(client,"/api/client/password",new{currentPassword=initial,newPassword=password,confirmPassword=password});
 Check((await client.GetAsync("/api/auth/me")).StatusCode==HttpStatusCode.Unauthorized,"Password change revokes old session");await Login(client,username,password);
 foreach(var path in new[]{"/api/dashboard","/api/cases","/api/users","/api/work-summary","/api/personal-documents","/api/messages/contacts","/api/admin/news",$"/api/cases/{caseId}/backup",$"/api/client-management/{caseId}"})Check((await client.GetAsync(path)).StatusCode==HttpStatusCode.Forbidden,"Client blocked from staff route "+path);
 var home=await client.GetFromJsonAsync<JsonNode>($"/api/client/home?caseId={caseId}");Check(home!["files"]!.AsArray().Count==0&&home["summary"]!["caseSummary"]==null,"No files shared by default or internal case notes leaked");
 var pdf=System.Text.Encoding.ASCII.GetBytes("%PDF-1.4\nfixture\n%%EOF");
 var file=await Send(lawyer,"/api/files",new{caseId,fileTitle="Shared fixture",storageType="PDF",mimeType="application/pdf",pageCount=1,fileDataBase64=Convert.ToBase64String(pdf)});int fileId=(int)file["id"]!;
 var hiddenFile=await Send(lawyer,"/api/files",new{caseId,fileTitle="Internal fixture",storageType="PDF",mimeType="application/pdf",pageCount=1,fileDataBase64=Convert.ToBase64String(pdf)});int hiddenId=(int)hiddenFile["id"]!;
 Check((await lawyer.PutAsJsonAsync($"/api/client-management/{caseId}/{clientId}/files",new{fileIds=new[]{fileId,9999999}})).StatusCode==HttpStatusCode.BadRequest,"Foreign file share rejected");
 await Send(lawyer,$"/api/client-management/{caseId}/{clientId}/files",new{fileIds=new[]{fileId}},HttpMethod.Put);
 Check((await client.GetByteArrayAsync($"/api/client/files/{fileId}?caseId={caseId}")).SequenceEqual(pdf),"Shared PDF can be downloaded");
 Check((await client.GetAsync($"/api/client/files/{hiddenId}?caseId={caseId}")).StatusCode==HttpStatusCode.NotFound,"Unshared PDF inaccessible");
 Check((await client.GetAsync($"/api/files/{fileId}/content")).StatusCode==HttpStatusCode.Forbidden,"Generic file route inaccessible even for shared file");
 await Login(second,(string)account2["username"]!,"2234567890123");await Send(second,"/api/client/password",new{currentPassword="2234567890123",newPassword=password,confirmPassword=password});await Login(second,(string)account2["username"]!,password);
 Check((await second.GetAsync($"/api/client/files/{fileId}?caseId={caseId}")).StatusCode==HttpStatusCode.NotFound,"Sharing isolated per client in same case");
 var requestId=Guid.NewGuid();var payload=new{body="Client asks lawyer",fileName="client.pdf",mimeType="application/pdf",data=Convert.ToBase64String(pdf),requestId};
 var message=await Send(client,$"/api/client/messages?caseId={caseId}",payload);int attachedId=(int)message["fileId"]!;
 var retry=await Send(client,$"/api/client/messages?caseId={caseId}",payload);Check((int)message["id"]! == (int)retry["id"]!,"Message retries do not duplicate files or messages");
 Check((await second.GetFromJsonAsync<JsonArray>($"/api/client/messages?caseId={caseId}"))!.Count==0,"Private conversations isolated");
 Check((await outsider.GetAsync($"/api/client-management/{caseId}/{clientId}/messages")).StatusCode==HttpStatusCode.NotFound,"Other lawyer cannot read conversation");
 var thread=await lawyer.GetFromJsonAsync<JsonArray>($"/api/client-management/{caseId}/{clientId}/messages");Check(thread!.Count==1,"Owner reads client message");
 var read=await client.GetFromJsonAsync<JsonArray>($"/api/client/messages?caseId={caseId}");Check(read![0]!["readAt"]!=null,"Read receipt updated");
 await Send(lawyer,$"/api/client-management/{caseId}/{clientId}/messages",new{body="Lawyer reply",fileName=(string?)null,mimeType=(string?)null,data=(string?)null,requestId=Guid.NewGuid()});
 Check((await client.GetFromJsonAsync<JsonArray>($"/api/client/messages?caseId={caseId}"))!.Count==2,"Two-way chat persists");
 Check((await client.PostAsJsonAsync($"/api/client/messages?caseId={caseId}",new{body="",fileName="bad.pdf",mimeType="application/pdf",data="YmFk",requestId=Guid.NewGuid()})).StatusCode==HttpStatusCode.BadRequest,"Invalid chat file rejected");
 Check((await lawyer.DeleteAsync($"/api/files/{attachedId}")).StatusCode==HttpStatusCode.Conflict,"Chat evidence protected from standalone deletion");
 await Send(lawyer,$"/api/client-management/{caseId}/{clientId}/state",new{active=false},HttpMethod.Put);Check((await client.GetAsync("/api/auth/me")).StatusCode==HttpStatusCode.OK,"Suspension preserves other case session");
 await Send(lawyer,$"/api/client-management/{caseId}/{clientId}/state",new{active=true},HttpMethod.Put);await Login(client,username,password);
 await Send(lawyer,$"/api/client-management/{caseId}/{clientId}/reset",new{partyId,citizenId=initial});Check((await client.GetAsync("/api/auth/me")).StatusCode==HttpStatusCode.Unauthorized,"Owner reset revokes sessions");await Login(client,username,initial);Check((await client.GetAsync($"/api/client/home?caseId={caseId}")).StatusCode==HttpStatusCode.Forbidden,"Reset requires another password change");
 await Send(client,"/api/client/password",new{currentPassword=initial,newPassword=password,confirmPassword=password});await Login(client,username,password);
 var priorHash=await db.ExecuteScalarAsync<string>("SELECT PasswordHash FROM SL_UserAccounts WHERE Id=@clientId",new{clientId});
 var foreignCase=await Send(outsider,"/api/cases",new{courtName="Other lawyer court",blackCaseNo=prefix+"foreign",blackCaseYear="2569",plaintiffName="TEST",defendantName="TEST"});int foreignCaseId=(int)foreignCase["id"]!;
 var foreignParty=await Send(outsider,"/api/parties",new{caseId=foreignCaseId,fullName=prefix+"SameClient",isOurClient=true});
 var linked=await Send(outsider,$"/api/client-management/{foreignCaseId}",new{partyId=(int)foreignParty["id"]!,citizenId=initial});
 Check((int)linked["userId"]! == clientId && priorHash==await db.ExecuteScalarAsync<string>("SELECT PasswordHash FROM SL_UserAccounts WHERE Id=@clientId",new{clientId}),"Another lawyer links identity without resetting password");
 Check((await lawyer.PostAsJsonAsync($"/api/client-management/{caseId}/{clientId}/reset",new{partyId,citizenId=initial})).StatusCode==HttpStatusCode.Conflict,"Cross-lawyer password reset denied");
 Check((await lawyer.GetAsync($"/api/client-management/{foreignCaseId}/{clientId}/messages")).StatusCode==HttpStatusCode.NotFound,"Shared identity does not grant lawyer access to another lawyer case");
 await Send(outsider,$"/api/client-management/{foreignCaseId}/{clientId}/state",new{active=false},HttpMethod.Put);
 Check((await client.GetAsync($"/api/client/home?caseId={foreignCaseId}")).StatusCode==HttpStatusCode.NotFound,"Suspended case inaccessible while other cases remain active"); foreach(var role in new[]{"Clerk","Admin"}){await db.ExecuteAsync("UPDATE SL_UserAccounts SET Role=@role WHERE Username=@name",new{role,name=prefix+"other"});Check((await outsider.PostAsJsonAsync($"/api/client-management/{caseId}",new{partyId=party2,citizenId="2234567890123"})).StatusCode==HttpStatusCode.NotFound,role+" cannot create client accounts");}
 Check((await client.GetFromJsonAsync<JsonArray>("/api/client/cases"))!.Count==2,"Client lists both linked cases");
 Check((await client.GetAsync($"/api/client/home?caseId=9999999")).StatusCode==HttpStatusCode.NotFound,"Foreign selected case denied");
 Check((await client.GetAsync($"/api/client/files/{fileId}?caseId={otherCase}")).StatusCode==HttpStatusCode.NotFound,"File cannot cross selected case");
 var otherFile=await Send(lawyer,"/api/files",new{caseId=otherCase,fileTitle="Second case file",storageType="PDF",mimeType="application/pdf",pageCount=1,fileDataBase64=Convert.ToBase64String(pdf)});int otherFileId=(int)otherFile["id"]!;
 await Send(lawyer,$"/api/client-management/{otherCase}/{clientId}/files",new{fileIds=new[]{otherFileId}},HttpMethod.Put);
 await Send(lawyer,$"/api/client-management/{caseId}/{clientId}/files",new{fileIds=new[]{fileId,attachedId}},HttpMethod.Put);
 Check((await client.GetByteArrayAsync($"/api/client/files/{otherFileId}?caseId={otherCase}")).SequenceEqual(pdf),"Sharing changes preserve other case shares");
 await Send(client,$"/api/client/messages?caseId={otherCase}",payload);
 Check((await client.GetFromJsonAsync<JsonArray>($"/api/client/messages?caseId={otherCase}"))!.Count==2,"Same retry ID in different case sends independently"); var before=await db.ExecuteScalarAsync<int>("SELECT UsedCasesCount FROM SL_UserAccounts WHERE Username=@prefix",new{prefix});
 using var backup=await lawyer.GetAsync($"/api/cases/{caseId}/backup");Check(backup.IsSuccessStatusCode,"Case backup with chat succeeds");var token=backup.Headers.GetValues("X-Case-Backup-Token").Single();
 using(var zip=new ZipArchive(new MemoryStream(await backup.Content.ReadAsByteArrayAsync()))){Check(zip.GetEntry($"files/{attachedId}.pdf")!=null,"Chat file included in ZIP");using var reader=new StreamReader(zip.GetEntry("case-data.json")!.Open());var text=await reader.ReadToEndAsync();Check(text.Contains("ClientMessages")&&!text.Contains("PasswordHash"),"Chat data included; credentials excluded from ZIP");}
 await Send(lawyer,$"/api/cases/{caseId}",new{backupToken=token,confirmed=true,confirmation="ลบคดี"},HttpMethod.Delete);
 Check((await client.GetAsync("/api/auth/me")).StatusCode==HttpStatusCode.OK,"Deleting one case preserves other case access");Check(await db.ExecuteScalarAsync<int>("SELECT UsedCasesCount FROM SL_UserAccounts WHERE Username=@prefix",new{prefix})==before,"Client provisioning and case deletion do not change credits");
 Check((await client.GetByteArrayAsync($"/api/client/files/{otherFileId}?caseId={otherCase}")).SequenceEqual(pdf),"Deleting first case preserves second case files");
 Console.WriteLine("PASS: national-ID multi-case identity, legacy history merge, password preservation, cross-lawyer isolation, case-scoped sharing/chat/retries/suspension, ZIP/deletion preserves other cases and credits.");
}finally{
 var cleanupKeys=(await db.QueryAsync<string>("""
 SELECT StorageKey FROM SL_CaseFileAttachments WHERE StorageKey IS NOT NULL AND CaseId IN
   (SELECT Id FROM SL_LawCases WHERE PrimaryLawyerId IN(SELECT LawyerProfileId FROM SL_UserAccounts WHERE Username LIKE @pattern))
 """,new{pattern=prefix+"%"})).ToArray();
 foreach(var key in cleanupKeys){if(!SmartLaws.Web.Services.FileStorage.IsValidKey(key))continue;var path=Path.Combine("App_Data","Uploads",key);if(File.Exists(path))File.Delete(path);}
 await db.ExecuteAsync("""
 SELECT Id,LawyerProfileId,FullName INTO #PortalUsers FROM SL_UserAccounts WHERE Username LIKE @pattern OR FullName LIKE @pattern;
 SELECT Id INTO #PortalCases FROM SL_LawCases WHERE PrimaryLawyerId IN(SELECT LawyerProfileId FROM #PortalUsers WHERE LawyerProfileId>0);
 DELETE FROM SL_ClientChat WHERE CaseId IN(SELECT Id FROM #PortalCases);
 DELETE FROM SL_ClientShares WHERE ClientUserId IN(SELECT Id FROM #PortalUsers);
 DELETE FROM SL_ClientCaseLinks WHERE UserId IN(SELECT Id FROM #PortalUsers);
 DELETE FROM SL_ClientIdentities WHERE UserId IN(SELECT Id FROM #PortalUsers);
 DELETE FROM SL_Appointments WHERE CaseId IN(SELECT Id FROM #PortalCases);
 DELETE FROM SL_LitigationEvents WHERE CaseId IN(SELECT Id FROM #PortalCases);
 DELETE FROM SL_CaseFileAttachments WHERE CaseId IN(SELECT Id FROM #PortalCases);
 DELETE FROM SL_CaseDocuments WHERE CaseId IN(SELECT Id FROM #PortalCases);
 DELETE FROM SL_CaseParties WHERE CaseId IN(SELECT Id FROM #PortalCases);
 DELETE FROM SL_LawCases WHERE Id IN(SELECT Id FROM #PortalCases);
 DELETE FROM SL_Sessions WHERE UserId IN(SELECT Id FROM #PortalUsers);
 DELETE FROM SL_AuditLog WHERE UserId IN(SELECT Id FROM #PortalUsers);
 DELETE FROM SL_UserAccounts WHERE Id IN(SELECT Id FROM #PortalUsers);
 DELETE FROM SL_LawyerProfiles WHERE Id IN(SELECT LawyerProfileId FROM #PortalUsers WHERE LawyerProfileId>0);
 DELETE FROM SL_ElectronicSignatures WHERE SignerName IN(SELECT FullName FROM #PortalUsers);
 DROP TABLE #PortalCases; DROP TABLE #PortalUsers;
 """,new{pattern=prefix+"%"});
}
