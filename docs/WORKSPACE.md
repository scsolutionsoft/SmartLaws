# SmartLaws workspace

Run with `dotnet run --project SmartLaws.Web.csproj --urls http://localhost:5088` and open `/login.html`.

The existing account credentials continue to work. Successful first login upgrades legacy passwords to ASP.NET Identity PBKDF2 hashes. Newly registered accounts and reset passwords use hashes immediately. Sessions are HTTP-only cookies backed by expiring database sessions (8 hours); logout, password reset, suspension, and role changes invalidate sessions. Authentication requests are rate limited per client IP. No account-switching impersonation is available.

## Roles

| Capability | Lawyer | Clerk | Admin |
| --- | --- | --- | --- |
| Read case details and files | Owned cases | Explicitly assigned cases with an active office mapping | No |
| Create/update/delete cases and assign clerks | Yes | No | No |
| Prepare documents and upload files | Yes | Yes, assigned cases; documents remain unsigned drafts | No |
| Record judgments and appeals; complete follow-up | Yes | Read only | No |
| Manage subscription/payment submissions | Own account | No | Review and approve |
| Manage members, quotas, plans and password resets | No | No | Yes |
| Audit log | No | No | Yes |

The API checks ownership and role independently of navigation visibility. Administrative dashboard responses omit case details, case files, documents and signatures. Duplicate payment approval is rejected and quota changes run in the same database transaction as approval. Case creation reserves quota under a serializable transaction; case deletion does not refund lifetime consumed quota.

## Workflow and files

The three-step new-case wizard collects court/category/role, parties/team/hearing information, then review. The case-history module records judgment, appeal, response to appeal, supreme appeal, response, permission request, extension, stay, enforcement and finality. Records preserve court, reference, date, summary, outcome, deadline basis and an optional attachment from the same case. New records are appended; completing follow-up removes a deadline from the active queue. Drafts and backdated events do not advance a case past newer events.

PDF/PNG/JPEG uploads are checked for their file signature and limited to 10 MB decoded. HTTPS links and linked court documents are supported. A file referenced by litigation history cannot be deleted. Existing legacy example paths remain in the database but are not served as private case files; upload an actual file to replace missing examples.

## Court-form reference

Catalogue checked on 2026-11-14 against [Lawyers Council court forms](https://www.lawyerscouncil.or.th/court-forms): 31 judgment; 32–35 appeal, ending and responses; 36–39 supreme appeal, ending and responses. The court-issued judgment is uploaded, not generated as if issued by a court. Templates 32–39 in the editor are **working drafts using the existing general layout**, not validated reproductions of every original form. Download/compare the official originals before filing, particularly the ending pages. Form choice, permission requirements and deadlines depend on case type and court orders; no universal deadline is calculated automatically.

## Verification

`scripts/smoke.mjs` uses Node 24+ and environment credentials `SMARTLAWS_LAWYER`, `SMARTLAWS_LAWYER_PASSWORD`, `SMARTLAWS_ADMIN`, `SMARTLAWS_ADMIN_PASSWORD`, `SMARTLAWS_CLERK`, `SMARTLAWS_CLERK_PASSWORD`. It checks anonymous access, login bypass, ownership, admin privacy, clerk restrictions, origin validation and logout invalidation. It does not create cases or payment records.

`scripts/browser-smoke.mjs` uses a separate Chrome test profile with remote debugging on localhost:9222 and the lawyer environment credentials. It exercises real login, dashboard, themes, wizard opening, court-form catalogue, responsive width and logout, records browser exceptions, and saves screenshots under ignored `artifacts/`.

`dotnet run --project scripts/Integration/Integration.csproj` creates an isolated test member, case, linked file and litigation record. It checks persistence, quota attribution, evidence protection and password revocation, then removes only its fixture rows in a `finally` block. Run from the repository root while the server is running. If admin/clerk credentials are supplied, the browser test also checks their dashboard/navigation and the member-edit and audit screens.

Themes are saved per account in the current browser. Court printing retains the existing white A4 layout. The staged user changes in `court-renderer.js` are intentionally preserved.

## Judgment PDF library

The general file upload dialog accepts multiple PDF/PNG/JPEG files (10 MB each), with editable document title and page count per file. Files upload sequentially to keep browser/server memory bounded. Partial failures stay in the dialog and retry skips successful entries. The directory shows one row per file with its title, upload date in Thai calendar/Asia-Bangkok time, and an individual viewer. Upload date comes from the database CreatedAt UTC value, not the document date. `scripts/multi-file-upload-smoke.mjs` verifies three-file upload, a simulated partial failure, retry without duplication, saved metadata and byte-exact downloads.

The PDF viewer fetches the authorized file, checks HTTP failures and the PDF header, then opens a temporary PDF blob URL. Loading, missing-file, expired-session, permission and invalid-file states display explicit messages instead of an empty frame. Closing or switching documents aborts pending requests and releases blob URLs. Download remains available when the browser cannot display PDFs. The multi-file smoke test also checks missing/invalid PDF messages.

On 2026-11-15, five existing attachments for case อ.398/2568 were restored in the local database from their original PDFs. Those records previously contained no file bytes and referenced sample routes tied to another machine. Restoration preserved attachment IDs and case metadata, and uses the existing authorized content endpoint; sample routes remain restricted. This data repair is local database state and is not included in application publish ZIPs.

Open “คำพิพากษา · อุทธรณ์ · ฎีกา”, select a case, then “จัดเก็บคำพิพากษา”. Upload a PDF up to 10 MB with court level, judgment date, black/red case numbers (including year), title, page count and optional notes. The file is stored in the existing case attachment database and remains available in the regular file directory. Lawyers and assigned clerks use existing case access controls; admins cannot access the files.

JudgmentBlackCaseNo and JudgmentRedCaseNo record the numbers on that court's judgment. CaseId links the attachment to the underlying case; entering judgment numbers does not overwrite the case master numbers. Filter by court level or search title/numbers using Thai or Arabic digits. The reader and download action show the judgment's own numbers. Existing unclassified attachments remain in the regular directory. Startup adds the four metadata columns without changing old files. Storage status starts as draft for later review through the existing directory.

`scripts/judgment-library-smoke.mjs` exercises upload, database reload, all three court levels, number filtering, PDF viewing, invalid-file/metadata rejection, unauthorized case rejection, and mobile layout. Fixtures are deleted after the run. Workspace styling respects the existing ten themes and preserves court paper layout.

## Account and report update

Profile autofill now uses `/api/cases/{id}/quick-fill?source=self|client`. The server checks case access and resolves the self profile exclusively from the authenticated account's LawyerProfileId. `/api/lawyers` and dashboard profile lists return only that account's profile; they no longer include team members' identity/address/signature records. Team membership names remain available through assigned-account/mapping metadata. New Studio drafts use the authenticated account's profile without array-position or hard-coded-person fallbacks.

Client autofill uses IsOurClient records in the selected case, with a picker for multiple clients. Legacy cases without individual client records fall back to the appropriate party name from that case's master record, without inventing personal data. Switching to a client clears stale identity fields and signatures. Existing saved documents are preserved. `scripts/profile-security-smoke.mjs` checks two-account isolation, direct API attempts against another case, forged profile IDs, poisoned local profile arrays, client mapping, and clearing old identity/signature values.

Members can rename their own username after verifying their current password. Admins can rename a member or reset a password with confirmation from the Username / Password action. Changes are atomic, reject duplicate usernames, update clerk mappings, and revoke prior sessions. Reports now explicitly expose lawyer name, black case number, plaintiff and defendant to admins as requested; other accounts remain scoped to their accessible cases. Search, CSV download and printable reports use the same permitted rows.

The permission paragraph is off when no explicit choice is saved; saved explicit choices remain editable. Object-valued legacy permission text is normalized. Preview/print reserve a 31px blank line before the closing prayer and Word inserts an exact 465-twip blank paragraph (31px).

### Form-specific editor bindings
Form (15) now uses `witness-pagination.js` and its scoped stylesheet. The supplied two-page witness PDF was inspected: front-page capacity is seven ordinary rows, continuation capacity eighteen. Rows use 13 mm slots and measured text heights; long entries consume additional slots, and oversized cells split by Thai grapheme boundaries across pages without discarding text. Empty slots fill the remaining table area. Every continuation repeats column headings and reserves signature space. An empty declared count falls back to the number of source entries. Validation covers 0/1/7/8/10/25/26 entries, very long text, cell bounds, header/footer separation and browser print; an actual ten-entry print PDF was confirmed to have two pages. This change applies to preview and browser print/PDF, not the separate legacy Word exporter.

The court code dropdown and upper template selector share `court-form-editor.js`.
Changing code creates a separate draft, preserving unsaved drafts per case/code for the current page session. Fixed form titles are normalized. Shared case display fields are stored in `ExtraFieldsJson.CaseFields` for this document, without modifying the case master record. The HTML preview and print/PDF path consume these overrides; the legacy DOCX exporter does not yet consume CaseFields.
Special fields include cover archive number, front-sheet dates, appointment information, defendant identity, hearing information, and ending-form drafter/typist fields. Index and property tables have separate column editors. Long cover notes use numbered continuation attachments without removing the original text. Preview scales to available screen width; print remains A4.
Validation: `scripts/form-editor-smoke.mjs` checks 25 selectable codes, template IDs, field propagation, draft restoration, database save/read/delete of one generated test document, and cover print overflow. It uses the same environment credentials and Chrome CDP setup as browser-smoke.mjs. Generic judgment/appeal layouts still require comparison with original court forms before filing; these changes do not certify exact official PDF layouts.

Witness first-page layout update: measure the actual heading and signature/footer before pagination. Place the table 3 mm below the witness-count sentence and expand it to 5 mm before the signature area. First-page capacity now follows available space (8 ordinary slots in the tested fixture), rather than a fixed seven. Continuations retain up to 18 slots. Browser tests cover capacity boundaries, a multiline first entry among eight witnesses, very long text preservation, and screen/print bounds. Visual check: artifacts/witness-adjusted-front.png.

Studio save workflow: green saves an editable draft; purple saves first and idempotently links the current document into the case catalogue via POST /documents/{id}/archive. The catalogue displays all pages from the saved document, replacing the incomplete SVG summary behavior. This is a live document link; PDF export remains the Print/PDF action. studio-save.js provides a modal with measured completed-step percentages, duplicate-click guard, partial-success messages and navigation to the catalogue/appointment. Word export first saves current edits. Validation: studio-save-smoke.mjs covers multi-page viewing, repeated archive, partial failure, duplicate clicks and cross-account denial; appointment-files-smoke.mjs covers the appointment integration.
