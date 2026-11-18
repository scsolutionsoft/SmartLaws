using System.Text.Json;
using Dapper;
using Microsoft.Data.SqlClient;
using SmartLaws.Web.Models;
namespace SmartLaws.Web.Services;

public static class CaseParties
{
    public record PartyInput(
        int Id,string PartySide,int PartyOrder,string FullName,string CitizenId,string Phone,bool IsOurClient,
        string Title = "",string Race = "ไทย",string Nationality = "ไทย",string Occupation = "",string Age = "-",
        string BirthDateText = "-",string HouseNo = "",string Moo = "-",string Road = "-",string Soi = "-",
        string NearBy = "-",string SubDistrict = "",string District = "",string Province = "ศรีสะเกษ",
        string PostalCode = "33000",string Fax = "-",string Email = "-");
    public record RosterInput(int Version,string LawyerRole,Dictionary<string,int> Counts,List<PartyInput> Parties);
    public static readonly string[] Sides=["โจทก์","จำเลย","ผู้ร้อง","ผู้คัดค้าน"];
    public static async Task InitializeAsync(DatabaseService db){using var c=db.CreateConnection();await c.ExecuteAsync("""
        IF COL_LENGTH('SL_LawCases','PartyCountsJson') IS NULL ALTER TABLE SL_LawCases ADD PartyCountsJson nvarchar(max) NOT NULL DEFAULT N'{}',PartyVersion int NOT NULL DEFAULT 0;
        ALTER TABLE SL_LawCases ALTER COLUMN RepresentingPartyOrder nvarchar(max) NULL;
        """);}
    public static Dictionary<string,int> Counts(string json){try{return JsonSerializer.Deserialize<Dictionary<string,int>>(json)??new();}catch(JsonException){return new();}}
    public static string? Validate(string role,Dictionary<string,int> counts,IEnumerable<CaseParty> rows,bool requireClient=true)
    {
        var list=rows.ToList();var side=Sides.FirstOrDefault(s=>role=="ทนาย"+s);
        if(side==null)return "เลือกฝ่ายที่ทนายรับว่าความ";
        if(counts.Any(p=>!Sides.Contains(p.Key)||p.Value<0||p.Value>10000))return "จำนวนคู่ความต้องอยู่ระหว่าง 0–10,000 คน";
        if(list.Count>1000)return "เพิ่มรายชื่อได้ไม่เกิน 1,000 คนต่อครั้ง";
        if(list.Any(p=>!Sides.Contains(p.PartySide)||p.PartyOrder<1||p.PartyOrder>10000||string.IsNullOrWhiteSpace(p.FullName)||p.FullName.Length>250))return "ระบุฝ่าย ลำดับ และชื่อคู่ความให้ครบ";
        if(list.GroupBy(p=>(p.PartySide,p.PartyOrder)).Any(g=>g.Count()>1))return "ลำดับคู่ความซ้ำในฝ่ายเดียวกัน กรุณาแก้ลำดับก่อนบันทึก";
        if(list.Any(p=>counts.TryGetValue(p.PartySide,out var total)&&p.PartyOrder>total))return "ลำดับคู่ความเกินจำนวนทั้งหมดที่ระบุ";
        if(list.Any(p=>!string.IsNullOrEmpty(p.CitizenId)&&!System.Text.RegularExpressions.Regex.IsMatch(p.CitizenId,"^[0-9]{13}$")))return "เลขประจำตัวประชาชนต้องมี 13 หลัก หรือเว้นว่างไว้ก่อน";
        if(list.Any(p=>p.IsOurClient&&p.PartySide!=side))return "เลือกลูกความเฉพาะฝ่ายที่ทนายรับว่าความในสำนวนนี้";
        if(requireClient&&!list.Any(p=>p.IsOurClient))return "เลือกลูกความที่รับว่าความอย่างน้อย 1 คน";
        if(list.Any(p=>(p.Title?.Length??0)>50||(p.Race?.Length??0)>50||(p.Nationality?.Length??0)>50||
            (p.Occupation?.Length??0)>100||(p.Age?.Length??0)>20||(p.BirthDateText?.Length??0)>100||
            (p.HouseNo?.Length??0)>100||(p.Moo?.Length??0)>50||(p.Road?.Length??0)>150||
            (p.Soi?.Length??0)>150||(p.NearBy?.Length??0)>150||(p.SubDistrict?.Length??0)>150||
            (p.District?.Length??0)>150||(p.Province?.Length??0)>150||(p.PostalCode?.Length??0)>20||
            (p.Phone?.Length??0)>100||(p.Fax?.Length??0)>100||(p.Email?.Length??0)>150))
            return "ข้อมูลประวัติหรือที่อยู่ยาวเกินกำหนด กรุณาตรวจสอบช่องที่กรอก";
        return null;
    }
    public static string Summary(IEnumerable<CaseParty> rows)=>string.Join(" และ",rows.Where(p=>p.IsOurClient).OrderBy(p=>p.PartySide).ThenBy(p=>p.PartyOrder).Select(p=>p.PartySide+"ที่ "+string.Concat(p.PartyOrder.ToString().Select(ch=>"๐๑๒๓๔๕๖๗๘๙"[ch-'0']))));
    public static async Task<int> Insert(SqlConnection c,SqlTransaction tx,CaseParty p)=>await c.QuerySingleAsync<int>("""
        INSERT INTO SL_CaseParties(CaseId,PartySide,PartyOrder,Title,FullName,CitizenId,Race,Nationality,Occupation,Age,BirthDateText,HouseNo,Moo,Road,Soi,NearBy,SubDistrict,District,Province,PostalCode,Phone,Fax,Email,IsOurClient)
        OUTPUT INSERTED.Id VALUES(@CaseId,@PartySide,@PartyOrder,@Title,@FullName,@CitizenId,@Race,@Nationality,@Occupation,@Age,@BirthDateText,@HouseNo,@Moo,@Road,@Soi,@NearBy,@SubDistrict,@District,@Province,@PostalCode,@Phone,@Fax,@Email,@IsOurClient)
        """,p,tx);
    public static async Task Sync(SqlConnection c,SqlTransaction tx,int caseId){var parties=await c.QueryAsync<CaseParty>("SELECT * FROM SL_CaseParties WHERE CaseId=@caseId",new{caseId},tx);await c.ExecuteAsync("UPDATE SL_LawCases SET RepresentingPartyOrder=@summary,PartyVersion=PartyVersion+1,UpdatedAt=SYSUTCDATETIME() WHERE Id=@caseId",new{caseId,summary=Summary(parties)},tx);}
    public static void Map(RouteGroupBuilder api)
    {
        api.MapGet("/cases/{id:int}/parties",async(int id,HttpContext h,DatabaseService db)=>{
            if(!ClientPortal.Owns(h,id))return Results.NotFound();using var c=db.CreateConnection();
            var lc=await c.QuerySingleAsync<LawCase>("SELECT * FROM SL_LawCases WHERE Id=@id",new{id});
            var parties=await c.QueryAsync("SELECT p.*,i.CitizenNumber LinkedCitizenNumber,CAST(CASE WHEN a.UserId IS NULL THEN 0 ELSE 1 END AS bit) HasAccount FROM SL_CaseParties p LEFT JOIN SL_ClientCaseLinks a ON a.PartyId=p.Id AND a.CaseId=p.CaseId LEFT JOIN SL_ClientIdentities i ON i.UserId=a.UserId WHERE p.CaseId=@id ORDER BY p.PartySide,p.PartyOrder,p.Id",new{id});
            return Results.Ok(new{version=lc.PartyVersion,lawyerRole=lc.LawyerRole,counts=Counts(lc.PartyCountsJson),parties,summary=lc.RepresentingPartyOrder});
        });
        api.MapPut("/cases/{id:int}/parties",async(int id,RosterInput input,HttpContext h,DatabaseService db)=>{
            if(!ClientPortal.Owns(h,id))return Results.NotFound();
            if(input.Parties==null||input.Counts==null)return Results.BadRequest();
            var rows=input.Parties.Select(p=>new CaseParty{
                Id=p.Id,CaseId=id,PartySide=p.PartySide,PartyOrder=p.PartyOrder,Title=p.Title??"",FullName=p.FullName?.Trim()??"",
                CitizenId=ClientPortal.Digits(p.CitizenId??""),Race=p.Race??"ไทย",Nationality=p.Nationality??"ไทย",
                Occupation=p.Occupation??"",Age=p.Age??"-",BirthDateText=p.BirthDateText??"-",HouseNo=p.HouseNo??"",
                Moo=p.Moo??"-",Road=p.Road??"-",Soi=p.Soi??"-",NearBy=p.NearBy??"-",SubDistrict=p.SubDistrict??"",
                District=p.District??"",Province=p.Province??"",PostalCode=p.PostalCode??"",Phone=p.Phone??"",Fax=p.Fax??"",
                Email=p.Email??"",IsOurClient=p.IsOurClient
            }).ToList();
            var error=Validate(input.LawyerRole,input.Counts,rows,false);if(error!=null)return Results.BadRequest(new{message=error});
            using var c=db.CreateConnection();await c.OpenAsync();using var tx=c.BeginTransaction(System.Data.IsolationLevel.Serializable);
            var version=await c.ExecuteScalarAsync<int>("SELECT PartyVersion FROM SL_LawCases WITH(UPDLOCK,HOLDLOCK) WHERE Id=@id",new{id},tx);
            if(version!=input.Version)return Results.Conflict(new{message="รายชื่อมีการเปลี่ยนแปลงแล้ว กรุณาปิดและเปิดหน้าจอใหม่ก่อนแก้ไข"});
            var old=(await c.QueryAsync<CaseParty>("SELECT * FROM SL_CaseParties WHERE CaseId=@id",new{id},tx)).ToList();
            if(rows.Where(p=>p.Id>0).GroupBy(p=>p.Id).Any(g=>g.Count()>1)||rows.Any(p=>p.Id<0||p.Id>0&&!old.Any(o=>o.Id==p.Id))||old.Any(o=>!rows.Any(p=>p.Id==o.Id)))return Results.BadRequest(new{message="รายชื่อเดิมต้องอยู่ครบ หากเลิกรับว่าความให้ยกเลิกเครื่องหมายรับว่าความแทนการลบ"});
            foreach(var p in rows){
                if(p.Id==0){p.Id=await Insert(c,tx,p);continue;}
                var linked=await c.ExecuteScalarAsync<string>("SELECT i.CitizenNumber FROM SL_ClientCaseLinks a JOIN SL_ClientIdentities i ON i.UserId=a.UserId WHERE a.CaseId=@id AND a.PartyId=@partyId",new{id,partyId=p.Id},tx);
                if(!string.IsNullOrEmpty(linked)&&linked!=p.CitizenId)return Results.Conflict(new{message="เลขประชาชนผูกบัญชีลูกความแล้ว ต้องใช้เลขเดิมเพื่อไม่ย้ายสิทธิ์ผิดคน"});
                await c.ExecuteAsync("""
                    UPDATE SL_CaseParties SET PartySide=@PartySide,PartyOrder=@PartyOrder,Title=@Title,FullName=@FullName,
                    CitizenId=@CitizenId,Race=@Race,Nationality=@Nationality,Occupation=@Occupation,Age=@Age,BirthDateText=@BirthDateText,
                    HouseNo=@HouseNo,Moo=@Moo,Road=@Road,Soi=@Soi,NearBy=@NearBy,SubDistrict=@SubDistrict,District=@District,
                    Province=@Province,PostalCode=@PostalCode,Phone=@Phone,Fax=@Fax,Email=@Email,IsOurClient=@IsOurClient
                    WHERE Id=@Id AND CaseId=@CaseId
                    """,p,tx);
                if(!p.IsOurClient)await c.ExecuteAsync("UPDATE SL_ClientCaseLinks SET IsActive=0 WHERE CaseId=@CaseId AND PartyId=@Id",p,tx);
            }
            await c.ExecuteAsync("UPDATE SL_LawCases SET LawyerRole=@LawyerRole,PartyCountsJson=@json WHERE Id=@id",new{id,input.LawyerRole,json=JsonSerializer.Serialize(input.Counts)},tx);
            await Sync(c,tx,id);
            await c.ExecuteAsync("INSERT INTO SL_AuditLog(UserId,Action,Resource) VALUES(@actor,'PARTIES_UPDATE',@resource)",new{actor=AccountSecurity.User(h).Id,resource=$"case:{id}; clients:{rows.Count(p=>p.IsOurClient)}; version:{version+1}"},tx);
            tx.Commit();return Results.Ok(new{version=version+1,summary=Summary(rows)});
        });
    }
}
