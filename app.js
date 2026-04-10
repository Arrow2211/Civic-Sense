
// CivicSense - Vanilla JS Core Logic
const SUPABASE_URL = 'https://wnjizzmlovynxqtyfpih.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Induaml6em1sb3Z5bnhxdHlmcGloIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE0MzQ5MzMsImV4cCI6MjA4NzAxMDkzM30.cmMEB0t2Z27dR5_9Gr_tK-1Ikz6mFLxaN5HtASxAtVE';

const { createClient } = supabase;
const _supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// State Management
let appState = {
    user: null,
    reports: [],
    currentView: 'landing',
    authRole: 'citizen',
    isSignUp: false,
    isLoading: true,
    recoveryStep: 'none',
    generatedOtp: '',
    recoveryUser: null,
    viewingReportId: null,
    resolvingId: null
};

const AUTH_CREDENTIALS = {
    username: 'Atharv',
    password: 'Civicsense',
    mobile: '7972113737'
};

const STORAGE_KEY = 'civicsense_user_session';

// Selectors
const views = document.querySelectorAll('.view');
const nav = document.getElementById('main-nav');
const navGuest = document.getElementById('nav-actions-guest');
const navAuth = document.getElementById('nav-actions-auth');
const navUserName = document.getElementById('nav-user-name');
const navUserRole = document.getElementById('nav-user-role');
const loadingOverlay = document.getElementById('loading-overlay');

// 1. Navigation & View Controller
function navigateTo(viewId) {
    appState.currentView = viewId;
    views.forEach(v => v.classList.add('hidden'));
    
    const targetView = document.getElementById(`view-${viewId === 'dashboard' ? (appState.user?.role === 'authority' ? 'dashboard-authority' : 'dashboard-citizen') : viewId}`);
    if (targetView) targetView.classList.remove('hidden');

    // Update Nav visibility
    if (viewId === 'landing') {
        nav.classList.remove('hidden');
        nav.classList.add('bg-white/80');
    } else if (viewId === 'login') {
        nav.classList.add('hidden');
    } else {
        nav.classList.remove('hidden');
        nav.classList.add('bg-white/80');
    }

    window.scrollTo(0, 0);
}

// 2. Auth Role Toggle
window.setAuthRole = (role) => {
    appState.authRole = role;
    const citizenBtn = document.getElementById('role-btn-citizen');
    const authorityBtn = document.getElementById('role-btn-authority');
    const signupToggle = document.getElementById('toggle-signup-container');
    const forgotPassLink = document.getElementById('forgot-pass-link');

    if (role === 'citizen') {
        citizenBtn.classList.add('bg-white', 'text-indigo-600', 'shadow-md', 'scale-[1.02]');
        citizenBtn.classList.remove('text-slate-400');
        authorityBtn.classList.remove('bg-white', 'text-indigo-600', 'shadow-md', 'scale-[1.02]');
        authorityBtn.classList.add('text-slate-400');
        signupToggle.classList.remove('hidden');
        forgotPassLink.classList.remove('hidden');
    } else {
        authorityBtn.classList.add('bg-white', 'text-indigo-600', 'shadow-md', 'scale-[1.02]');
        authorityBtn.classList.remove('text-slate-400');
        citizenBtn.classList.remove('bg-white', 'text-indigo-600', 'shadow-md', 'scale-[1.02]');
        citizenBtn.classList.add('text-slate-400');
        signupToggle.classList.add('hidden');
        forgotPassLink.classList.add('hidden');
        setSignUp(false);
    }
};

function setSignUp(isSignUp) {
    appState.isSignUp = isSignUp;
    const signupFields = document.getElementById('signup-fields');
    const authTitle = document.getElementById('auth-title');
    const authBtnText = document.getElementById('auth-btn-text');
    const toggleBtn = document.getElementById('toggle-signup-btn');

    if (isSignUp) {
        signupFields.classList.remove('hidden');
        authTitle.innerText = "Create Impact";
        authBtnText.innerText = "Join Community";
        toggleBtn.innerText = "Already a hero? Sign In";
        document.getElementById('forgot-pass-link').classList.add('hidden');
    } else {
        signupFields.classList.add('hidden');
        authTitle.innerText = appState.authRole === 'authority' ? "Officer Access" : "Welcome Back";
        authBtnText.innerText = "Get Started";
        toggleBtn.innerText = "New here? Create an account";
        if(appState.authRole === 'citizen') document.getElementById('forgot-pass-link').classList.remove('hidden');
    }
}

window.toggleSignUp = () => setSignUp(!appState.isSignUp);

window.openLogin = (role, isSignUp = false) => {
    setAuthRole(role);
    setSignUp(isSignUp);
    navigateTo('login');
};

// 3. Supabase Integration
async function fetchReports() {
    const { data, error } = await _supabase
        .from('reports')
        .select('*')
        .order('timestamp', { ascending: false });

    if (!error && data) {
        appState.reports = data;
        renderReports();
        renderAuthorityStats();
        renderAuthorityQueue();
        renderLandingStats();
        renderLandingFeed();
    }
}

function subscribeToReports() {
    _supabase.channel('realtime-reports')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'reports' }, (payload) => {
            if (payload.eventType === 'INSERT') {
                appState.reports = [payload.new, ...appState.reports];
                
                // Admin Notification
                triggerSMSNotification(AUTH_CREDENTIALS.mobile, `New Issue: "${payload.new.title}" reported in ${payload.new.location}!`);
            } else if (payload.eventType === 'UPDATE') {
                const oldStatus = appState.reports.find(r => r.id === payload.new.id)?.status;
                appState.reports = appState.reports.map(r => r.id === payload.new.id ? payload.new : r);
                
                // Citizen Notification
                if (oldStatus !== 'RESOLVED' && payload.new.status === 'RESOLVED' && appState.user?.id === payload.new.citizen_id) {
                    triggerSMSNotification(appState.user.mobile || 'N/A', `Great news! Your report "${payload.new.title}" has been resolved.`);
                }
            } else if (payload.eventType === 'DELETE') {
                appState.reports = appState.reports.filter(r => r.id !== payload.old.id);
            }
            renderReports();
            renderAuthorityStats();
            renderAuthorityQueue();
            renderLandingStats();
            renderLandingFeed();
        })
        .subscribe();
}

// 4. Notification Engine (Real-World SMS via Vercel API)
async function triggerSMSNotification(to, message) {
    const sound = document.getElementById('notification-sound');
    if (sound) {
        sound.currentTime = 0;
        sound.play().catch(e => console.log("Audio play blocked by browser. Click anywhere to allow."));
    }

    // Trigger In-App Mobile Banner
    const container = document.getElementById('mobile-notification-container');
    const banner = document.createElement('div');
    banner.className = 'sms-banner';
    banner.innerHTML = `
        <div class="w-12 h-12 bg-indigo-600 text-white rounded-2xl flex items-center justify-center flex-shrink-0 shadow-lg">
            <i class="fas fa-comment-sms text-xl"></i>
        </div>
        <div class="flex-1 overflow-hidden">
            <div class="flex items-center justify-between mb-0.5">
                <span class="text-[10px] font-black text-indigo-600 uppercase tracking-widest">Messages</span>
                <span class="text-[9px] font-bold text-slate-400">now</span>
            </div>
            <p class="text-[11px] font-black text-slate-900 leading-tight truncate">To: ${to}</p>
            <p class="text-[12px] font-medium text-slate-600 leading-tight mt-1 line-clamp-2">${message}</p>
        </div>
    `;
    container.appendChild(banner);

    // Send Real SMS via Vercel Serverless Function
    try {
        const response = await fetch('/api/send-sms', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to, message })
        });
        
        const result = await response.json();
        if (result.success) {
            console.log("Real SMS sent successfully:", result.sid);
        } else {
            console.warn("SMS failed (is your Twilio SID/TOKEN set in Vercel?):", result.error);
        }
    } catch (err) {
        console.error("SMS API Error:", err.message);
    }

    // Auto remove banner after 5 seconds
    setTimeout(() => {
        banner.classList.add('exit');
        setTimeout(() => banner.remove(), 600);
    }, 5000);
}

// 4. Form Handlers
document.getElementById('auth-form').onsubmit = async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const username = formData.get('username');
    const password = formData.get('password');

    if (appState.authRole === 'authority') {
        if (username !== AUTH_CREDENTIALS.username || password !== AUTH_CREDENTIALS.password) {
            alert("Invalid Authority Credentials.");
            return;
        }

        const { data: sessions, error: sessionError } = await _supabase.from('auth_sessions').select('*');
        if (sessionError) return alert(sessionError.message);

        const existingSession = sessions.find(s => s.username === username);
        if (sessions.length >= 5 && !existingSession) return alert("Maximum 5 concurrent authority sessions are active.");

        await _supabase.from('auth_sessions').upsert({ username, last_active: new Date().toISOString() });
        const user = { id: `auth_${username}`, username, role: 'authority', email: 'authority@civicsense.gov' };
        login(user);
    } else {
        if (appState.isSignUp) {
            const confirm = formData.get('confirmPassword');
            const email = formData.get('email');
            const mobile = formData.get('mobile');
            if (password !== confirm) return alert("Passwords do not match!");

            const { data: existingUser } = await _supabase.from('users').select('*').or(`username.eq.${username},email.eq.${email}`).single();
            if (existingUser) return alert("Username or Email already exists.");

            const userId = `cit_${Math.random().toString(36).substr(2, 9)}`;
            const { error } = await _supabase.from('users').insert({ id: userId, username, password, email, mobile, role: 'citizen' });
            if (error) return alert(error.message);
            alert("Account ready! Please sign in.");
            setSignUp(false);
        } else {
            const { data, error } = await _supabase.from('users').select('*').eq('username', username).eq('password', password).single();
            if (error || !data) return alert("Invalid username or password.");
            login(data);
        }
    }
};

function login(user) {
    appState.user = user;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    navGuest.classList.add('hidden');
    navAuth.classList.remove('hidden');
    navUserName.innerText = `Hi, ${user.username}!`;
    navUserRole.innerText = `${user.role} member`;
    
    // Trigger relative renders
    if (user.role === 'authority') {
        renderAuthorityStats();
        renderAuthorityQueue();
    } else {
        renderReports();
    }
    
    navigateTo('dashboard');
}

window.handleLogout = async () => {
    if (appState.user?.role === 'authority') {
        await _supabase.from('auth_sessions').delete().eq('username', appState.user.username);
    }
    appState.user = null;
    localStorage.removeItem(STORAGE_KEY);
    navGuest.classList.remove('hidden');
    navAuth.classList.add('hidden');
    navigateTo('landing');
};

document.getElementById('report-form').onsubmit = async (e) => {
    e.preventDefault();
    const btn = document.getElementById('report-submit-btn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-circle-notch animate-spin"></i> Launching...';

    const formData = new FormData(e.target);
    const file = formData.get('media');
    const reader = new FileReader();

    reader.onloadend = async () => {
        const base64 = reader.result;
        const newReport = {
            citizen_id: appState.user.id,
            citizen_name: appState.user.username,
            title: `${formData.get('category')} Report`,
            description: formData.get('description'),
            category: formData.get('category'),
            location: formData.get('location'),
            timestamp: Date.now(),
            status: 'PENDING',
            media_url: base64,
            media_type: file.type.startsWith('video') ? 'video' : 'image',
            notified: false
        };

        const { error } = await _supabase.from('reports').insert([newReport]);
        if (error) alert(error.message);
        else {
            e.target.reset();
            document.getElementById('media-upload-text').innerText = 'Select Media';
            alert("Report shared with the community!");
        }
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-rocket text-indigo-400"></i> Launch Report';
    };
    reader.readAsDataURL(file);
};

window.handleFileSelect = (input) => {
    const text = document.getElementById('media-upload-text');
    if(input.files && input.files[0]) {
        text.innerText = `Selected: ${input.files[0].name.slice(0, 15)}...`;
    }
};

// 5. Recovery Logic
window.showRecoveryView = (step) => {
    appState.recoveryStep = step;
    const container = document.getElementById('recovery-container');
    const loginForm = document.getElementById('login-form-container');
    loginForm.classList.add('hidden');
    container.classList.remove('hidden');
    renderRecovery();
};

function renderRecovery() {
    const container = document.getElementById('recovery-container');
    let html = `
        <div class="text-center">
            <div class="w-16 h-16 bg-amber-50 text-amber-500 rounded-[2rem] flex items-center justify-center mx-auto mb-6 shadow-inner"><i class="fas fa-lock-open text-2xl"></i></div>
            <h2 class="text-3xl font-black text-slate-900 tracking-tight">Recovery</h2>
            <p class="text-slate-400 text-sm mt-2 font-medium">
                ${appState.recoveryStep === 'identify' ? "Find your citizen profile." : 
                  (appState.recoveryStep === 'otp' ? "Check your messages (Demo: " + appState.generatedOtp + ")" : "Create a strong new password.")}
            </p>
        </div>
    `;

    if (appState.recoveryStep === 'identify') {
        html += `
            <form id="recovery-identify-form" class="space-y-4">
                <input name="identifier" required class="w-full px-5 py-4 rounded-2xl bg-slate-50 border border-slate-200 outline-none focus:ring-4 focus:ring-indigo-500/10 font-medium" placeholder="Username or Email">
                <button type="submit" class="w-full bg-slate-900 text-white font-black py-4 rounded-2xl shadow-lg hover:bg-black transition-all">Verify Account</button>
            </form>
        `;
    } else if (appState.recoveryStep === 'otp') {
        html += `
            <form id="recovery-otp-form" class="space-y-4">
                <input id="recovery-otp-input" maxLength="6" class="w-full tracking-[1.5rem] text-center text-3xl font-black px-5 py-5 rounded-2xl bg-slate-50 border border-slate-200 outline-none focus:ring-4 focus:ring-indigo-500/10" placeholder="000000">
                <button type="submit" class="w-full bg-slate-900 text-white font-black py-4 rounded-2xl shadow-lg">Check Code</button>
            </form>
        `;
    } else if (appState.recoveryStep === 'reset') {
        html += `
            <form id="recovery-reset-form" class="space-y-4">
                <input name="newPassword" type="password" required class="w-full px-5 py-4 rounded-2xl bg-slate-50 border border-slate-200 font-medium" placeholder="New Password">
                <input name="confirmNewPassword" type="password" required class="w-full px-5 py-4 rounded-2xl bg-slate-50 border border-slate-200 font-medium" placeholder="Repeat Password">
                <button type="submit" class="w-full bg-emerald-600 text-white font-black py-4 rounded-2xl shadow-lg hover:bg-emerald-700">Update Password</button>
            </form>
        `;
    }

    html += `<button onclick="hideRecovery()" class="w-full text-slate-400 hover:text-slate-600 text-sm font-bold transition-colors mt-4">Go Back</button>`;
    container.innerHTML = html;

    // Add events
    if (appState.recoveryStep === 'identify') {
        document.getElementById('recovery-identify-form').onsubmit = handleRecoveryIdentify;
    } else if (appState.recoveryStep === 'otp') {
        document.getElementById('recovery-otp-form').onsubmit = handleRecoveryOtp;
    } else if (appState.recoveryStep === 'reset') {
        document.getElementById('recovery-reset-form').onsubmit = handleRecoveryReset;
    }
}

window.hideRecovery = () => {
    document.getElementById('recovery-container').classList.add('hidden');
    document.getElementById('login-form-container').classList.remove('hidden');
};

async function handleRecoveryIdentify(e) {
    e.preventDefault();
    const id = new FormData(e.target).get('identifier');
    const { data, error } = await _supabase.from('users').select('*').or(`username.eq.${id},email.eq.${id}`).single();
    if (error || !data) return alert("Account not found.");
    appState.generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();
    appState.recoveryUser = data;
    showRecoveryView('otp');
    alert(`Demo Code: ${appState.generatedOtp}`);
}

function handleRecoveryOtp(e) {
    e.preventDefault();
    const val = document.getElementById('recovery-otp-input').value;
    if (val === appState.generatedOtp) showRecoveryView('reset');
    else alert("Incorrect code.");
}

async function handleRecoveryReset(e) {
    e.preventDefault();
    const formData = new FormData(e.target);
    const pass = formData.get('newPassword');
    const conf = formData.get('confirmNewPassword');
    if (pass !== conf) return alert("Mismatch!");
    const { error } = await _supabase.from('users').update({ password: pass }).eq('id', appState.recoveryUser.id);
    if (!error) {
        alert("Password updated!");
        hideRecovery();
    }
}

// 6. Rendering Logic
function renderReports() {
    const container = document.getElementById('dashboard-feed-container');
    const title = document.getElementById('citizen-feed-title');
    if (!container) return;

    // Debugging (optional)
    console.log("Rendering Reports for user:", appState.user?.username, "Total reports:", appState.reports.length);

    if (title) title.innerText = "My Reports";

    const userReports = appState.reports.filter(r => r.citizen_id === appState.user?.id);

    if (userReports.length === 0) {
        container.innerHTML = `<div class="bg-white p-12 rounded-[2.5rem] border border-slate-100 text-center shadow-sm">
            <div class="w-20 h-20 bg-slate-50 rounded-[2rem] flex items-center justify-center mx-auto mb-6"><i class="fas fa-leaf text-3xl text-slate-200"></i></div>
            <p class="text-slate-400 font-bold italic text-lg">You haven't issued any reports yet.</p>
        </div>`;
        return;
    }

    container.innerHTML = userReports.map(r => `
        <div class="bg-white rounded-[2.5rem] border border-slate-100 overflow-hidden shadow-lg shadow-slate-200/50 flex flex-col hover:shadow-xl transition-all group border-b-4 border-b-transparent hover:border-b-indigo-500">
            <div class="flex flex-col md:flex-row">
                <div class="md:w-56 h-56 bg-slate-100 flex-shrink-0 relative overflow-hidden">
                    ${r.media_type === 'video' ? `<video src="${r.media_url}" class="w-full h-full object-cover"></video>` : `<img src="${r.media_url}" class="w-full h-full object-cover" />`}
                    <div class="absolute top-4 left-4">
                        <span class="px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-[0.1em] shadow-lg backdrop-blur-md ${r.status === 'RESOLVED' ? 'bg-emerald-500/90' : 'bg-amber-500/90'} text-white">${r.status}</span>
                    </div>
                </div>
                <div class="p-8 flex-1">
                    <div class="flex justify-between items-start mb-4">
                        <div>
                            <p class="text-[10px] font-bold text-slate-400 uppercase mb-1">Reported by ${r.citizen_name}</p>
                            <p class="text-[10px] font-black text-indigo-500 uppercase tracking-widest mb-1">${r.category}</p>
                            <h4 class="font-black text-xl text-slate-900 leading-tight mb-2">${r.title}</h4>
                        </div>
                        <span class="text-[11px] text-slate-400 font-bold bg-slate-50 px-3 py-1 rounded-full">${new Date(r.timestamp).toLocaleDateString()}</span>
                    </div>
                    <div class="flex items-center gap-2 text-slate-500 text-sm font-bold mb-4 bg-slate-50 w-fit px-4 py-2 rounded-2xl">
                        <i class="fas fa-map-marker-alt text-rose-500"></i> ${r.location}
                    </div>
                    <p class="text-slate-600 font-medium leading-relaxed italic">"${r.description}"</p>
                    ${r.status === 'RESOLVED' ? `
                    <div class="mt-4 p-4 bg-emerald-50 rounded-2xl border border-emerald-100 flex gap-4 items-start">
                        ${r.work_done_media_url ? `
                            <div class="w-16 h-16 rounded-xl overflow-hidden shadow-sm flex-shrink-0 border-2 border-white">
                                <img src="${r.work_done_media_url}" class="w-full h-full object-cover" />
                            </div>` : ''}
                        <div>
                            <p class="text-[10px] font-black text-emerald-600 uppercase mb-1">Authority Resolution</p>
                            <p class="text-xs text-emerald-800 italic font-medium leading-relaxed">"${r.work_done_description}"</p>
                        </div>
                    </div>` : ''}
                </div>
            </div>
        </div>
    `).join('');
}

function renderLandingFeed() {
    const container = document.getElementById('live-activity-feed');
    if(!container) return;
    container.innerHTML = appState.reports.slice(0, 6).map((r, i) => `
        <div class="bg-slate-50 rounded-[2rem] p-6 border border-slate-100 hover:bg-white hover:shadow-xl transition-all group">
            <div class="flex items-center gap-4 mb-4 relative">
                <div class="w-12 h-12 rounded-xl overflow-hidden bg-slate-200">
                    <img src="${r.media_url}" class="w-full h-full object-cover" />
                </div>
                <div>
                    <p class="text-[10px] font-black text-indigo-500 uppercase tracking-widest">${r.category}</p>
                    <h4 class="font-bold text-slate-900 line-clamp-1">${r.title}</h4>
                </div>
            </div>
            <p class="text-sm text-slate-500 font-medium line-clamp-2 mb-4 italic">"${r.description}"</p>
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-2 text-[10px] font-bold text-slate-400"><i class="fas fa-map-marker-alt text-rose-400"></i> ${r.location}</div>
                <span class="px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${r.status === 'RESOLVED' ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}">${r.status}</span>
            </div>
        </div>
    `).join('');
}

function renderLandingStats() {
    const container = document.getElementById('stats-grid');
    if(!container) return;
    const stats = calculateStats();
    const items = [
        { label: 'Reports Filed', val: stats.total },
        { label: 'Issues Resolved', val: stats.resolved },
        { label: 'Active Citizens', val: stats.citizens },
        { label: 'Avg. Response', val: '24h' }
    ];
    container.innerHTML = items.map(s => `
        <div>
            <div class="text-4xl md:text-5xl font-black mb-2 tracking-tighter">${s.val}</div>
            <div class="text-indigo-300 text-xs font-black uppercase tracking-widest">${s.label}</div>
        </div>
    `).join('');
}

function renderAuthorityStats() {
    const grid = document.getElementById('authority-stats-grid');
    if(!grid) return;
    const stats = calculateStats();
    const items = [
        { label: 'Pending Action', val: stats.pending, color: 'from-amber-500 to-orange-500', icon: 'fa-hourglass-half' },
        { label: 'Active Reports', val: stats.total, color: 'from-indigo-500 to-blue-500', icon: 'fa-chart-line' },
        { label: 'Total Resolved', val: stats.resolved, color: 'from-emerald-500 to-teal-500', icon: 'fa-check-circle' },
        { label: 'Categories', val: stats.categories.length, color: 'from-purple-500 to-pink-500', icon: 'fa-tags' },
    ];
    grid.innerHTML = items.map(s => `
        <div class="p-8 rounded-[2.5rem] bg-white border border-slate-100 shadow-xl relative overflow-hidden group">
            <div class="relative z-10 flex items-center justify-between">
                <div>
                  <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">${s.label}</p>
                  <span class="text-4xl font-black text-slate-900 tracking-tighter">${s.val}</span>
                </div>
                <div class="w-14 h-14 bg-gradient-to-br ${s.color} text-white rounded-2xl flex items-center justify-center shadow-lg transform group-hover:scale-110 transition-transform">
                  <i class="fas ${s.icon} text-xl"></i>
                </div>
            </div>
        </div>
    `).join('');

    document.getElementById('stats-total-pill').innerText = `Reports: ${stats.total}`;
    document.getElementById('stats-resolved-pill').innerText = `Fixed: ${stats.resolved}`;
}

function renderAuthorityQueue() {
    const t = document.getElementById('authority-queue-body');
    if(!t) return;
    t.innerHTML = appState.reports.map(r => `
        <tr class="bg-white hover:bg-slate-50 transition-all rounded-[2rem] group">
            <td class="px-6 py-4 first:rounded-l-[2rem]">
                <div class="relative w-16 h-16 rounded-2xl overflow-hidden shadow-md group-hover:scale-105 transition-transform">
                    <img src="${r.media_url}" class="w-full h-full object-cover" />
                    ${r.media_type === 'video' ? '<i class="fas fa-play absolute inset-0 m-auto text-white text-xs bg-black/40 w-fit h-fit p-1.5 rounded-full"></i>' : ''}
                </div>
            </td>
            <td class="px-6 py-4">
                <p class="text-sm font-black text-slate-900 mb-0.5">${r.title}</p>
                <p class="text-[10px] font-bold text-indigo-500 uppercase">${r.citizen_name}</p>
            </td>
            <td class="px-6 py-4">
                <div class="flex items-center gap-2 text-xs font-bold text-slate-500"><i class="fas fa-map-pin text-rose-500"></i> ${r.location}</div>
            </td>
            <td class="px-6 py-4">
                <span class="text-[9px] font-black px-4 py-1.5 rounded-full uppercase tracking-widest ${r.status === 'RESOLVED' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}">${r.status}</span>
            </td>
            <td class="px-6 py-4 last:rounded-r-[2rem] text-center">
                <div class="flex items-center justify-center gap-4">
                    <button onclick="openModal('view', '${r.id}')" class="w-10 h-10 rounded-xl bg-slate-100 text-slate-600 hover:bg-indigo-600 hover:text-white transition-all flex items-center justify-center"><i class="fas fa-expand-alt"></i></button>
                    ${r.status !== 'RESOLVED' ? `<button onclick="openModal('resolve', '${r.id}')" class="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 hover:bg-emerald-600 hover:text-white transition-all flex items-center justify-center border border-emerald-100"><i class="fas fa-check"></i></button>` : ''}
                </div>
            </td>
        </tr>
    `).join('');
}

function calculateStats() {
    return {
        total: appState.reports.length,
        pending: appState.reports.filter(r => r.status !== 'RESOLVED').length,
        resolved: appState.reports.filter(r => r.status === 'RESOLVED').length,
        citizens: new Set(appState.reports.map(r => r.citizen_id)).size,
        categories: [...new Set(appState.reports.map(r => r.category))]
    };
}

// 7. Modals
window.openModal = (type, reportId) => {
    const report = appState.reports.find(r => r.id === reportId);
    if(!report) return;
    const container = document.getElementById('modal-container');
    container.classList.remove('hidden');
    container.innerHTML = '';
    
    let modalHtml = `<div class="fixed inset-0 bg-slate-900/90 backdrop-blur-xl modal-overlay-fade-in flex items-center justify-center p-4">`;

    if (type === 'view') {
        modalHtml += `
            <div class="bg-white rounded-[3rem] shadow-2xl w-full max-w-5xl max-h-[92vh] overflow-hidden flex flex-col modal-content-zoom-in">
                <div class="p-8 border-b border-slate-100 flex items-center justify-between">
                    <div class="flex items-center gap-4">
                        <div class="w-14 h-14 bg-indigo-50 text-indigo-600 rounded-[1.5rem] flex items-center justify-center text-2xl shadow-inner"><i class="fas fa-file-alt"></i></div>
                        <div><h3 class="text-3xl font-black text-slate-900 tracking-tight leading-none">Full Case View</h3><p class="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Reference: ${report.id.slice(0, 8)}</p></div>
                    </div>
                    <button onclick="closeModal()" class="w-12 h-12 flex items-center justify-center rounded-2xl hover:bg-slate-100 text-slate-400 hover:text-slate-900 transition-all"><i class="fas fa-times text-xl"></i></button>
                </div>
                <div class="overflow-y-auto p-8 md:p-12">
                    <div class="grid grid-cols-1 lg:grid-cols-2 gap-12">
                        <div class="space-y-6">
                            <div class="rounded-[2.5rem] overflow-hidden border border-slate-100 shadow-2xl bg-slate-100">
                                ${report.media_type === 'video' ? `<video src="${report.media_url}" controls class="w-full aspect-square object-cover"></video>` : `<img src="${report.media_url}" class="w-full object-cover" />`}
                            </div>
                        </div>
                        <div class="space-y-8">
                             <div class="space-y-4">
                                <div class="flex gap-2">
                                    <span class="bg-indigo-600 text-white text-[10px] font-black px-4 py-1.5 rounded-full uppercase tracking-widest shadow-lg shadow-indigo-100">${report.category}</span>
                                    <span class="text-[10px] font-black px-4 py-1.5 rounded-full uppercase tracking-widest shadow-lg ${report.status === 'RESOLVED' ? 'bg-emerald-500 text-white' : 'bg-amber-500 text-white'}">${report.status}</span>
                                </div>
                                <h4 class="text-5xl font-black text-slate-900 leading-[0.9] tracking-tighter">${report.title}</h4>
                                <p class="text-2xl text-slate-400 font-black flex items-center gap-3 tracking-tight"><i class="fas fa-location-arrow text-rose-500"></i> ${report.location}</p>
                            </div>
                            <div class="p-8 bg-slate-900 rounded-[2.5rem] text-white relative overflow-hidden group">
                                <h5 class="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] mb-4">Citizen Statement</h5>
                                <p class="text-xl leading-relaxed font-bold italic opacity-90">"${report.description}"</p>
                                <p class="mt-4 text-xs font-black text-indigo-400">— Submitted by ${report.citizen_name}</p>
                            </div>
                            ${report.status === 'RESOLVED' ? `
                                <div class="p-8 bg-emerald-600 rounded-[2.5rem] text-white shadow-xl">
                                    <h5 class="text-[10px] font-black text-emerald-200 uppercase tracking-widest mb-4 flex items-center gap-2"><i class="fas fa-medal"></i> Success Outcome</h5>
                                    <div class="flex gap-6">
                                        ${report.work_done_media_url ? `<img src="${report.work_done_media_url}" class="w-28 h-28 rounded-3xl object-cover border-4 border-white/20 shadow-lg" />` : ''}
                                        <div><p class="font-black text-xl mb-2 tracking-tight">Resolution Complete</p><p class="text-emerald-50 text-sm font-bold opacity-90 leading-relaxed">"${report.work_done_description || ''}"</p></div>
                                    </div>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                </div>
            </div>`;
    } else {
        modalHtml += `
            <div class="bg-white rounded-[3rem] shadow-2xl w-full max-w-lg overflow-hidden border border-white/20 modal-content-zoom-in">
                <div class="p-8 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                    <div><h3 class="text-2xl font-black text-slate-900 tracking-tight">Finish Task</h3><p class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Job Ref: #${report.id.slice(0, 6)}</p></div>
                    <button onclick="closeModal()" class="w-10 h-10 rounded-xl bg-white border border-slate-200 text-slate-400 hover:text-slate-900 transition-all flex items-center justify-center"><i class="fas fa-times"></i></button>
                </div>
                <form onsubmit="handleResolve(event, '${report.id}')" class="p-8 space-y-8">
                    <div class="space-y-2">
                        <label class="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Resolution Summary</label>
                        <textarea name="resolution" required rows="4" class="w-full p-5 rounded-[2rem] bg-slate-50 border border-slate-100 outline-none focus:ring-4 focus:ring-emerald-500/10 focus:bg-white transition-all font-bold text-slate-700 placeholder:text-slate-300 resize-none" placeholder="Describe the amazing work your team did..."></textarea>
                    </div>
                    <div class="space-y-2">
                        <label class="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Work Proof (Image)</label>
                        <label class="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-emerald-200 rounded-[1.5rem] cursor-pointer bg-emerald-50/20 hover:bg-emerald-50 transition-all">
                            <div class="flex items-center gap-3"><i class="fas fa-camera text-emerald-400 text-xl"></i><p id="proof-text" class="text-xs font-black text-emerald-700">Attach Evidence</p></div>
                            <input name="work_media" type="file" accept="image/*" required class="hidden" onchange="document.getElementById('proof-text').innerText = 'Selected: ' + this.files[0].name.slice(0,10)">
                        </label>
                    </div>
                    <button type="submit" id="resolve-btn" class="w-full py-5 bg-emerald-600 text-white rounded-[2rem] font-black shadow-lg hover:bg-emerald-700 transition-all flex items-center justify-center gap-3">Complete Task</button>
                </form>
            </div>`;
    }
    
    modalHtml += `</div>`;
    container.innerHTML = modalHtml;
};

window.closeModal = () => {
    document.getElementById('modal-container').classList.add('hidden');
    document.getElementById('modal-container').innerHTML = '';
};

window.handleResolve = async (e, reportId) => {
    e.preventDefault();
    const btn = document.getElementById('resolve-btn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-circle-notch animate-spin"></i> Processing...';

    const formData = new FormData(e.target);
    const mediaFile = formData.get('work_media');
    const reader = new FileReader();

    reader.onloadend = async () => {
        const { error } = await _supabase.from('reports').update({
            status: 'RESOLVED',
            work_done_description: formData.get('resolution'),
            work_done_media_url: reader.result,
            resolved_at: Date.now()
        }).eq('id', reportId);

        if (error) alert(error.message);
        else {
            await fetchReports(); // Ensure fresh data for large payloads
            closeModal();
            alert("Case Resolved! Impact recorded.");
        }
        btn.disabled = false;
        btn.innerHTML = 'Complete Task';
    };
    reader.readAsDataURL(mediaFile);
};

// 8. Initialization
(async function init() {
    try {
        loadingOverlay.classList.remove('hidden');
        
        // Check session
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            try {
                appState.user = JSON.parse(saved);
            } catch(e) { 
                localStorage.removeItem(STORAGE_KEY); 
            }
        }

        await fetchReports();
        subscribeToReports();

        if (appState.user) {
            login(appState.user);
        } else {
            navigateTo('landing');
        }

        // Static features grid injection
        const featGrid = document.getElementById('features-grid');
        if(featGrid) {
            const feats = [
                { icon: 'fa-camera', title: 'Snap & Report', desc: 'Take a photo or video of the issue. Provide clear details to help authorities.', color: 'bg-indigo-500' },
                { icon: 'fa-map-location-dot', title: 'Real-time Tracking', desc: 'Follow your report from submission to resolution. Get notified instantly.', color: 'bg-purple-500' },
                { icon: 'fa-shield-check', title: 'Verified Impact', desc: 'Authorities provide visual proof of resolution, ensuring transparency.', color: 'bg-emerald-500' }
            ];
            featGrid.innerHTML = feats.map(f => `
                <div class="bg-white p-10 rounded-[2.5rem] border border-slate-100 shadow-sm hover:shadow-xl transition-all group">
                    <div class="${f.color} w-14 h-14 text-white rounded-2xl flex items-center justify-center mb-8 shadow-lg group-hover:rotate-6 transition-transform">
                        <i class="fas ${f.icon} text-xl"></i>
                    </div>
                    <h3 class="text-2xl font-black text-slate-900 mb-4 tracking-tight">${f.title}</h3>
                    <p class="text-slate-500 font-medium leading-relaxed">${f.desc}</p>
                </div>
            `).join('');
        }
    } catch (err) {
        console.error("Initialization error:", err);
    } finally {
        loadingOverlay.classList.add('hidden');
        renderLandingFeed();
        renderLandingStats();
    }
})();

window.navigateTo = navigateTo;
