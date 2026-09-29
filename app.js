import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
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
  where,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { firebaseConfig, APP_CONFIG } from "./config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
auth.languageCode = "id";

const STORAGE = {
  email: "feedbackZone.pendingEmail",
  classId: "feedbackZone.pendingClassId"
};

const state = {
  user: null,
  studentClass: null,
  appSettings: null,
  period: null,
  teachers: [],
  questions: [],
  selectedTeachers: new Map(),
  submitted: new Set(),
  currentIndex: 0,
  filter: "all",
  search: "",
  activeTeacher: null,
  responsesSaved: 0,
  nonTeachingContext: null
};

const $ = (id) => document.getElementById(id);
const views = ["loadingView", "startView", "blockedView", "closedView", "selectionView", "feedbackView", "completeView"];

function showView(id) { views.forEach(v => $(v)?.classList.toggle("hidden", v !== id)); }
function showAlert(id, message) { const el = $(id); if (!el) return; el.textContent = message; el.classList.remove("hidden"); }
function hideAlert(id) { $(id)?.classList.add("hidden"); }
function initials(name = "") { return name.trim().split(/\s+/).slice(0, 2).map(x => x[0]?.toUpperCase() || "").join("") || "G"; }
function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function normalise(value = "") { return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
function validEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim()); }
function toast(message) { const el = $("toast"); el.textContent = message; el.classList.remove("hidden"); window.clearTimeout(toast.timer); toast.timer = window.setTimeout(() => el.classList.add("hidden"), 3200); }

function configuredClasses() {
  return Array.isArray(APP_CONFIG.classes) ? APP_CONFIG.classes : [];
}

function renderClassOptions(selected = "") {
  const items = configuredClasses();
  const select = $("classSelect");
  select.innerHTML = `<option value="">Pilih kelas…</option>` + items.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.label)}</option>`).join("");
  if (selected) select.value = selected;
}

function selectedClassConfig() {
  const id = $("classSelect").value;
  return configuredClasses().find(c => c.id === id) || null;
}

function updateStartButton() {
  const ready = Boolean($("classSelect").value && validEmail($("emailInput").value) && $("privacyConsent").checked);
  $("sendLinkBtn").disabled = !ready;
}

async function startSession() {
  hideAlert("startError");
  const classInfo = selectedClassConfig();
  const email = $("emailInput").value.trim().toLowerCase();
  if (!classInfo) return showAlert("startError", "Pilih kelas terlebih dahulu.");
  if (!validEmail(email)) return showAlert("startError", "Masukkan alamat email yang valid.");
  if (!$("privacyConsent").checked) return showAlert("startError", "Centang persetujuan penggunaan feedback terlebih dahulu.");

  try {
    $("sendLinkBtn").disabled = true;
    $("sendLinkBtn").innerHTML = "Memproses…";
    localStorage.setItem(STORAGE.email, email);
    localStorage.setItem(STORAGE.classId, classInfo.id);
    if (auth.currentUser) await bootstrapForUser(auth.currentUser);
    else await signInAnonymously(auth); // onAuthStateChanged akan memanggil bootstrapForUser
  } catch (error) {
    console.error(error);
    showAlert("startError", mapAuthError(error));
  } finally {
    updateStartButton();
    $("sendLinkBtn").innerHTML = "Mulai <span>→</span>";
  }
}

function mapAuthError(error) {
  const code = error?.code || "";
  const messages = {
    "auth/operation-not-allowed": "Login anonim belum diaktifkan di Firebase (Authentication → Sign-in method → Anonymous).",
    "auth/admin-restricted-operation": "Login anonim belum diaktifkan di Firebase (Authentication → Sign-in method → Anonymous).",
    "auth/network-request-failed": "Koneksi internet bermasalah. Coba lagi.",
    "auth/too-many-requests": "Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi."
  };
  return messages[code] || "Tidak dapat memulai sesi. Coba lagi.";
}

async function loadClassesFromFirestore() {
  // Config supplies the first screen's choices; Firestore is the source of truth after authentication.
  const snap = await getDocs(query(collection(db, "classes"), where("active", "==", true)));
  const classes = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.sort ?? 999) - (b.sort ?? 999));
  const chosenId = localStorage.getItem(STORAGE.classId);
  state.studentClass = classes.find(c => c.id === chosenId) || null;
  if (!state.studentClass) {
    showView("startView");
    renderClassOptions(chosenId || "");
    showAlert("startError", "Pilih kelas Anda kembali. Kelas diperlukan untuk analisis hasil.");
    return false;
  }
  return true;
}

async function loadBaseData() {
  const appDoc = await getDoc(doc(db, "settings", "app"));
  state.appSettings = appDoc.exists() ? appDoc.data() : {};
  const periodId = state.appSettings.activePeriodId || APP_CONFIG.defaultPeriodId;
  const periodDoc = await getDoc(doc(db, "periods", periodId));
  state.period = periodDoc.exists() ? { id: periodId, ...periodDoc.data() } : { id: periodId, active: true, title: periodId };

  const teacherSnap = await getDocs(query(collection(db, "teachers"), where("active", "==", true)));
  state.teachers = teacherSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.sort ?? 999) - (b.sort ?? 999));

  const questionSnap = await getDocs(query(collection(db, "questions"), where("active", "==", true)));
  state.questions = questionSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
}

async function loadSubmitted() {
  state.submitted.clear();
  const ref = collection(db, "users", state.user.uid, "responses");
  const snap = await getDocs(query(ref, where("periodId", "==", state.period.id)));
  snap.docs.forEach(d => state.submitted.add(d.id));
}

function teacherResponseId(teacherId) { return `${state.period.id}__${teacherId}`.replace(/[^A-Za-z0-9_-]/g, "_"); }

function renderTeachers() {
  const term = normalise(state.search);
  const list = state.teachers.filter(t => {
    const hay = normalise(`${t.name || ""} ${t.subject || ""} ${t.group || ""}`);
    const searchOk = !term || hay.includes(term);
    const relationship = state.selectedTeachers.get(t.id);
    const done = state.submitted.has(teacherResponseId(t.id));
    let filterOk = true;
    if (state.filter === "teaching") filterOk = relationship === "teaching";
    if (state.filter === "not_teaching") filterOk = relationship === "not_teaching";
    if (state.filter === "done") filterOk = done;
    return searchOk && filterOk;
  });

  $("teacherGrid").innerHTML = list.map(t => {
    const relationship = state.selectedTeachers.get(t.id);
    const done = state.submitted.has(teacherResponseId(t.id));
    const selected = Boolean(relationship);
    return `<article class="teacher-card ${selected ? "selected" : ""} ${done ? "done" : ""}" data-teacher-id="${escapeHtml(t.id)}">
      <div class="teacher-card-top"><div class="teacher-mini-avatar">${escapeHtml(initials(t.name))}</div><div class="teacher-meta"><strong>${escapeHtml(t.name)}</strong><span>${escapeHtml(t.subject || "Guru")}</span>${t.group ? `<small>${escapeHtml(t.group)}</small>` : ""}</div>${done ? `<span class="done-pill">✓ Selesai</span>` : ""}</div>
      <div class="relationship-actions" role="group" aria-label="Hubungan dengan guru ${escapeHtml(t.name)}">
        <button class="rel-btn ${relationship === "teaching" ? "active" : ""}" data-rel="teaching" ${done ? "disabled" : ""}>Saya diajar</button>
        <button class="rel-btn ${relationship === "not_teaching" ? "active" : ""}" data-rel="not_teaching" ${done ? "disabled" : ""}>Tidak mengajar saya</button>
      </div>
      ${!done && selected ? `<button class="clear-selection" data-clear="1">Hapus pilihan</button>` : ""}
    </article>`;
  }).join("");
  $("teacherEmpty").classList.toggle("hidden", list.length > 0);
  updateSelectionSummary();
}

function updateSelectionSummary() {
  const available = [...state.selectedTeachers.entries()].filter(([id]) => !state.submitted.has(teacherResponseId(id)));
  const count = available.length;
  $("selectedCount").textContent = `${count} guru dipilih`;
  $("selectedHint").textContent = count ? "Setiap guru akan dievaluasi satu per satu." : "Pilih minimal satu guru untuk melanjutkan.";
  $("startFeedbackBtn").disabled = count === 0;
}

function attachTeacherEvents() {
  $("teacherGrid").addEventListener("click", (event) => {
    const card = event.target.closest(".teacher-card");
    if (!card) return;
    const teacherId = card.dataset.teacherId;
    if (event.target.closest("[data-clear]")) { state.selectedTeachers.delete(teacherId); renderTeachers(); return; }
    const relButton = event.target.closest("[data-rel]");
    if (!relButton || relButton.disabled) return;
    state.selectedTeachers.set(teacherId, relButton.dataset.rel);
    renderTeachers();
  });
  document.querySelectorAll(".filter-pill").forEach(btn => btn.addEventListener("click", () => {
    document.querySelectorAll(".filter-pill").forEach(x => x.classList.remove("active"));
    btn.classList.add("active"); state.filter = btn.dataset.filter; renderTeachers();
  }));
  $("teacherSearch").addEventListener("input", (e) => { state.search = e.target.value; renderTeachers(); });
}

function selectedQueue() {
  return [...state.selectedTeachers.entries()]
    .filter(([id]) => !state.submitted.has(teacherResponseId(id)))
    .map(([id, relationship]) => ({ teacher: state.teachers.find(t => t.id === id), relationship }))
    .filter(x => x.teacher);
}

function ratingQuestions() { return state.questions.filter(q => q.kind !== "nonTeaching" && q.kind !== "essay" && q.teachingOnly !== false); }
function essayQuestions() { return state.questions.filter(q => q.kind === "essay"); }

function renderQuestions() {
  const teachingQuestions = ratingQuestions();
  $("teachingQuestions").innerHTML = teachingQuestions.map((q, index) => {
    const labels = ["Sangat tidak sesuai", "Tidak sesuai", "Cukup", "Sesuai", "Sangat sesuai"];
    const options = labels.map((label, i) => `<label class="scale-option"><input type="radio" name="q_${escapeHtml(q.id)}" value="${i + 1}" /><span><b>${i + 1}</b><small>${label}</small></span></label>`).join("");
    return `<div class="question-card"><div class="question-number">${String(index + 1).padStart(2, "0")}</div><div class="question-content"><p>${escapeHtml(q.prompt)}</p><div class="scale-grid">${options}</div></div></div>`;
  }).join("");
  $("teachingEssays").innerHTML = essayQuestions().map(q => `<label class="textarea-card full"><span>${escapeHtml(q.prompt)}</span><textarea data-essay-id="${escapeHtml(q.id)}" maxlength="1000" placeholder="Tulis jawabanmu di sini."></textarea><small>Opsional • maks. 1.000 karakter</small></label>`).join("");
}

function openFeedback() { if (!selectedQueue().length) return; state.currentIndex = 0; showFeedbackItem(); }

function clearCurrentForm() {
  document.querySelectorAll("input[type=radio]").forEach(x => x.checked = false);
  document.querySelectorAll("#teachingEssays textarea").forEach(x => { x.value = ""; });
  if ($("nonTeachingFeedback")) $("nonTeachingFeedback").value = "";
  document.querySelectorAll(".choice-card").forEach(x => x.classList.remove("active"));
  state.nonTeachingContext = null; hideAlert("formError");
}

function showFeedbackItem() {
  const queue = selectedQueue();
  if (!queue.length || state.currentIndex >= queue.length) return finishFlow();
  const { teacher, relationship } = queue[state.currentIndex];
  state.activeTeacher = teacher; clearCurrentForm();
  $("activeTeacherName").textContent = teacher.name;
  $("activeTeacherSubject").textContent = teacher.subject || "Guru";
  $("activeTeacherAvatar").textContent = initials(teacher.name);
  $("relationshipLabel").textContent = relationship === "teaching" ? "GURU YANG MENGAJAR ANDA" : "GURU YANG TIDAK MENGAJAR ANDA";
  $("teachingForm").classList.toggle("hidden", relationship !== "teaching");
  $("nonTeachingForm").classList.toggle("hidden", relationship !== "not_teaching");
  const pct = Math.round((state.currentIndex / queue.length) * 100);
  $("feedbackProgressText").textContent = `${state.currentIndex + 1}/${queue.length}`;
  $("feedbackPercent").textContent = `${Math.max(0, pct)}%`;
  $("feedbackProgressBar").style.width = `${Math.max(6, pct)}%`;
  $("submitTeacherBtn").textContent = state.currentIndex === queue.length - 1 ? "Kirim & selesai ✓" : "Kirim feedback →";
  showView("feedbackView"); window.scrollTo({ top: 0, behavior: "smooth" });
}

function collectTeachingPayload() {
  const teachingQuestions = ratingQuestions();
  const ratings = {};
  for (const q of teachingQuestions) {
    const chosen = document.querySelector(`input[name="q_${CSS.escape(q.id)}"]:checked`);
    if (!chosen) return { error: `Mohon jawab pernyataan nomor ${teachingQuestions.indexOf(q) + 1}.` };
    ratings[q.id] = Number(chosen.value);
  }
  const essays = {};
  document.querySelectorAll("#teachingEssays textarea").forEach(t => { const v = t.value.trim(); if (v) essays[t.dataset.essayId] = v; });
  return { ratings, essays };
}

async function submitCurrentTeacher() {
  const queue = selectedQueue(); const current = queue[state.currentIndex]; if (!current) return;
  hideAlert("formError");
  const relationship = current.relationship;
  const payload = relationship === "teaching" ? collectTeachingPayload() : { context: state.nonTeachingContext, feedback: $("nonTeachingFeedback").value.trim() };
  if (payload.error) { showAlert("formError", payload.error); return; }
  if (relationship === "not_teaching" && !payload.context && !payload.feedback) { showAlert("formError", "Pilih konteks interaksi atau tuliskan feedback terlebih dahulu."); return; }
  if (!state.studentClass?.id) { showAlert("formError", "Kelas belum terdeteksi. Silakan kembali ke tahap awal."); return; }

  const btn = $("submitTeacherBtn"); btn.disabled = true; btn.innerHTML = "Menyimpan…";
  try {
    const id = teacherResponseId(current.teacher.id);
    const responseRef = doc(db, "users", state.user.uid, "responses", id);
    const base = {
      periodId: state.period.id,
      periodTitle: state.period.title || state.period.id,
      classId: state.studentClass.id,
      classLabelSnapshot: state.studentClass.label || state.studentClass.name || state.studentClass.id,
      teacherId: current.teacher.id,
      teacherNameSnapshot: current.teacher.name,
      subjectSnapshot: current.teacher.subject || "",
      relationship,
      createdAt: serverTimestamp()
    };
    const data = relationship === "teaching"
      ? { ...base, ratings: payload.ratings, essays: payload.essays }
      : { ...base, context: payload.context || "", feedback: payload.feedback };

    await setDoc(responseRef, data, { merge: false });
    state.submitted.add(id); state.responsesSaved += 1;
    const remaining = selectedQueue().length;
    if (remaining > 0) { state.currentIndex = 0; showView("selectionView"); renderTeachers(); toast("Feedback tersimpan. Silakan lanjutkan guru lainnya."); }
    else finishFlow();
  } catch (error) {
    console.error(error);
    showAlert("formError", "Feedback belum tersimpan. Periksa koneksi internet lalu coba lagi.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Kirim feedback →";
  }
}

function finishFlow() {
  const total = state.submitted.size;
  $("completedNumber").textContent = total;
  $("remainingNumber").textContent = 0;
  $("continueFeedbackBtn").classList.add("hidden");
  $("completeMessage").textContent = `Terima kasih. ${total} feedback sudah tersimpan untuk ${state.studentClass?.label || "kelas Anda"} pada ${state.period?.title || state.period?.id || "periode aktif"}.`;
  showView("completeView");
}

function attachFeedbackEvents() {
  $("startFeedbackBtn").addEventListener("click", openFeedback);
  $("submitTeacherBtn").addEventListener("click", submitCurrentTeacher);
  $("continueFeedbackBtn").addEventListener("click", () => { if (selectedQueue().length) openFeedback(); else finishFlow(); });
  $("backToSelectionBtn").addEventListener("click", () => showView("selectionView"));
  document.querySelectorAll("#nonTeachingContext .choice-card").forEach(btn => btn.addEventListener("click", () => { document.querySelectorAll("#nonTeachingContext .choice-card").forEach(x => x.classList.remove("active")); btn.classList.add("active"); state.nonTeachingContext = btn.dataset.value; }));
}

async function bootstrapForUser(user) {
  state.user = user;
  try {
    if (!(await loadClassesFromFirestore())) return;
    await loadBaseData();
    if (state.appSettings.maintenance === true || state.period.active === false) { $("closedMessage").textContent = state.appSettings.closedMessage || "Periode feedback sedang tidak dibuka."; showView("closedView"); return; }
    await loadSubmitted();
    $("teacherCount").textContent = state.teachers.length;
    renderQuestions(); renderTeachers();
    $("sessionBadge").textContent = `Masuk • ${state.studentClass.label || state.studentClass.id}`;
    $("sessionBadge").classList.remove("hidden");
    showView("selectionView");
  } catch (error) {
    console.error(error);
    showView("blockedView");
    $("blockedMessage").textContent = "Data Feedback Zone belum dapat dimuat. Periksa konfigurasi Firebase, collection kelas, dan aturan database.";
  }
}

function resetStartForm() {
  localStorage.removeItem(STORAGE.email); localStorage.removeItem(STORAGE.classId);
  $("emailInput").value = ""; $("privacyConsent").checked = false; renderClassOptions(); updateStartButton(); hideAlert("startError"); showView("startView");
}

function bindStartEvents() {
  $("classSelect").addEventListener("change", updateStartButton);
  $("emailInput").addEventListener("input", updateStartButton);
  $("privacyConsent").addEventListener("change", updateStartButton);
  $("sendLinkBtn").addEventListener("click", startSession);
  $("blockedBackBtn").addEventListener("click", resetStartForm);
  $("closedSignoutBtn").addEventListener("click", () => signOut(auth));
  $("completeSignoutBtn").addEventListener("click", () => signOut(auth));
}

(async () => {
  showView("loadingView");
  renderClassOptions(localStorage.getItem(STORAGE.classId) || "");
  bindStartEvents(); attachTeacherEvents(); attachFeedbackEvents();

  onAuthStateChanged(auth, async (user) => {
    if (!user) { $("sessionBadge").classList.add("hidden"); showView("startView"); return; }
    await bootstrapForUser(user);
  });
})();
