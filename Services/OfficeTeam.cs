using Dapper;
using SmartLaws.Web.Models;

namespace SmartLaws.Web.Services;

public static class OfficeTeam
{
    public static async Task InitializeAsync(DatabaseService db)
    {
        using var c=db.CreateConnection();
        await c.ExecuteAsync("""
        IF OBJECT_ID('SL_LawOfficeMembers','U') IS NULL CREATE TABLE SL_LawOfficeMembers(
          Id int IDENTITY PRIMARY KEY, OfficeOwnerUserId int NOT NULL REFERENCES SL_UserAccounts(Id),
          LawyerUserId int NOT NULL REFERENCES SL_UserAccounts(Id), IsActive bit NOT NULL DEFAULT 1,
          CreatedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME(), CONSTRAINT UQ_SL_OfficeMember UNIQUE(OfficeOwnerUserId,LawyerUserId));
        IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE name='UX_SL_OfficeMember_User') CREATE UNIQUE INDEX UX_SL_OfficeMember_User ON SL_LawOfficeMembers(LawyerUserId) WHERE IsActive=1;
        IF OBJECT_ID('SL_OfficeCaseAssignments','U') IS NULL CREATE TABLE SL_OfficeCaseAssignments(
          Id int IDENTITY PRIMARY KEY, CaseId int NOT NULL REFERENCES SL_LawCases(Id), OfficeOwnerUserId int NOT NULL REFERENCES SL_UserAccounts(Id),
          LawyerUserId int NOT NULL REFERENCES SL_UserAccounts(Id), AssignedByUserId int NOT NULL REFERENCES SL_UserAccounts(Id),
          AssignedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME(), CONSTRAINT UQ_SL_OfficeCaseAssignment UNIQUE(CaseId));
        """);
    }
    public static void Map(RouteGroupBuilder api)
    {
        api.MapGet("/office/team",async(HttpContext h,DatabaseService db)=>{
            var u=AccountSecurity.User(h);if(u.Role!="Lawyer"||!await IsOwner(db,u.Id))return Results.StatusCode(403);
            using var c=db.CreateConnection();return Results.Ok(await c.QueryAsync("""
              SELECT m.Id membershipId,m.IsActive,u.Id userId,u.Username,u.FullName,u.LawyerProfileId,u.LicenseNo,u.Phone,u.Email,
                (SELECT COUNT(*) FROM SL_OfficeCaseAssignments a WHERE a.LawyerUserId=u.Id AND a.OfficeOwnerUserId=@owner) assignedCases
              FROM SL_LawOfficeMembers m JOIN SL_UserAccounts u ON u.Id=m.LawyerUserId WHERE m.OfficeOwnerUserId=@owner ORDER BY u.FullName
              """,new{owner=u.Id}));
        });
        api.MapPost("/office/team",async(HttpContext h,OfficeLawyerInput r,DatabaseService db)=>{
            var owner=AccountSecurity.User(h);if(owner.Role!="Lawyer"||!await IsOwner(db,owner.Id))return Results.StatusCode(403);
            if(string.IsNullOrWhiteSpace(r.Username)||string.IsNullOrWhiteSpace(r.FullName)||r.Password.Length<12||string.IsNullOrWhiteSpace(r.LicenseNo))return Results.BadRequest(new{message="กรอกชื่อผู้ใช้ ชื่อทนาย เลขใบอนุญาต และรหัสผ่านอย่างน้อย 12 ตัวอักษร"});
            if(r.Username.Length>100||r.FullName.Length>200||r.LicenseNo.Length>100||r.Password.Length>200)return Results.BadRequest();
            using var c=db.CreateConnection();await c.OpenAsync();using var tx=c.BeginTransaction(System.Data.IsolationLevel.Serializable);
            if(await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_UserAccounts WHERE Username=@username",new{username=r.Username.Trim()},tx)>0)return Results.Conflict(new{message="ชื่อผู้ใช้นี้มีแล้ว"});
            var profile=await c.ExecuteScalarAsync<int>("""
              INSERT SL_LawyerProfiles(FullName,RoleType,LicenseNo,LicenseJurisdiction,Occupation,Age,HouseNo,Moo,Road,SubDistrict,District,Province,PostalCode,Phone,OfficeName)
              OUTPUT INSERTED.Id VALUES(@name,N'ทนายความ',@license,N'ทั่วราชอาณาจักร',N'ทนายความ',N'-',N'-',N'-',N'-',N'-',N'-',N'-',N'-',@phone,@office)
              """,new{name=r.FullName.Trim(),license=r.LicenseNo.Trim(),phone=r.Phone?.Trim()??"",office=owner.OfficeName},tx);
            var member=await c.ExecuteScalarAsync<int>("""
              INSERT SL_UserAccounts(Username,PasswordHash,FullName,Role,LawyerProfileId,LicenseNo,Phone,Email,OfficeName,PlanType,PlanName,MaxCasesQuota,UsedCasesCount,SubscriptionExpireDate,AccountStatus)
              OUTPUT INSERTED.Id VALUES(@username,@hash,@name,'Lawyer',@profile,@license,@phone,@email,@office,'OfficeTeam',N'ทนายในสำนักงาน',0,0,DATEADD(year,10,SYSUTCDATETIME()),'Active')
              """,new{username=r.Username.Trim(),hash=AccountSecurity.Hash(r.Password),name=r.FullName.Trim(),profile,license=r.LicenseNo.Trim(),phone=r.Phone?.Trim()??"",email=r.Email?.Trim()??"",office=owner.OfficeName},tx);
            await c.ExecuteAsync("INSERT SL_LawOfficeMembers(OfficeOwnerUserId,LawyerUserId) VALUES(@owner,@member)",new{owner=owner.Id,member},tx);tx.Commit();return Results.Ok(new{userId=member,lawyerProfileId=profile});
        });
        api.MapPut("/office/team/{id:int}/state",async(int id,HttpContext h,OfficeMemberState r,DatabaseService db)=>{
            var owner=AccountSecurity.User(h);if(owner.Role!="Lawyer"||!await IsOwner(db,owner.Id))return Results.StatusCode(403);using var c=db.CreateConnection();
            if(await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_LawOfficeMembers WHERE Id=@id AND OfficeOwnerUserId=@owner",new{id,owner=owner.Id})==0)return Results.NotFound();
            await c.ExecuteAsync("UPDATE SL_LawOfficeMembers SET IsActive=@active WHERE Id=@id AND OfficeOwnerUserId=@owner; UPDATE SL_UserAccounts SET AccountStatus=CASE WHEN @active=1 THEN N'Active' ELSE N'Suspended' END WHERE Id=(SELECT LawyerUserId FROM SL_LawOfficeMembers WHERE Id=@id AND OfficeOwnerUserId=@owner); IF @active=0 DELETE FROM SL_Sessions WHERE UserId=(SELECT LawyerUserId FROM SL_LawOfficeMembers WHERE Id=@id AND OfficeOwnerUserId=@owner)",new{active=r.Active,id,owner=owner.Id});return Results.Ok();
        });
        api.MapGet("/office/cases",async(HttpContext h,DatabaseService db)=>{
            var owner=AccountSecurity.User(h);if(owner.Role!="Lawyer"||!await IsOwner(db,owner.Id))return Results.StatusCode(403);using var c=db.CreateConnection();
            return Results.Ok(await c.QueryAsync("""
              SELECT c.Id,c.CaseCode,c.BlackCaseNo,c.BlackCaseYear,c.CourtName,c.PlaintiffName,c.DefendantName,c.PrimaryLawyerId,
               COALESCE(a.LawyerUserId,@owner) assignedLawyerUserId,COALESCE(u.FullName,@ownerName) assignedLawyerName
              FROM SL_LawCases c LEFT JOIN SL_OfficeCaseAssignments a ON a.CaseId=c.Id AND a.OfficeOwnerUserId=@owner
              LEFT JOIN SL_UserAccounts u ON u.Id=a.LawyerUserId
              WHERE c.PrimaryLawyerId=@profile OR a.OfficeOwnerUserId=@owner ORDER BY c.Id DESC
              """,new{owner=owner.Id,profile=owner.LawyerProfileId,ownerName=owner.FullName}));
        });
        api.MapPut("/office/cases/{caseId:int}/assignment",async(int caseId,OfficeAssignment r,HttpContext h,DatabaseService db)=>{
            var owner=AccountSecurity.User(h);if(owner.Role!="Lawyer"||!await IsOwner(db,owner.Id))return Results.StatusCode(403);using var c=db.CreateConnection();await c.OpenAsync();using var tx=c.BeginTransaction(System.Data.IsolationLevel.Serializable);
            var lc=await c.QuerySingleOrDefaultAsync<LawCase>("SELECT * FROM SL_LawCases WITH(UPDLOCK) WHERE Id=@caseId",new{caseId},tx);if(lc==null||(lc.PrimaryLawyerId!=owner.LawyerProfileId&&await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_OfficeCaseAssignments WHERE CaseId=@caseId AND OfficeOwnerUserId=@owner",new{caseId,owner=owner.Id},tx)==0))return Results.NotFound();
            var profile=owner.LawyerProfileId;int? lawyerUserId=null;
            if(r.LawyerUserId is >0){var memberProfile=await c.ExecuteScalarAsync<int?>("SELECT u.LawyerProfileId FROM SL_LawOfficeMembers m JOIN SL_UserAccounts u ON u.Id=m.LawyerUserId WHERE m.OfficeOwnerUserId=@owner AND m.LawyerUserId=@id AND m.IsActive=1 AND u.AccountStatus='Active'",new{owner=owner.Id,id=r.LawyerUserId},tx);if(memberProfile is null or <=0)return Results.BadRequest(new{message="เลือกทนายที่ใช้งานอยู่ในสำนักงาน"});profile=memberProfile.Value;lawyerUserId=r.LawyerUserId;}
            await c.ExecuteAsync("UPDATE SL_LawCases SET PrimaryLawyerId=@profile,UpdatedAt=SYSUTCDATETIME() WHERE Id=@caseId",new{profile,caseId},tx);
            if(lawyerUserId.HasValue)await c.ExecuteAsync("IF EXISTS(SELECT 1 FROM SL_OfficeCaseAssignments WHERE CaseId=@caseId) UPDATE SL_OfficeCaseAssignments SET LawyerUserId=@lawyerUserId,AssignedByUserId=@owner,AssignedAt=SYSUTCDATETIME() WHERE CaseId=@caseId ELSE INSERT SL_OfficeCaseAssignments(CaseId,OfficeOwnerUserId,LawyerUserId,AssignedByUserId) VALUES(@caseId,@owner,@lawyerUserId,@owner)",new{caseId,owner=owner.Id,lawyerUserId},tx);
            else await c.ExecuteAsync("DELETE FROM SL_OfficeCaseAssignments WHERE CaseId=@caseId AND OfficeOwnerUserId=@owner",new{caseId,owner=owner.Id},tx);
            tx.Commit();return Results.Ok();
        });
    }
    static async Task<bool> IsOwner(DatabaseService db,int id){using var c=db.CreateConnection();return await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_UserAccounts u WHERE u.Id=@id AND u.Role='Lawyer' AND NOT EXISTS(SELECT 1 FROM SL_LawOfficeMembers m WHERE m.LawyerUserId=u.Id)",new{id})==1;}
}
public sealed record OfficeLawyerInput(string Username,string Password,string FullName,string LicenseNo,string? Phone,string? Email);
public sealed record OfficeMemberState(bool Active);
public sealed record OfficeAssignment(int? LawyerUserId);
