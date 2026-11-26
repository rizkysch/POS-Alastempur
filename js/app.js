const cfg = window.APP_CONFIG || {};
const hasConfig = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && cfg.supabaseUrl.startsWith("https://") && !cfg.supabaseUrl.includes("YOUR_") && !cfg.supabaseAnonKey.includes("YOUR_"));
const sb = hasConfig && window.supabase ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
}) : null;

const STATUS = [
  ["baru","Baru"],["diproses","Diproses"],["dicuci","Dicuci"],["dikeringkan","Dikeringkan"],
  ["quality_check","Quality Check"],["siap_diambil","Siap Diambil"],["selesai","Selesai"]
];
let state = {session:null, profile:null, orders:[], services:[], staff:[], auditLogs:[], currentPage:"dashboard", realtime:null, recoveryMode:false, inviteMode:false};

const $ = id => document.getElementById(id);
const rupiah = n => new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(Number(n||0));
const esc = s => String(s ?? "").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
function toast(msg, bad=false){const t=$("toast");t.textContent=msg;t.style.background=bad?"#7b2626":"#111";t.classList.add("show");clearTimeout(window._toast);window._toast=setTimeout(()=>t.classList.remove("show"),3500)}
function diag(msg){const d=$("authDiagnostics");d.classList.remove("hidden");d.innerHTML=esc(msg).replace(/\n/g,"<br>")}
function showAuth(view){document.querySelectorAll(".auth-view").forEach(x=>x.classList.add("hidden"));$(view).classList.remove("hidden");$("authDiagnostics").classList.add("hidden");if(view==="registerView"){clearFormErrors("registerForm");const length=$("registerName").value.trim().length;$("registerNameCount").textContent=`${length}/100 karakter`;$("registerNameCount").classList.toggle("danger",length>100)}}
function setFieldError(input,message){
  if(!input)return !message;
  const label=input.closest("label");
  if(!label)return !message;
  let error=label.querySelector(".field-error");
  if(!error){error=document.createElement("small");error.className="field-error";error.setAttribute("aria-live","polite");label.appendChild(error)}
  error.textContent=message||"";
  input.classList.toggle("is-invalid",!!message);
  input.setAttribute("aria-invalid",message?"true":"false");
  return !message;
}
function clearFormErrors(formId){
  const form=$(formId);if(!form)return;
  form.querySelectorAll(".is-invalid").forEach(input=>{input.classList.remove("is-invalid");input.setAttribute("aria-invalid","false")});
  form.querySelectorAll(".field-error").forEach(error=>{error.textContent=""});
}
function validatePhone(v){return /^\d{10,14}$/.test(v)}
function statusLabel(v){return STATUS.find(x=>x[0]===v)?.[1]||v}
function paymentStatus(o){if(Number(o.paid_amount||0)>=Number(o.total||0))return "Lunas";if(Number(o.paid_amount||0)>0)return "DP";return "Belum bayar"}

function explainError(e){
  const m=(e?.message||String(e||"")).toLowerCase();
  if(m.includes("invalid api key")) return "Invalid API key. Pastikan SUPABASE_ANON_KEY di js/config.js adalah anon/publishable key dari project yang sama.";
  if(m.includes("redirect")||m.includes("redirect url")) return "Redirect URL ditolak. Tambahkan URL aplikasi di Supabase → Authentication → URL Configuration. Untuk Live Server tambahkan http://127.0.0.1:5500/** dan/atau http://localhost:5500/**.";
  if(m.includes("email not confirmed")) return "Email belum dikonfirmasi. Untuk testing, buka Supabase → Authentication → Providers → Email dan nonaktifkan Confirm email, atau buka email konfirmasi.";
  if(m.includes("user already registered")) return "Email tersebut sudah terdaftar. Gunakan login atau Forgot Password.";
  if(m.includes("relation")&&m.includes("does not exist")) return "Tabel database belum dibuat. Jalankan schema.sql di Supabase → SQL Editor.";
  if(m.includes("row-level security")||m.includes("permission denied")||e?.status===401||e?.status===403) return "Akses database ditolak oleh RLS/policy. Jalankan schema.sql versi Alastempur lalu coba lagi.";
  if(m.includes("failed to fetch")) return "Tidak bisa terhubung ke Supabase. Periksa internet, SUPABASE_URL, dan blokir browser/extension.";
  return e?.message || String(e);
}

async function authBoot(){
  if(!sb){diag("Supabase belum aktif. Periksa js/config.js dan pastikan CDN Supabase dapat dimuat.");return;}
  // Capture the recovery marker before Supabase consumes the URL fragment.
  state.recoveryMode = new URLSearchParams(location.search).get("reset-password")==="true" || location.hash.includes("type=recovery");
  state.inviteMode = new URLSearchParams(location.search).get("invite")==="true" || location.hash.includes("type=invite");
  const {data,error}=await sb.auth.getSession();
  if(error){diag(explainError(error));return}
  if((state.recoveryMode || state.inviteMode) && !data.session){
    showAuthScreen();
    showAuth("loginView");
    diag("Link reset password tidak valid atau sudah kedaluwarsa. Minta link reset baru.");
  }else{
    // Invitation links also establish an authenticated session. Route that
    // initial session directly to password setup instead of briefly opening
    // the app/login flow and depending on the auth-state callback race.
    await handleSession(data.session,state.recoveryMode || state.inviteMode);
  }
  sb.auth.onAuthStateChange((event,session)=>{
    // getSession above already rendered the initial session. Ignore the
    // matching INITIAL_SESSION callback to prevent duplicate startup loads.
    if(event==="INITIAL_SESSION") return;
    if(event==="PASSWORD_RECOVERY") state.recoveryMode=true;
    if(!session){state.recoveryMode=false;state.inviteMode=false;}
    const isPasswordSetup=(state.recoveryMode || state.inviteMode) && !!session;
    setTimeout(()=>handleSession(session,isPasswordSetup).catch(error=>toast(explainError(error),true)),0);
  });
}
function showAuthScreen(){
  $("appScreen").classList.add("hidden");
  $("authScreen").classList.remove("hidden");
}
async function handleSession(session,recovery=false){
  state.session=session;
  if(session){
    if(recovery){
      showAuthScreen();
      showAuth("resetView");
      const invite=state.inviteMode;
      $("resetEyebrow").textContent=invite?"UNDANGAN KASIR":"PASSWORD BARU";
      $("resetHeading").textContent=invite?"Buat password":"Atur password";
      $("resetDescription").textContent=invite?"Buat password untuk mengaktifkan akun kasir Alastempur.":"Buat password baru untuk akun Alastempur.";
      $("resetSubmit").textContent=invite?"Aktifkan akun":"Simpan password";
      return;
    }
    $("authScreen").classList.add("hidden");$("appScreen").classList.remove("hidden");
    await loadProfile();
    if(state.profile?.is_active===false){
      showAuthScreen();showAuth("loginView");diag("Akun ini sedang dinonaktifkan. Hubungi super admin.");
      setTimeout(()=>sb.auth.signOut(),0);
      return;
    }
    // Reveal the super-admin navigation item, but keep its page hidden until
    // the user explicitly navigates to it. The page itself also has the
    // superadmin-only class and must retain its initial `.page.hidden` state.
    document.querySelectorAll(".sidebar .superadmin-only").forEach(el=>el.classList.toggle("hidden",state.profile?.role!=="superadmin"));
    renderProfile();
    await loadData();
    subscribeRealtime();
  }else{
    $("appScreen").classList.add("hidden");$("authScreen").classList.remove("hidden");
    showAuth("loginView");
  }
}
async function loadProfile(){
  const {data,error}=await sb.from("profiles").select("*").eq("id",state.session.user.id).maybeSingle();
  if(error){toast(explainError(error),true);state.profile={full_name:state.session.user.user_metadata?.full_name||state.session.user.email,role:"kasir"}}
  else state.profile=data||{full_name:state.session.user.user_metadata?.full_name||state.session.user.email,email:state.session.user.email,phone:"",role:"kasir",is_active:true};
  const name=state.profile.full_name||state.session.user.email;
  $("userName").textContent=name;$("userRole").textContent=(state.profile.role||"kasir").toUpperCase();
  $("userAvatar").textContent=name.charAt(0).toUpperCase();
}
async function loadData(){
  setConnection(true);
  const [o,s]=await Promise.all([
    sb.from("orders").select("*, order_items(*)").order("created_at",{ascending:false}),
    sb.from("services").select("*").order("name")
  ]);
  if(o.error){setConnection(false);toast(explainError(o.error),true);return}
  if(s.error){toast(explainError(s.error),true);return}
  state.orders=o.data||[];state.services=s.data||[];
  renderAll();
}
async function loadStaffData(){
  const [staff,audit]=await Promise.all([
    sb.from("profiles").select("id,full_name,email,phone,role,is_active,created_at").order("created_at",{ascending:false}),
    sb.from("audit_logs").select("id,actor_id,action,target_user_id,details,created_at").order("created_at",{ascending:false}).limit(100)
  ]);
  if(staff.error||audit.error){toast(explainError(staff.error||audit.error),true);return}
  state.staff=staff.data||[];state.auditLogs=audit.data||[];renderStaff();
}
function setConnection(ok){$("connectionDot").style.background=ok?"#222":"#b33";$("connectionText").textContent=ok?"Supabase terhubung":"Supabase error"}
function subscribeRealtime(){
  if(state.realtime) sb.removeChannel(state.realtime);
  state.realtime=sb.channel("alastempur-orders").on("postgres_changes",{event:"*",schema:"public",table:"orders"},()=>loadData()).on("postgres_changes",{event:"*",schema:"public",table:"order_items"},()=>loadData()).subscribe();
}

async function login(e){e.preventDefault();$("authDiagnostics").classList.add("hidden");if(!sb)return diag("Supabase belum dikonfigurasi.");const email=$("loginEmail").value.trim(),password=$("loginPassword").value;const {error}=await sb.auth.signInWithPassword({email,password});if(error){diag(explainError(error));return}toast("Berhasil masuk")}

async function logout() {await sb.auth.signOut();toast("Anda telah keluar");}
function validateRegistration(){
  const name=$("registerName").value.trim();
  const phone=$("registerPhone").value.trim();
  const email=$("registerEmail").value.trim();
  const password=$("registerPassword").value;
  const confirm=$("registerConfirm").value;
  const results=[
    [$("registerName"),name.length<2?"Nama minimal 2 karakter.":name.length>100?"Nama maksimal 100 karakter.":""],
    [$("registerPhone"),!/^\d{10,14}$/.test(phone)?"Nomor telepon harus 10-14 digit.":""],
    [$("registerEmail"),!email.includes("@")?"Email harus mengandung @.":!/^\S+@\S+\.\S+$/.test(email)?"Format email belum valid.":""],
    [$("registerPassword"),password.length<8?"Password minimal 8 karakter.":""],
    [$("registerConfirm"),confirm!==password?"Konfirmasi password harus sama dengan password.":""]
  ];
  let firstInvalid=null;
  results.forEach(([input,message])=>{if(!setFieldError(input,message)&&!firstInvalid)firstInvalid=input});
  if(firstInvalid){firstInvalid.focus();return false}
  return true;
}
function validateRegistrationField(input){
  const value=input.value.trim();
  let message="";
  if(input.id==="registerName"){
    const length=value.length;
    const counter=$("registerNameCount");
    counter.textContent=`${length}/100 karakter`;
    counter.classList.toggle("danger",length>100);
    message=length<2?"Nama minimal 2 karakter.":length>100?"Nama maksimal 100 karakter.":"";
  }
  if(input.id==="registerPhone")message=!/^\d{10,14}$/.test(value)?"Nomor telepon harus 10-14 digit.":"";
  if(input.id==="registerEmail")message=!value.includes("@")?"Email harus mengandung @.":!/^\S+@\S+\.\S+$/.test(value)?"Format email belum valid.":"";
  if(input.id==="registerPassword")message=input.value.length<8?"Password minimal 8 karakter.":"";
  if(input.id==="registerConfirm")message=input.value!==$("registerPassword").value?"Konfirmasi password harus sama dengan password.":"";
  setFieldError(input,message);
  if(input.id==="registerPassword"&&$("registerConfirm").value)validateRegistrationField($("registerConfirm"));
}
async function register(e){
  e.preventDefault();
  if(!validateRegistration())return;
  if(!sb)return diag("Supabase belum dikonfigurasi.");
  const name=$("registerName").value.trim(),phone=$("registerPhone").value.trim(),email=$("registerEmail").value.trim(),password=$("registerPassword").value;
  const {data,error}=await sb.auth.signUp({email,password,options:{data:{full_name:name,phone},emailRedirectTo:location.origin+"/"}});
  if(error){diag(explainError(error));return}
  if(data.session)toast("Akun berhasil dibuat dan sudah masuk.");
  else {showAuth("loginView");diag("Akun berhasil dibuat. Jika Confirm email aktif, buka email konfirmasi terlebih dahulu lalu login.")}
}
async function forgot(e){e.preventDefault();const email=$("forgotEmail").value.trim();const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:location.origin+"/?reset-password=true"});if(error){diag(explainError(error));return}toast("Link reset password dikirim. Periksa email Anda.")}
async function saveProfile(e){e.preventDefault();const full_name=$("profileName").value.trim(),phone=$("profilePhone").value.trim();if(full_name.length<2||full_name.length>100)return toast("Nama harus berisi 2-100 karakter.",true);if(phone&&!validatePhone(phone))return toast("Nomor telepon harus 10-14 digit angka.",true);const {data,error}=await sb.from("profiles").update({full_name,phone:phone||null}).eq("id",state.session.user.id).select().single();if(error)return toast(explainError(error),true);state.profile=data;$("userName").textContent=data.full_name;$("userAvatar").textContent=data.full_name.charAt(0).toUpperCase();renderProfile();toast("Profil berhasil diperbarui.")}
async function changePassword(e){e.preventDefault();const current=$("currentPassword").value,next=$("newPassword").value,confirm=$("confirmNewPassword").value;if(next.length<8)return toast("Password baru minimal 8 karakter.",true);if(next!==confirm)return toast("Konfirmasi password tidak sama.",true);if(current===next)return toast("Password baru harus berbeda dari password saat ini.",true);const {error:verifyError}=await sb.auth.signInWithPassword({email:state.session.user.email,password:current});if(verifyError)return toast("Password saat ini tidak sesuai.",true);const {error}=await sb.auth.updateUser({password:next});if(error)return toast(explainError(error),true);$("passwordForm").reset();toast("Password berhasil diubah.")}
async function edgeFunctionError(error){try{const body=await error.context?.json();if(body?.error)return body.error}catch{}return error?.message||"Permintaan ke server gagal."}
async function inviteCashier(e){e.preventDefault();const full_name=$("inviteName").value.trim(),email=$("inviteEmail").value.trim().toLowerCase(),phone=$("invitePhone").value.trim();if(full_name.length<2||full_name.length>100)return toast("Nama harus berisi 2-100 karakter.",true);if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return toast("Format email tidak valid.",true);if(!validatePhone(phone))return toast("Nomor telepon harus 10-14 digit angka.",true);const {data,error}=await sb.functions.invoke("admin-cashier",{body:{action:"invite",full_name,email,phone}});if(error)return toast(await edgeFunctionError(error),true);$("inviteModal").classList.add("hidden");$("inviteForm").reset();toast(data?.message||"Undangan berhasil dikirim.");await loadStaffData()}
async function setCashierActive(id,active){const {data,error}=await sb.functions.invoke("admin-cashier",{body:{action:"set_active",user_id:id,active}});if(error)return toast(await edgeFunctionError(error),true);toast(data?.message||"Status akun diperbarui.");await loadStaffData()}
async function resetPassword(e){e.preventDefault();const p=$("resetPassword").value,c=$("resetConfirm").value;if(p.length<8)return diag("Password minimal 8 karakter.");if(p!==c)return diag("Konfirmasi password tidak sama.");if(!state.session)return diag("Sesi reset tidak ditemukan. Minta link reset password baru.");const {error}=await sb.auth.updateUser({password:p});if(error){diag(explainError(error));return}history.replaceState({},document.title,location.pathname);toast("Password berhasil diubah.");await sb.auth.signOut();state.recoveryMode=false;showAuth("loginView")}

function navigate(page){if(page==="staff"&&state.profile?.role!=="superadmin"){page="dashboard";toast("Halaman ini hanya untuk super admin.",true)}state.currentPage=page;document.querySelectorAll(".page").forEach(x=>x.classList.add("hidden"));$("page-"+page).classList.remove("hidden");document.querySelectorAll(".nav-item").forEach(x=>x.classList.toggle("active",x.dataset.page===page));const titles={dashboard:"Dashboard",orders:"Pesanan",kanban:"Kanban",customers:"Pelanggan",services:"Layanan",payments:"Pembayaran",reports:"Laporan",profile:"Pengaturan",staff:"Manajemen kasir"};$("pageTitle").textContent=titles[page];$("pageEyebrow").textContent=page==="dashboard"?"OVERVIEW":page==="staff"?"SUPER ADMIN":page.toUpperCase();if(page==="staff")loadStaffData();renderAll()}
function renderAll(){renderDashboard();renderOrders();renderKanban();renderCustomers();renderServices();renderPayments();renderReports();fillStatusFilter()}
function aggregateCustomers(orders){
  const customers=new Map();
  orders.forEach(order=>{
    const name=String(order.customer_name||"").trim().replace(/\s+/g," ");
    const phone=String(order.phone||"").trim();
    const key=JSON.stringify([name.toLocaleLowerCase("id"),phone]);
    if(!customers.has(key))customers.set(key,{name,phone,count:0,total:0});
    const customer=customers.get(key);
    customer.count++;
    customer.total+=Number(order.total||0);
  });
  return [...customers.values()];
}
function renderDashboard(){const active=state.orders.filter(o=>o.status!=="selesai").length,ready=state.orders.filter(o=>o.status==="siap_diambil").length,revenue=state.orders.reduce((a,o)=>a+Number(o.paid_amount||0),0),customers=aggregateCustomers(state.orders).length;$("statActive").textContent=active;$("statReady").textContent=ready;$("statRevenue").textContent=rupiah(revenue);$("statCustomers").textContent=customers;$("recentOrders").innerHTML=state.orders.slice(0,8).map(o=>`<tr><td><strong>${esc(o.order_code)}</strong></td><td>${esc(o.customer_name)}</td><td>${(o.order_items||[]).map(i=>`${esc(i.shoe_name||"Sepatu")}: ${esc(i.service_name)}`).join(", ")||"-"}</td><td><span class="status ${o.status==="selesai"?"done":o.status==="siap_diambil"?"ready":""}">${statusLabel(o.status)}</span></td><td>${rupiah(o.total)}</td></tr>`).join("")||`<tr><td colspan="5" class="empty">Belum ada pesanan.</td></tr>`}
function renderOrders(){const q=($("orderSearch")?.value||"").toLowerCase(),f=$("orderStatusFilter")?.value||"";const list=state.orders.filter(o=>(!q||`${o.order_code} ${o.customer_name} ${o.phone}`.toLowerCase().includes(q))&&(!f||o.status===f));$("ordersTable").innerHTML=list.map(o=>`<tr><td><strong>${esc(o.order_code)}</strong></td><td>${esc(o.customer_name)}</td><td>${esc(o.phone)}</td><td><span class="status">${statusLabel(o.status)}</span></td><td>${paymentStatus(o)}</td><td>${rupiah(o.total)}</td><td><button class="mini-btn" data-next="${o.id}">Lanjut</button></td></tr>`).join("")||`<tr><td colspan="7" class="empty">Tidak ada data.</td></tr>`}
function renderKanban(){const board=$("kanbanBoard");board.innerHTML=STATUS.map(([key,label])=>{const items=state.orders.filter(o=>o.status===key);return `<div class="kanban-col"><div class="kanban-head"><span>${label}</span><span>${items.length}</span></div><div class="kanban-cards">${items.map(o=>{const idx=STATUS.findIndex(x=>x[0]===o.status),next=STATUS[idx+1]?.[0];return `<div class="k-card"><strong>${esc(o.order_code)}</strong><p>${esc(o.customer_name)} · ${rupiah(o.total)}</p><p>${(o.order_items||[]).map(i=>`${esc(i.shoe_name||"Sepatu")}: ${esc(i.service_name)}`).join(", ")}</p>${next?`<div class="k-actions"><button class="mini-btn" data-next="${o.id}">→ ${statusLabel(next)}</button></div>`:""}</div>`}).join("")||`<div class="empty">Kosong</div>`}</div></div>`}).join("")}
function renderCustomers(){const q=($("customerSearch")?.value||"").toLocaleLowerCase("id");const list=aggregateCustomers(state.orders).filter(c=>`${c.name} ${c.phone}`.toLocaleLowerCase("id").includes(q));$("customersTable").innerHTML=list.map(c=>`<tr><td>${esc(c.name)}</td><td>${esc(c.phone)}</td><td>${c.count}</td><td>${rupiah(c.total)}</td></tr>`).join("")||`<tr><td colspan="4" class="empty">Belum ada pelanggan.</td></tr>`}
function renderServices(){$("servicesTable").innerHTML=state.services.map(s=>`<tr><td>${esc(s.name)}</td><td>${rupiah(s.price)}</td><td>${s.active?"Aktif":"Nonaktif"}</td><td><button class="mini-btn" data-edit-service="${s.id}">Edit</button></td></tr>`).join("")||`<tr><td colspan="4" class="empty">Belum ada layanan.</td></tr>`}
function renderPayments(){
  const total=state.orders.reduce((sum,o)=>sum+Number(o.total||0),0);
  const paid=state.orders.reduce((sum,o)=>sum+Number(o.paid_amount||0),0);
  $("paymentCount").textContent=state.orders.length;
  $("paymentTotal").textContent=rupiah(total);
  $("paymentPaid").textContent=rupiah(paid);
  $("paymentDue").textContent=rupiah(total-paid);
  $("paymentsTable").innerHTML=state.orders.map(o=>{
    const due=Math.max(0,Number(o.total||0)-Number(o.paid_amount||0));
    const action=due>0?`<button class="mini-btn" data-edit-payment="${o.id}">Edit pembayaran</button>`:"-";
    return `<tr><td>${esc(o.order_code||o.invoice_number||"-")}</td><td>${esc(o.customer_name||"-")}</td><td>${rupiah(o.total)}</td><td>${rupiah(o.paid_amount)}</td><td>${rupiah(due)}</td><td>${paymentStatus(o)}</td><td>${action}</td></tr>`;
  }).join("")||`<tr><td colspan="7" class="empty">Belum ada pesanan.</td></tr>`;
}
function openPaymentEdit(id){
  const order=state.orders.find(item=>item.id===id);
  if(!order)return toast("Pesanan tidak ditemukan.",true);
  const total=Number(order.total||0),paid=Number(order.paid_amount||0);
  if(total<=paid)return toast("Pesanan ini sudah lunas.",true);
  $("paymentEditOrderId").value=order.id;
  $("paymentEditOrderCode").textContent=order.order_code||order.invoice_number||"-";
  $("paymentEditCustomer").textContent=order.customer_name||"-";
  $("paymentEditTotal").textContent=rupiah(total);
  $("paymentEditAmount").value=paid;
  $("paymentEditAmount").max=String(total);
  $("paymentEditHint").textContent=`Sisa tagihan ${rupiah(total-paid)}. Isi jumlah total yang sudah diterima.`;
  $("paymentEditMethod").value=["cash","transfer","qris"].includes(order.payment_method)?order.payment_method:"cash";
  $("paymentEditModal").classList.remove("hidden");
}
async function savePaymentEdit(e){
  e.preventDefault();
  const id=$("paymentEditOrderId").value;
  const order=state.orders.find(item=>item.id===id);
  if(!order)return toast("Pesanan tidak ditemukan.",true);
  const paid=Number($("paymentEditAmount").value);
  const total=Number(order.total||0);
  if(!Number.isFinite(paid)||paid<0)return toast("Nominal pembayaran tidak valid.",true);
  if(paid>total)return toast("Nominal dibayar tidak boleh melebihi total tagihan.",true);
  const payment_method=$("paymentEditMethod").value;
  if(!["cash","transfer","qris"].includes(payment_method))return toast("Pilih metode pembayaran yang valid.",true);
  const {error}=await sb.from("orders").update({
    paid_amount:paid,
    payment_amount:paid,
    payment_status:paid>=total?"LUNAS":"BELUM LUNAS",
    payment_method
  }).eq("id",id);
  if(error)return toast(explainError(error),true);
  $("paymentEditModal").classList.add("hidden");
  toast(paid>=total?"Pembayaran diperbarui: pesanan lunas.":paid>0?"Pembayaran diperbarui: masih ada sisa tagihan.":"Pembayaran dikembalikan ke belum bayar.");
  await loadData();
}
function renderReports(){
  const from=$("reportDateFrom").value,to=$("reportDateTo").value,error=$("reportDateError");
  const rangeValid=!(from&&to&&from>to);
  error.textContent=rangeValid?"":"Tanggal awal tidak boleh setelah tanggal akhir.";
  const orders=rangeValid?state.orders.filter(order=>{
    const date=String(order.created_at||"").slice(0,10);
    return (!from||date>=from)&&(!to||date<=to);
  }):[];
  const total=orders.reduce((a,o)=>a+Number(o.total||0),0),done=orders.filter(o=>o.status==="selesai").length,active=orders.length-done;
  $("reportRevenue").textContent=rupiah(orders.reduce((a,o)=>a+Number(o.paid_amount||0),0));$("reportDone").textContent=done;$("reportAverage").textContent=rupiah(orders.length?total/orders.length:0);$("reportActive").textContent=active;
  const counts={};orders.forEach(o=>counts[o.status]=(counts[o.status]||0)+1);
  $("reportStatus").innerHTML=STATUS.map(([k,l])=>`<div class="bar-row"><span>${l}</span><div class="bar"><i style="width:${orders.length?(counts[k]||0)/orders.length*100:0}%"></i></div><strong>${counts[k]||0}</strong></div>`).join("");
}
function renderProfile(){if(!state.profile)return;$("profileName").value=state.profile.full_name||"";$("profileEmail").value=state.session?.user?.email||state.profile.email||"";$("profilePhone").value=state.profile.phone||""}
function renderStaff(){
  const q=($("staffSearch")?.value||"").toLowerCase(),filter=$("staffStatusFilter")?.value||"";
  const people=state.staff.filter(p=>p.role==="kasir"&&(!q||`${p.full_name} ${p.email} ${p.phone}`.toLowerCase().includes(q))&&(!filter||(filter==="active")===(p.is_active===true)));
  $("staffTable").innerHTML=people.map(p=>`<tr><td>${esc(p.full_name||"-")}</td><td>${esc(p.email||"-")}</td><td>${esc(p.phone||"-")}</td><td><span class="status ${p.is_active?"ready":"inactive"}">${p.is_active?"Aktif":"Nonaktif"}</span></td><td>${new Date(p.created_at).toLocaleDateString("id-ID")}</td><td><button class="mini-btn" data-staff-toggle="${p.id}" data-active="${p.is_active}">${p.is_active?"Nonaktifkan":"Aktifkan"}</button></td></tr>`).join("")||`<tr><td colspan="6" class="empty">Tidak ada akun kasir.</td></tr>`;
  const nameById=new Map(state.staff.map(p=>[p.id,p.full_name||p.email||p.id]));
  if(state.profile)nameById.set(state.session.user.id,state.profile.full_name||state.session.user.email);
  $("auditTable").innerHTML=state.auditLogs.map(log=>`<tr><td>${new Date(log.created_at).toLocaleString("id-ID")}</td><td>${esc(nameById.get(log.actor_id)||log.actor_id||"Sistem")}</td><td>${esc(log.action)}</td><td>${esc(nameById.get(log.target_user_id)||log.details?.email||"-")}</td><td>${esc(log.details?.full_name||log.details?.email||"")}</td></tr>`).join("")||`<tr><td colspan="5" class="empty">Belum ada aktivitas tercatat.</td></tr>`;
}
function fillStatusFilter(){const s=$("orderStatusFilter");if(s.options.length>1)return;STATUS.forEach(([k,l])=>s.add(new Option(l,k)))}
function serviceChoices(){return state.services.filter(s=>s.active).map(s=>`<label class="service-choice"><input type="checkbox" class="item-service" value="${esc(s.id)}" data-price="${Number(s.price)}"><span>${esc(s.name)}</span><strong>${rupiah(s.price)}</strong></label>`).join("")||`<p class="muted service-empty">Belum ada layanan aktif.</p>`}
function selectedServices(row){return [...row.querySelectorAll(".item-service:checked")].map(input=>state.services.find(service=>service.id===input.value)).filter(Boolean)}
function addOrderItem(){
  const wrap=$("orderItems");
  if(wrap.children.length>=5){$("orderItemsError").textContent="Maksimal 5 sepatu per pesanan.";return toast("Maksimal 5 sepatu per pesanan.",true)}
  $("orderItemsError").textContent="";
  const row=document.createElement("div");
  row.className="order-item";
  row.innerHTML=`
    <div class="shoe-details">
      <label>Nama sepatu<input class="item-shoe-name" required maxlength="100" placeholder="Contoh: Sneakers putih"></label>
      <label>Merek<input class="item-brand" maxlength="80" placeholder="Opsional"></label>
      <label>Warna<input class="item-color" maxlength="50" placeholder="Opsional"></label>
      <label>Bahan<input class="item-material" maxlength="80" placeholder="Opsional"></label>
      <label class="shoe-condition">Kondisi awal / catatan<textarea class="item-condition" rows="2" maxlength="500" placeholder="Opsional"></textarea></label>
    </div>
    <div class="selected-services"><strong>Layanan dipilih</strong><div class="selected-service-list"><span class="muted">Belum ada layanan dipilih.</span></div></div>
    <div class="shoe-services"><label>Cari dan pilih layanan<input class="service-search" type="search" placeholder="Ketik nama layanan..."></label><div class="service-choice-list">${serviceChoices()}</div><small class="field-error service-error" aria-live="polite"></small></div>
    <label>Qty<input class="item-qty" type="number" min="1" value="1" required></label>
    <label>Subtotal sepatu<input class="item-subtotal" readonly value="Rp0"></label>
    <button type="button" class="remove" aria-label="Hapus item">Hapus</button>`;
  wrap.appendChild(row);
  row.querySelector(".remove").onclick=()=>{row.remove();$("orderItemsError").textContent="";updateOrderTotal()};
  row.querySelector(".item-shoe-name").oninput=e=>setFieldError(e.target,e.target.value.trim()?"":"Nama sepatu wajib diisi.");
  row.querySelector(".service-search").oninput=e=>{const query=e.target.value.trim().toLocaleLowerCase("id");row.querySelectorAll(".service-choice").forEach(choice=>{choice.hidden=!choice.textContent.toLocaleLowerCase("id").includes(query)})};
  row.querySelectorAll(".item-service").forEach(input=>input.onchange=()=>{const selectedCount=document.querySelectorAll(".item-service:checked").length;if(selectedCount>5){input.checked=false;$("orderItemsError").textContent="Maksimal 5 pilihan layanan per pesanan.";toast("Maksimal 5 pilihan layanan per pesanan.",true)}else{$("orderItemsError").textContent=""}row.querySelector(".service-error").textContent=row.querySelector(".item-service:checked")?"":"Pilih minimal satu layanan untuk sepatu ini.";updateOrderTotal()});
  row.querySelector(".item-qty").oninput=e=>{const quantity=Number(e.target.value);setFieldError(e.target,Number.isInteger(quantity)&&quantity>=1?"":"Qty harus berupa bilangan bulat minimal 1.");updateOrderTotal()};
  updateOrderTotal();
}
function updateOrderTotal(){let total=0;document.querySelectorAll(".order-item").forEach(row=>{const quantity=Math.max(1,Number(row.querySelector(".item-qty").value||1)),services=selectedServices(row),serviceTotal=services.reduce((sum,service)=>sum+Number(service.price),0),subtotal=serviceTotal*quantity;row.querySelector(".item-subtotal").value=rupiah(subtotal);row.querySelector(".selected-service-list").innerHTML=services.length?services.map(service=>`<span class="selected-service-chip">${esc(service.name)} <strong>${rupiah(Number(service.price)*quantity)}</strong></span>`).join(""):`<span class="muted">Belum ada layanan dipilih.</span>`;total+=subtotal});$("orderTotal").textContent=rupiah(total);$("paidAmount").max=total;const paid=Number($("paidAmount").value||0);setFieldError($("paidAmount"),paid>total?`Pembayaran melebihi total. Maksimum ${rupiah(total)}.`:paid<0?"Nominal pembayaran tidak boleh negatif.":"")}
function openOrder(){if(!state.services.filter(s=>s.active).length)return toast("Tambahkan minimal satu layanan aktif terlebih dahulu.",true);$("orderForm").reset();clearFormErrors("orderForm");$("orderItems").innerHTML="";$("orderItemsError").textContent="";$("paidAmount").value=0;addOrderItem();$("orderModal").classList.remove("hidden")}
async function saveOrder(e){
  e.preventDefault();
  const customerInput=$("orderCustomer"),phoneInput=$("orderPhone");
  const customer=customerInput.value.trim(),phone=phoneInput.value.trim();
  let firstInvalid=null;
  if(!setFieldError(customerInput,customer?"":"Nama pelanggan wajib diisi."))firstInvalid=customerInput;
  if(!setFieldError(phoneInput,validatePhone(phone)?"":"Nomor telepon harus 10-14 digit."))firstInvalid??=phoneInput;
  if(firstInvalid){firstInvalid.focus();return}
  const rows=[...document.querySelectorAll(".order-item")];
  if(rows.length<1||rows.length>5){$("orderItemsError").textContent="Pesanan harus memiliki 1-5 sepatu.";return}
  $("orderItemsError").textContent="";
  const serviceCount=rows.reduce((count,row)=>count+selectedServices(row).length,0);
  if(serviceCount>5){$("orderItemsError").textContent="Maksimal 5 pilihan layanan per pesanan.";return}
  const items=[];
  for(const row of rows){
    const services=selectedServices(row),shoeInput=row.querySelector(".item-shoe-name");
    const shoeName=shoeInput.value.trim();
    const quantity=Number(row.querySelector(".item-qty").value);
    if(!Number.isInteger(quantity)||quantity<1){setFieldError(row.querySelector(".item-qty"),"Qty harus berupa bilangan bulat minimal 1.");row.querySelector(".item-qty").focus();return}
    const serviceError=row.querySelector(".service-error");
    serviceError.textContent=services.length?"":"Pilih minimal satu layanan untuk sepatu ini.";
    const shoeValid=setFieldError(shoeInput,shoeName?"":"Nama sepatu wajib diisi.");
    if(!services.length||!shoeValid){(shoeValid?row.querySelector(".service-search"):shoeInput).focus();return}
    services.forEach(service=>items.push({
      service_id:service.id,
      service_name:service.name,
      shoe_name:shoeName,
      brand:row.querySelector(".item-brand").value.trim()||null,
      color:row.querySelector(".item-color").value.trim()||null,
      material:row.querySelector(".item-material").value.trim()||null,
      condition_notes:row.querySelector(".item-condition").value.trim()||null,
      quantity,
      unit_price:Number(service.price),
      subtotal:quantity*Number(service.price)
    }));
  }
  const total=items.reduce((sum,item)=>sum+item.subtotal,0);
  const paidInput=$("paidAmount"),paid=Number(paidInput.value||0);
  const paymentError=!Number.isFinite(paid)||paid<0?"Nominal pembayaran tidak boleh negatif.":paid>total?`Pembayaran melebihi total. Maksimum ${rupiah(total)}.`:"";
  if(!setFieldError(paidInput,paymentError)){paidInput.focus();return}
  const orderCode=`ALT-${new Date().toISOString().slice(0,10).replaceAll("-","")}-${crypto.randomUUID().slice(0,8).toUpperCase()}`;
  const order={
    invoice_number:orderCode,
    order_code:orderCode,
    customer_name:customer,
    phone,
    notes:$("orderNotes").value.trim(),
    status:"baru",
    payment_method:$("paymentMethod").value,
    paid_amount:paid,
    payment_amount:paid,
    payment_status:paid>=total?"LUNAS":"BELUM LUNAS",
    total,
    created_by:state.session.user.id
  };
  const {data,error}=await sb.from("orders").insert(order).select().single();
  if(error)return toast(explainError(error),true);
  const {error:itemError}=await sb.from("order_items").insert(items.map(item=>({...item,order_id:data.id})));
  if(itemError){
    await sb.from("orders").delete().eq("id",data.id);
    return toast(explainError(itemError),true);
  }
  $("orderModal").classList.add("hidden");
  toast("Pesanan berhasil dibuat.");
  await loadData();
}
async function nextStatus(id){const o=state.orders.find(x=>x.id===id);if(!o)return;const idx=STATUS.findIndex(x=>x[0]===o.status),next=STATUS[idx+1];if(!next)return;const {error}=await sb.from("orders").update({status:next[0],completed_at:next[0]==="selesai"?new Date().toISOString():null}).eq("id",id);if(error)toast(explainError(error),true);else loadData()}
function openService(id=null){$("serviceForm").reset();$("serviceId").value="";$("serviceActive").checked=true;$("serviceModalTitle").textContent="Layanan baru";if(id){const s=state.services.find(x=>x.id===id);$("serviceModalTitle").textContent="Edit layanan";$("serviceId").value=s.id;$("serviceName").value=s.name;$("servicePrice").value=s.price;$("serviceActive").checked=s.active}$("serviceModal").classList.remove("hidden")}
async function saveService(e){e.preventDefault();const name=$("serviceName").value.trim(),rawPrice=$("servicePrice").value,price=Number(rawPrice);if(name.length<2||name.length>100)return toast("Nama layanan harus berisi 2-100 karakter.",true);if(rawPrice===""||!Number.isFinite(price)||price<0)return toast("Harga harus berupa angka nol atau lebih.",true);const id=$("serviceId").value,payload={name,price,active:$("serviceActive").checked};const q=id?sb.from("services").update(payload).eq("id",id):sb.from("services").insert(payload);const {error}=await q;if(error)return toast(explainError(error),true);$("serviceModal").classList.add("hidden");toast("Layanan disimpan.");await loadData()}

document.addEventListener("click",async e=>{
  const pv=e.target.closest("[data-page]");if(pv)navigate(pv.dataset.page);
  const av=e.target.closest("[data-auth-view]");if(av)showAuth(av.dataset.authView);
  const tp=e.target.closest("[data-toggle-password]");if(tp){const i=$(tp.dataset.togglePassword);i.type=i.type==="password"?"text":"password";tp.textContent=i.type==="password"?"Lihat":"Sembunyi"}
  const close=e.target.closest("[data-close]");if(close)$(close.dataset.close).classList.add("hidden");
  const ns=e.target.closest("[data-next]");if(ns)nextStatus(ns.dataset.next);
  const es=e.target.closest("[data-edit-service]");if(es)openService(es.dataset.editService);
  const pe=e.target.closest("[data-edit-payment]");if(pe)openPaymentEdit(pe.dataset.editPayment);
  const st=e.target.closest("[data-staff-toggle]");if(st){const active=st.dataset.active!=="true";if(confirm(`${active?"Aktifkan":"Nonaktifkan"} akun kasir ini?`))await setCashierActive(st.dataset.staffToggle,active)}
});
$("loginForm").onsubmit=login;$("registerForm").onsubmit=register;$("forgotForm").onsubmit=forgot;$("resetForm").onsubmit=resetPassword;
$("profileForm").onsubmit=saveProfile;$("passwordForm").onsubmit=changePassword;$("inviteForm").onsubmit=inviteCashier;
$("paymentEditForm").onsubmit=savePaymentEdit;
$("logoutBtn").onclick=logout;
$("newOrderBtn").onclick=openOrder;$("addItemBtn").onclick=addOrderItem;$("orderForm").onsubmit=saveOrder;$("newServiceBtn").onclick=()=>openService();$("serviceForm").onsubmit=saveService;
$("orderSearch").oninput=renderOrders;$("orderStatusFilter").onchange=renderOrders;$("customerSearch").oninput=renderCustomers;
$("inviteCashierBtn").onclick=()=>{$("inviteForm").reset();$("inviteModal").classList.remove("hidden")};
$("staffSearch").oninput=renderStaff;$("staffStatusFilter").onchange=renderStaff;
$("orderPhone").oninput=e=>{e.target.value=e.target.value.replace(/\D/g,"");setFieldError(e.target,/^\d{10,14}$/.test(e.target.value)?"":"Nomor telepon harus 10-14 digit.")};
$("registerPhone").oninput=e=>{e.target.value=e.target.value.replace(/\D/g,"");validateRegistrationField(e.target)};
$("registerPhone").onblur=e=>validateRegistrationField(e.target);
$("orderPhone").onblur=e=>setFieldError(e.target,/^\d{10,14}$/.test(e.target.value)?"":"Nomor telepon harus 10-14 digit.");
$("orderCustomer").oninput=e=>setFieldError(e.target,e.target.value.trim()?"":"Nama pelanggan wajib diisi.");
$("paidAmount").oninput=updateOrderTotal;
$("registerName").addEventListener("input",e=>validateRegistrationField(e.target));
$("registerName").addEventListener("blur",e=>validateRegistrationField(e.target));
$("registerEmail").addEventListener("input",e=>validateRegistrationField(e.target));
$("registerEmail").addEventListener("blur",e=>validateRegistrationField(e.target));
$("registerPassword").addEventListener("input",e=>validateRegistrationField(e.target));
$("registerPassword").addEventListener("blur",e=>validateRegistrationField(e.target));
$("registerConfirm").addEventListener("input",e=>validateRegistrationField(e.target));
$("registerConfirm").addEventListener("blur",e=>validateRegistrationField(e.target));
$("profilePhone").oninput=e=>e.target.value=e.target.value.replace(/\D/g,"").slice(0,14);
$("invitePhone").oninput=e=>e.target.value=e.target.value.replace(/\D/g,"").slice(0,14);
$("reportDateFrom").onchange=renderReports;$("reportDateTo").onchange=renderReports;
$("clearReportDates").onclick=()=>{$("reportDateFrom").value="";$("reportDateTo").value="";renderReports()};
authBoot();
