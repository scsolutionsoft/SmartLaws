import assert from 'node:assert/strict';
const base = process.env.SMARTLAWS_URL || 'http://localhost:5088';
async function request(path, cookie = '', method = 'GET', data) {
    const response = await fetch(base + path, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
    const text = await response.text();
    return { status: response.status, cookie: response.headers.get('set-cookie')?.split(';')[0], text, body: text ? JSON.parse(text) : null };
}
async function login(username, password) {
    assert.ok(username && password, 'Set the SMARTLAWS_* credentials before running this test.');
    const r = await request('/api/auth/login', '', 'POST', { username, password });
    assert.equal(r.status, 200, `Login failed for ${username}`); assert.ok(r.cookie);
    assert.equal(r.body.passwordHash, '');
    return r.cookie;
}
assert.equal((await request('/api/dashboard')).status, 401);
assert.equal((await request('/api/auth/login', '', 'POST', { id: 1, username: '', password: '' })).status, 400);
const lawyer = await login(process.env.SMARTLAWS_LAWYER, process.env.SMARTLAWS_LAWYER_PASSWORD);
const me = (await request('/api/auth/me', lawyer)).body;
assert.ok(!('passwordHash' in me));
const dashboard = (await request('/api/dashboard', lawyer)).body;
assert.ok(!JSON.stringify(dashboard).includes('passwordHash'));
assert.ok(dashboard.cases.every(c => c.primaryLawyerId === me.lawyerProfileId));
assert.equal((await request('/api/admin/audit', lawyer)).status, 403);
assert.equal((await request('/api/cases/2147483647', lawyer)).status, 404);
assert.equal((await request('/api/documents', lawyer, 'POST', {caseId:2147483647})).status, 404);
assert.equal((await request('/api/litigation', lawyer, 'POST', {caseId:0})).status, 400);
const forged = await fetch(base + '/api/auth/logout', {method:'POST',headers:{Cookie:lawyer,Origin:'https://attacker.example'}});
assert.equal(forged.status,403);
const admin = await login(process.env.SMARTLAWS_ADMIN, process.env.SMARTLAWS_ADMIN_PASSWORD);
const adminData = (await request('/api/dashboard', admin)).body;
assert.equal(adminData.cases.length,0); assert.equal(adminData.recentDocuments.length,0); assert.equal(adminData.caseFiles.length,0); assert.equal(adminData.signatures.length,0);
assert.equal((await request('/api/cases',admin)).status,403);
assert.equal((await request('/api/admin/audit',admin)).status,200);
const clerk = await login(process.env.SMARTLAWS_CLERK, process.env.SMARTLAWS_CLERK_PASSWORD);
const clerkMe = (await request('/api/auth/me',clerk)).body;
const clerkData = (await request('/api/dashboard',clerk)).body;
assert.ok(clerkData.cases.every(c => c.clerkId === clerkMe.lawyerProfileId));
assert.equal((await request('/api/cases',clerk,'POST',{})).status,403);
assert.equal((await request('/api/litigation',clerk,'POST',{})).status,403);
for (const cookie of [lawyer,admin,clerk]) { assert.equal((await request('/api/auth/logout',cookie,'POST')).status,200); assert.equal((await request('/api/auth/me',cookie)).status,401); }
console.log('PASS: anonymous access, password bypass, password redaction, ownership, admin privacy, clerk restrictions, CSRF origin, and session revocation.');
