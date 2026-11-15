(() => {
    let register = false;
    const form = document.getElementById('authForm'), error = document.getElementById('authError'), submit = document.getElementById('submitAuth');
    document.getElementById('showPassword').onclick = e => { const p = form.password; p.type = p.type === 'password' ? 'text' : 'password'; e.target.textContent = p.type === 'password' ? 'แสดง' : 'ซ่อน'; };
    document.getElementById('toggleRegister').onclick = e => {
        register = !register; document.getElementById('registerFields').classList.toggle('hidden', !register);
        form.fullName.required = register; form.licenseNo.required = register; form.email.required = register;
        form.password.minLength = register ? 10 : 1; form.password.autocomplete = register ? 'new-password' : 'current-password';
        document.getElementById('authTitle').textContent = register ? 'เริ่มต้นสำนักงานของคุณ' : 'ยินดีต้อนรับกลับ';
        document.getElementById('authSubtitle').textContent = register ? 'บัญชีทนายความ ทดลองใช้งาน 3 คดี • รหัสผ่านอย่างน้อย 10 ตัวอักษร' : 'เข้าสู่พื้นที่ทำงานของคุณด้วยบัญชีผู้ใช้งาน';
        submit.textContent = register ? 'สร้างบัญชีทนายความ' : 'เข้าสู่ระบบ →'; e.target.textContent = register ? 'มีบัญชีแล้ว เข้าสู่ระบบ' : 'สมัครบัญชีทนายความใหม่'; error.textContent = '';
    };
    form.onsubmit = async e => {
        e.preventDefault(); error.textContent = ''; submit.disabled = true;
        try {
            const data = Object.fromEntries(new FormData(form));
            if (register) {
                const r = await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...data, passwordHash: data.password }) });
                if (!r.ok) throw Error(r.status === 429 ? 'ลองใหม่ในอีก 1 นาที' : (await r.json()).message || 'สมัครบัญชีไม่สำเร็จ');
            }
            const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: data.username, password: data.password }) });
            if (!r.ok) throw Error(r.status === 429 ? 'ลองใหม่ในอีก 1 นาที' : (await r.json()).message || 'เข้าสู่ระบบไม่สำเร็จ');
            location.replace('/');
        } catch (err) { error.textContent = err.message || 'เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่'; } finally { submit.disabled = false; }
    };
    fetch('/api/auth/me').then(r => { if (r.ok) location.replace('/'); }).catch(() => {});
})();
