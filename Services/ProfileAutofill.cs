using Dapper;
using SmartLaws.Web.Models;
namespace SmartLaws.Web.Services;

public static class ProfileAutofill
{
    public static void Map(RouteGroupBuilder api)
    {
        api.MapGet("/cases/{id:int}/quick-fill",async(int id,string source,HttpContext h,DatabaseService db)=>{
            var user=AccountSecurity.User(h);
            var lawCase=((List<LawCase>)h.Items["visibleCases"]!).Find(c=>c.Id==id);
            if(lawCase==null || user.Role=="Admin")return Results.NotFound();
            using var c=db.CreateConnection();
            if(source=="self"){
                var profile=await c.QuerySingleOrDefaultAsync<LawyerProfile>("SELECT * FROM SL_LawyerProfiles WHERE Id=@LawyerProfileId",user);
                if(profile==null)return Results.NotFound(new{message="ยังไม่มีข้อมูลส่วนตัวของบัญชีนี้"});
                if(user.Role!="Lawyer")profile.SignatureDataUrl="";
                return Results.Ok(new{profiles=new[]{profile},statusText=user.Role=="Lawyer"?lawCase.LawyerRole:"เสมียนทนาย"});
            }
            if(source!="client")return Results.BadRequest(new{message="เลือกดึงข้อมูลตนเองหรือลูกความในคดี"});
            var parties=(await c.QueryAsync<CaseParty>("SELECT * FROM SL_CaseParties WHERE CaseId=@id AND IsOurClient=1 ORDER BY PartySide,PartyOrder",new{id})).ToList();
            if(parties.Count>0)return Results.Ok(new{profiles=parties,statusText=""});
            // Legacy cases may have names on the case master but no individual client records.
            var side=new[]{"ผู้คัดค้าน","ผู้ร้อง","โจทก์","จำเลย"}.FirstOrDefault(s=>lawCase.LawyerRole.Contains(s));
            if(side==null)return Results.BadRequest(new{message="กรุณาระบุบทบาททนายและลูกความในข้อมูลคดีก่อน"});
            var name=side is "โจทก์" or "ผู้ร้อง"?lawCase.PlaintiffName:lawCase.DefendantName;
            return Results.Ok(new{profiles=new[]{new {fullName=name,partySide=side}},statusText=lawCase.RepresentingPartyOrder.Length>0?lawCase.RepresentingPartyOrder:side});
        });
    }
}
