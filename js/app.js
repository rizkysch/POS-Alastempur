const cfg = window.APP_CONFIG || {};
const hasConfig = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && cfg.supabaseUrl.startsWith("https://") && !cfg.supabaseUrl.includes("YOUR_") && !cfg.supabaseAnonKey.includes("YOUR_"));
const sb = hasConfig && window.supabase ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
}) : null;

const STATUS = [
  ["baru","Baru"],["diproses","Diproses"],["dicuci","Dicuci"],["dikeringkan","Dikeringkan"],
  ["quality_check","Quality Check"],["siap_diambil","Siap Diambil"],["selesai","Selesai"]
];
let state = {session:null, profile:null, orders:[], services:[], currentPage:"dashboard", realtime:null};

const $ = id => document.getElementById(id);
const rupiah = n => new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(Number(n||0));
const esc = s => String(s ?? "").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
function toast(msg, bad=false){const t=$("toast");t.textContent=msg;t.style.background=bad?"#7b2626":"#111";t.classList.add("show");clearTimeout(window._toast);window._toast=setTimeout(()=>t.classList.remove("show"),3500)}
function diag(msg){const d=$("authDiagnostics");d.classList.remove("hidden");d.innerHTML=esc(msg).replace(/\n/g,"<br>")}
function showAuth(view){document.querySelectorAll(".auth-view").forEach(x=>x.classList.add("hidden"));$(view).classList.remove("hidden");$("authDiagnostics").classList.add("hidden")}
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
  const {data,error}=await sb.auth.getSession();
  if(error){diag(explainError(error));return}
  await handleSession(data.session);
  sb.auth.onAuthStateChange(async (_event,session)=>{ await handleSession(session); });
  if(new URLSearchParams(location.search).get("reset-password")==="true" || location.hash.includes("type=recovery")) showAuth("resetView");
}
async function handleSession(session){
  state.session=session;
  if(session){
    $("authScreen").classList.add("hidden");$("appScreen").classList.remove("hidden");
    await loadProfile();
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
  else state.profile=data||{full_name:state.session.user.user_metadata?.full_name||state.session.user.email,role:"kasir"};
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
function setConnection(ok){$("connectionDot").style.background=ok?"#222":"#b33";$("connectionText").textContent=ok?"Supabase terhubung":"Supabase error"}
function subscribeRealtime(){
  if(state.realtime) sb.removeChannel(state.realtime);
  state.realtime=sb.channel("alastempur-orders").on("postgres_changes",{event:"*",schema:"public",table:"orders"},()=>loadData()).on("postgres_changes",{event:"*",schema:"public",table:"order_items"},()=>loadData()).subscribe();
}

async function login(e){e.preventDefault();$("authDiagnostics").classList.add("hidden");if(!sb)return diag("Supabase belum dikonfigurasi.");const email=$("loginEmail").value.trim(),password=$("loginPassword").value;const {error}=await sb.auth.signInWithPassword({email,password});if(error){diag(explainError(error));return}toast("Berhasil masuk")}
async function register(e){e.preventDefault();const name=$("registerName").value.trim(),phone=$("registerPhone").value.trim(),email=$("registerEmail").value.trim(),password=$("registerPassword").value,confirm=$("registerConfirm").value;if(!validatePhone(phone))return diag("Nomor telepon harus angka saja dan 10–14 digit.");if(password!==confirm)return diag("Konfirmasi password tidak sama.");if(password.length<8)return diag("Password minimal 8 karakter.");const {data,error}=await sb.auth.signUp({email,password,options:{data:{full_name:name,phone},emailRedirectTo:location.origin+"/"}});if(error){diag(explainError(error));return}if(data.session)toast("Akun berhasil dibuat dan sudah masuk.");else {showAuth("loginView");diag("Akun berhasil dibuat. Jika Confirm email aktif, buka email konfirmasi terlebih dahulu lalu login.")}}
async function forgot(e){e.preventDefault();const email=$("forgotEmail").value.trim();const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:location.origin+"/?reset-password=true"});if(error){diag(explainError(error));return}toast("Link reset password dikirim. Periksa email Anda.")}
async function resetPassword(e){e.preventDefault();const p=$("resetPassword").value,c=$("resetConfirm").value;if(p.length<8)return diag("Password minimal 8 karakter.");if(p!==c)return diag("Konfirmasi password tidak sama.");const {error}=await sb.auth.updateUser({password:p});if(error){diag(explainError(error));return}history.replaceState({},document.title,location.pathname);toast("Password berhasil diubah.");showAuth("loginView");await sb.auth.signOut()}

function navigate(page){state.currentPage=page;document.querySelectorAll(".page").forEach(x=>x.classList.add("hidden"));$("page-"+page).classList.remove("hidden");document.querySelectorAll(".nav-item").forEach(x=>x.classList.toggle("active",x.dataset.page===page));const titles={dashboard:"Dashboard",orders:"Pesanan",kanban:"Kanban",customers:"Pelanggan",services:"Layanan",payments:"Pembayaran",reports:"Laporan"};$("pageTitle").textContent=titles[page];$("pageEyebrow").textContent=page==="dashboard"?"OVERVIEW":page.toUpperCase();renderAll()}
function renderAll(){renderDashboard();renderOrders();renderKanban();renderCustomers();renderServices();renderPayments();renderReports();fillStatusFilter()}
function renderDashboard(){const active=state.orders.filter(o=>o.status!=="selesai").length,ready=state.orders.filter(o=>o.status==="siap_diambil").length,revenue=state.orders.reduce((a,o)=>a+Number(o.paid_amount||0),0),customers=new Set(state.orders.map(o=>o.phone)).size;$("statActive").textContent=active;$("statReady").textContent=ready;$("statRevenue").textContent=rupiah(revenue);$("statCustomers").textContent=customers;$("recentOrders").innerHTML=state.orders.slice(0,8).map(o=>`<tr><td><strong>${esc(o.order_code)}</strong></td><td>${esc(o.customer_name)}</td><td>${(o.order_items||[]).map(i=>esc(i.service_name)).join(", ")||"-"}</td><td><span class="status ${o.status==="selesai"?"done":o.status==="siap_diambil"?"ready":""}">${statusLabel(o.status)}</span></td><td>${rupiah(o.total)}</td></tr>`).join("")||`<tr><td colspan="5" class="empty">Belum ada pesanan.</td></tr>`}
function renderOrders(){const q=($("orderSearch")?.value||"").toLowerCase(),f=$("orderStatusFilter")?.value||"";const list=state.orders.filter(o=>(!q||`${o.order_code} ${o.customer_name} ${o.phone}`.toLowerCase().includes(q))&&(!f||o.status===f));$("ordersTable").innerHTML=list.map(o=>`<tr><td><strong>${esc(o.order_code)}</strong></td><td>${esc(o.customer_name)}</td><td>${esc(o.phone)}</td><td><span class="status">${statusLabel(o.status)}</span></td><td>${paymentStatus(o)}</td><td>${rupiah(o.total)}</td><td><button class="mini-btn" data-next="${o.id}">Lanjut</button></td></tr>`).join("")||`<tr><td colspan="7" class="empty">Tidak ada data.</td></tr>`}
function renderKanban(){const board=$("kanbanBoard");board.innerHTML=STATUS.map(([key,label])=>{const items=state.orders.filter(o=>o.status===key);return `<div class="kanban-col"><div class="kanban-head"><span>${label}</span><span>${items.length}</span></div><div class="kanban-cards">${items.map(o=>{const idx=STATUS.findIndex(x=>x[0]===o.status),next=STATUS[idx+1]?.[0];return `<div class="k-card"><strong>${esc(o.order_code)}</strong><p>${esc(o.customer_name)} · ${rupiah(o.total)}</p><p>${(o.order_items||[]).map(i=>esc(i.service_name)).join(", ")}</p>${next?`<div class="k-actions"><button class="mini-btn" data-next="${o.id}">→ ${statusLabel(next)}</button></div>`:""}</div>`}).join("")||`<div class="empty">Kosong</div>`}</div></div>`}).join("")}
function renderCustomers(){const q=($("customerSearch")?.value||"").toLowerCase();const map=new Map();state.orders.forEach(o=>{const k=o.phone;if(!map.has(k))map.set(k,{name:o.customer_name,phone:k,count:0,total:0});const c=map.get(k);c.count++;c.total+=Number(o.total||0)});const list=[...map.values()].filter(c=>`${c.name} ${c.phone}`.toLowerCase().includes(q));$("customersTable").innerHTML=list.map(c=>`<tr><td>${esc(c.name)}</td><td>${esc(c.phone)}</td><td>${c.count}</td><td>${rupiah(c.total)}</td></tr>`).join("")||`<tr><td colspan="4" class="empty">Belum ada pelanggan.</td></tr>`}
function renderServices(){$("servicesTable").innerHTML=state.services.map(s=>`<tr><td>${esc(s.name)}</td><td>${rupiah(s.price)}</td><td>${s.active?"Aktif":"Nonaktif"}</td><td><button class="mini-btn" data-edit-service="${s.id}">Edit</button></td></tr>`).join("")||`<tr><td colspan="4" class="empty">Belum ada layanan.</td></tr>`}
function renderPayments(){const total=state.orders.reduce((a,o)=>a+Number(o.total||0),0),paid=state.orders.reduce((a,o)=>a+Number(o.paid_amount||0),0);$("paymentCount").textContent=state.orders.length;$("paymentTotal").textContent=rupiah(total);$("paymentPaid").textContent=rupiah(paid);$("paymentDue").textContent=rupiah(total-paid);$("paymentsTable").innerHTML=state.orders.map(o=>`<tr><td>${esc(o.order_code)}</td><td>${esc(o.customer_name)}</td><td>${rupiah(o.total)}</td><td>${rupiah(o.paid_amount)}</td><td>${rupiah(Math.max(0,Number(o.total)-Number(o.paid_amount)))}</td><td>${paymentStatus(o)}</td></tr>`).join("")}
function renderReports(){const total=state.orders.reduce((a,o)=>a+Number(o.total||0),0),done=state.orders.filter(o=>o.status==="selesai").length,active=state.orders.length-done;$("reportRevenue").textContent=rupiah(state.orders.reduce((a,o)=>a+Number(o.paid_amount||0),0));$("reportDone").textContent=done;$("reportAverage").textContent=rupiah(state.orders.length?total/state.orders.length:0);$("reportActive").textContent=active;const counts={};state.orders.forEach(o=>counts[o.status]=(counts[o.status]||0)+1);$("reportStatus").innerHTML=STATUS.map(([k,l])=>`<div class="bar-row"><span>${l}</span><div class="bar"><i style="width:${state.orders.length?(counts[k]||0)/state.orders.length*100:0}%"></i></div><strong>${counts[k]||0}</strong></div>`).join("")}
function fillStatusFilter(){const s=$("orderStatusFilter");if(s.options.length>1)return;STATUS.forEach(([k,l])=>s.add(new Option(l,k)))}
function serviceOptions(){return `<option value="">Pilih layanan</option>${state.services.filter(s=>s.active).map(s=>`<option value="${s.id}" data-price="${s.price}">${esc(s.name)} — ${rupiah(s.price)}</option>`).join("")}`}
function addOrderItem(){const wrap=$("orderItems");if(wrap.children.length>=5)return toast("Maksimal 5 layanan per pesanan.",true);const row=document.createElement("div");row.className="order-item";row.innerHTML=`<label>Layanan<select class="item-service" required>${serviceOptions()}</select></label><label>Qty<input class="item-qty" type="number" min="1" value="1" required></label><label>Subtotal<input class="item-subtotal" readonly value="Rp0"></label><button type="button" class="remove">×</button>`;wrap.appendChild(row);row.querySelector(".remove").onclick=()=>{row.remove();updateOrderTotal()};row.querySelector(".item-service").onchange=updateOrderTotal;row.querySelector(".item-qty").oninput=updateOrderTotal;updateOrderTotal()}
function updateOrderTotal(){let total=0;document.querySelectorAll(".order-item").forEach(r=>{const s=r.querySelector(".item-service"),q=Math.max(1,Number(r.querySelector(".item-qty").value||1)),price=Number(s.selectedOptions[0]?.dataset.price||0);r.querySelector(".item-subtotal").value=rupiah(price*q);total+=price*q});$("orderTotal").textContent=rupiah(total);$("paidAmount").max=total}
function openOrder(){if(!state.services.filter(s=>s.active).length)return toast("Tambahkan minimal satu layanan aktif terlebih dahulu.",true);$("orderForm").reset();$("orderItems").innerHTML="";$("paidAmount").value=0;addOrderItem();$("orderModal").classList.remove("hidden")}
async function saveOrder(e){e.preventDefault();const phone=$("orderPhone").value.trim();if(!validatePhone(phone))return toast("Nomor telepon harus angka saja dan 10–14 digit.",true);const rows=[...document.querySelectorAll(".order-item")];if(rows.length<1||rows.length>5)return toast("Pesanan harus memiliki 1–5 layanan.",true);const items=rows.map(r=>{const s=r.querySelector(".item-service"),svc=state.services.find(x=>x.id===s.value),qty=Math.max(1,Number(r.querySelector(".item-qty").value||1));return {service_id:svc.id,service_name:svc.name,quantity:qty,unit_price:Number(svc.price),subtotal:qty*Number(svc.price)}});const total=items.reduce((a,i)=>a+i.subtotal,0),paid=Math.max(0,Number($("paidAmount").value||0));if(paid>total)return toast("Nominal pembayaran tidak boleh melebihi total.",true);const order={order_code:`ALT-${new Date().toISOString().slice(0,10).replaceAll("-","")}-${Math.random().toString(36).slice(2,6).toUpperCase()}`,customer_name:$("orderCustomer").value.trim(),phone,notes:$("orderNotes").value.trim(),status:"baru",payment_method:$("paymentMethod").value,paid_amount:paid,total,created_by:state.session.user.id};const {data,error}=await sb.from("orders").insert(order).select().single();if(error)return toast(explainError(error),true);const {error:ie}=await sb.from("order_items").insert(items.map(i=>({...i,order_id:data.id})));if(ie){await sb.from("orders").delete().eq("id",data.id);return toast(explainError(ie),true)}$("orderModal").classList.add("hidden");toast("Pesanan berhasil dibuat.");await loadData()}
async function nextStatus(id){const o=state.orders.find(x=>x.id===id);if(!o)return;const idx=STATUS.findIndex(x=>x[0]===o.status),next=STATUS[idx+1];if(!next)return;const {error}=await sb.from("orders").update({status:next[0],completed_at:next[0]==="selesai"?new Date().toISOString():null}).eq("id",id);if(error)toast(explainError(error),true);else loadData()}
function openService(id=null){$("serviceForm").reset();$("serviceId").value="";$("serviceActive").checked=true;$("serviceModalTitle").textContent="Layanan baru";if(id){const s=state.services.find(x=>x.id===id);$("serviceModalTitle").textContent="Edit layanan";$("serviceId").value=s.id;$("serviceName").value=s.name;$("servicePrice").value=s.price;$("serviceActive").checked=s.active}$("serviceModal").classList.remove("hidden")}
async function saveService(e){e.preventDefault();const id=$("serviceId").value,payload={name:$("serviceName").value.trim(),price:Number($("servicePrice").value||0),active:$("serviceActive").checked};const q=id?sb.from("services").update(payload).eq("id",id):sb.from("services").insert(payload);const {error}=await q;if(error)return toast(explainError(error),true);$("serviceModal").classList.add("hidden");toast("Layanan disimpan.");await loadData()}

document.addEventListener("click",async e=>{
  const pv=e.target.closest("[data-page]");if(pv)navigate(pv.dataset.page);
  const av=e.target.closest("[data-auth-view]");if(av)showAuth(av.dataset.authView);
  const tp=e.target.closest("[data-toggle-password]");if(tp){const i=$(tp.dataset.togglePassword);i.type=i.type==="password"?"text":"password";tp.textContent=i.type==="password"?"Lihat":"Sembunyi"}
  const close=e.target.closest("[data-close]");if(close)$(close.dataset.close).classList.add("hidden");
  const ns=e.target.closest("[data-next]");if(ns)nextStatus(ns.dataset.next);
  const es=e.target.closest("[data-edit-service]");if(es)openService(es.dataset.editService);
});
$("loginForm").onsubmit=login;$("registerForm").onsubmit=register;$("forgotForm").onsubmit=forgot;$("resetForm").onsubmit=resetPassword;
$("logoutBtn").onclick=async()=>{await sb.auth.signOut();toast("Anda telah keluar.")};
$("newOrderBtn").onclick=openOrder;$("addItemBtn").onclick=addOrderItem;$("orderForm").onsubmit=saveOrder;$("newServiceBtn").onclick=()=>openService();$("serviceForm").onsubmit=saveService;
$("orderSearch").oninput=renderOrders;$("orderStatusFilter").onchange=renderOrders;$("customerSearch").oninput=renderCustomers;
$("orderPhone").oninput=e=>e.target.value=e.target.value.replace(/\D/g,"").slice(0,14);
$("registerPhone").oninput=e=>e.target.value=e.target.value.replace(/\D/g,"").slice(0,14);
authBoot();
