using Dapper;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using SmartLaws.Web.Models;

namespace SmartLaws.Web.Services;

public static class OfficeTeam
{
    const string OfficeAdmin = "OfficeAdmin";
    const string PermanentLawyer = "PermanentLawyer";

    public static async Task InitializeAsync(DatabaseService db)
    {
        using var c=db.CreateConnection();
        await c.ExecuteAsync("""
        IF OBJECT_ID('SL_LawOfficeMembers','U') IS NULL CREATE TABLE SL_LawOfficeMembers(
          Id int IDENTITY PRIMARY KEY, OfficeOwnerUserId int NOT NULL REFERENCES SL_UserAccounts(Id),
          LawyerUserId int NOT NULL REFERENCES SL_UserAccounts(Id), IsActive bit NOT NULL DEFAULT 1,
          MemberRole nvarchar(30) NOT NULL DEFAULT N'PermanentLawyer',
          CreatedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME(), CONSTRAINT UQ_SL_OfficeMember UNIQUE(OfficeOwnerUserId,LawyerUserId));
        IF COL_LENGTH('SL_LawOfficeMembers','MemberRole') IS NULL
          ALTER TABLE SL_LawOfficeMembers ADD MemberRole nvarchar(30) NOT NULL CONSTRAINT DF_SL_OfficeMember_Role DEFAULT N'PermanentLawyer';
        IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE name='UX_SL_OfficeMember_User') CREATE UNIQUE INDEX UX_SL_OfficeMember_User ON SL_LawOfficeMembers(LawyerUserId) WHERE IsActive=1;
        IF OBJECT_ID('SL_OfficeCaseAssignments','U') IS NULL CREATE TABLE SL_OfficeCaseAssignments(
          Id int IDENTITY PRIMARY KEY, CaseId int NOT NULL REFERENCES SL_LawCases(Id), OfficeOwnerUserId int NOT NULL REFERENCES SL_UserAccounts(Id),
          LawyerUserId int NOT NULL REFERENCES SL_UserAccounts(Id), AssignedByUserId int NOT NULL REFERENCES SL_UserAccounts(Id),
          AssignedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME(), CONSTRAINT UQ_SL_OfficeCaseAssignment UNIQUE(CaseId));
        """);
        await c.ExecuteAsync("""
        DECLARE @kriangkrai int=(SELECT TOP 1 Id FROM SL_UserAccounts WHERE Username=N'kriangkrai' OR FullName=N'นายเกรียงไกร โล่ห์ทวนชัย');
        IF @kriangkrai IS NOT NULL BEGIN
          UPDATE SL_UserAccounts SET OfficeName=N'สำนักงานทนายความอัศวิน',PlanType=N'OfficeTeam',PlanName=N'ทนายประจำสำนักงาน · แอดมินสำนักงาน' WHERE Id=@kriangkrai;
          UPDATE SL_LawyerProfiles SET OfficeName=N'สำนักงานทนายความอัศวิน' WHERE Id=(SELECT LawyerProfileId FROM SL_UserAccounts WHERE Id=@kriangkrai);
          UPDATE SL_LawOfficeMembers SET MemberRole=N'OfficeAdmin',IsActive=1 WHERE LawyerUserId=@kriangkrai;
        END;
        """);
    }

    public static void Map(RouteGroupBuilder api)
    {
        api.MapGet("/office/form9-lawyers",async(HttpContext h,DatabaseService db)=>{
            var actor=AccountSecurity.User(h);if(actor.Role!="Lawyer")return Results.StatusCode(403);
            using var c=db.CreateConnection();var office=await ResolveOffice(c,actor.Id);if(office==null)return Results.StatusCode(403);
            return Results.Ok(await ActiveLawyers(c,office.OwnerUserId));
        });

        api.MapGet("/office/form10-recipients",async(int? lawyerUserId,HttpContext h,DatabaseService db)=>{
            var actor=AccountSecurity.User(h);if(actor.Role is not ("Lawyer" or "Clerk"))return Results.StatusCode(403);
            using var c=db.CreateConnection();
            int ownerId;
            if(actor.Role=="Lawyer"){
                var office=await ResolveOffice(c,actor.Id);if(office==null)return Results.StatusCode(403);ownerId=office.OwnerUserId;
            }else{
                ownerId=lawyerUserId.GetValueOrDefault();
                if(ownerId<=0||await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_LawyerClerkMappings WHERE LawyerUserId=@ownerId AND ClerkUserId=@actorId AND IsActive=1",new{ownerId,actorId=actor.Id})==0)return Results.StatusCode(403);
            }
            return Results.Ok(await c.QueryAsync("""
              SELECT DISTINCT u.Id UserId,u.Role AccountRole,p.* FROM SL_UserAccounts u
              JOIN SL_LawyerProfiles p ON p.Id=u.LawyerProfileId
              WHERE u.AccountStatus=N'Active' AND (
                u.Id=@ownerId OR u.Id IN(SELECT LawyerUserId FROM SL_LawOfficeMembers WHERE OfficeOwnerUserId=@ownerId AND IsActive=1)
                OR u.Id IN(SELECT m.ClerkUserId FROM SL_LawyerClerkMappings m WHERE m.IsActive=1 AND m.LawyerUserId IN(
                  SELECT LawyerUserId FROM SL_LawOfficeMembers WHERE OfficeOwnerUserId=@ownerId AND IsActive=1 UNION SELECT @ownerId))
              ) ORDER BY u.Role,p.FullName
              """,new{ownerId}));
        });

        api.MapGet("/office/team",async(HttpContext h,DatabaseService db)=>{
            var actor=AccountSecurity.User(h);using var c=db.CreateConnection();var office=await ResolveManagedOffice(c,actor);if(office==null)return Results.StatusCode(403);
            var members=await c.QueryAsync("""
              SELECT m.Id membershipId,m.IsActive,m.MemberRole,u.Id userId,u.Username,u.FullName,u.LawyerProfileId,u.LicenseNo,u.Phone,u.Email,u.AccountStatus,
                (SELECT COUNT(DISTINCT c.Id) FROM SL_LawCases c
                  LEFT JOIN SL_OfficeCaseAssignments a ON a.CaseId=c.Id AND a.OfficeOwnerUserId=@owner
                  WHERE a.LawyerUserId=u.Id OR c.PrimaryLawyerId=u.LawyerProfileId) assignedCases
              FROM SL_LawOfficeMembers m JOIN SL_UserAccounts u ON u.Id=m.LawyerUserId
              WHERE m.OfficeOwnerUserId=@owner ORDER BY CASE m.MemberRole WHEN N'OfficeAdmin' THEN 0 ELSE 1 END,u.FullName
              """,new{owner=office.OwnerUserId});
            var owner=await c.QuerySingleAsync("SELECT Id userId,Username,FullName,LawyerProfileId,LicenseNo,Phone,Email,AccountStatus FROM SL_UserAccounts WHERE Id=@id",new{id=office.OwnerUserId});
            return Results.Ok(new{office=new{office.OwnerUserId,office.OfficeName,office.CanManage},owner,members});
        });

        api.MapGet("/office/profiles",async(HttpContext h,DatabaseService db)=>{
            var actor=AccountSecurity.User(h);if(actor.Role!="Lawyer")return Results.StatusCode(403);
            using var c=db.CreateConnection();var office=await ResolveOffice(c,actor.Id);if(office==null)return Results.StatusCode(403);
            var profiles=await c.QueryAsync("""
              SELECT u.Id UserId,u.Role AccountRole,u.Username,u.AccountStatus,p.*,
                (SELECT TOP 1 om.Id FROM SL_LawOfficeMembers om WHERE om.OfficeOwnerUserId=@owner AND om.LawyerUserId=u.Id AND om.IsActive=1) MembershipId,
                (SELECT COUNT(DISTINCT lc.Id) FROM SL_LawCases lc LEFT JOIN SL_OfficeCaseAssignments oa ON oa.CaseId=lc.Id AND oa.OfficeOwnerUserId=@owner
                  WHERE (u.Role=N'Lawyer' AND (lc.PrimaryLawyerId=p.Id OR oa.LawyerUserId=u.Id)) OR (u.Role=N'Clerk' AND lc.ClerkId=p.Id)) AssignedCases
              FROM SL_UserAccounts u JOIN SL_LawyerProfiles p ON p.Id=u.LawyerProfileId
              WHERE u.AccountStatus=N'Active' AND (
                u.Id=@owner OR u.Id IN(SELECT LawyerUserId FROM SL_LawOfficeMembers WHERE OfficeOwnerUserId=@owner AND IsActive=1)
                OR u.Id IN(SELECT m.ClerkUserId FROM SL_LawyerClerkMappings m WHERE m.IsActive=1 AND m.LawyerUserId IN(
                  SELECT LawyerUserId FROM SL_LawOfficeMembers WHERE OfficeOwnerUserId=@owner AND IsActive=1 UNION SELECT @owner))
              ) ORDER BY CASE WHEN u.Id=@owner THEN 0 ELSE 1 END,u.Role,p.FullName
              """,new{owner=office.OwnerUserId});
            return Results.Ok(new{office=new{office.OwnerUserId,office.OfficeName,office.CanManage},profiles});
        });

        api.MapPut("/office/profiles/{userId:int}",async(int userId,LawyerProfile profile,HttpContext h,DatabaseService db)=>{
            var actor=AccountSecurity.User(h);using var c=db.CreateConnection();await c.OpenAsync();using var tx=c.BeginTransaction(System.Data.IsolationLevel.Serializable);
            var office=await ResolveManagedOffice(c,actor,tx);if(office==null)return Results.StatusCode(403);
            if(string.IsNullOrWhiteSpace(profile.FullName)||profile.FullName.Trim().Length>200)return Results.BadRequest(new{message="กรุณาระบุชื่อ-นามสกุลให้ถูกต้อง"});
            var member=await FindOfficeProfile(c,tx,userId,office.OwnerUserId);if(member==null)return Results.NotFound();
            profile.Id=member.ProfileId;profile.FullName=profile.FullName.Trim();
            await UpdateProfile(c,tx,profile);
            await c.ExecuteAsync("""
              UPDATE SL_UserAccounts SET FullName=@FullName,LicenseNo=@LicenseNo,CitizenId=@CitizenId,Phone=@Phone,OfficeName=@OfficeName WHERE Id=@userId;
              UPDATE SL_LawyerClerkMappings SET ClerkFullName=@FullName,ClerkCitizenId=@CitizenId,ClerkPhone=@Phone WHERE ClerkUserId=@userId;
              UPDATE SL_LawyerClerkMappings SET LawyerFullName=@FullName WHERE LawyerUserId=@userId;
              """,new{profile.FullName,profile.LicenseNo,profile.CitizenId,profile.Phone,profile.OfficeName,userId},tx);
            tx.Commit();return Results.Ok(profile);
        });

        api.MapDelete("/office/profiles/{userId:int}",async(int userId,HttpContext h,DatabaseService db)=>{
            var actor=AccountSecurity.User(h);using var c=db.CreateConnection();await c.OpenAsync();using var tx=c.BeginTransaction(System.Data.IsolationLevel.Serializable);
            var office=await ResolveManagedOffice(c,actor,tx);if(office==null)return Results.StatusCode(403);
            if(userId==office.OwnerUserId)return Results.Conflict(new{message="ลบโปรไฟล์เจ้าของสำนักงานจากเมนูนี้ไม่ได้"});
            var member=await FindOfficeProfile(c,tx,userId,office.OwnerUserId);if(member==null)return Results.NotFound();
            if(member.AccountRole=="Lawyer")return Results.Conflict(new{message="Remove this lawyer from the office team and transfer assigned cases first."});
            await c.ExecuteAsync("""
              UPDATE SL_LawyerClerkMappings SET IsActive=0 WHERE LawyerUserId=@userId OR ClerkUserId=@userId;
              DELETE SL_Sessions WHERE UserId=@userId;
              UPDATE SL_UserAccounts SET AccountStatus=N'Suspended' WHERE Id=@userId;
              INSERT SL_AuditLog(UserId,Action,Resource) VALUES(@actor,'OFFICE_PROFILE_DELETE',@resource);
              """,new{userId,actor=actor.Id,resource=$"office:{office.OwnerUserId}; profile:{member.ProfileId}; account:{userId}"},tx);
            tx.Commit();return Results.Ok(new{deleted=true});
        });

        api.MapPost("/office/team",async(HttpContext h,OfficeLawyerCreate r,DatabaseService db)=>{
            var actor=AccountSecurity.User(h);using var c=db.CreateConnection();await c.OpenAsync();using var tx=c.BeginTransaction(System.Data.IsolationLevel.Serializable);
            var office=await ResolveManagedOffice(c,actor,tx);if(office==null)return Results.StatusCode(403);
            var error=Validate(r.Username,r.Password,r.FullName,r.LicenseNo,r.Phone,r.Email);if(error!=null)return Results.BadRequest(new{message=error});
            if(await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_UserAccounts WHERE Username=@username",new{username=r.Username.Trim()},tx)>0)return Results.Conflict(new{message="ชื่อผู้ใช้นี้มีแล้ว"});
            var role=NormalizeRole(r.MemberRole);
            var profile=await c.ExecuteScalarAsync<int>("""
              INSERT SL_LawyerProfiles(FullName,RoleType,LicenseNo,LicenseJurisdiction,Occupation,Age,HouseNo,Moo,Road,SubDistrict,District,Province,PostalCode,Phone,OfficeName)
              OUTPUT INSERTED.Id VALUES(@name,N'ทนายความ',@license,N'ทั่วราชอาณาจักร',N'ทนายความ',N'-',N'-',N'-',N'-',N'-',N'-',N'-',N'-',@phone,@office)
              """,new{name=r.FullName.Trim(),license=r.LicenseNo.Trim(),phone=r.Phone?.Trim()??"",office=office.OfficeName},tx);
            var member=await c.ExecuteScalarAsync<int>("""
              INSERT SL_UserAccounts(Username,PasswordHash,FullName,Role,LawyerProfileId,LicenseNo,Phone,Email,OfficeName,PlanType,PlanName,MaxCasesQuota,UsedCasesCount,SubscriptionExpireDate,AccountStatus)
              OUTPUT INSERTED.Id VALUES(@username,@hash,@name,'Lawyer',@profile,@license,@phone,@email,@office,'OfficeTeam',@plan,0,0,DATEADD(year,10,SYSUTCDATETIME()),'Active')
              """,new{username=r.Username.Trim(),hash=AccountSecurity.Hash(r.Password),name=r.FullName.Trim(),profile,license=r.LicenseNo.Trim(),phone=r.Phone?.Trim()??"",email=r.Email?.Trim()??"",office=office.OfficeName,plan=role==OfficeAdmin?"ทนายประจำสำนักงาน · แอดมินสำนักงาน":"ทนายประจำสำนักงาน"},tx);
            await c.ExecuteAsync("INSERT SL_LawOfficeMembers(OfficeOwnerUserId,LawyerUserId,MemberRole) VALUES(@owner,@member,@role); INSERT SL_AuditLog(UserId,Action,Resource) VALUES(@actor,'OFFICE_MEMBER_CREATE',@resource)",new{owner=office.OwnerUserId,member,role,actor=actor.Id,resource=$"office:{office.OwnerUserId}; lawyer:{member}; role:{role}"},tx);
            tx.Commit();return Results.Ok(new{userId=member,lawyerProfileId=profile});
        });

        api.MapPut("/office/team/{id:int}",async(int id,HttpContext h,OfficeLawyerUpdate r,DatabaseService db)=>{
            var actor=AccountSecurity.User(h);using var c=db.CreateConnection();await c.OpenAsync();using var tx=c.BeginTransaction(System.Data.IsolationLevel.Serializable);
            var office=await ResolveManagedOffice(c,actor,tx);if(office==null)return Results.StatusCode(403);
            var member=await FindMember(c,tx,id,office.OwnerUserId);if(member==null)return Results.NotFound();
            var error=Validate(null,null,r.FullName,r.LicenseNo,r.Phone,r.Email);if(error!=null)return Results.BadRequest(new{message=error});var role=NormalizeRole(r.MemberRole);
            await c.ExecuteAsync("""
              UPDATE SL_UserAccounts SET FullName=@name,LicenseNo=@license,Phone=@phone,Email=@email,OfficeName=@office,PlanName=@plan WHERE Id=@userId;
              UPDATE SL_LawyerProfiles SET FullName=@name,LicenseNo=@license,Phone=@phone,OfficeName=@office WHERE Id=@profileId;
              UPDATE SL_LawOfficeMembers SET MemberRole=@role WHERE Id=@id;
              INSERT SL_AuditLog(UserId,Action,Resource) VALUES(@actor,'OFFICE_MEMBER_UPDATE',@resource);
              """,new{id,userId=member.LawyerUserId,profileId=member.LawyerProfileId,name=r.FullName.Trim(),license=r.LicenseNo.Trim(),phone=r.Phone?.Trim()??"",email=r.Email?.Trim()??"",office=office.OfficeName,role,plan=role==OfficeAdmin?"ทนายประจำสำนักงาน · แอดมินสำนักงาน":"ทนายประจำสำนักงาน",actor=actor.Id,resource=$"office:{office.OwnerUserId}; lawyer:{member.LawyerUserId}; role:{role}"},tx);
            tx.Commit();return Results.Ok();
        });

        api.MapPut("/office/team/{id:int}/state",async(int id,HttpContext h,OfficeMemberState r,DatabaseService db)=>{
            var actor=AccountSecurity.User(h);using var c=db.CreateConnection();await c.OpenAsync();using var tx=c.BeginTransaction(System.Data.IsolationLevel.Serializable);var office=await ResolveManagedOffice(c,actor,tx);if(office==null)return Results.StatusCode(403);
            var member=await FindMember(c,tx,id,office.OwnerUserId);if(member==null)return Results.NotFound();
            if(!r.Active&&await AssignedCaseCount(c,office.OwnerUserId,member.LawyerUserId,member.LawyerProfileId,tx)>0)return Results.Conflict(new{message="ทนายยังมีสำนวนรับผิดชอบ กรุณาโอนสำนวนก่อนระงับบัญชี"});
            await c.ExecuteAsync("UPDATE SL_LawOfficeMembers SET IsActive=@active WHERE Id=@id; UPDATE SL_UserAccounts SET AccountStatus=CASE WHEN @active=1 THEN N'Active' ELSE N'Suspended' END WHERE Id=@userId; IF @active=0 DELETE SL_Sessions WHERE UserId=@userId",new{active=r.Active,id,userId=member.LawyerUserId},tx);tx.Commit();return Results.Ok();
        });

        api.MapDelete("/office/team/{id:int}",async(int id,[FromBody] OfficeMemberRemove r,HttpContext h,DatabaseService db)=>{
            var actor=AccountSecurity.User(h);using var c=db.CreateConnection();await c.OpenAsync();using var tx=c.BeginTransaction(System.Data.IsolationLevel.Serializable);var office=await ResolveManagedOffice(c,actor,tx);if(office==null)return Results.StatusCode(403);
            var member=await FindMember(c,tx,id,office.OwnerUserId);if(member==null)return Results.NotFound();
            var count=await AssignedCaseCount(c,office.OwnerUserId,member.LawyerUserId,member.LawyerProfileId,tx);var target=await ResolveTarget(c,office.OwnerUserId,r.TransferToUserId,tx);
            if(count>0&&target==null)return Results.Conflict(new{message="ต้องเลือกทนายใหม่เพื่อรับโอนสำนวนทั้งหมดก่อนลบทนายออกจากสำนักงาน",assignedCases=count});
            if(target?.UserId==member.LawyerUserId)return Results.BadRequest(new{message="ผู้รับโอนต้องเป็นทนายคนอื่น"});
            if(target!=null)await c.ExecuteAsync("UPDATE SL_LawCases SET PrimaryLawyerId=@profile,UpdatedAt=SYSUTCDATETIME() WHERE PrimaryLawyerId=@oldProfile; UPDATE SL_OfficeCaseAssignments SET LawyerUserId=@userId,AssignedByUserId=@actor,AssignedAt=SYSUTCDATETIME() WHERE OfficeOwnerUserId=@owner AND LawyerUserId=@oldUser",new{profile=target.LawyerProfileId,userId=target.UserId,oldProfile=member.LawyerProfileId,oldUser=member.LawyerUserId,owner=office.OwnerUserId,actor=actor.Id},tx);
            await c.ExecuteAsync("DELETE SL_LawOfficeMembers WHERE Id=@id; UPDATE SL_UserAccounts SET AccountStatus=N'Suspended',PlanName=N'ออกจากสำนักงานแล้ว' WHERE Id=@userId; DELETE SL_Sessions WHERE UserId=@userId; INSERT SL_AuditLog(UserId,Action,Resource) VALUES(@actor,'OFFICE_MEMBER_REMOVE',@resource)",new{id,userId=member.LawyerUserId,actor=actor.Id,resource=$"office:{office.OwnerUserId}; lawyer:{member.LawyerUserId}; transferred:{count}; target:{target?.UserId}"},tx);
            tx.Commit();return Results.Ok(new{removed=true,transferredCases=count});
        });

        api.MapGet("/office/cases",async(HttpContext h,DatabaseService db)=>{
            var actor=AccountSecurity.User(h);using var c=db.CreateConnection();var office=await ResolveManagedOffice(c,actor);if(office==null)return Results.StatusCode(403);
            return Results.Ok(await c.QueryAsync("""
              SELECT c.Id,c.CaseCode,c.BlackCaseNo,c.BlackCaseYear,c.CourtName,c.PlaintiffName,c.DefendantName,c.PrimaryLawyerId,
               COALESCE(a.LawyerUserId,@owner) assignedLawyerUserId,COALESCE(u.FullName,owner.FullName) assignedLawyerName
              FROM SL_LawCases c JOIN SL_UserAccounts owner ON owner.Id=@owner
              LEFT JOIN SL_OfficeCaseAssignments a ON a.CaseId=c.Id AND a.OfficeOwnerUserId=@owner LEFT JOIN SL_UserAccounts u ON u.Id=a.LawyerUserId
              WHERE c.PrimaryLawyerId=owner.LawyerProfileId OR a.OfficeOwnerUserId=@owner
                OR c.PrimaryLawyerId IN(
                  SELECT memberUser.LawyerProfileId FROM SL_LawOfficeMembers member
                  JOIN SL_UserAccounts memberUser ON memberUser.Id=member.LawyerUserId
                  WHERE member.OfficeOwnerUserId=@owner)
              ORDER BY c.Id DESC
              """,new{owner=office.OwnerUserId}));
        });

        api.MapPut("/office/cases/{caseId:int}/assignment",async(int caseId,OfficeAssignment r,HttpContext h,DatabaseService db)=>{
            var actor=AccountSecurity.User(h);using var c=db.CreateConnection();await c.OpenAsync();using var tx=c.BeginTransaction(System.Data.IsolationLevel.Serializable);var office=await ResolveManagedOffice(c,actor,tx);if(office==null)return Results.StatusCode(403);
            var exists=await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM SL_LawCases c WHERE c.Id=@caseId AND (c.PrimaryLawyerId=(SELECT LawyerProfileId FROM SL_UserAccounts WHERE Id=@owner) OR c.PrimaryLawyerId IN(SELECT u.LawyerProfileId FROM SL_LawOfficeMembers m JOIN SL_UserAccounts u ON u.Id=m.LawyerUserId WHERE m.OfficeOwnerUserId=@owner) OR EXISTS(SELECT 1 FROM SL_OfficeCaseAssignments a WHERE a.CaseId=c.Id AND a.OfficeOwnerUserId=@owner))",new{caseId,owner=office.OwnerUserId},tx);if(exists==0)return Results.NotFound();
            var target=await ResolveTarget(c,office.OwnerUserId,r.LawyerUserId??office.OwnerUserId,tx);if(target==null)return Results.BadRequest(new{message="เลือกทนายที่ใช้งานอยู่ในสำนักงาน"});
            await c.ExecuteAsync("UPDATE SL_LawCases SET PrimaryLawyerId=@profile,UpdatedAt=SYSUTCDATETIME() WHERE Id=@caseId; IF @userId=@owner DELETE SL_OfficeCaseAssignments WHERE CaseId=@caseId ELSE IF EXISTS(SELECT 1 FROM SL_OfficeCaseAssignments WHERE CaseId=@caseId) UPDATE SL_OfficeCaseAssignments SET OfficeOwnerUserId=@owner,LawyerUserId=@userId,AssignedByUserId=@actor,AssignedAt=SYSUTCDATETIME() WHERE CaseId=@caseId ELSE INSERT SL_OfficeCaseAssignments(CaseId,OfficeOwnerUserId,LawyerUserId,AssignedByUserId) VALUES(@caseId,@owner,@userId,@actor)",new{caseId,profile=target.LawyerProfileId,userId=target.UserId,owner=office.OwnerUserId,actor=actor.Id},tx);tx.Commit();return Results.Ok();
        });
    }

    static string NormalizeRole(string? role)=>role==OfficeAdmin?OfficeAdmin:PermanentLawyer;
    static async Task<OfficeProfileRef?> FindOfficeProfile(SqlConnection c,SqlTransaction tx,int userId,int owner)=>await c.QuerySingleOrDefaultAsync<OfficeProfileRef>("""
      SELECT u.Id UserId,u.LawyerProfileId ProfileId,u.Role AccountRole FROM SL_UserAccounts u
      WHERE u.Id=@userId AND u.AccountStatus=N'Active' AND u.Role IN(N'Lawyer',N'Clerk') AND (
        u.Id=@owner OR u.Id IN(SELECT LawyerUserId FROM SL_LawOfficeMembers WHERE OfficeOwnerUserId=@owner AND IsActive=1)
        OR u.Id IN(SELECT m.ClerkUserId FROM SL_LawyerClerkMappings m WHERE m.IsActive=1 AND m.LawyerUserId IN(
          SELECT LawyerUserId FROM SL_LawOfficeMembers WHERE OfficeOwnerUserId=@owner AND IsActive=1 UNION SELECT @owner))
      )
      """,new{userId,owner},tx);
    static async Task UpdateProfile(SqlConnection c,SqlTransaction tx,LawyerProfile p)=>await c.ExecuteAsync("""
      UPDATE SL_LawyerProfiles SET FullName=@FullName,RoleType=@RoleType,LicenseNo=@LicenseNo,LicenseJurisdiction=@LicenseJurisdiction,
        CitizenId=@CitizenId,Race=@Race,Nationality=@Nationality,Occupation=@Occupation,Age=@Age,HouseNo=@HouseNo,Moo=@Moo,
        Road=@Road,Soi=@Soi,NearBy=@NearBy,SubDistrict=@SubDistrict,District=@District,Province=@Province,PostalCode=@PostalCode,
        Phone=@Phone,OfficeName=@OfficeName WHERE Id=@Id
      """,p,tx);
    static string? Validate(string? username,string? password,string? fullName,string? license,string? phone,string? email){if((username!=null&&string.IsNullOrWhiteSpace(username))||(password!=null&&password.Length<12)||string.IsNullOrWhiteSpace(fullName)||string.IsNullOrWhiteSpace(license))return "กรอกชื่อทนาย เลขใบอนุญาต และข้อมูลบัญชีให้ครบ (รหัสผ่านอย่างน้อย 12 ตัวอักษร)";if((username?.Length??0)>100||(password?.Length??0)>200||(fullName?.Length??0)>200||(license?.Length??0)>100||(phone?.Length??0)>100||(email?.Length??0)>150)return "ข้อมูลยาวเกินกำหนด";return null;}
    static async Task<OfficeContext?> ResolveOffice(SqlConnection c,int userId,SqlTransaction? tx=null)=>await c.QuerySingleOrDefaultAsync<OfficeContext>("SELECT TOP 1 COALESCE(m.OfficeOwnerUserId,u.Id) OwnerUserId,COALESCE(NULLIF(owner.OfficeName,N''),NULLIF(u.OfficeName,N''),N'สำนักงานทนายความ') OfficeName,CAST(CASE WHEN m.MemberRole=N'OfficeAdmin' OR m.Id IS NULL THEN 1 ELSE 0 END AS bit) CanManage FROM SL_UserAccounts u LEFT JOIN SL_LawOfficeMembers m ON m.LawyerUserId=u.Id AND m.IsActive=1 LEFT JOIN SL_UserAccounts owner ON owner.Id=m.OfficeOwnerUserId WHERE u.Id=@userId AND u.Role=N'Lawyer' AND u.AccountStatus=N'Active'",new{userId},tx);
    static async Task<OfficeContext?> ResolveManagedOffice(SqlConnection c,UserAccount actor,SqlTransaction? tx=null){if(actor.Role!="Lawyer")return null;var office=await ResolveOffice(c,actor.Id,tx);return office?.CanManage==true?office:null;}
    static async Task<IEnumerable<dynamic>> ActiveLawyers(SqlConnection c,int owner,SqlTransaction? tx=null)=>await c.QueryAsync("SELECT u.Id UserId,p.* FROM SL_UserAccounts u JOIN SL_LawyerProfiles p ON p.Id=u.LawyerProfileId WHERE u.Role='Lawyer' AND u.AccountStatus='Active' AND (u.Id=@owner OR u.Id IN(SELECT LawyerUserId FROM SL_LawOfficeMembers WHERE OfficeOwnerUserId=@owner AND IsActive=1)) ORDER BY CASE WHEN u.Id=@owner THEN 0 ELSE 1 END,p.FullName",new{owner},tx);
    static async Task<MemberRow?> FindMember(SqlConnection c,SqlTransaction tx,int id,int owner)=>await c.QuerySingleOrDefaultAsync<MemberRow>("SELECT m.Id MembershipId,m.LawyerUserId,u.LawyerProfileId FROM SL_LawOfficeMembers m JOIN SL_UserAccounts u ON u.Id=m.LawyerUserId WHERE m.Id=@id AND m.OfficeOwnerUserId=@owner",new{id,owner},tx);
    static async Task<TargetLawyer?> ResolveTarget(SqlConnection c,int owner,int userId,SqlTransaction? tx=null)=>await c.QuerySingleOrDefaultAsync<TargetLawyer>("SELECT u.Id UserId,u.LawyerProfileId FROM SL_UserAccounts u WHERE u.Id=@userId AND u.Role='Lawyer' AND u.AccountStatus='Active' AND (u.Id=@owner OR EXISTS(SELECT 1 FROM SL_LawOfficeMembers m WHERE m.OfficeOwnerUserId=@owner AND m.LawyerUserId=u.Id AND m.IsActive=1))",new{owner,userId},tx);
    static async Task<int> AssignedCaseCount(SqlConnection c,int owner,int userId,int profileId,SqlTransaction? tx=null)=>await c.ExecuteScalarAsync<int>("SELECT COUNT(DISTINCT c.Id) FROM SL_LawCases c LEFT JOIN SL_OfficeCaseAssignments a ON a.CaseId=c.Id AND a.OfficeOwnerUserId=@owner WHERE a.LawyerUserId=@userId OR (c.PrimaryLawyerId=@profileId AND @userId<>@owner)",new{owner,userId,profileId},tx);
    sealed class OfficeContext{public int OwnerUserId{get;set;}public string OfficeName{get;set;}="";public bool CanManage{get;set;}}
    sealed class OfficeProfileRef{public int UserId{get;set;}public int ProfileId{get;set;}public string AccountRole{get;set;}="";}
    sealed class MemberRow{public int MembershipId{get;set;}public int LawyerUserId{get;set;}public int LawyerProfileId{get;set;}}
    sealed class TargetLawyer{public int UserId{get;set;}public int LawyerProfileId{get;set;}}
}

public sealed record OfficeLawyerCreate(string Username,string Password,string FullName,string LicenseNo,string? Phone,string? Email,string? MemberRole);
public sealed record OfficeLawyerUpdate(string FullName,string LicenseNo,string? Phone,string? Email,string? MemberRole);
public sealed record OfficeMemberState(bool Active);
public sealed record OfficeMemberRemove(int TransferToUserId);
public sealed record OfficeAssignment(int? LawyerUserId);
