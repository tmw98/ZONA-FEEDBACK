// ==============================
// FEEDBACK ZONE — CONFIGURATION
// ==============================
// Firebase web configuration is public client configuration, not a service-account secret.
// NEVER place a Firebase service-account JSON/private key in this file or repository.

export const firebaseConfig = {
  apiKey: "AIzaSyCpPf8RGuwt8sOi6PG2tWBz4pTqM5yhWeM",
  authDomain: "zona-feedback.firebaseapp.com",
  projectId: "zona-feedback",
  storageBucket: "zona-feedback.firebasestorage.app",
  messagingSenderId: "956862249905",
  appId: "1:956862249905:web:3e74b263ffc7bad7eb1b90",
  measurementId: "G-WT0FGCW73W"
};

export const APP_CONFIG = {
  appName: "Feedback Zone",
  defaultPeriodId: "periode-1",
  maxCommentLength: 1500,
  autosaveDrafts: false,
  classes: [
    { id: "x-umum-1", label: "X Umum 1" },
    { id: "x-umum-2", label: "X Umum 2" },
    { id: "xi-stek-1", label: "XI STEK 1" },
    { id: "xi-stek-2", label: "XI STEK 2" },
    { id: "xi-shum-1", label: "XI SHUM 1" },
    { id: "xi-shum-2", label: "XI SHUM 2" },
    { id: "xii-minat-a", label: "XII MINAT A" },
    { id: "xii-minat-b1", label: "XII MINAT B1" },
    { id: "xii-minat-b2", label: "XII MINAT B2" }
  ]
};
