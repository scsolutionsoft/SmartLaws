namespace SmartLaws.Web.Models;

public class LawCase
{
    public int Id { get; set; }
    public string CaseCode { get; set; } = string.Empty;
    public string BlackCaseNo { get; set; } = string.Empty;
    public string BlackCaseYear { get; set; } = string.Empty;
    public string RedCaseNo { get; set; } = string.Empty;
    public string RedCaseYear { get; set; } = string.Empty;
    public string CourtName { get; set; } = "จังหวัดศรีสะเกษ";
    public string CaseCategory { get; set; } = "อาญา"; // อาญา, แพ่ง
    public string SubCategory { get; set; } = string.Empty; // อาญาสามัญ, แพ่งสามัญ, มโนสาเร่, ผบ., ขจัดการมรดก
    public string LawyerRole { get; set; } = "ทนายโจทก์"; // ทนายโจทก์, ทนายจำเลย, ทนายผู้ร้อง, ทนายผู้คัดค้าน
    public string RepresentingPartyOrder { get; set; } = string.Empty; // เช่น จำเลยที่ ๒, โจทก์
    public string PlaintiffName { get; set; } = string.Empty;
    public string DefendantName { get; set; } = string.Empty;
    public string ChargeOrCauseOfAction { get; set; } = string.Empty; // ข้อหาหรือฐานความผิด
    public decimal ClaimAmount { get; set; } = 0; // จำนวนทุนทรัพย์
    public decimal InterestRate { get; set; } = 5.0m; // อัตราดอกเบี้ยร้อยละต่อปี
    public string CurrentProceduralStage { get; set; } = string.Empty; // ขั้นตอนตาม ป.วิ.อ. / ป.วิ.พ.
    public string Status { get; set; } = "กำลังดำเนินการ"; // กำลังดำเนินการ, นัดสืบพยาน, รอคำพิพากษา, ชั้นบังคับคดี, เสร็จสิ้น
    public DateTime? NextHearingDate { get; set; }
    public string NextHearingNote { get; set; } = string.Empty;
    public int PrimaryLawyerId { get; set; }
    public int ClerkId { get; set; }
    public string CaseSummary { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.Now;
    public DateTime UpdatedAt { get; set; } = DateTime.Now;
}

public class CaseParty
{
    public int Id { get; set; }
    public int CaseId { get; set; }
    public string PartySide { get; set; } = "โจทก์"; // โจทก์, จำเลย, ผู้ร้อง, ผู้คัดค้าน
    public int PartyOrder { get; set; } = 1; // ที่ 1, ที่ 2 ...
    public string Title { get; set; } = string.Empty;
    public string FullName { get; set; } = string.Empty;
    public string CitizenId { get; set; } = string.Empty; // 13 หลัก
    public string Race { get; set; } = "ไทย";
    public string Nationality { get; set; } = "ไทย";
    public string Occupation { get; set; } = string.Empty;
    public string Age { get; set; } = "-";
    public string BirthDateText { get; set; } = "-";
    public string HouseNo { get; set; } = string.Empty;
    public string Moo { get; set; } = "-";
    public string Road { get; set; } = "-";
    public string Soi { get; set; } = "-";
    public string NearBy { get; set; } = "-";
    public string SubDistrict { get; set; } = string.Empty;
    public string District { get; set; } = string.Empty;
    public string Province { get; set; } = "ศรีสะเกษ";
    public string PostalCode { get; set; } = "33000";
    public string Phone { get; set; } = "-";
    public string Fax { get; set; } = "-";
    public string Email { get; set; } = "-";
    public bool IsOurClient { get; set; } = false;
}

public class LawyerProfile
{
    public int Id { get; set; }
    public string FullName { get; set; } = string.Empty;
    public string RoleType { get; set; } = "ทนายความ"; // ทนายความ, เสมียนทนาย, ผู้รับมอบฉันทะ
    public string LicenseNo { get; set; } = string.Empty; // เช่น 7834/2529
    public string LicenseJurisdiction { get; set; } = "ทั่วราชอาณาจักร";
    public string CitizenId { get; set; } = string.Empty;
    public string Race { get; set; } = "ไทย";
    public string Nationality { get; set; } = "ไทย";
    public string Occupation { get; set; } = "ทนายความ";
    public string Age { get; set; } = "-";
    public string HouseNo { get; set; } = string.Empty;
    public string Moo { get; set; } = "-";
    public string Road { get; set; } = "-";
    public string Soi { get; set; } = "-";
    public string NearBy { get; set; } = "-";
    public string SubDistrict { get; set; } = string.Empty;
    public string District { get; set; } = string.Empty;
    public string Province { get; set; } = "ศรีสะเกษ";
    public string PostalCode { get; set; } = "33000";
    public string Phone { get; set; } = "-";
    public string OfficeName { get; set; } = string.Empty;
    public string SignatureDataUrl { get; set; } = string.Empty; // Base64 PNG/SVG
}

public class CourtFormTemplate
{
    public int Id { get; set; }
    public string FormCode { get; set; } = string.Empty; // เช่น (๔), (๕), (๗), (๙), (๑๐), (๑๑ ก.), (๑๒), (๑๓), (๑๕), (๔๐ ก.)
    public string FormName { get; set; } = string.Empty; // เช่น คำฟ้อง, คำขอท้ายคำฟ้องแพ่ง, คำร้อง/คำแถลง/คำขอ
    public string Category { get; set; } = "ทั้งสองประเภท"; // อาญา, แพ่ง, ทั้งสองประเภท
    public string ApplicableRole { get; set; } = "ทุกฝ่าย"; // ทนายโจทก์, ทนายจำเลย, ทุกฝ่าย
    public string ProceduralLawRef { get; set; } = string.Empty; // อ้างอิงมาตรา ป.วิ.อ. / ป.วิ.พ.
    public string LayoutType { get; set; } = "GarudaStandard"; // GarudaStandard, EndOfPlaint5, Appointment9, Proxy10, Summons12, Witness15, Continuation40A
    public string DefaultHeaderTitle { get; set; } = string.Empty;
    public string DefaultPreambleTemplate { get; set; } = string.Empty;
    public string DefaultClausesJson { get; set; } = "[]";
    public string DefaultClosingText { get; set; } = "ควรมิควรแล้วแต่จะโปรด";
    public string SourceWordFileName { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
}

public class CaseDocument
{
    public int Id { get; set; }
    public int CaseId { get; set; }
    public int TemplateId { get; set; }
    public string FormCode { get; set; } = "(๗)";
    public string DocumentTitle { get; set; } = string.Empty; // เช่น คำร้อง ขอยื่นคำให้การ(เพิ่มเติม)
    public string DocumentSubTitle { get; set; } = string.Empty;
    public string LawyerRoleInDoc { get; set; } = "ทนายจำเลยที่ ๒"; // ทนายโจทก์, ทนายจำเลย, โจทก์, จำเลยที่ ๒
    public string DocDay { get; set; } = string.Empty;
    public string DocMonth { get; set; } = string.Empty;
    public string DocYear { get; set; } = string.Empty; // พ.ศ. เช่น ๒๕๖๙
    public string RequesterFullName { get; set; } = string.Empty;
    public string RequesterStatus { get; set; } = string.Empty; // โจทก์, จำเลยที่ ๒, ทนายโจทก์, ทนายจำเลยที่ ๒
    public string RequesterCitizenId { get; set; } = string.Empty;
    public string RequesterRace { get; set; } = "ไทย";
    public string RequesterNationality { get; set; } = "ไทย";
    public string RequesterOccupation { get; set; } = "ทนายความ";
    public string RequesterAge { get; set; } = "-";
    public string RequesterHouseNo { get; set; } = string.Empty;
    public string RequesterMoo { get; set; } = "-";
    public string RequesterRoad { get; set; } = "-";
    public string RequesterSoi { get; set; } = "-";
    public string RequesterNearBy { get; set; } = "-";
    public string RequesterSubDistrict { get; set; } = string.Empty;
    public string RequesterDistrict { get; set; } = string.Empty;
    public string RequesterProvince { get; set; } = "ศรีสะเกษ";
    public string RequesterPostalCode { get; set; } = "33000";
    public string RequesterPhone { get; set; } = "-";
    public string ClausesJson { get; set; } = "[]"; // JSON array of clauses: [{ClauseNo, Content}] or Witness items
    public string ExtraFieldsJson { get; set; } = "{}"; // JSON for specific forms (e.g. Form 5 prayers, Form 9 powers, Form 12 hearing date)
    public string ClosingPrayer { get; set; } = "ควรมิควรแล้วแต่จะโปรด";
    public string SignerName { get; set; } = string.Empty;
    public string SignerRole { get; set; } = string.Empty;
    public string DrafterName { get; set; } = string.Empty; // ผู้เรียง
    public string TypistName { get; set; } = string.Empty; // ผู้พิมพ์/เขียน
    public string SignatureImageBase64 { get; set; } = string.Empty;
    public string DrafterSignatureBase64 { get; set; } = string.Empty;
    public string TypistSignatureBase64 { get; set; } = string.Empty;
    public bool UseThaiNumerals { get; set; } = true;
    public string Status { get; set; } = "ฉบับสมบูรณ์"; // ร่าง, รอลงนาม, ลงนามแล้ว, ยื่นต่อศาลแล้ว
    public DateTime CreatedAt { get; set; } = DateTime.Now;
    public DateTime UpdatedAt { get; set; } = DateTime.Now;
}

public class ElectronicSignature
{
    public int Id { get; set; }
    public string SignerName { get; set; } = string.Empty;
    public string SignerRole { get; set; } = string.Empty; // ทนายโจทก์, ทนายจำเลย, ลูกความ, ผู้เรียง, ผู้พิมพ์
    public string LicenseOrCitizenId { get; set; } = string.Empty;
    public string SignatureType { get; set; } = "Draw"; // Draw, Upload, Font
    public string ImageDataUrl { get; set; } = string.Empty;
    public string VerificationHash { get; set; } = string.Empty;
    public bool IsDefault { get; set; } = false;
    public DateTime CreatedAt { get; set; } = DateTime.Now;
}

public class WitnessItem
{
    public int OrderNo { get; set; }
    public string WitnessNameAndDesc { get; set; } = string.Empty;
    public string AddressText { get; set; } = string.Empty;
    public string Note { get; set; } = "นำ"; // นำ, หมาย
}

public class ClauseItem
{
    public string ClauseTitle { get; set; } = "ข้อ ๑.";
    public string Content { get; set; } = string.Empty;
}

/// <summary>
/// บัญชีผู้ใช้งานทนายความและผู้ดูแลระบบ (Admin & Lawyer Membership / 3-Case Free Trial & Quota)
/// </summary>
public class UserAccount
{
    public int Id { get; set; }
    public string Username { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = "123456";
    public string FullName { get; set; } = string.Empty;
    public string Role { get; set; } = "Lawyer"; // Admin, Lawyer
    public int LawyerProfileId { get; set; }
    public string LicenseNo { get; set; } = string.Empty;
    public string CitizenId { get; set; } = string.Empty;
    public string Phone { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string OfficeName { get; set; } = string.Empty;
    public string PlanType { get; set; } = "Trial"; // Trial (ทดลองฟรี 3 คดี), Monthly (รายเดือน), Yearly (รายปี), QuotaPack (ซื้อโควต้าเพิ่ม)
    public string PlanName { get; set; } = "ทดลองใช้งานฟรี (๓ คดี)";
    public int MaxCasesQuota { get; set; } = 3; // เริ่มต้นทดลองใช้ฟรี 3 คดี
    public int UsedCasesCount { get; set; } = 0;
    public DateTime? SubscriptionExpireDate { get; set; }
    public string AccountStatus { get; set; } = "Active"; // Active, Suspended
    public DateTime CreatedAt { get; set; } = DateTime.Now;
}

/// <summary>
/// แพ็กเกจค่าบริการ (รายเดือน / รายปี / ซื้อโควต้าจำนวนคดี) ที่แอดมินตั้งราคาได้
/// </summary>
public class SubscriptionPlan
{
    public int Id { get; set; }
    public string PlanCode { get; set; } = string.Empty;
    public string PlanName { get; set; } = string.Empty;
    public string PlanCategory { get; set; } = "QuotaPack"; // Trial, Monthly, Yearly, QuotaPack
    public decimal PriceBaht { get; set; }
    public int CasesQuotaIncluded { get; set; } = 3;
    public int DurationDays { get; set; } = 30;
    public string Description { get; set; } = string.Empty;
    public string BankAccountInfo { get; set; } = "ธ.กรุงไทย สาขาศรีสะเกษ เลขที่ 311-0-88999-1 ชื่อบัญชี บจก.สมาร์ทลอว์ โซลูชั่น (พร้อมเพย์ 089-2802450)";
    public bool IsActive { get; set; } = true;
}

/// <summary>
/// รายการแจ้งสลิปโอนเงินเพื่อต่ออายุรายเดือน/รายปี หรือซื้อโควต้าคดีเพิ่ม
/// </summary>
public class PaymentSlip
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public string UserFullName { get; set; } = string.Empty;
    public int PlanId { get; set; }
    public string PlanName { get; set; } = string.Empty;
    public string PlanCategory { get; set; } = "QuotaPack";
    public decimal AmountBaht { get; set; }
    public int CasesQuotaRequested { get; set; }
    public string TransferDateText { get; set; } = string.Empty;
    public string TransferTimeText { get; set; } = string.Empty;
    public string BankName { get; set; } = "ธนาคารกรุงไทย";
    public string SlipImageBase64 { get; set; } = string.Empty;
    public string ReferenceNote { get; set; } = string.Empty;
    public string Status { get; set; } = "รอตรวจสอบ"; // รอตรวจสอบ, อนุมัติแล้ว, ปฏิเสธ
    public string AdminRemark { get; set; } = string.Empty;
    public string ReviewedBy { get; set; } = string.Empty;
    public DateTime? ReviewedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.Now;
}

/// <summary>
/// ระบบจัดเก็บไฟล์เอกสาร รูปภาพ หรือ Link ไฟล์ ของแต่ละสำนวนคดี อ้างอิงตามสารบัญแบบพิมพ์ศาล (๐๐)-(๑๕)
/// </summary>
public class CaseFileAttachment
{
    public int Id { get; set; }
    public int CaseId { get; set; }
    public int? DocumentId { get; set; }
    public int DirectoryIndexNo { get; set; } = 1; // ลำดับตามสารบัญแบบพิมพ์ศาล
    public string FormCode { get; set; } = "(๗)"; // เช่น (๑) ปกหน้าสำนวน, (๔) คำฟ้อง, (๗) คำร้อง, (๑๑) คำให้การจำเลย, (๑๕) บัญชีพยาน
    public string DirectoryCategoryName { get; set; } = string.Empty; // ชื่อหมวดตามสารบัญแบบพิมพ์ศาล
    public string FileTitle { get; set; } = string.Empty;
    public string StorageType { get; set; } = "PDF"; // PDF, IMAGE, LINK, COURT_FORM
    public string FileStatus { get; set; } = "ยื่นต่อศาลแล้ว"; // ร่าง, ตรวจทานแล้ว, ลงนามแล้ว, ยื่นต่อศาลแล้ว, ศาลรับคำคู่ความแล้ว
    public string FileUrlOrPath { get; set; } = string.Empty; // URL ภายนอก หรือ /api/files/stream-sample/...
    public string FileDataBase64 { get; set; } = string.Empty; // Base64 ของ PDF หรือรูปภาพที่จัดเก็บ
    public string MimeType { get; set; } = "application/pdf";
    public int PageCount { get; set; } = 1;
    public string UploadedBy { get; set; } = string.Empty;
    public string Remark { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.Now;
}

/// <summary>
/// ความสัมพันธ์แบบ Many-to-Many ระหว่าง แอคเคาท์ทนายความ กับ แอคเคาท์เสมียนทนาย
/// (เสมียนทนายเป็นส่วนหนึ่งของแอคเคาท์ทนาย และเสมียน ๑ คนสามารถทำงานให้ทนายได้มากกว่า ๑ คน)
/// </summary>
public class LawyerClerkMapping
{
    public int Id { get; set; }
    public int LawyerUserId { get; set; }
    public string LawyerFullName { get; set; } = string.Empty;
    public int ClerkUserId { get; set; }
    public int ClerkProfileId { get; set; }
    public string ClerkFullName { get; set; } = string.Empty;
    public string ClerkUsername { get; set; } = string.Empty;
    public string ClerkCitizenId { get; set; } = string.Empty;
    public string ClerkPhone { get; set; } = string.Empty;
    public string Permissions { get; set; } = "พิมพ์คำคู่ความ, ยื่นคำร้อง/ปิดหมาย, รับมอบฉันทะ (แบบ ๑๐), จัดเก็บไฟล์สารบัญสำนวน";
    public bool IsDefaultTypist { get; set; } = true;
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.Now;
}

public class AssignClerkRequest
{
    public int LawyerUserId { get; set; }
    public string Mode { get; set; } = "EXISTING"; // EXISTING (ผูกเสมียนที่มีอยู่แล้ว) หรือ NEW (สร้างแอคเคาท์เสมียนใหม่พร้อมผูก)
    public int ExistingClerkUserId { get; set; }
    public string Username { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = "123456";
    public string FullName { get; set; } = string.Empty;
    public string CitizenId { get; set; } = string.Empty;
    public string Phone { get; set; } = string.Empty;
    public string Age { get; set; } = "35";
    public string HouseNo { get; set; } = "260/17";
    public string Moo { get; set; } = "5";
    public string SubDistrict { get; set; } = "หนองครก";
    public string District { get; set; } = "เมืองฯ";
    public string Province { get; set; } = "ศรีสะเกษ";
    public string PostalCode { get; set; } = "33000";
    public string Permissions { get; set; } = "พิมพ์คำคู่ความ, ยื่นคำร้อง/ปิดหมาย, รับมอบฉันทะ (แบบ ๑๐), จัดเก็บไฟล์สารบัญสำนวน";
    public bool IsDefaultTypist { get; set; } = true;
}
