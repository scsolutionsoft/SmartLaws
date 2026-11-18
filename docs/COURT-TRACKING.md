# Court case tracking

Staff menu: ตรวจสอบนัดคดีศาล. Default URL: https://cios.coj.go.th/tracking/

The official site sends X-Frame-Options: SAMEORIGIN. SmartLaws opens a separate browser popup instead of embedding it. A new-tab link remains available if popups are blocked. No court login or case data is proxied or imported.

Admins edit the global HTTPS URL under ธีมและบัญชีผู้ใช้ → ตั้งค่าลิงก์ตรวจสอบนัดคดีศาล. Changes persist in SL_CourtTrackingSettings and create an audit entry. Clicking the default button only changes the form; save to apply it.

GET /api/court-tracking/settings requires a staff session. PUT /api/admin/court-tracking requires an admin session. Startup creates the configuration table and inserts the default only when no setting exists.
