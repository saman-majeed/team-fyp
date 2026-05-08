import { useState, useEffect, useRef } from "react";
import { db, storage } from "./firebase/config";
import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  getDoc,
  query,
  where,
  getDocs,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";

// ─── DB HELPERS ───────────────────────────────────────────────────────────────
async function dbSet(col, id, data) {
  await setDoc(doc(db, col, id), { ...data, updatedAt: serverTimestamp() });
  return { id, ...data };
}

async function dbGet(col, id) {
  const snap = await getDoc(doc(db, col, id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

async function dbQuery(col, field, value) {
  const q = query(collection(db, col), where(field, "==", value));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ─── GROQ AI QUESTION GENERATOR ───────────────────────────────────────────────
export async function generateQuestion(role, difficulty, skills, previousQuestions = []) {
  const prompt = `Generate a single multiple-choice question for a ${role} candidate...`;
  const topic = skills?.[0] || role || "General Aptitude";
  const asked = new Set(
    (previousQuestions || [])
      .map((q) => (q?.question || "").trim().toLowerCase())
      .filter(Boolean)
  );

  const fallbackBank = {
    easy: [
      {
        question: `(${difficulty.toUpperCase()}) What is the primary goal of ${topic} in software projects?`,
        options: [
          "Improve reliability and maintainability of solutions.",
          "Avoid planning and only focus on coding speed.",
          "Remove the need for testing completely.",
          "Guarantee no bugs can ever happen.",
        ],
        correctIndex: 0,
      },
      {
        question: `(${difficulty.toUpperCase()}) Which practice is most important when starting with ${topic}?`,
        options: [
          "Understand fundamentals before using advanced tools.",
          "Skip basics and copy production code immediately.",
          "Ignore documentation to save time.",
          "Avoid code reviews during implementation.",
        ],
        correctIndex: 0,
      },
      {
        question: `(${difficulty.toUpperCase()}) In ${topic}, what usually leads to better long-term code quality?`,
        options: [
          "Clear structure, readability, and iterative improvement.",
          "Large files with repeated logic everywhere.",
          "No naming conventions across the project.",
          "Frequent hotfixes without root-cause analysis.",
        ],
        correctIndex: 0,
      },
    ],
    medium: [
      {
        question: `(${difficulty.toUpperCase()}) Which approach best scales ${topic} across a growing codebase?`,
        options: [
          "Modular design with reusable components and tests.",
          "Centralize all logic in one massive file.",
          "Duplicate code for each new feature.",
          "Avoid refactoring to prevent any change risk.",
        ],
        correctIndex: 0,
      },
      {
        question: `(${difficulty.toUpperCase()}) What is the strongest indicator that ${topic} implementation needs refactoring?`,
        options: [
          "Frequent regressions and difficult onboarding for teammates.",
          "Stable behavior with good test coverage.",
          "Consistent coding conventions in pull requests.",
          "Predictable release cycle outcomes.",
        ],
        correctIndex: 0,
      },
      {
        question: `(${difficulty.toUpperCase()}) For ${topic}, which trade-off is usually best in production systems?`,
        options: [
          "Balance performance, readability, and maintainability.",
          "Optimize only micro-benchmarks and ignore clarity.",
          "Use clever code over understandable code.",
          "Ship without monitoring and iterate later.",
        ],
        correctIndex: 0,
      },
    ],
    hard: [
      {
        question: `(${difficulty.toUpperCase()}) During high-scale usage, what is the best strategy for hardening ${topic}?`,
        options: [
          "Measure bottlenecks, validate assumptions, and optimize targeted paths.",
          "Apply broad optimizations without profiling data.",
          "Disable observability to reduce overhead.",
          "Increase complexity before validating correctness.",
        ],
        correctIndex: 0,
      },
      {
        question: `(${difficulty.toUpperCase()}) Which decision most improves resilience in ${topic} architecture?`,
        options: [
          "Design for graceful failure and clear rollback paths.",
          "Treat all failures as edge cases and ignore retries.",
          "Depend on manual fixes during incidents.",
          "Bundle unrelated responsibilities into single services.",
        ],
        correctIndex: 0,
      },
      {
        question: `(${difficulty.toUpperCase()}) What is the most mature way to validate complex ${topic} changes?`,
        options: [
          "Use staged rollout, monitoring, and fast rollback controls.",
          "Deploy globally without canary checks.",
          "Skip tests if local checks pass once.",
          "Rely only on customer reports for validation.",
        ],
        correctIndex: 0,
      },
    ],
  };

  const level = fallbackBank[difficulty] ? difficulty : "easy";
  const candidates = fallbackBank[level].filter(
    (q) => !asked.has((q.question || "").trim().toLowerCase())
  );
  const pool = candidates.length ? candidates : fallbackBank[level];
  const fallbackQuestion = { topic, ...pool[Math.floor(Math.random() * pool.length)] };

  const randomizeCorrectOption = (q) => {
    if (!q || !Array.isArray(q.options) || !Number.isInteger(q.correctIndex)) return q;
    const indexed = q.options.map((opt, idx) => ({ opt, idx }));
    for (let i = indexed.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [indexed[i], indexed[j]] = [indexed[j], indexed[i]];
    }
    return {
      ...q,
      options: indexed.map((x) => x.opt),
      correctIndex: indexed.findIndex((x) => x.idx === q.correctIndex),
    };
  };

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${import.meta.env.VITE_GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama3-70b-8192",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      throw new Error(`Groq API failed with status ${response.status}`);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return randomizeCorrectOption(fallbackQuestion);

    const parsed = JSON.parse(match[0]);
    if (
      !parsed ||
      typeof parsed.question !== "string" ||
      !Array.isArray(parsed.options) ||
      !Number.isInteger(parsed.correctIndex)
    ) {
      return randomizeCorrectOption(fallbackQuestion);
    }
    return randomizeCorrectOption(parsed);
  } catch (error) {
    console.error("AI Generation Error:", error);
    return randomizeCorrectOption(fallbackQuestion);
  }
}

// ─── UTILITIES ────────────────────────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2, 10).toUpperCase();
const nowISO = () => new Date().toISOString();

// ─── COLOR PALETTE ────────────────────────────────────────────────────────────
const C = {
  bg: "#0D0F14",
  surface: "#161921",
  border: "#1E2330",
  accent: "#4F7EFF",
  accentDim: "#1E2F5E",
  text: "#E8EAF0",
  muted: "#6B7280",
  success: "#22D3A5",
  warning: "#F5A623",
  danger: "#FF5B5B",
  purple: "#9B72FF",
};

const S = {
  app: { minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'DM Sans', sans-serif" },
  card: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "1.5rem" },
  btn: (variant = "primary", size = "md") => ({
    padding: size === "sm" ? "6px 14px" : "10px 20px",
    borderRadius: 8,
    border: variant === "ghost" ? `1px solid ${C.border}` : "none",
    cursor: "pointer",
    fontWeight: 600,
    fontSize: size === "sm" ? 13 : 14,
    background: variant === "primary" ? C.accent : variant === "success" ? C.success : variant === "danger" ? C.danger : "transparent",
    color: variant === "ghost" ? C.muted : "#fff",
  }),
  input: { background: "#0D0F14", border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px", color: C.text, width: "100%", outline: "none", boxSizing: "border-box" },
  badge: (color) => ({ padding: "2px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600, background: color === "success" ? "#0D2E26" : color === "warning" ? "#2A1F0A" : "#1A2040", color: color === "success" ? C.success : color === "warning" ? C.warning : C.accent }),
};

// ─── SHARED UI PRIMITIVES ─────────────────────────────────────────────────────
function Tag({ color = "warning", children }) {
  return <span style={S.badge(color)}>{children}</span>;
}

function Stat({ label, value, color = C.accent }) {
  return (
    <div style={{ ...S.card, minWidth: 170, flex: 1 }}>
      <div style={{ fontSize: 28, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 12, color: C.muted }}>{label}</div>
    </div>
  );
}

function Modal({ open, onClose, title, children }) {
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
        zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ ...S.card, width: "100%", maxWidth: 620, maxHeight: "85vh", overflowY: "auto" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <h3 style={{ margin: 0, fontSize: 18 }}>{title}</h3>
          <button onClick={onClose} style={{ ...S.btn("ghost", "sm"), padding: "4px 10px" }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <div
      style={{
        width: 30,
        height: 30,
        borderRadius: "50%",
        border: `3px solid ${C.border}`,
        borderTopColor: C.accent,
        animation: "spin 1s linear infinite",
      }}
    >
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─── AUTH HOOK ────────────────────────────────────────────────────────────────
function useAuth() {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem("rp_user")); }
    catch { return null; }
  });

  const signIn = async (id, pass, role = "admin") => {
    console.log(`Attempting login for: ${id} as ${role}`);

    if (role === "admin") {
      // Logic for Admin login
      const adminDoc = await dbGet("admins", id.trim());
      console.log("Firestore Admin Data found:", adminDoc);

      // Check against the field names found in your Firestore screenshot
      if (adminDoc && adminDoc.role === "admin") {
        // Checking if password field is 'admin' or 'password'
        const correctPass = adminDoc.admin || adminDoc.password;

        if (correctPass === pass) {
          const u = { uid: id, name: adminDoc.email || "Admin", role: "admin" };
          sessionStorage.setItem("rp_user", JSON.stringify(u));
          setUser(u);
          return { ok: true };
        }
      }
      return { ok: false, error: "Invalid admin credentials. Check Firestore fields." };
    } else {
      // Logic for Candidate login
      const cands = await dbQuery("candidates", "candidateId", id.trim());
      const cand = cands.find((c) => c.password === pass);
      if (cand) {
        const u = { uid: cand.id, name: cand.name, role: "candidate", testId: cand.testId, ...cand };
        sessionStorage.setItem("rp_user", JSON.stringify(u));
        setUser(u);
        return { ok: true, user: u };
      }
      return { ok: false, error: "Invalid Candidate ID or Password" };
    }
  };

  const signOut = () => {
    sessionStorage.removeItem("rp_user");
    setUser(null);
  };

  return { user, signIn, signOut };
}

// ─── LOGIN SCREEN ─────────────────────────────────────────────────────────────
function LoginScreen({ onLogin, defaultRole = "admin" }) {
  const [id, setId] = useState("");
  const [pass, setPass] = useState("");
  const [role, setRole] = useState(defaultRole);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { signIn } = useAuth();

  const handleSubmit = async () => {
    if (!id || !pass) return setError("Please fill all fields");
    setLoading(true);
    setError("");
    try {
      const res = await signIn(id, pass, role);
      if (res.ok) onLogin(res);
      else setError(res.error);
    } catch (err) {
      setError("Database connection error");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ ...S.app, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: 420, padding: "1rem" }}>
        <div style={{ textAlign: "center", marginBottom: "2.5rem" }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: C.accentDim, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 1rem", fontSize: 24 }}>🎯</div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>HireAI</h1>
          <p style={{ margin: "4px 0 0", color: C.muted, fontSize: 14 }}>AI-Powered Recruitment</p>
        </div>

        <div style={S.card}>
          <div style={{ display: "flex", background: C.bg, borderRadius: 8, padding: 4, marginBottom: "1.25rem" }}>
            {["admin", "candidate"].map((r) => (
              <button key={r} onClick={() => { setRole(r); setError(""); }} style={{ flex: 1, padding: "8px 0", border: "none", cursor: "pointer", borderRadius: 6, fontWeight: 600, fontSize: 13, background: role === r ? C.accent : "transparent", color: role === r ? "#fff" : C.muted }}>
                {r === "admin" ? "Admin" : "Candidate"}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <input style={S.input} placeholder={role === "admin" ? "Username (admin@gmail.com)" : "Candidate ID"} value={id} onChange={(e) => setId(e.target.value)} />
            <input style={S.input} type="password" placeholder="Password" value={pass} onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSubmit()} />
            {error && <div style={{ color: C.danger, fontSize: 13, textAlign: "center" }}>{error}</div>}
            <button onClick={handleSubmit} disabled={loading} style={{ ...S.btn("primary"), width: "100%", opacity: loading ? 0.7 : 1 }}>
              {loading ? "Verifying..." : "Sign In"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


// Note: Ensure the rest of your sub-components (AdminPanel, etc.) 
// are pasted below this if they were in the same file.
// ─── ADMIN PANEL SHELL ────────────────────────────────────────────────────────
function AdminPanel({ user, onSignOut }) {
  const [view, setView] = useState("dashboard");
  const [tests, setTests] = useState([]);
  const [results, setResults] = useState([]);
  const [loadError, setLoadError] = useState("");

  // Load tests and results from Firestore with realtime updates
  useEffect(() => {
    const unsubTests = onSnapshot(
      collection(db, "tests"),
      (snap) => {
        setTests(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoadError("");
      },
      (err) => {
        console.error("Failed to load tests:", err);
        setLoadError("Unable to load tests/results from Firestore. Check rules/auth configuration.");
      }
    );

    const unsubResults = onSnapshot(
      collection(db, "results"),
      (snap) => {
        setResults(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      (err) => {
        console.error("Failed to load results:", err);
        setLoadError("Unable to load tests/results from Firestore. Check rules/auth configuration.");
      }
    );

    return () => {
      unsubTests();
      unsubResults();
    };
  }, []);

  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: "📊" },
    { id: "create", label: "Create Test", icon: "➕" },
    { id: "tests", label: "Manage Tests", icon: "📋" },
    { id: "monitor", label: "Live Monitor", icon: "👁️" },
    { id: "results", label: "Results", icon: "🏆" },
  ];

  return (
    <div style={{ ...S.app, display: "flex" }}>
      {/* Sidebar */}
      <div style={{
        width: 220, background: C.surface, borderRight: `1px solid ${C.border}`,
        display: "flex", flexDirection: "column", padding: "1.5rem 0",
        position: "fixed", top: 0, left: 0, bottom: 0, zIndex: 10,
      }}>
        <div style={{ padding: "0 1.25rem 1.5rem", borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 2 }}>🎯 HireAI</div>
          <div style={{ fontSize: 12, color: C.muted }}>Admin Panel</div>
        </div>
        <nav style={{ flex: 1, padding: "1rem 0" }}>
          {navItems.map((n) => (
            <button key={n.id} onClick={() => setView(n.id)} style={{
              display: "flex", alignItems: "center", gap: 10,
              width: "100%", padding: "10px 1.25rem", border: "none", cursor: "pointer",
              background: view === n.id ? C.accentDim : "transparent",
              color: view === n.id ? C.accent : C.muted,
              fontSize: 14, fontWeight: view === n.id ? 600 : 400, textAlign: "left",
              borderLeft: view === n.id ? `3px solid ${C.accent}` : "3px solid transparent",
              transition: "all 0.15s",
            }}>
              <span>{n.icon}</span> {n.label}
            </button>
          ))}
        </nav>
        <div style={{ padding: "1rem 1.25rem", borderTop: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{user.name}</div>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>Administrator</div>
          <button onClick={onSignOut} style={{ ...S.btn("ghost", "sm"), width: "100%" }}>Sign Out</button>
        </div>
      </div>

      {/* Main Content */}
      <div style={{ marginLeft: 220, flex: 1, padding: "2rem", overflowY: "auto" }}>
        {loadError && (
          <div style={{ ...S.card, border: `1px solid ${C.warning}`, marginBottom: "1rem" }}>
            <div style={{ color: C.warning, fontSize: 13 }}>{loadError}</div>
          </div>
        )}
        {view === "dashboard" && <AdminDashboard tests={tests} results={results} setView={setView} />}
        {view === "create" && <CreateTest onCreated={() => setView("tests")} />}
        {view === "tests" && <ManageTests tests={tests} setTests={setTests} />}
        {view === "monitor" && <LiveMonitor />}
        {view === "results" && <ResultsView results={results} />}
      </div>
    </div>
  );
}

// ─── ADMIN DASHBOARD ──────────────────────────────────────────────────────────
function AdminDashboard({ tests, results, setView }) {
  const activeTests = tests.filter((t) => t.status === "active").length;
  const avgScore = results.length
    ? Math.round(results.reduce((a, r) => a + (r.score || 0), 0) / results.length) + "%"
    : "—";

  return (
    <div>
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>Dashboard</h1>
        <p style={{ margin: "4px 0 0", color: C.muted }}>Overview of recruitment assessments</p>
      </div>

      <div style={{ display: "flex", gap: 16, marginBottom: "2rem", flexWrap: "wrap" }}>
        <Stat label="Total Tests" value={tests.length} color={C.accent} />
        <Stat label="Active Tests" value={activeTests} color={C.success} />
        <Stat label="Completed" value={results.length} color={C.purple} />
        <Stat label="Avg Score" value={avgScore} color={C.warning} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={S.card}>
          <h3 style={{ margin: "0 0 1rem", fontSize: 16, fontWeight: 600 }}>Recent Tests</h3>
          {tests.length === 0 ? (
            <div style={{ color: C.muted, fontSize: 14 }}>No tests created yet.</div>
          ) : (
            tests.slice(-5).reverse().map((t) => (
              <div key={t.id} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "10px 0", borderBottom: `1px solid ${C.border}`,
              }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{t.position}</div>
                  <div style={{ fontSize: 12, color: C.muted }}>{t.numQuestions} questions · {t.duration} min</div>
                </div>
                <Tag color={t.status === "active" ? "success" : "warning"}>{t.status || "draft"}</Tag>
              </div>
            ))
          )}
          <button onClick={() => setView("create")} style={{ ...S.btn("primary", "sm"), marginTop: "1rem" }}>
            + Create New Test
          </button>
        </div>

        <div style={S.card}>
          <h3 style={{ margin: "0 0 1rem", fontSize: 16, fontWeight: 600 }}>Quick Actions</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[
              { label: "Create New Assessment", icon: "➕", action: () => setView("create") },
              { label: "View Live Monitor", icon: "👁️", action: () => setView("monitor") },
              { label: "Browse Results", icon: "📈", action: () => setView("results") },
              { label: "Manage Tests", icon: "⚙️", action: () => setView("tests") },
            ].map((a) => (
              <button key={a.label} onClick={a.action} style={{
                ...S.btn("ghost"),
                display: "flex", alignItems: "center", gap: 10, textAlign: "left", width: "100%",
              }}>
                <span>{a.icon}</span> {a.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function LabelInput({ label, value, onChange, placeholder }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 13, color: C.muted, marginBottom: 6 }}>{label}</label>
      <input style={S.input} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

// ─── CREATE TEST ──────────────────────────────────────────────────────────────
function CreateTest({ onCreated }) {
  const [form, setForm] = useState({
    position: "", numQuestions: 10, duration: 30,
    skills: "", candidateName: "", expiryHours: 24,
  });
  const [generated, setGenerated] = useState(null);
  const [loading, setLoading] = useState(false);

  const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleCreate = async () => {
    if (!form.position) return alert("Please enter a position name");
    setLoading(true);
    try {
      const testId = "T" + uid();
      const candidateId = "C" + uid();
      const password = uid().toLowerCase();
      const link = `${window.location.origin}?test=${testId}&cid=${candidateId}`;

      const testData = {
        ...form,
        skills: form.skills.split(",").map((s) => s.trim()).filter(Boolean),
        testId,
        candidateId,
        password,
        link,
        status: "active",
        createdAt: nowISO(),
        expiresAt: new Date(Date.now() + form.expiryHours * 3600000).toISOString(),
      };

      await dbSet("tests", testId, testData);
      await dbSet("candidates", candidateId, {
        candidateId,
        password,
        testId,
        name: form.candidateName || "Candidate",
        status: "pending",
        createdAt: nowISO(),
      });

      setGenerated({ testId, candidateId, password, link });
    } catch (err) {
      console.error("Failed to create test:", err);
      alert("Could not create test in Firestore. Please check Firestore rules/auth.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h1 style={{ margin: "0 0 0.5rem", fontSize: 26, fontWeight: 700 }}>Create Assessment</h1>
      <p style={{ margin: "0 0 2rem", color: C.muted }}>Configure a new recruitment test</p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        {/* Left column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={S.card}>
            <h3 style={{ margin: "0 0 1.25rem", fontSize: 16 }}>Test Details</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <LabelInput label="Position / Role *" value={form.position} onChange={(v) => setF("position", v)} placeholder="e.g. Senior Frontend Developer" />
              <LabelInput label="Candidate Name (Optional)" value={form.candidateName} onChange={(v) => setF("candidateName", v)} placeholder="e.g. John Smith" />
              <LabelInput label="Skills / Topics (comma-separated)" value={form.skills} onChange={(v) => setF("skills", v)} placeholder="React, TypeScript, CSS" />
            </div>
          </div>

          <div style={S.card}>
            <h3 style={{ margin: "0 0 1.25rem", fontSize: 16 }}>Test Configuration</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {[
                { label: "Number of Questions", key: "numQuestions", min: 5, max: 30, step: 1, suffix: "" },
                { label: "Duration (minutes)", key: "duration", min: 10, max: 120, step: 5, suffix: " min" },
                { label: "Link Expiry (hours)", key: "expiryHours", min: 1, max: 168, step: 1, suffix: "h" },
              ].map(({ label, key, min, max, step, suffix }) => (
                <div key={key}>
                  <label style={{ display: "block", fontSize: 13, color: C.muted, marginBottom: 6 }}>
                    {label}: <strong style={{ color: C.text }}>{form[key]}{suffix}</strong>
                  </label>
                  <input
                    type="range" min={min} max={max} step={step} value={form[key]}
                    onChange={(e) => setF(key, +e.target.value)}
                    style={{ width: "100%", accentColor: C.accent }}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right column */}
        <div>
          <div style={S.card}>
            <h3 style={{ margin: "0 0 1rem", fontSize: 16 }}>Adaptive Difficulty System</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                { label: "Questions 1–3", level: "Easy", color: "success", desc: "All candidates start here" },
                { label: "Correct streak (×3)", level: "Medium", color: "warning", desc: "Unlocked after 3 correct answers" },
                { label: "Perfect performance", level: "Hard", color: "danger", desc: "Unlocked after passing Medium" },
                { label: "Wrong answers", level: "Drops", color: "purple", desc: "Difficulty decreases on failure" },
              ].map((r) => (
                <div key={r.label} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "10px 12px", background: C.bg, borderRadius: 8,
                }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{r.label}</div>
                    <div style={{ fontSize: 12, color: C.muted }}>{r.desc}</div>
                  </div>
                  <Tag color={r.color}>{r.level}</Tag>
                </div>
              ))}
            </div>
          </div>

          {generated ? (
            <div style={{ ...S.card, marginTop: 16, border: `1px solid ${C.success}` }}>
              <h3 style={{ margin: "0 0 1rem", fontSize: 16, color: C.success }}>✅ Test Created!</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[
                  { label: "Test ID", value: generated.testId },
                  { label: "Candidate ID", value: generated.candidateId },
                  { label: "Password", value: generated.password },
                  { label: "Test Link", value: generated.link },
                ].map((f) => (
                  <div key={f.label} style={{ background: C.bg, padding: "10px 12px", borderRadius: 8 }}>
                    <div style={{ fontSize: 11, color: C.muted, marginBottom: 3 }}>{f.label}</div>
                    <div style={{ fontSize: 13, fontFamily: "monospace", color: C.accent, wordBreak: "break-all" }}>{f.value}</div>
                  </div>
                ))}
                <button
                  onClick={() => navigator.clipboard.writeText(
                    `ID: ${generated.candidateId}\nPassword: ${generated.password}\nLink: ${generated.link}`
                  )}
                  style={S.btn("ghost", "sm")}
                >
                  📋 Copy Credentials
                </button>
                <button onClick={onCreated} style={S.btn("primary", "sm")}>View All Tests →</button>
              </div>
            </div>
          ) : (
            <button
              onClick={handleCreate}
              disabled={loading}
              style={{ ...S.btn("primary"), width: "100%", marginTop: 16, padding: "14px", fontSize: 15, fontWeight: 700 }}
            >
              {loading ? "Generating..." : "🚀 Generate Test + Credentials"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── MANAGE TESTS ─────────────────────────────────────────────────────────────
function ManageTests({ tests, setTests }) {
  const [selected, setSelected] = useState(null);

  const deleteTest = async (id) => {
    if (!window.confirm("Delete this test? This cannot be undone.")) return;
    // Delete from Firestore
    const { deleteDoc } = await import("firebase/firestore");
    await deleteDoc(doc(db, "tests", id));
    setTests((t) => t.filter((x) => x.id !== id));
  };

  return (
    <div>
      <h1 style={{ margin: "0 0 0.5rem", fontSize: 26, fontWeight: 700 }}>Manage Tests</h1>
      <p style={{ margin: "0 0 2rem", color: C.muted }}>{tests.length} tests total</p>

      {tests.length === 0 ? (
        <div style={{ ...S.card, textAlign: "center", padding: "3rem" }}>
          <div style={{ fontSize: 48, marginBottom: "1rem" }}>📋</div>
          <p style={{ color: C.muted }}>No tests yet. Create your first assessment.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {tests.map((t) => {
            const normalizedSkills = Array.isArray(t.skills)
              ? t.skills
              : typeof t.skills === "string"
                ? t.skills.split(",").map((s) => s.trim()).filter(Boolean)
                : [];
            const createdAtDate =
              typeof t.createdAt === "string" || typeof t.createdAt === "number"
                ? new Date(t.createdAt)
                : t.createdAt?.toDate?.() || null;

            return (
              <div key={t.id} style={{ ...S.card, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                    <span style={{ fontSize: 16, fontWeight: 700 }}>{t.position}</span>
                    <Tag color={t.status === "active" ? "success" : "warning"}>{t.status || "draft"}</Tag>
                  </div>
                  <div style={{ fontSize: 13, color: C.muted, display: "flex", gap: 16, flexWrap: "wrap" }}>
                    <span>🎯 {t.numQuestions} questions</span>
                    <span>⏱ {t.duration} min</span>
                    <span>🆔 {t.candidateId}</span>
                    <span>📅 {createdAtDate && !Number.isNaN(createdAtDate.getTime()) ? createdAtDate.toLocaleDateString() : "—"}</span>
                  </div>
                  {normalizedSkills.length > 0 && (
                    <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {normalizedSkills.map((s) => (
                        <span key={s} style={{ fontSize: 11, padding: "2px 8px", background: C.accentDim, borderRadius: 10, color: C.accent }}>{s}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                  <button onClick={() => setSelected(t)} style={S.btn("ghost", "sm")}>View</button>
                  <button onClick={() => deleteTest(t.id)} style={{ ...S.btn("ghost", "sm"), color: C.danger }}>Delete</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Modal open={!!selected} onClose={() => setSelected(null)} title="Test Details">
        {selected && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {Object.entries({
              Position: selected.position,
              "Test ID": selected.testId,
              "Candidate ID": selected.candidateId,
              Password: selected.password,
              Questions: selected.numQuestions,
              "Duration (min)": selected.duration,
              Status: selected.status,
              Created: selected.createdAt ? new Date(selected.createdAt).toLocaleString() : "—",
              Expires: selected.expiresAt ? new Date(selected.expiresAt).toLocaleString() : "N/A",
            }).map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${C.border}`, fontSize: 14 }}>
                <span style={{ color: C.muted }}>{k}</span>
                <span style={{ fontWeight: 500 }}>{String(v)}</span>
              </div>
            ))}
            <div style={{ padding: "12px", background: C.bg, borderRadius: 8 }}>
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>Test Link</div>
              <div style={{ fontSize: 12, fontFamily: "monospace", color: C.accent, wordBreak: "break-all" }}>{selected.link}</div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ─── LIVE MONITOR ─────────────────────────────────────────────────────────────
function LiveMonitor() {
  const [sessions, setSessions] = useState([]);
  const [monitorError, setMonitorError] = useState("");

  // Real-time Firestore listener on liveSessions collection
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "liveSessions"),
      (snap) => {
        setSessions(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setMonitorError("");
      },
      (err) => {
        console.error("Live monitor load error:", err);
        setMonitorError("Unable to read live sessions. Check Firestore rules/auth.");
      }
    );
    return unsub; // unsubscribe on unmount
  }, []);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "2rem" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>Live Monitor</h1>
          <p style={{ margin: "4px 0 0", color: C.muted }}>Real-time candidate surveillance</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: C.success, animation: "pulse 1.5s infinite" }} />
          <span style={{ fontSize: 13, color: C.success }}>Live</span>
          <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>
        </div>
      </div>

      {sessions.length === 0 ? (
        <div style={{ ...S.card, textAlign: "center", padding: "4rem" }}>
          <div style={{ fontSize: 48, marginBottom: "1rem" }}>👁️</div>
          <h3 style={{ color: C.muted, fontWeight: 400 }}>{monitorError || "No active sessions"}</h3>
          <p style={{ color: C.muted, fontSize: 14 }}>
            {monitorError || "Active candidate sessions will appear here in real-time"}
          </p>
          {/* Demo preview card */}
          <DemoMonitorCard />
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
          {sessions.map((s) => (
            <LiveSessionCard key={s.id} session={s} />
          ))}
        </div>
      )}
    </div>
  );
}

function LiveSessionCard({ session }) {
  const pct = session.numQuestions
    ? Math.round(((session.currentQuestion || 0) / session.numQuestions) * 100)
    : 0;

  return (
    <div style={S.card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{session.name || session.candidateId}</div>
          <div style={{ fontSize: 12, color: C.muted }}>{session.position}</div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <Tag color="success">Live</Tag>
          {session.warningCount > 0 && <Tag color="danger">⚠ {session.warningCount}</Tag>}
        </div>
      </div>
      <div style={{ width: "100%", height: 140, background: "#000", borderRadius: 8, overflow: "hidden", marginBottom: "0.9rem" }}>
        {session.previewImage ? (
          <img
            src={session.previewImage}
            alt="Candidate preview"
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#666", fontSize: 12 }}>
            Camera preview unavailable
          </div>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: "0.75rem" }}>
        {[
          { label: "Question", value: `${(session.currentQuestion || 0) + 1}` },
          { label: "Time Left", value: session.timeLeft ? `${Math.floor(session.timeLeft / 60)}m` : "—" },
          { label: "Warnings", value: session.warningCount || 0 },
        ].map((s) => (
          <div key={s.label} style={{ background: C.bg, padding: "8px 10px", borderRadius: 8, textAlign: "center" }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{s.value}</div>
            <div style={{ fontSize: 11, color: C.muted }}>{s.label}</div>
          </div>
        ))}
      </div>
      <div style={{ background: C.bg, borderRadius: 4, height: 6 }}>
        <div style={{ width: `${pct}%`, height: "100%", background: C.accent, borderRadius: 4 }} />
      </div>
    </div>
  );
}

function DemoMonitorCard() {
  return (
    <div style={{ ...S.card, border: `1px solid ${C.accentDim}`, marginTop: "2rem", textAlign: "left" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Demo Preview</div>
          <div style={{ fontSize: 12, color: C.muted }}>Senior Developer · Question 4/10</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Tag color="success">Active</Tag>
          <Tag color="danger">⚠ 1 warning</Tag>
        </div>
      </div>
      <div style={{
        width: "100%", height: 140, background: "#000", borderRadius: 8,
        display: "flex", alignItems: "center", justifyContent: "center",
        marginBottom: "1rem", position: "relative",
      }}>
        <div style={{ textAlign: "center", color: "#555" }}>
          <div style={{ fontSize: 28, marginBottom: 6 }}>📹</div>
          <div style={{ fontSize: 12 }}>Camera Feed</div>
        </div>
        <div style={{ position: "absolute", top: 8, right: 8, width: 8, height: 8, borderRadius: "50%", background: C.success }} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: "0.75rem" }}>
        {[{ label: "Progress", value: "40%" }, { label: "Time Left", value: "18:24" }, { label: "Warnings", value: 1 }].map((s) => (
          <div key={s.label} style={{ background: C.bg, padding: "8px 10px", borderRadius: 8, textAlign: "center" }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{s.value}</div>
            <div style={{ fontSize: 11, color: C.muted }}>{s.label}</div>
          </div>
        ))}
      </div>
      <div style={{ background: C.bg, borderRadius: 4, height: 6, marginBottom: "0.75rem" }}>
        <div style={{ width: "40%", height: "100%", background: C.accent, borderRadius: 4 }} />
      </div>
      <div style={{ fontSize: 12, color: C.muted }}>⚠ Tab switch detected at 14:32</div>
    </div>
  );
}

// ─── RESULTS VIEW ─────────────────────────────────────────────────────────────
function ResultsView({ results }) {
  const [selected, setSelected] = useState(null);
  const selectedAnswers =
    selected?.answers ||
    selected?.questionAnswers ||
    selected?.responses ||
    [];
  const selectedShots =
    selected?.proctoringScreenshots ||
    selected?.screenshots ||
    selected?.proctoringShots ||
    [];

  return (
    <div>
      <h1 style={{ margin: "0 0 0.5rem", fontSize: 26, fontWeight: 700 }}>Results</h1>
      <p style={{ margin: "0 0 2rem", color: C.muted }}>{results.length} assessments completed</p>

      {results.length === 0 ? (
        <div style={{ ...S.card, textAlign: "center", padding: "3rem" }}>
          <div style={{ fontSize: 48, marginBottom: "1rem" }}>🏆</div>
          <p style={{ color: C.muted }}>Results will appear here after candidates complete their assessments</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {results.map((r) => (
            <div key={r.id} style={{ ...S.card, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>{r.candidateName || r.candidateId}</div>
                <div style={{ fontSize: 13, color: C.muted }}>
                  {r.position} · {r.submittedAt ? new Date(r.submittedAt).toLocaleString() : "—"}
                </div>
              </div>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: r.score >= 70 ? C.success : r.score >= 40 ? C.warning : C.danger }}>
                    {r.score}%
                  </div>
                  <div style={{ fontSize: 11, color: C.muted }}>Score</div>
                </div>
                <button onClick={() => setSelected(r)} style={S.btn("ghost", "sm")}>Details</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={!!selected} onClose={() => setSelected(null)} title="Assessment Result">
        {selected && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: "1.5rem" }}>
              <Stat label="Score" value={`${selected.score}%`} color={selected.score >= 70 ? C.success : C.warning} />
              <Stat label="Correct" value={`${selected.correct}/${selected.total}`} color={C.accent} />
              <Stat label="Warnings" value={selected.warnings || 0} color={C.danger} />
            </div>
            <div style={{ fontSize: 13, color: C.muted }}>
              Time taken: {selected.timeTaken || "—"} &nbsp;·&nbsp;
              Submitted: {selected.submittedAt ? new Date(selected.submittedAt).toLocaleString() : "—"}
            </div>

            <div style={{ ...S.card, marginTop: "1rem" }}>
              <h3 style={{ margin: "0 0 0.75rem", fontSize: 15 }}>Question-wise Answers</h3>
              {!Array.isArray(selectedAnswers) || selectedAnswers.length === 0 ? (
                <div style={{ fontSize: 13, color: C.muted }}>
                  No answer details available for this record. This usually means this result was submitted before detailed Q/A logging was enabled.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {selectedAnswers.map((a, idx) => (
                    <div key={`${selected.id}_${idx}`} style={{ background: C.bg, borderRadius: 8, padding: "10px 12px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 6 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>
                          Q{(a.questionIndex ?? idx) + 1}: {a.question || "Question text unavailable"}
                        </div>
                        <Tag color={a.correct ? "success" : "danger"}>{a.correct ? "Correct" : "Wrong"}</Tag>
                      </div>
                      <div style={{ fontSize: 12, color: C.muted }}>
                        Selected: {a.selectedOption || a.options?.[a.selected] || "Not answered"}
                      </div>
                      <div style={{ fontSize: 12, color: C.muted }}>
                        Correct: {a.correctOption || a.options?.[a.correctOptionIndex] || "N/A"}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ ...S.card, marginTop: "1rem" }}>
              <h3 style={{ margin: "0 0 0.75rem", fontSize: 15 }}>Proctoring Screenshots</h3>
              {!Array.isArray(selectedShots) || selectedShots.length === 0 ? (
                <div style={{ fontSize: 13, color: C.muted }}>
                  No screenshots found in this result record. Please run a new test attempt after this update to verify screenshot capture.
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
                  {selectedShots.map((shot, idx) => (
                    <a
                      key={`${selected.id}_shot_${idx}`}
                      href={shot.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ textDecoration: "none", color: "inherit" }}
                    >
                      <div style={{ background: C.bg, borderRadius: 8, padding: 8 }}>
                        <div style={{ width: "100%", aspectRatio: "16/9", background: "#000", borderRadius: 6, overflow: "hidden", marginBottom: 6 }}>
                          <img src={shot.url} alt={`Proctoring capture ${idx + 1}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        </div>
                        <div style={{ fontSize: 11, color: C.muted }}>
                          {shot.capturedAt ? new Date(shot.capturedAt).toLocaleString() : "Timestamp unavailable"}
                        </div>
                      </div>
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ─── CANDIDATE PANEL ──────────────────────────────────────────────────────────
function CandidatePanel({ user, onSignOut }) {
  const [phase, setPhase] = useState("disclaimer");
  const [testData, setTestData] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    dbGet("tests", user.testId).then((t) => {
      if (t) setTestData(t);
      else alert("Test not found. Please contact your recruiter.");
    });
  }, [user.testId]);

  if (!testData) return <div style={S.app}><Spinner /></div>;

  return (
    <div style={S.app}>
      {phase === "disclaimer" && (
        <DisclaimerScreen testData={testData} user={user} onStart={() => setPhase("test")} />
      )}
      {phase === "test" && (
        <TestInterface
          testData={testData}
          user={user}
          onComplete={(r) => { setResult(r); setPhase("completed"); }}
        />
      )}
      {phase === "completed" && (
        <CompletionScreen result={result} testData={testData} />
      )}
    </div>
  );
}

// ─── DISCLAIMER SCREEN ────────────────────────────────────────────────────────
function DisclaimerScreen({ testData, user, onStart }) {
  const [cameraOk, setCameraOk] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const videoRef = useRef(null);

  const requestCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCameraOk(true);
    } catch {
      alert("Camera access is required to take this assessment.");
    }
  };

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: "2rem" }}>
      <div style={{ maxWidth: 620, width: "100%" }}>
        <div style={{ textAlign: "center", marginBottom: "2rem" }}>
          <div style={{ fontSize: 48, marginBottom: "0.5rem" }}>🎯</div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>Assessment: {testData.position}</h1>
          <p style={{ margin: "4px 0 0", color: C.muted }}>Hello {user.name}! Please read carefully before starting.</p>
        </div>

        {/* Info grid */}
        <div style={{ ...S.card, marginBottom: 16 }}>
          <h3 style={{ margin: "0 0 1rem", fontSize: 16 }}>Test Information</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {[
              { label: "Questions", value: testData.numQuestions },
              { label: "Duration", value: `${testData.duration} minutes` },
              { label: "Format", value: "Multiple Choice" },
              { label: "Adaptive", value: "Yes — AI-powered" },
            ].map((f) => (
              <div key={f.label} style={{ background: C.bg, padding: "10px 12px", borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: C.muted }}>{f.label}</div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{f.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Rules */}
        <div style={{ ...S.card, marginBottom: 16 }}>
          <h3 style={{ margin: "0 0 1rem", fontSize: 16 }}>⚠️ Important Rules</h3>
          {[
            "Camera must remain ON throughout the test",
            "Switching tabs or minimizing browser will trigger warnings",
            "Exiting fullscreen will be recorded",
            "You will NOT see correct/incorrect feedback during the test",
            "Questions adapt in difficulty based on your performance",
            "Test auto-submits when time expires",
            "3 or more warnings may flag your attempt for review",
          ].map((r) => (
            <div key={r} style={{ display: "flex", gap: 10, fontSize: 13, padding: "7px 0", borderBottom: `1px solid ${C.border}` }}>
              <span style={{ color: C.warning, flexShrink: 0 }}>⚠</span> {r}
            </div>
          ))}
        </div>

        {/* Camera check */}
        <div style={{ ...S.card, marginBottom: 16 }}>
          <h3 style={{ margin: "0 0 1rem", fontSize: 16 }}>📹 Camera Check</h3>
          {cameraOk ? (
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <video ref={videoRef} autoPlay muted style={{ width: 120, height: 80, borderRadius: 8, background: "#000", objectFit: "cover" }} />
              <div>
                <div style={{ color: C.success, fontWeight: 600 }}>✓ Camera Active</div>
                <div style={{ fontSize: 13, color: C.muted }}>Your camera is working correctly</div>
              </div>
            </div>
          ) : (
            <button onClick={requestCamera} style={{ ...S.btn("primary"), width: "100%" }}>
              📷 Enable Camera Access
            </button>
          )}
        </div>

        {/* Agreement */}
        <div style={{ ...S.card, marginBottom: 16 }}>
          <label style={{ display: "flex", gap: 12, cursor: "pointer", alignItems: "flex-start" }}>
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)}
              style={{ marginTop: 3, accentColor: C.accent }} />
            <span style={{ fontSize: 14 }}>
              I have read and understood all the rules. I agree to camera monitoring and acknowledge that any attempt to cheat will be recorded.
            </span>
          </label>
        </div>

        <button
          onClick={onStart}
          disabled={!agreed}
          style={{ ...S.btn("primary"), width: "100%", padding: "14px", fontSize: 16, fontWeight: 700, opacity: agreed ? 1 : 0.4 }}
        >
          Start Assessment →
        </button>
      </div>
    </div>
  );
}

// ─── TEST INTERFACE ────────────────────────────────────────────────────────────
function TestInterface({ testData, user, onComplete }) {
  const [questions, setQuestions] = useState([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [difficulty, setDifficulty] = useState("easy");
  const [timeLeft, setTimeLeft] = useState(testData.duration * 60);
  const [warnings, setWarnings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [streak, setStreak] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [questionError, setQuestionError] = useState("");
  const videoRef = useRef(null);
  const cameraStreamRef = useRef(null);
  const submitRef = useRef(false); // prevent double submit
  const answersRef = useRef([]);
  const proctoringShotsRef = useRef([]);
  const liveRef = useRef({ currentIdx: 0, timeLeft: testData.duration * 60, warningCount: 0 });
  const skills = testData.skills?.length ? testData.skills : [testData.position];
  const [proctoringShots, setProctoringShots] = useState([]);
  const [proctoringDebug, setProctoringDebug] = useState({
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastError: "",
    lastSource: "",
    totalCaptured: 0,
  });
  const withTimeout = async (promise, ms, label) => {
    let timerId;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timerId = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
        }),
      ]);
    } finally {
      if (timerId) clearTimeout(timerId);
    }
  };

  const capturePreviewImage = async () => {
    try {
      const video = videoRef.current;
      if (video && video.videoWidth > 0 && video.videoHeight > 0) {
        const canvas = document.createElement("canvas");
        canvas.width = 240;
        canvas.height = 135;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/jpeg", 0.45);
      }

      const track = cameraStreamRef.current?.getVideoTracks?.()[0];
      if (track && "ImageCapture" in window) {
        const imageCapture = new window.ImageCapture(track);
        const bitmap = await imageCapture.grabFrame();
        const canvas = document.createElement("canvas");
        canvas.width = 240;
        canvas.height = 135;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/jpeg", 0.45);
      }
    } catch (err) {
      console.error("Preview capture failed:", err);
    }
    return null;
  };

  const captureScreenshotBlob = async () => {
    try {
      const video = videoRef.current;
      if (!video || video.videoWidth <= 0 || video.videoHeight <= 0) return null;
      const canvas = document.createElement("canvas");
      canvas.width = 960;
      canvas.height = 540;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      return await new Promise((resolve) => {
        canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.8);
      });
    } catch (err) {
      console.error("Screenshot capture failed:", err);
      return null;
    }
  };

  const uploadSessionScreenshot = async (reason = "interval") => {
    setProctoringDebug((prev) => ({
      ...prev,
      lastAttemptAt: nowISO(),
      lastError: "",
    }));

    try {
      const blob = await captureScreenshotBlob();
      if (!blob) return null;
      const capturedAt = nowISO();
      const filePath = `sessionScreenshots/${testData.testId}/${user.uid}/${Date.now()}.jpg`;
      const fileRef = storageRef(storage, filePath);
      await uploadBytes(fileRef, blob, { contentType: "image/jpeg" });
      const url = await getDownloadURL(fileRef);
      setProctoringDebug((prev) => ({
        ...prev,
        lastSuccessAt: capturedAt,
        lastSource: "firebase-storage",
      }));
      return { url, path: filePath, capturedAt, reason };
    } catch (err) {
      console.error("Screenshot upload failed:", err);
      const inlineUrl = await capturePreviewImage();
      if (!inlineUrl) {
        setProctoringDebug((prev) => ({
          ...prev,
          lastError: err?.message || "Screenshot upload failed",
        }));
        return null;
      }
      const fallbackTime = nowISO();
      setProctoringDebug((prev) => ({
        ...prev,
        lastSuccessAt: fallbackTime,
        lastSource: "inline-fallback",
      }));
      return { url: inlineUrl, path: null, capturedAt: nowISO(), reason, source: "inline-fallback" };
    }
  };

  // Camera
  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ video: true })
      .then((stream) => {
        cameraStreamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => { });
        }
      })
      .catch(() => addWarning("Camera turned off"));

    return () => {
      cameraStreamRef.current?.getTracks?.().forEach((t) => t.stop());
    };
  }, []);

  // Countdown timer
  useEffect(() => {
    const t = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) { clearInterval(t); doSubmit(answersRef.current); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // Tab-switch detection
  useEffect(() => {
    const handler = () => { if (document.hidden) addWarning("Tab switch detected"); };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []);

  // Keep latest values for stable live-session interval
  useEffect(() => {
    liveRef.current = {
      currentIdx,
      timeLeft,
      warningCount: warnings.length,
    };
  }, [currentIdx, timeLeft, warnings.length]);

  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  useEffect(() => {
    proctoringShotsRef.current = proctoringShots;
    setProctoringDebug((prev) => ({
      ...prev,
      totalCaptured: proctoringShots.length,
    }));
  }, [proctoringShots]);

  // Live session updates to Firestore every 5 seconds
  useEffect(() => {
    const pushLiveSession = async () => {
      const { currentIdx: idx, timeLeft: remaining, warningCount } = liveRef.current;
      const previewImage = await capturePreviewImage();
      dbSet("liveSessions", user.uid, {
        candidateId: user.uid,
        name: user.name,
        position: testData.position,
        numQuestions: testData.numQuestions,
        currentQuestion: idx,
        timeLeft: remaining,
        warningCount,
        previewImage,
        lastSeen: serverTimestamp(),
      }).catch((err) => console.error("Failed to update live session:", err));
    };

    // Push immediately so admin can see candidate quickly.
    pushLiveSession();

    const interval = setInterval(() => {
      pushLiveSession();
    }, 5000);
    return () => clearInterval(interval);
  }, [user.uid, user.name, testData.position, testData.numQuestions]);

  useEffect(() => {
    const interval = setInterval(async () => {
      if (submitRef.current) return;
      const shot = await uploadSessionScreenshot("interval");
      if (!shot) return;
      setProctoringShots((prev) => [...prev, shot]);
    }, 120000);
    return () => clearInterval(interval);
  }, [user.uid, testData.testId]);

  // Load first question on mount
  useEffect(() => { loadNextQuestion("easy"); }, []);

  const addWarning = (msg) => {
    const w = { msg, time: new Date().toLocaleTimeString() };
    setWarnings((prev) => [...prev, w]);
    dbSet("warnings", `${user.uid}_${Date.now()}`, {
      candidateId: user.uid,
      testId: testData.testId,
      message: msg,
      timestamp: serverTimestamp(),
    }).catch((err) => console.error("Failed to save warning:", err));
  };

  const loadNextQuestion = async (diff) => {
    setLoading(true);
    setSelected(null);
    setQuestionError("");
    try {
      const q = await generateQuestion(testData.position, diff, skills, questions);
      const hasValidShape =
        q &&
        typeof q.question === "string" &&
        Array.isArray(q.options) &&
        q.options.length > 1 &&
        Number.isInteger(q.correctIndex);

      if (!hasValidShape) {
        throw new Error("Invalid question payload from AI service");
      }

      setQuestions((prev) => [...prev, { ...q, difficulty: diff }]);
    } catch (err) {
      console.error("Question generation failed:", err);
      setQuestionError("Unable to generate the next question. Please check your API key/config and retry.");
    } finally {
      setLoading(false);
    }
  };

  const handleAnswer = async (optionIdx) => {
    if (selected !== null || loading) return;
    if (!questions[currentIdx]) return;
    setSelected(optionIdx);

    const q = questions[currentIdx];
    const correct = optionIdx === q.correctIndex;
    const newAns = [
      ...answers,
      {
        questionIndex: currentIdx,
        question: q.question,
        selected: optionIdx,
        selectedOption: q.options?.[optionIdx] ?? "Not answered",
        correctOptionIndex: q.correctIndex,
        correctOption: q.options?.[q.correctIndex] ?? "N/A",
        options: q.options || [],
        correct,
        difficulty: q.difficulty,
      },
    ];
    setAnswers(newAns);
    answersRef.current = newAns;

    // Adaptive difficulty
    const newStreak = correct ? streak + 1 : 0;
    setStreak(newStreak);
    let nextDiff = difficulty;
    if (correct && newStreak >= 3)
      nextDiff = difficulty === "easy" ? "medium" : difficulty === "medium" ? "hard" : "hard";
    else if (!correct)
      nextDiff = difficulty === "hard" ? "medium" : "easy";
    setDifficulty(nextDiff);

    setTimeout(async () => {
      if (currentIdx + 1 >= testData.numQuestions) {
        doSubmit(newAns);
      } else {
        setCurrentIdx((i) => i + 1);
        await loadNextQuestion(nextDiff);
      }
    }, 1500);
  };

  const doSubmit = async (finalAnswers) => {
    if (submitRef.current) return;
    submitRef.current = true;
    setSubmitted(true);
    try {
      const answersToSave = Array.isArray(finalAnswers) ? finalAnswers : answersRef.current;
      const finalShot = await withTimeout(
        uploadSessionScreenshot("submit"),
        12000,
        "Final screenshot capture"
      ).catch((err) => {
        console.error("Final screenshot skipped:", err);
        return null;
      });
      const combinedShots = finalShot
        ? [...proctoringShotsRef.current, finalShot]
        : proctoringShotsRef.current;

      const correct = answersToSave.filter((a) => a.correct).length;
      const score = Math.round((correct / testData.numQuestions) * 100);
      const result = {
        candidateId: user.uid,
        candidateName: user.name,
        testId: testData.testId,
        position: testData.position,
        score, correct,
        total: testData.numQuestions,
        warnings: warnings.length,
        timeTaken: `${Math.floor((testData.duration * 60 - timeLeft) / 60)}m`,
        submittedAt: nowISO(),
        answers: answersToSave,
        questionsAsked: questions.map((item, idx) => ({
          questionIndex: idx,
          question: item.question,
          options: item.options || [],
          correctOptionIndex: item.correctIndex,
          correctOption: item.options?.[item.correctIndex] ?? "N/A",
          difficulty: item.difficulty,
        })),
        proctoringScreenshots: combinedShots,
      };
      await withTimeout(
        dbSet("results", `${user.uid}_result`, result),
        20000,
        "Result save"
      );
      // Remove candidate from live monitor once test is submitted.
      await withTimeout(
        deleteDoc(doc(db, "liveSessions", user.uid)),
        10000,
        "Live session cleanup"
      ).catch((err) => console.error("Failed to remove live session on submit:", err));
      onComplete(result);
    } catch (err) {
      console.error("Submit failed:", err);
      alert("Submission failed. Please check your internet/firestore permissions and try again.");
      submitRef.current = false;
      setSubmitted(false);
    }
  };

  const fmt = (s) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  const progress = (currentIdx / testData.numQuestions) * 100;
  const q = questions[currentIdx];

  if (submitted) return <div style={S.app}><Spinner /></div>;

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      {/* ── Question area ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "2rem", maxWidth: 720 }}>
        {/* Header row */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
          <div>
            <div style={{ fontSize: 14, color: C.muted }}>
              Question {Math.min(currentIdx + 1, testData.numQuestions)} of {testData.numQuestions}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <Tag color={difficulty === "easy" ? "success" : difficulty === "medium" ? "warning" : "danger"}>
                {difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}
              </Tag>
              {warnings.length > 0 && (
                <Tag color="danger">⚠ {warnings.length} warning{warnings.length > 1 ? "s" : ""}</Tag>
              )}
            </div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{
              fontSize: 28, fontWeight: 700, fontFamily: "monospace",
              color: timeLeft < 60 ? C.danger : timeLeft < 300 ? C.warning : C.text,
            }}>
              {fmt(timeLeft)}
            </div>
            <div style={{ fontSize: 11, color: C.muted }}>remaining</div>
          </div>
        </div>

        {/* Progress bar */}
        <div style={{ background: C.surface, borderRadius: 4, height: 6, marginBottom: "2rem" }}>
          <div style={{ width: `${progress}%`, height: "100%", background: C.accent, borderRadius: 4, transition: "width 0.5s" }} />
        </div>

        {/* Question / options */}
        {loading || !q ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1 }}>
            <Spinner />
            <div style={{ color: C.muted, fontSize: 14, marginTop: 8 }}>
              {questionError || "Generating next question..."}
            </div>
            {questionError && (
              <button
                onClick={() => loadNextQuestion(difficulty)}
                style={{ ...S.btn("ghost", "sm"), marginTop: 12 }}
              >
                Retry
              </button>
            )}
          </div>
        ) : (
          <div style={{ flex: 1 }}>
            <div style={{ ...S.card, marginBottom: "1.5rem" }}>
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Topic: {q.topic}
              </div>
              <div style={{ fontSize: 17, lineHeight: 1.6, fontWeight: 500 }}>{q.question}</div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {q.options.map((opt, i) => {
                const isSel = selected === i;
                return (
                  <button
                    key={i}
                    onClick={() => handleAnswer(i)}
                    disabled={selected !== null}
                    style={{
                      ...S.card,
                      padding: "14px 18px",
                      cursor: selected !== null ? "default" : "pointer",
                      textAlign: "left",
                      display: "flex", alignItems: "center", gap: 12,
                      border: `1px solid ${isSel ? C.accent : C.border}`,
                      background: isSel ? C.accentDim : C.surface,
                      transition: "all 0.2s",
                      fontSize: 14,
                    }}
                  >
                    <div style={{
                      width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                      border: `2px solid ${isSel ? C.accent : C.border}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 12, fontWeight: 700,
                      color: isSel ? C.accent : C.muted,
                    }}>
                      {"ABCD"[i]}
                    </div>
                    {opt}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Right sidebar ── */}
      <div style={{
        width: 240, background: C.surface, borderLeft: `1px solid ${C.border}`,
        padding: "1.5rem", display: "flex", flexDirection: "column", gap: 16,
        position: "sticky", top: 0, height: "100vh", overflowY: "auto",
      }}>
        {/* Camera feed */}
        <div>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>📹 Camera</div>
          <div style={{ width: "100%", aspectRatio: "4/3", background: "#000", borderRadius: 8, overflow: "hidden" }}>
            <video ref={videoRef} autoPlay muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            { label: "Completed", value: `${currentIdx}/${testData.numQuestions}` },
            { label: "Difficulty", value: difficulty, color: difficulty === "easy" ? C.success : difficulty === "medium" ? C.warning : C.danger },
            { label: "Streak", value: `${streak} correct` },
          ].map((s) => (
            <div key={s.label} style={{
              background: C.bg, padding: "8px 10px", borderRadius: 8,
              display: "flex", justifyContent: "space-between", fontSize: 13,
            }}>
              <span style={{ color: C.muted }}>{s.label}</span>
              <span style={{ fontWeight: 600, color: s.color || C.text }}>{s.value}</span>
            </div>
          ))}
        </div>

        {/* Warnings */}
        {warnings.length > 0 && (
          <div>
            <div style={{ fontSize: 12, color: C.danger, marginBottom: 8 }}>⚠ Warnings ({warnings.length})</div>
            {warnings.slice(-3).map((w, i) => (
              <div key={i} style={{ background: "#2A0F0F", padding: "6px 8px", borderRadius: 6, fontSize: 11, marginBottom: 4 }}>
                <div style={{ color: C.danger }}>{w.msg}</div>
                <div style={{ color: C.muted }}>{w.time}</div>
              </div>
            ))}
          </div>
        )}

        {/* Proctoring debug */}
        <div style={{ background: C.bg, borderRadius: 8, padding: "10px 12px" }}>
          <div style={{ fontSize: 12, color: C.accent, marginBottom: 8 }}>🛠 Proctoring Status</div>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>
            Captures: {proctoringDebug.totalCaptured}
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>
            Last Attempt: {proctoringDebug.lastAttemptAt ? new Date(proctoringDebug.lastAttemptAt).toLocaleTimeString() : "—"}
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>
            Last Success: {proctoringDebug.lastSuccessAt ? new Date(proctoringDebug.lastSuccessAt).toLocaleTimeString() : "—"}
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>
            Source: {proctoringDebug.lastSource || "—"}
          </div>
          {proctoringDebug.lastError && (
            <div style={{ fontSize: 11, color: C.danger }}>
              Error: {proctoringDebug.lastError}
            </div>
          )}
        </div>

        <button
          onClick={() => { if (window.confirm("Submit the test now?")) doSubmit(answersRef.current); }}
          style={{ ...S.btn("danger", "sm"), marginTop: "auto" }}
        >
          Submit Early
        </button>
      </div>
    </div>
  );
}

// ─── COMPLETION SCREEN ────────────────────────────────────────────────────────
function CompletionScreen({ result }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: "2rem" }}>
      <div style={{ maxWidth: 560, width: "100%", textAlign: "center" }}>
        <div style={{ fontSize: 64, marginBottom: "1rem" }}>✅</div>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: "0.5rem" }}>Test Submitted Successfully</h1>
        <p style={{ color: C.muted, marginBottom: "2rem" }}>
          Thank you {result.candidateName}. Your response has been recorded.
        </p>

        <div style={{ ...S.card, marginBottom: 16 }}>
          <div style={{ fontSize: 15, color: C.text, marginBottom: 10 }}>
            The recruiter will review your test and contact you with the outcome.
          </div>
          <div style={{ fontSize: 12, color: C.muted }}>
            Submitted at: {result.submittedAt ? new Date(result.submittedAt).toLocaleString() : "—"}
          </div>
        </div>

        <div style={{ ...S.card, background: "#0D2E26", border: `1px solid ${C.success}` }}>
          <div style={{ fontSize: 14, color: C.success }}>
            Thank you for completing the assessment.<br />
            Best of luck for your result.
          </div>
        </div>

        <p style={{ color: C.muted, fontSize: 13, marginTop: "1.5rem" }}>
          You may now close this window.
        </p>
      </div>
    </div>
  );
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function App() {
  const { user, signOut } = useAuth();

  // Detect candidate link params
  const params = new URLSearchParams(window.location.search);
  const defaultRole = params.get("test") ? "candidate" : "admin";

  if (!user) {
    return <LoginScreen onLogin={() => window.location.reload()} defaultRole={defaultRole} />;
  }

  if (user.role === "admin") return <AdminPanel user={user} onSignOut={signOut} />;
  if (user.role === "candidate") return <CandidatePanel user={user} onSignOut={signOut} />;

  return <LoginScreen onLogin={() => window.location.reload()} />;
}