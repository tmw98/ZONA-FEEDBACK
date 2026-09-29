import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  getDocs,
  getDoc,
  doc,
  query,
  where
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { firebaseConfig } from "./config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });
auth.languageCode = "id";

const state = { user: null, periods: [], classes: [], teachers: [], questions: [], responses: [], activePeriodId: "", classFilter: "all" };
const $ = id => document.getElementById(id);

function show(id) {
  ["adminLoading", "adminLogin", "adminDenied", "dashboardView"].forEach(x => $(x)?.classList.toggle("hidden", x !== id));
}
function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function avg(nums) { const a = nums.filter(n => Number.isFinite(n)); return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; }
function fmt(n) { return n == null ? "—" : n.toFixed(2); }
function dateText(ts) { if (!ts) return ""; const d = typeof ts.toDate === "function" ? ts.toDate() : new Date(ts); return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(d); }

async function signIn() {
  try { await signInWithRedirect(auth, provider); }
  catch (e) { console.error(e); $("adminLoginError").textContent = "Login gagal. Silakan coba lagi."; $("adminLoginError").classList.remove("hidden"); }
}

async function isAdmin(user) {
  const snap = await getDoc(doc(db, "admins", user.uid));
  return snap.exists() && snap.data()?.active === true;
}

async function loadDashboardData() {
  const periodsSnap = await getDocs(collection(db, "periods"));
  state.periods = periodsSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => String(b.id).localeCompare(String(a.id)));
  const classesSnap = await getDocs(query(collection(db, "classes"), where("active", "==", true)));
  state.classes = classesSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.sort ?? 999) - (b.sort ?? 999));
  $("classFilter").innerHTML = `<option value="all">Semua kelas</option>` + state.classes.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.label || c.id)}</option>`).join("");

  const teachersSnap = await getDocs(query(collection(db, "teachers"), where("active", "==", true)));
  state.teachers = teachersSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.sort ?? 999) - (b.sort ?? 999));
  const questionsSnap = await getDocs(query(collection(db, "questions"), where("active", "==", true)));
  state.questions = questionsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const appSnap = await getDoc(doc(db, "settings", "app"));
  state.activePeriodId = appSnap.exists() ? appSnap.data()?.activePeriodId : state.periods[0]?.id;
  $("periodSelect").innerHTML = state.periods.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.title || p.id)}</option>`).join("");
  if (state.activePeriodId) $("periodSelect").value = state.activePeriodId;
  await loadResponses(state.activePeriodId);
}

async function loadResponses(periodId) {
  state.activePeriodId = periodId;
  // Firestore collectionGroup lets the dashboard read response documents across all student paths.
  const { collectionGroup } = await import("https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js");
  const responseSnap = await getDocs(query(collectionGroup(db, "responses"), where("periodId", "==", periodId)));
  state.responses = responseSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderDashboard();
}

function filteredResponses() {
  return state.responses.filter(r => state.classFilter === "all" || r.classId === state.classFilter);
}

function renderDashboard() {
  const visibleResponses = filteredResponses();
  const teaching = visibleResponses.filter(r => r.relationship === "teaching");
  $("kpiTotal").textContent = visibleResponses.length.toLocaleString("id-ID");
  $("kpiTeachers").textContent = new Set(visibleResponses.map(r => r.teacherId)).size.toLocaleString("id-ID");
  $("kpiTeaching").textContent = teaching.length.toLocaleString("id-ID");

  const allRatings = teaching.flatMap(r => Object.values(r.ratings || {}).map(Number));
  $("kpiAverage").textContent = avg(allRatings) == null ? "—" : fmt(avg(allRatings));

  const summaries = state.teachers.map(t => {
    const rows = visibleResponses.filter(r => r.teacherId === t.id);
    const teachRows = rows.filter(r => r.relationship === "teaching");
    const ratings = teachRows.flatMap(r => Object.values(r.ratings || {}).map(Number));
    return { teacher: t, total: rows.length, teaching: teachRows.length, average: avg(ratings) };
  }).filter(x => x.total > 0 || x.teacher.active).sort((a, b) => b.total - a.total || (a.teacher.sort ?? 999) - (b.teacher.sort ?? 999));

  $("teacherSummaryBody").innerHTML = summaries.map(s => `<tr><td><strong>${escapeHtml(s.teacher.name)}</strong></td><td>${escapeHtml(s.teacher.subject || "")}</td><td>${s.total}</td><td>${s.teaching}</td><td><span class="score-pill">${fmt(s.average)}</span></td></tr>`).join("") || `<tr><td colspan="5">Belum ada respons pada periode ini.</td></tr>`;

  const dimensions = new Map();
  state.questions.filter(q => q.teachingOnly !== false && q.kind !== "nonTeaching" && q.kind !== "essay").forEach(q => {
    const values = teaching.map(r => Number(r.ratings?.[q.id])).filter(Number.isFinite);
    dimensions.set(q.dimension || q.short || q.prompt, avg(values));
  });
  const max = 5;
  $("dimensionBars").innerHTML = [...dimensions.entries()].map(([label, value]) => `<div class="bar-row"><div><span>${escapeHtml(label)}</span><b>${fmt(value)}</b></div><div class="bar-track"><span style="width:${value == null ? 0 : (value / max) * 100}%"></span></div></div>`).join("") || `<p class="muted">Belum ada skor numerik.</p>`;

  const teacherFilter = $("commentTeacherFilter");
  const currentValue = teacherFilter.value || "all";
  teacherFilter.innerHTML = `<option value="all">Semua guru</option>` + state.teachers.map(t => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`).join("");
  if ([...teacherFilter.options].some(o => o.value === currentValue)) teacherFilter.value = currentValue;
  renderComments();
}

function renderComments() {
  const teacherId = $("commentTeacherFilter").value;
  const type = $("commentTypeFilter").value;
  let rows = filteredResponses().filter(r => teacherId === "all" || r.teacherId === teacherId).filter(r => type === "all" || r.relationship === type);
  rows.sort((a, b) => {
    const da = a.createdAt?.toMillis?.() || 0; const dbv = b.createdAt?.toMillis?.() || 0; return dbv - da;
  });
  const teacherById = new Map(state.teachers.map(t => [t.id, t]));
  const essayQs = state.questions.filter(q => q.kind === "essay").sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  const comments = [];
  rows.forEach(r => {
    const t = teacherById.get(r.teacherId) || { name: r.teacherNameSnapshot || "Guru", subject: r.subjectSnapshot || "" };
    if (r.relationship === "teaching") {
      essayQs.forEach(q => {
        const text = r.essays?.[q.id];
        if (text) comments.push({ type: q.tag || "other", label: q.short || "Feedback", teacher: t, text, date: r.createdAt });
      });
    } else if (r.feedback) comments.push({ type: "other", label: "Feedback", teacher: t, text: r.feedback, date: r.createdAt });
  });
  $("commentList").innerHTML = comments.slice(0, 100).map(c => `<article class="comment-card"><div class="comment-top"><strong>${escapeHtml(c.teacher.name)}</strong><span>${escapeHtml(c.teacher.subject || "")} · ${dateText(c.date)}</span></div><span class="comment-tag ${c.type}">${escapeHtml(c.label)}</span><p>${escapeHtml(c.text)}</p></article>`).join("") || `<div class="empty-inline">Belum ada feedback tertulis sesuai filter.</div>`;
}

function exportCsv() {
  const teacherById = new Map(state.teachers.map(t => [t.id, t]));
  const byOrder = (a, b) => (a.order ?? 999) - (b.order ?? 999);
  const ratingQs = state.questions.filter(q => q.teachingOnly !== false && q.kind !== "nonTeaching" && q.kind !== "essay").sort(byOrder);
  const essayQs = state.questions.filter(q => q.kind === "essay").sort(byOrder);
  const headers = ["Periode", "Tanggal", "Kelas", "Guru", "Mata Pelajaran", "Relasi", "Konteks", ...ratingQs.map(q => q.short || q.dimension || q.id), ...essayQs.map(q => q.short || q.id), "Feedback_Guru_Tidak_Mengajar"];
  const rows = filteredResponses().map(r => {
    const t = teacherById.get(r.teacherId) || {};
    return [state.activePeriodId, dateText(r.createdAt), r.classLabelSnapshot || r.classId || "", r.teacherNameSnapshot || t.name || "", r.subjectSnapshot || t.subject || "", r.relationship, r.context || "", ...ratingQs.map(q => r.ratings?.[q.id] ?? ""), ...essayQs.map(q => r.essays?.[q.id] || ""), r.feedback || ""];
  });
  // Awalan ' mencegah teks siswa yang diawali = + - @ dieksekusi sebagai rumus di Excel/Sheets.
  const cell = v => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s.replaceAll('"', '""')}"`; };
  const csv = [headers, ...rows].map(row => row.map(cell).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.href = url; link.download = `feedback-zone-${state.activePeriodId}.csv`; link.click(); URL.revokeObjectURL(url);
}

$("adminLoginBtn").addEventListener("click", signIn);
$("adminSignoutBtn").addEventListener("click", () => signOut(auth));
$("adminDeniedSignout").addEventListener("click", () => signOut(auth));
$("periodSelect").addEventListener("change", e => loadResponses(e.target.value).catch(err => { console.error(err); $("dashboardError").textContent = "Periode tidak dapat dimuat."; $("dashboardError").classList.remove("hidden"); }));
$("commentTeacherFilter").addEventListener("change", renderComments);
$("commentTypeFilter").addEventListener("change", renderComments);
$("classFilter").addEventListener("change", e => { state.classFilter = e.target.value; renderDashboard(); });
$("exportCsvBtn").addEventListener("click", exportCsv);

(async () => {
  try { await getRedirectResult(auth); } catch (e) { console.error(e); }
  onAuthStateChanged(auth, async user => {
    if (!user) { show("adminLogin"); return; }
    $("adminEmail").textContent = "Akun admin terverifikasi";
    try {
      if (!(await isAdmin(user))) { show("adminDenied"); return; }
      await loadDashboardData();
      show("dashboardView");
    } catch (error) {
      console.error(error);
      $("dashboardError").textContent = "Dashboard belum dapat memuat data. Periksa Firestore Rules dan indeks/query.";
      $("dashboardError").classList.remove("hidden");
      show("dashboardView");
    }
  });
})();
