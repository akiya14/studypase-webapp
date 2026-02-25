"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/** ---------- localStorage DB ---------- */
const KEY = "studypace_full_singlefile_v4_everything";

function systemTheme() {
  if (typeof window === "undefined") return "light";
  return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
}

function isoDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString().slice(0, 10);
}

function addDays(isoYYYYMMDD, days) {
  const d = new Date(isoYYYYMMDD);
  d.setDate(d.getDate() + days);
  return isoDay(d);
}

function randomColor() {
  const colors = ["#2563eb", "#7c3aed", "#16a34a", "#ea580c", "#dc2626", "#0891b2"];
  return colors[Math.floor(Math.random() * colors.length)];
}

function defaultDB() {
  return {
    theme: systemTheme(),
    onboardingDone: false,

    notificationsEnabled: false,
    notificationPermission: "default",
    lastDueNotifyDay: "",

    dailyGoal: 2,

    // timer upgrades
    timer: {
      pomodoroMin: 25,
      shortMin: 5,
      longMin: 15,
      cyclesBeforeLong: 4,
      autoStartBreak: true,
      autoStartPomodoro: true,
      endSound: true,
    },
    pomodoroCycleCount: 0,

    subjects: [], // {id, name, examDate, nextReviewDate, color, intervalDays, easeStreak}
    sessions: [], // {id, subjectId, type:'pomodoro', minutes, completedAt, difficulty, note}

    calendarNotes: {}, // { "YYYY-MM-DD": "note" }
    manualStudied: {}, // { "YYYY-MM-DD": true }
  };
}

function loadDB() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : defaultDB();
  } catch {
    return defaultDB();
  }
}

function saveDB(db) {
  localStorage.setItem(KEY, JSON.stringify(db));
}

/** ---------- utilities ---------- */
function fmt(sec) {
  const m = String(Math.floor(sec / 60)).padStart(2, "0");
  const s = String(sec % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function cx(...parts) {
  return parts.filter(Boolean).join(" ");
}

function withinLastNDays(isoDate, n) {
  const d = new Date(isoDate);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const cutoff = new Date(now);
  cutoff.setDate(now.getDate() - (n - 1));
  return d >= cutoff && d <= now;
}

function monthMatrix(year, monthIndex) {
  const first = new Date(year, monthIndex, 1);
  const startDay = first.getDay();
  const start = new Date(year, monthIndex, 1 - startDay);

  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    cells.push({
      iso: d.toISOString().slice(0, 10),
      day: d.getDate(),
      inMonth: d.getMonth() === monthIndex,
    });
  }
  return cells;
}

function computeStats(db) {
  const today = isoDay();
  const totalSubjects = db.subjects.length;
  const dueToday = db.subjects.filter((s) => (s.nextReviewDate || today) <= today).length;

  const goal = db.dailyGoal || 1;

  const todayCount =
    db.sessions.filter((s) => s.completedAt.slice(0, 10) === today).length +
    (db.manualStudied?.[today] ? 1 : 0);

  const studiedDays = new Set([
    ...db.sessions.map((s) => s.completedAt.slice(0, 10)),
    ...Object.keys(db.manualStudied || {}).filter((k) => db.manualStudied[k]),
  ]);

  let streak = 0;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  while (true) {
    const day = d.toISOString().slice(0, 10);
    if (!studiedDays.has(day)) break;
    streak++;
    d.setDate(d.getDate() - 1);
  }

  return { totalSubjects, dueToday, bestStreak: streak, todayDone: todayCount, goal };
}

/** ---------- UI helpers ---------- */
function Modal({ title, onClose, children, wide = false, theme }) {
  const isDark = theme === "dark";
  const border = isDark ? "border-zinc-800" : "border-zinc-200";
  const bg = isDark ? "bg-black" : "bg-white";
  const btn = isDark ? "bg-zinc-900" : "bg-zinc-100";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
      <div
        className={cx(
          "fade-up w-full rounded-2xl border p-6 max-h-[85vh] overflow-y-auto",
          border,
          bg,
          wide ? "max-w-5xl" : "max-w-2xl"
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <h3 className="text-xl font-bold">{title}</h3>
          <button
            onClick={onClose}
            className={cx(
              "grid h-11 w-11 place-items-center rounded-xl font-bold transition hover:scale-105",
              btn
            )}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}

function Card({ children, className = "", theme }) {
  const isDark = theme === "dark";
  const border = isDark ? "border-zinc-800" : "border-zinc-200";
  const bg = isDark ? "bg-black" : "bg-white";
  return (
    <div
      className={cx(
        "rounded-2xl border p-6 transition hover:-translate-y-1 hover:shadow-lg hover:shadow-zinc-950/10",
        border,
        bg,
        className
      )}
    >
      {children}
    </div>
  );
}

/** ---------- Notifications + sound ---------- */
function canNotify() {
  return typeof window !== "undefined" && "Notification" in window;
}

function sendNotification(title, body) {
  try {
    // eslint-disable-next-line no-new
    new Notification(title, { body });
  } catch {}
}

function playEndSound() {
  // nicer 3-beep pattern
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();

    const beep = (t, freq) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = freq;

      g.gain.value = 0.0001;
      g.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.18);

      o.connect(g);
      g.connect(ctx.destination);

      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.22);
    };

    beep(0.0, 880);
    beep(0.28, 990);
    beep(0.56, 880);

    setTimeout(() => ctx.close?.(), 1100);
  } catch {}
}

/** ---------- Page ---------- */
export default function Home() {
  const [db, setDb] = useState(null);

  // modals: "welcome" | "about" | "add" | "subjects" | "edit" | "timer" | "review" | "calendar" | "analytics" | "subjectDetail" | "achievements" | "achievementDetail"
  const [modal, setModal] = useState(null);

  // add subject
  const [subjectName, setSubjectName] = useState("");
  const [examDate, setExamDate] = useState("");

  // edit subject
  const [editId, setEditId] = useState("");
  const [editName, setEditName] = useState("");
  const [editExamDate, setEditExamDate] = useState("");
  const [editNextReviewDate, setEditNextReviewDate] = useState("");
  const [editColor, setEditColor] = useState("#2563eb");

  // timer
  const [mode, setMode] = useState("pomodoro"); // pomodoro | short | long
  const [seconds, setSeconds] = useState(25 * 60);
  const [running, setRunning] = useState(false);
  const tickRef = useRef(null);

  const [sessionNote, setSessionNote] = useState("");
  const [lastCompletedSubjectId, setLastCompletedSubjectId] = useState("");

  // selected subject
  const [activeSubjectId, setActiveSubjectId] = useState("");

  // calendar
  const [calView, setCalView] = useState(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const [selectedDay, setSelectedDay] = useState(isoDay());
  const [dayNoteDraft, setDayNoteDraft] = useState("");

  // analytics
  const [analyticsTab, setAnalyticsTab] = useState("overview"); // overview | subjects | history
  const [analyticsRange, setAnalyticsRange] = useState(7); // 7 | 30
  const [selectedSubjectDetailId, setSelectedSubjectDetailId] = useState("");

  // achievements
  const [selectedAchievementKey, setSelectedAchievementKey] = useState("");

  // toast
  const [toast, setToast] = useState("");

  /** -------------------- DERIVED (hooks ALWAYS run) -------------------- */
  const stats = useMemo(() => (db ? computeStats(db) : null), [db]);

  const studiedDays = useMemo(() => {
    if (!db) return new Set();
    const fromSessions = db.sessions.map((x) => x.completedAt.slice(0, 10));
    const fromManual = Object.keys(db.manualStudied || {}).filter((k) => db.manualStudied[k]);
    return new Set([...fromSessions, ...fromManual]);
  }, [db]);

  const calendarCells = useMemo(() => monthMatrix(calView.y, calView.m), [calView]);

  const monthTitle = useMemo(() => {
    return new Date(calView.y, calView.m, 1).toLocaleString(undefined, {
      month: "long",
      year: "numeric",
    });
  }, [calView]);

  const activeSubject = useMemo(() => {
    if (!db) return null;
    return db.subjects.find((s) => s.id === activeSubjectId) || db.subjects[0] || null;
  }, [db, activeSubjectId]);

  const dueTodaySubjects = useMemo(() => {
    if (!db) return [];
    const today = isoDay();
    return db.subjects
      .filter((s) => (s.nextReviewDate || today) <= today)
      .sort((a, b) => (a.nextReviewDate || today).localeCompare(b.nextReviewDate || today));
  }, [db]);

  const nextDueSubject = useMemo(() => dueTodaySubjects[0] || null, [dueTodaySubjects]);

  const sessionsOnSelectedDay = useMemo(() => {
    if (!db) return 0;
    return db.sessions.filter((s) => s.completedAt.slice(0, 10) === selectedDay).length;
  }, [db, selectedDay]);

  const dueSubjectsOnSelectedDay = useMemo(() => {
    if (!db) return [];
    const today = isoDay();
    return db.subjects.filter((s) => (s.nextReviewDate || today) <= selectedDay);
  }, [db, selectedDay]);

  const rangeActivity = useMemo(() => {
    if (!db) return [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const arr = [];
    for (let i = analyticsRange - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const iso = d.toISOString().slice(0, 10);

      const countSessions = db.sessions.filter((x) => x.completedAt.slice(0, 10) === iso).length;
      const countManual = db.manualStudied?.[iso] ? 1 : 0;

      arr.push({
        iso,
        label:
          analyticsRange === 7
            ? d.toLocaleString(undefined, { weekday: "short" })
            : d.toLocaleString(undefined, { month: "short", day: "numeric" }),
        count: countSessions + countManual,
      });
    }
    return arr;
  }, [db, analyticsRange]);

  const subjectStats = useMemo(() => {
    if (!db) return [];
    const today = isoDay();
    return db.subjects
      .map((s) => {
        const total = db.sessions.filter((x) => x.subjectId === s.id).length;
        const last7 = db.sessions.filter(
          (x) => x.subjectId === s.id && withinLastNDays(x.completedAt.slice(0, 10), 7)
        ).length;

        const due = (s.nextReviewDate || today) <= today;

        return {
          id: s.id,
          name: s.name,
          color: s.color || "#2563eb",
          examDate: s.examDate,
          nextReviewDate: s.nextReviewDate || today,
          intervalDays: s.intervalDays || 1,
          easeStreak: s.easeStreak || 0,
          totalSessions: total,
          sessionsLast7: last7,
          due,
        };
      })
      .sort((a, b) => Number(b.due) - Number(a.due) || b.sessionsLast7 - a.sessionsLast7);
  }, [db]);

  const history = useMemo(() => {
    if (!db) return [];
    return [...db.sessions]
      .sort((a, b) => (a.completedAt < b.completedAt ? 1 : -1))
      .slice(0, 30)
      .map((s) => {
        const subj = db.subjects.find((x) => x.id === s.subjectId);
        return {
          id: s.id,
          day: s.completedAt.slice(0, 10),
          time: s.completedAt.slice(11, 16),
          subjectName: subj?.name || "Unknown",
          subjectId: subj?.id || "",
          color: subj?.color || "#2563eb",
          difficulty: s.difficulty || "",
          minutes: s.minutes || 25,
          note: s.note || "",
        };
      });
  }, [db]);

  const achievementModel = useMemo(() => {
    if (!db) return [];
    const totalReviews = db.sessions.length;
    const bestStreak = stats?.bestStreak || 0;
    const dueToday = stats?.dueToday || 0;

    return [
      {
        key: "gettingStarted",
        title: "Getting Started",
        desc: "Add your first subject.",
        progressText: `${Math.min(1, db.subjects.length)} / 1`,
        done: db.subjects.length >= 1,
      },
      {
        key: "firstReview",
        title: "First Review",
        desc: "Complete your first Pomodoro.",
        progressText: `${Math.min(1, totalReviews)} / 1`,
        done: totalReviews >= 1,
      },
      {
        key: "threeReviews",
        title: "Consistency",
        desc: "Complete 3 Pomodoros.",
        progressText: `${Math.min(3, totalReviews)} / 3`,
        done: totalReviews >= 3,
      },
      {
        key: "tenReviews",
        title: "Dedicated",
        desc: "Complete 10 Pomodoros.",
        progressText: `${Math.min(10, totalReviews)} / 10`,
        done: totalReviews >= 10,
      },
      {
        key: "streak3",
        title: "Streak Starter",
        desc: "Reach a 3-day streak.",
        progressText: `${Math.min(3, bestStreak)} / 3`,
        done: bestStreak >= 3,
      },
      {
        key: "streak7",
        title: "Weekly Warrior",
        desc: "Reach a 7-day streak.",
        progressText: `${Math.min(7, bestStreak)} / 7`,
        done: bestStreak >= 7,
      },
      {
        key: "clearDue",
        title: "Clear the Queue",
        desc: "Have 0 due reviews today.",
        progressText: `${dueToday === 0 ? 1 : 0} / 1`,
        done: dueToday === 0 && db.subjects.length > 0,
      },
    ];
  }, [db, stats]);

  const achievementsSummary = useMemo(() => {
    const total = achievementModel.length || 1;
    const unlocked = achievementModel.filter((x) => x.done).length;
    const pct = Math.round((unlocked / total) * 100);
    return { total, unlocked, pct };
  }, [achievementModel]);

  const subjectDetail = useMemo(() => {
    if (!db) return null;
    if (!selectedSubjectDetailId) return null;

    const s = db.subjects.find((x) => x.id === selectedSubjectDetailId);
    if (!s) return null;

    const sessions = db.sessions
      .filter((x) => x.subjectId === s.id)
      .sort((a, b) => (a.completedAt < b.completedAt ? 1 : -1))
      .slice(0, 10);

    const last7 = db.sessions.filter(
      (x) => x.subjectId === s.id && withinLastNDays(x.completedAt.slice(0, 10), 7)
    ).length;

    return {
      ...s,
      sessions,
      totalSessions: db.sessions.filter((x) => x.subjectId === s.id).length,
      last7,
    };
  }, [db, selectedSubjectDetailId]);

  const achievementDetail = useMemo(() => {
    return achievementModel.find((x) => x.key === selectedAchievementKey) || null;
  }, [achievementModel, selectedAchievementKey]);

  /** ----- timer derived ----- */
  const timerCfg = useMemo(() => {
    const t = db?.timer || {};
    return {
      pomodoroMin: Number(t.pomodoroMin || 25),
      shortMin: Number(t.shortMin || 5),
      longMin: Number(t.longMin || 15),
      cyclesBeforeLong: Number(t.cyclesBeforeLong || 4),
      autoStartBreak: !!t.autoStartBreak,
      autoStartPomodoro: !!t.autoStartPomodoro,
      endSound: t.endSound !== false,
    };
  }, [db]);

  const totalSecondsForMode = useMemo(() => {
    if (!db) return 25 * 60;
    if (mode === "pomodoro") return timerCfg.pomodoroMin * 60;
    if (mode === "short") return timerCfg.shortMin * 60;
    return timerCfg.longMin * 60;
  }, [db, mode, timerCfg]);

  const progressPct = useMemo(() => {
    const total = Math.max(1, totalSecondsForMode);
    const done = total - Math.max(0, seconds);
    return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
  }, [seconds, totalSecondsForMode]);

  /** -------------------- effects -------------------- */
  useEffect(() => {
    const loaded = loadDB();
    if (canNotify()) loaded.notificationPermission = Notification.permission;
    setDb(loaded);

    if (loaded.subjects?.[0]?.id) setActiveSubjectId(loaded.subjects[0].id);
    if (!loaded.onboardingDone) setModal("welcome");

    const cfg = loaded.timer || {};
    setSeconds(Number(cfg.pomodoroMin || 25) * 60);
  }, []);

  useEffect(() => {
    if (!running) return;
    tickRef.current = setInterval(() => setSeconds((x) => x - 1), 1000);
    return () => clearInterval(tickRef.current);
  }, [running]);

  useEffect(() => {
    if (!db) return;
    setRunning(false);
    setSeconds(totalSecondsForMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, db?.timer?.pomodoroMin, db?.timer?.shortMin, db?.timer?.longMin]);

  useEffect(() => {
    if (!db) return;
    if (!running) return;
    if (seconds > 0) return;

    setRunning(false);
    clearInterval(tickRef.current);

    if (timerCfg.endSound) playEndSound();

    if (mode === "pomodoro") {
      const subjectId = activeSubjectId || db.subjects[0]?.id;
      const session = {
        id: crypto.randomUUID(),
        subjectId,
        type: "pomodoro",
        minutes: timerCfg.pomodoroMin,
        completedAt: new Date().toISOString(),
        note: sessionNote.trim(),
      };

      const next = {
        ...db,
        sessions: [...db.sessions, session],
        pomodoroCycleCount: (db.pomodoroCycleCount || 0) + 1,
      };

      setDb(next);
      saveDB(next);

      setLastCompletedSubjectId(subjectId || "");
      setModal("review");
      return;
    }

    if (mode === "short" || mode === "long") {
      if (timerCfg.autoStartPomodoro) {
        setMode("pomodoro");
        setSeconds(timerCfg.pomodoroMin * 60);
        setRunning(true);
      } else {
        setMode("pomodoro");
        setSeconds(timerCfg.pomodoroMin * 60);
      }
    }
  }, [seconds, running, mode, db, activeSubjectId, timerCfg, sessionNote]);

  useEffect(() => {
    if (!db) return;
    if (!canNotify()) return;
    if (!db.notificationsEnabled) return;
    if (db.notificationPermission !== "granted") return;

    const today = isoDay();
    if (db.lastDueNotifyDay === today) return;

    const due = db.subjects.filter((s) => (s.nextReviewDate || today) <= today);
    if (due.length === 0) return;

    sendNotification("StudyPace reminder", `${due.length} subject(s) due for review today.`);
    const next = { ...db, lastDueNotifyDay: today };
    setDb(next);
    saveDB(next);
  }, [db]);

  /** -------------------- early return ONLY after hooks -------------------- */
  if (!db) return null;

  /** theme classes */
  const isDark = db.theme === "dark";
  const pageBg = isDark ? "bg-black text-zinc-50" : "bg-zinc-50 text-zinc-950";
  const headerBg = isDark ? "bg-black border-zinc-800" : "bg-white border-zinc-200";
  const muted = isDark ? "text-zinc-400" : "text-zinc-500";
  const subtleCard = isDark ? "bg-zinc-900/40 border-zinc-800" : "bg-zinc-100 border-zinc-200";
  const softBtn = isDark ? "bg-zinc-900" : "bg-zinc-100";
  const outlineBtn = isDark ? "border-zinc-800 bg-black" : "border-zinc-200 bg-white";
  const primaryBtn = isDark
    ? "bg-white text-black"
    : "bg-gradient-to-b from-zinc-950 to-zinc-900 text-white";
  const inputBase = isDark ? "border-zinc-800 bg-zinc-900" : "border-zinc-200 bg-zinc-100";

  /** toast helper */
  const showToast = (msg) => {
    setToast(msg);
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => setToast(""), 1800);
  };

  const setTheme = (t) => {
    const next = { ...db, theme: t };
    setDb(next);
    saveDB(next);
  };
  const toggleTheme = () => setTheme(isDark ? "light" : "dark");

  const finishOnboarding = () => {
    const next = { ...db, onboardingDone: true };
    setDb(next);
    saveDB(next);
    setModal(null);
  };

  const updateGoal = (val) => {
    const goal = Math.max(1, Math.min(10, Number(val || 1)));
    const next = { ...db, dailyGoal: goal };
    setDb(next);
    saveDB(next);
  };

  const submitSubject = () => {
    if (!subjectName.trim() || !examDate) return;
    const today = isoDay();
    const subject = {
      id: crypto.randomUUID(),
      name: subjectName.trim(),
      examDate,
      nextReviewDate: today,
      color: randomColor(),
      intervalDays: 1,
      easeStreak: 0,
    };

    const next = { ...db, subjects: [...db.subjects, subject] };
    setDb(next);
    saveDB(next);

    setSubjectName("");
    setExamDate("");
    if (next.subjects.length === 1) setActiveSubjectId(subject.id);

    setModal(null);
    showToast("Subject added ✅");
  };

  const openEdit = (sub) => {
    setEditId(sub.id);
    setEditName(sub.name);
    setEditExamDate(sub.examDate);
    setEditNextReviewDate(sub.nextReviewDate || isoDay());
    setEditColor(sub.color || "#2563eb");
    setModal("edit");
  };

  const saveEdit = () => {
    if (!editName.trim() || !editExamDate) return;
    const nextSubjects = db.subjects.map((s) =>
      s.id === editId
        ? {
            ...s,
            name: editName.trim(),
            examDate: editExamDate,
            nextReviewDate: editNextReviewDate,
            color: editColor,
          }
        : s
    );
    const next = { ...db, subjects: nextSubjects };
    setDb(next);
    saveDB(next);
    setModal("subjects");
    showToast("Subject updated ✨");
  };

  const deleteSubject = (id) => {
    const nextSubjects = db.subjects.filter((s) => s.id !== id);
    const nextSessions = db.sessions.filter((ses) => ses.subjectId !== id);
    const next = { ...db, subjects: nextSubjects, sessions: nextSessions };
    setDb(next);
    saveDB(next);
    if (activeSubjectId === id) setActiveSubjectId(nextSubjects[0]?.id || "");
    showToast("Subject deleted");
  };

  const openTimer = (subjectId) => {
    if (subjectId) setActiveSubjectId(subjectId);
    else if (!activeSubjectId && db.subjects[0]?.id) setActiveSubjectId(db.subjects[0].id);

    setSessionNote("");
    setMode("pomodoro");
    setSeconds(timerCfg.pomodoroMin * 60);
    setRunning(false);
    setModal("timer");
  };

  const setTimerMode = (m) => {
    setMode(m);
    setRunning(false);
    setSeconds(
      m === "pomodoro"
        ? timerCfg.pomodoroMin * 60
        : m === "short"
        ? timerCfg.shortMin * 60
        : timerCfg.longMin * 60
    );
  };

  const resetTimer = () => {
    setRunning(false);
    setSeconds(totalSecondsForMode);
  };

  const addTime = (min) => {
    setSeconds((s) => Math.max(0, s + min * 60));
    showToast(`+${min} min added`);
  };

  const skipTimer = () => {
    setRunning(false);
    setSeconds(0);
    showToast("Skipped ⏭️");
  };

  const saveTimerSettings = (patch) => {
    const next = { ...db, timer: { ...db.timer, ...patch } };
    setDb(next);
    saveDB(next);
  };

  const applyDifficulty = (difficulty) => {
    const today = isoDay();
    const next = { ...db, sessions: [...db.sessions] };

    // attach difficulty to last session
    const lastIdx = next.sessions.length - 1;
    if (lastIdx >= 0) next.sessions[lastIdx] = { ...next.sessions[lastIdx], difficulty };

    const sid = lastCompletedSubjectId || activeSubjectId || next.sessions[lastIdx]?.subjectId;

    next.subjects = next.subjects.map((s) => {
      if (s.id !== sid) return s;

      let interval = s.intervalDays || 1;
      let streak = s.easeStreak || 0;

      if (difficulty === "easy") {
        streak += 1;
        interval = Math.min(30, interval * 2);
      } else if (difficulty === "medium") {
        streak = 0;
        interval = Math.min(14, Math.max(2, interval));
      } else {
        streak = 0;
        interval = 1;
      }

      return {
        ...s,
        intervalDays: interval,
        easeStreak: streak,
        nextReviewDate: addDays(today, interval),
      };
    });

    // decide next break type
    const count = next.pomodoroCycleCount || 0;
    const shouldLong =
      count > 0 && count % (timerCfg.cyclesBeforeLong || 4) === 0;

    setDb(next);
    saveDB(next);
    setModal(null);

    const nextMode = shouldLong ? "long" : "short";
    setTimerMode(nextMode);

    if (timerCfg.autoStartBreak) setRunning(true);
    else setRunning(false);

    showToast(
      `Saved ${difficulty.toUpperCase()} ✅ → ${shouldLong ? "Long break" : "Short break"}`
    );
  };

  const resetAllData = () => {
    const fresh = defaultDB();
    if (canNotify()) fresh.notificationPermission = Notification.permission;
    setDb(fresh);
    saveDB(fresh);
    setActiveSubjectId("");
    setModal("welcome");
    showToast("Reset done");
  };

  const enableNotifications = async () => {
    if (!canNotify()) return showToast("Notifications not supported here");
    const perm = await Notification.requestPermission();
    const next = { ...db, notificationPermission: perm, notificationsEnabled: perm === "granted" };
    setDb(next);
    saveDB(next);
    if (perm === "granted") sendNotification("StudyPace", "Notifications enabled ✅");
    else showToast("Notification permission not granted");
  };

  const testNotification = () => {
    if (timerCfg.endSound) playEndSound();
    if (!canNotify()) return showToast("🔔 Sound played (no notification support)");
    if (db.notificationPermission !== "granted") return showToast("🔔 Sound played — allow notifications for popup");
    sendNotification("StudyPace Test", "This is a test reminder 🔔");
    showToast("Test notification sent ✅");
  };

  const selectCalendarDay = (iso) => {
    setSelectedDay(iso);
    setDayNoteDraft((db.calendarNotes?.[iso] || "").slice(0, 250));
  };

  const toggleStudiedForDay = (iso) => {
    const next = { ...db, manualStudied: { ...(db.manualStudied || {}) } };
    next.manualStudied[iso] = !next.manualStudied[iso];
    setDb(next);
    saveDB(next);
    showToast(next.manualStudied[iso] ? `Marked ${iso} as studied ✅` : `Unmarked ${iso}`);
  };

  const saveDayNote = (iso) => {
    const next = { ...db, calendarNotes: { ...(db.calendarNotes || {}) } };
    const text = dayNoteDraft.trim();
    if (text) next.calendarNotes[iso] = text;
    else delete next.calendarNotes[iso];
    setDb(next);
    saveDB(next);
    showToast(text ? "Note saved 📝" : "Note removed");
  };

  const jumpToToday = () => {
    const t = new Date();
    setCalView({ y: t.getFullYear(), m: t.getMonth() });
    selectCalendarDay(isoDay());
    showToast("Jumped to today");
  };

  const openSubjectDetail = (id) => {
    setSelectedSubjectDetailId(id);
    setModal("subjectDetail");
  };

  const openAchievementDetail = (key) => {
    setSelectedAchievementKey(key);
    setModal("achievementDetail");
  };

  /** ---------- Timer Ring Style ---------- */
  const ringStyle = {
    background: `conic-gradient(${isDark ? "#ffffff" : "#0a0a0a"} ${progressPct}%, ${
      isDark ? "#18181b" : "#e4e4e7"
    } 0%)`,
  };

  /** ---------- RENDER ---------- */
  return (
    <div className={cx("min-h-screen", pageBg)}>
      {/* tiny global CSS for animation (no extra files needed) */}
      <style jsx global>{`
        .fade-up {
          animation: fadeUp 160ms ease-out;
        }
        @keyframes fadeUp {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>

      {/* Toast */}
      {toast ? (
        <div className="fixed bottom-4 left-1/2 z-[60] -translate-x-1/2">
          <div
            className={cx(
              "rounded-xl px-4 py-3 text-sm font-semibold shadow-lg",
              isDark ? "bg-zinc-900" : "bg-white"
            )}
          >
            {toast}
          </div>
        </div>
      ) : null}

      {/* Header */}
      <header className={cx("border-b px-4 py-6 sm:px-6 md:px-8", headerBg)}>
        <div className="mx-auto flex w-full max-w-5xl items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">StudyPace</h1>
            <p className={cx("mt-2", muted)}>Your exam tracking dashboard</p>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <button
              onClick={() => setModal("subjects")}
              className={cx(
                "grid h-11 w-11 place-items-center rounded-xl border transition hover:scale-105",
                outlineBtn
              )}
              title="Subjects"
            >
              📚
            </button>

            <button
              onClick={() => setModal("about")}
              className={cx(
                "grid h-11 px-4 place-items-center rounded-xl border transition hover:scale-105",
                outlineBtn
              )}
              title="About"
            >
              About
            </button>

            <button
              onClick={() => {
                setAnalyticsTab("overview");
                setAnalyticsRange(7);
                setModal("analytics");
              }}
              className={cx(
                "grid h-11 w-11 place-items-center rounded-xl border transition hover:scale-105",
                outlineBtn
              )}
              title="Analytics"
            >
              📊
            </button>

            <button
              onClick={() => setModal("achievements")}
              className={cx(
                "grid h-11 w-11 place-items-center rounded-xl border transition hover:scale-105",
                outlineBtn
              )}
              title="Achievements"
            >
              🏆
            </button>

            <button
              onClick={toggleTheme}
              className={cx(
                "grid h-11 w-11 place-items-center rounded-xl border transition hover:scale-105",
                outlineBtn
              )}
              title="Toggle theme"
            >
              {isDark ? "🌙" : "☀️"}
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      {db.subjects.length === 0 ? (
        <main className="mx-auto flex w-full max-w-5xl flex-col items-center justify-center px-4 py-24 text-center sm:px-6 md:px-8">
          <div className="text-6xl">📚</div>
          <h2 className="mt-6 text-3xl font-bold">No subjects yet</h2>
          <p className={cx("mt-3", muted)}>Start tracking your first exam to stay on pace</p>

          <button
            onClick={() => setModal("add")}
            className={cx(
              "mt-8 h-14 w-full max-w-[340px] rounded-xl text-lg font-semibold shadow-lg transition hover:scale-[1.02] hover:opacity-95",
              primaryBtn
            )}
          >
            Add Your First Subject
          </button>
        </main>
      ) : (
        <main className="mx-auto w-full max-w-5xl space-y-5 px-4 py-10 sm:px-6 md:px-8">
          {/* Notifications */}
          <section className={cx("rounded-2xl border p-6", subtleCard)}>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-lg font-semibold">Enable Notifications</h3>
                <p className={cx("mt-1", muted)}>Get reminded when it’s time to review your subjects</p>
                <p className={cx("mt-1 text-sm", muted)}>
                  Permission: <span className="font-semibold">{db.notificationPermission}</span>
                </p>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  onClick={enableNotifications}
                  className={cx(
                    "h-11 w-full rounded-xl px-6 font-semibold transition hover:scale-[1.02] sm:w-auto",
                    primaryBtn
                  )}
                >
                  {db.notificationsEnabled ? "Enabled" : "Enable"}
                </button>

                <button
                  onClick={testNotification}
                  className={cx(
                    "h-11 w-full rounded-xl px-6 font-semibold transition hover:scale-[1.02] sm:w-auto",
                    softBtn
                  )}
                >
                  Test 🔔
                </button>
              </div>
            </div>
          </section>

          {/* Today's Goal */}
          <section
            className={cx(
              "rounded-2xl border p-6",
              isDark ? "border-zinc-800 bg-black" : "border-zinc-200 bg-white"
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-lg font-semibold">Today’s Goal</h3>
              <p className={muted}>
                {stats ? stats.todayDone : 0} / {stats ? stats.goal : 1} reviews
              </p>
            </div>

            <div
              className={cx(
                "mt-4 h-2 w-full overflow-hidden rounded-full",
                isDark ? "bg-zinc-900" : "bg-zinc-100"
              )}
            >
              <div
                className={cx(
                  "h-full rounded-full transition-all duration-500",
                  isDark ? "bg-white" : "bg-zinc-950"
                )}
                style={{
                  width: `${stats ? Math.min(100, (stats.todayDone / Math.max(1, stats.goal)) * 100) : 0}%`,
                }}
              />
            </div>

            <div className="mt-4 flex items-center gap-3">
              <span className={muted}>Daily goal</span>
              <input
                type="number"
                min={1}
                max={10}
                value={db.dailyGoal || 1}
                onChange={(e) => updateGoal(e.target.value)}
                className={cx("w-24 rounded-xl border px-3 py-2 outline-none", inputBase)}
              />
              <span className={cx("text-sm", muted)}>(1–10)</span>
            </div>
          </section>

          {/* Stats */}
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Card theme={db.theme}>
              <p className={muted}>Total Subjects</p>
              <p className="mt-3 text-4xl font-extrabold">{stats ? stats.totalSubjects : 0}</p>
            </Card>
            <Card theme={db.theme}>
              <p className={muted}>Due Today</p>
              <p className="mt-3 text-4xl font-extrabold">{stats ? stats.dueToday : 0}</p>
            </Card>
            <Card theme={db.theme}>
              <p className={muted}>Best Streak</p>
              <p className="mt-3 text-4xl font-extrabold">{stats ? stats.bestStreak : 0}</p>
            </Card>
          </section>

          {/* Quick cards */}
          <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <button
              onClick={() => {
                selectCalendarDay(isoDay());
                setModal("calendar");
              }}
              className="text-left"
            >
              <Card theme={db.theme}>
                <div className="flex items-start gap-3">
                  <div className="text-2xl">🗓️</div>
                  <div>
                    <h3 className="font-semibold">Calendar</h3>
                    <p className={muted}>View and log study days</p>
                  </div>
                </div>
              </Card>
            </button>

            <button onClick={() => openTimer()} className="text-left">
              <Card theme={db.theme}>
                <div className="flex items-start gap-3">
                  <div className="text-2xl">⏱️</div>
                  <div>
                    <h3 className="font-semibold">Start a Pomodoro</h3>
                    <p className={muted}>Quick focus session</p>
                  </div>
                </div>
              </Card>
            </button>
          </section>

          {/* Subjects list */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold">Your Subjects</h3>
              <div className="flex gap-2">
                <button
                  onClick={() => setModal("add")}
                  className={cx("rounded-xl px-4 py-2 font-semibold transition hover:scale-[1.02]", softBtn)}
                >
                  + Add
                </button>
                <button
                  onClick={() => setModal("subjects")}
                  className={cx("rounded-xl px-4 py-2 font-semibold transition hover:scale-[1.02]", softBtn)}
                >
                  Manage
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {db.subjects.slice(0, 6).map((sub) => {
                const today = isoDay();
                const due = (sub.nextReviewDate || today) <= today;

                return (
                  <Card key={sub.id} theme={db.theme}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="inline-block h-3 w-3 rounded-full" style={{ background: sub.color || "#2563eb" }} />
                          <div className="text-lg font-bold">{sub.name}</div>
                          {due ? (
                            <span className="ml-2 rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">
                              DUE
                            </span>
                          ) : null}
                        </div>

                        <div className={cx("mt-1", muted)}>Exam: {sub.examDate}</div>
                        <div className={cx("mt-1 text-sm", muted)}>
                          Next Review: <span className="font-semibold">{sub.nextReviewDate || today}</span>
                        </div>
                        <div className={cx("mt-1 text-xs", muted)}>
                          Interval: <span className="font-semibold">{sub.intervalDays || 1} day(s)</span>
                        </div>
                      </div>

                      <div className="flex flex-col gap-2">
                        <button
                          onClick={() => openTimer(sub.id)}
                          className={cx(
                            "rounded-xl px-4 py-2 font-semibold transition hover:scale-[1.02]",
                            primaryBtn
                          )}
                        >
                          Start
                        </button>
                        <button
                          onClick={() => openEdit(sub)}
                          className={cx(
                            "rounded-xl px-4 py-2 font-semibold transition hover:scale-[1.02]",
                            softBtn
                          )}
                        >
                          Edit
                        </button>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          </section>

          <div className="pt-2">
            <button
              onClick={resetAllData}
              className={cx("text-sm underline-offset-4 hover:underline", muted)}
            >
              Reset app data
            </button>
          </div>
        </main>
      )}

      {/* ---------------- MODALS ---------------- */}

      {modal === "welcome" ? (
        <Modal title="Welcome 👋" onClose={finishOnboarding} theme={db.theme}>
          <div className={cx("rounded-2xl border p-5", subtleCard)}>
            <p className="text-lg font-semibold">Welcome to StudyPace!</p>
            <p className={cx("mt-2", muted)}>
              Add subjects, use the Pomodoro timer, and rate difficulty — the app schedules your next review.
            </p>

            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:justify-end">
              <button
                onClick={() => setTheme(systemTheme())}
                className={cx("h-11 rounded-xl px-5 font-semibold transition hover:scale-[1.02]", softBtn)}
              >
                Use System Theme
              </button>
              <button
                onClick={finishOnboarding}
                className={cx("h-11 rounded-xl px-5 font-semibold transition hover:scale-[1.02]", primaryBtn)}
              >
                Let’s go
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {modal === "about" ? (
        <Modal title="About StudyPace" onClose={() => setModal(null)} theme={db.theme} wide>
          <div className={cx("rounded-2xl border p-6", isDark ? "border-zinc-800 bg-black" : "border-zinc-200 bg-white")}>
            <div className="text-2xl font-bold">StudyPace</div>
            <p className={cx("mt-2", muted)}>
              A simple exam tracker + Pomodoro timer with smart review scheduling (mini spaced repetition).
            </p>

            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className={cx("rounded-2xl border p-5", subtleCard)}>
                <div className="font-bold">Core Features</div>
                <ul className={cx("mt-2 list-disc pl-5", muted)}>
                  <li>Subjects + exam dates</li>
                  <li>Pomodoro timer + feedback</li>
                  <li>Auto review scheduling</li>
                  <li>Calendar notes + study marking</li>
                  <li>Analytics + achievements</li>
                </ul>
              </div>

              <div className={cx("rounded-2xl border p-5", subtleCard)}>
                <div className="font-bold">Timer Upgrades</div>
                <ul className={cx("mt-2 list-disc pl-5", muted)}>
                  <li>Custom durations</li>
                  <li>Auto start breaks / next Pomodoro</li>
                  <li>Long break every N cycles</li>
                  <li>Progress ring</li>
                  <li>Session notes</li>
                </ul>
              </div>
            </div>
          </div>
        </Modal>
      ) : null}

      {modal === "add" ? (
        <Modal title="Add Subject" onClose={() => setModal(null)} theme={db.theme}>
          <div className="space-y-4">
            <div>
              <div className="font-semibold">Subject</div>
              <input
                className={cx("mt-2 w-full rounded-xl border px-4 py-3 outline-none", inputBase)}
                placeholder="e.g., IT103 Database Systems"
                value={subjectName}
                onChange={(e) => setSubjectName(e.target.value)}
              />
            </div>
            <div>
              <div className="font-semibold">Exam Date</div>
              <input
                type="date"
                className={cx("mt-2 w-full rounded-xl border px-4 py-3 outline-none", inputBase)}
                value={examDate}
                onChange={(e) => setExamDate(e.target.value)}
              />
            </div>
            <button
              onClick={submitSubject}
              className={cx("h-12 w-full rounded-xl font-semibold transition hover:scale-[1.01]", primaryBtn)}
            >
              Start Tracking
            </button>
          </div>
        </Modal>
      ) : null}

      {modal === "subjects" ? (
        <Modal title="Manage Subjects" onClose={() => setModal(null)} theme={db.theme} wide>
          <div className="space-y-3">
            {db.subjects.length === 0 ? (
              <div className={muted}>No subjects yet.</div>
            ) : (
              db.subjects.map((sub) => (
                <div
                  key={sub.id}
                  className={cx(
                    "flex flex-col gap-3 rounded-2xl border p-5 sm:flex-row sm:items-center sm:justify-between",
                    isDark ? "border-zinc-800 bg-black" : "border-zinc-200 bg-white"
                  )}
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="inline-block h-3 w-3 rounded-full" style={{ background: sub.color || "#2563eb" }} />
                      <div className="text-lg font-bold">{sub.name}</div>
                    </div>
                    <div className={muted}>Exam: {sub.examDate}</div>
                    <div className={cx("text-sm", muted)}>Next Review: {sub.nextReviewDate || isoDay()}</div>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row">
                    <button
                      onClick={() => openTimer(sub.id)}
                      className={cx("rounded-xl px-4 py-2 font-semibold transition hover:scale-[1.02]", softBtn)}
                    >
                      Start Timer
                    </button>
                    <button
                      onClick={() => openEdit(sub)}
                      className={cx("rounded-xl px-4 py-2 font-semibold transition hover:scale-[1.02]", softBtn)}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => deleteSubject(sub.id)}
                      className="rounded-xl bg-red-600 px-4 py-2 font-semibold text-white transition hover:scale-[1.02]"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))
            )}

            <div className="pt-2">
              <button
                onClick={() => setModal("add")}
                className={cx("h-12 w-full rounded-xl font-semibold transition hover:scale-[1.01]", primaryBtn)}
              >
                + Add Subject
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {modal === "edit" ? (
        <Modal title="Edit Subject" onClose={() => setModal("subjects")} theme={db.theme}>
          <div className="space-y-4">
            <div>
              <div className="font-semibold">Subject Name</div>
              <input
                className={cx("mt-2 w-full rounded-xl border px-4 py-3 outline-none", inputBase)}
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>

            <div>
              <div className="font-semibold">Exam Date</div>
              <input
                type="date"
                className={cx("mt-2 w-full rounded-xl border px-4 py-3 outline-none", inputBase)}
                value={editExamDate}
                onChange={(e) => setEditExamDate(e.target.value)}
              />
            </div>

            <div>
              <div className="font-semibold">Next Review Date</div>
              <input
                type="date"
                className={cx("mt-2 w-full rounded-xl border px-4 py-3 outline-none", inputBase)}
                value={editNextReviewDate}
                onChange={(e) => setEditNextReviewDate(e.target.value)}
              />
              <p className={cx("mt-2 text-sm", muted)}>
                Tip: Updates automatically after Pomodoro feedback.
              </p>
            </div>

            <div>
              <div className="font-semibold">Color</div>
              <div className="mt-2 flex items-center gap-3">
                <input
                  type="color"
                  value={editColor}
                  onChange={(e) => setEditColor(e.target.value)}
                  className="h-12 w-16 rounded-xl border p-1"
                />
                <div className={muted}>Pick a subject color</div>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                onClick={() => setModal("subjects")}
                className={cx("h-11 rounded-xl px-5 font-semibold transition hover:scale-[1.02]", softBtn)}
              >
                Cancel
              </button>
              <button
                onClick={saveEdit}
                className={cx("h-11 rounded-xl px-5 font-semibold transition hover:scale-[1.02]", primaryBtn)}
              >
                Save
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {/* ✅ TIMER */}
      {modal === "timer" ? (
        <Modal
          title="Study Timer"
          onClose={() => {
            setRunning(false);
            setModal(null);
          }}
          theme={db.theme}
          wide
        >
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Left: timer */}
            <div className={cx("rounded-2xl border p-6", isDark ? "border-zinc-800 bg-black" : "border-zinc-200 bg-white")}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold">Studying</div>
                  <select
                    className={cx("mt-2 w-full rounded-xl border px-4 py-3 outline-none", inputBase)}
                    value={activeSubjectId || ""}
                    onChange={(e) => setActiveSubjectId(e.target.value)}
                  >
                    {db.subjects.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>

                  {nextDueSubject ? (
                    <button
                      onClick={() => {
                        setActiveSubjectId(nextDueSubject.id);
                        showToast(`Selected due subject: ${nextDueSubject.name}`);
                      }}
                      className={cx("mt-3 w-full rounded-xl px-4 py-2 font-semibold transition hover:scale-[1.01]", softBtn)}
                      title="Quick select"
                    >
                      ⭐ Select next due: {nextDueSubject.name}
                    </button>
                  ) : (
                    <div className={cx("mt-3 text-sm", muted)}>No due subjects right now 🎉</div>
                  )}
                </div>

                <div
                  className={cx("rounded-xl px-3 py-2 text-sm font-semibold", softBtn)}
                  title="Pomodoros since last long break"
                >
                  Cycle: {db.pomodoroCycleCount || 0}/{timerCfg.cyclesBeforeLong}
                </div>
              </div>

              <div className="mt-6 flex flex-wrap gap-2">
                {[
                  ["pomodoro", `Pomodoro (${timerCfg.pomodoroMin}m)`],
                  ["short", `Short (${timerCfg.shortMin}m)`],
                  ["long", `Long (${timerCfg.longMin}m)`],
                ].map(([m, label]) => (
                  <button
                    key={m}
                    onClick={() => setTimerMode(m)}
                    className={cx(
                      "rounded-xl px-4 py-2 font-semibold transition hover:scale-[1.02]",
                      mode === m ? primaryBtn : softBtn
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Progress ring */}
              <div className="mt-8 grid place-items-center">
                <div className="relative grid h-52 w-52 place-items-center rounded-full p-2" style={ringStyle}>
                  <div className={cx("grid h-48 w-48 place-items-center rounded-full border", isDark ? "border-zinc-800 bg-black" : "border-zinc-200 bg-white")}>
                    <div className="text-6xl font-extrabold tracking-wide">{fmt(seconds)}</div>
                    <div className={cx("mt-1 text-sm font-semibold", muted)}>{progressPct}%</div>
                  </div>
                </div>
              </div>

              {/* Controls */}
              <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <button
                  onClick={() => setRunning((r) => !r)}
                  className={cx("h-12 rounded-xl font-semibold transition hover:scale-[1.02] col-span-2 sm:col-span-2", primaryBtn)}
                >
                  {running ? "Pause" : "Start"}
                </button>
                <button
                  onClick={resetTimer}
                  className={cx("h-12 rounded-xl font-semibold transition hover:scale-[1.02]", softBtn)}
                >
                  Reset
                </button>
                <button
                  onClick={skipTimer}
                  className={cx("h-12 rounded-xl font-semibold transition hover:scale-[1.02]", softBtn)}
                >
                  Skip ⏭️
                </button>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3">
                <button
                  onClick={() => addTime(1)}
                  className={cx("h-11 rounded-xl font-semibold transition hover:scale-[1.02]", softBtn)}
                >
                  +1 min
                </button>
                <button
                  onClick={() => addTime(5)}
                  className={cx("h-11 rounded-xl font-semibold transition hover:scale-[1.02]", softBtn)}
                >
                  +5 min
                </button>
              </div>

              {/* Note */}
              <div className="mt-6">
                <div className="font-semibold">Session note</div>
                <textarea
                  className={cx("mt-2 w-full rounded-xl border px-4 py-3 outline-none", inputBase)}
                  rows={3}
                  placeholder="What are you focusing on? (saved in history)"
                  value={sessionNote}
                  onChange={(e) => setSessionNote(e.target.value)}
                />
                <div className={cx("mt-2 text-xs", muted)}>Saved automatically when Pomodoro ends.</div>
              </div>
            </div>

            {/* Right: settings */}
            <div className={cx("rounded-2xl border p-6", isDark ? "border-zinc-800 bg-black" : "border-zinc-200 bg-white")}>
              <div className="text-xl font-bold">Timer Settings</div>
              <p className={cx("mt-1", muted)}>Customize durations and auto-flow.</p>

              <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <div className="font-semibold">Pomodoro (min)</div>
                  <input
                    type="number"
                    min={5}
                    max={90}
                    value={timerCfg.pomodoroMin}
                    onChange={(e) => saveTimerSettings({ pomodoroMin: Number(e.target.value || 25) })}
                    className={cx("mt-2 w-full rounded-xl border px-4 py-3 outline-none", inputBase)}
                  />
                </div>
                <div>
                  <div className="font-semibold">Short break (min)</div>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={timerCfg.shortMin}
                    onChange={(e) => saveTimerSettings({ shortMin: Number(e.target.value || 5) })}
                    className={cx("mt-2 w-full rounded-xl border px-4 py-3 outline-none", inputBase)}
                  />
                </div>
                <div>
                  <div className="font-semibold">Long break (min)</div>
                  <input
                    type="number"
                    min={5}
                    max={60}
                    value={timerCfg.longMin}
                    onChange={(e) => saveTimerSettings({ longMin: Number(e.target.value || 15) })}
                    className={cx("mt-2 w-full rounded-xl border px-4 py-3 outline-none", inputBase)}
                  />
                </div>
                <div>
                  <div className="font-semibold">Long break every</div>
                  <input
                    type="number"
                    min={2}
                    max={8}
                    value={timerCfg.cyclesBeforeLong}
                    onChange={(e) => saveTimerSettings({ cyclesBeforeLong: Number(e.target.value || 4) })}
                    className={cx("mt-2 w-full rounded-xl border px-4 py-3 outline-none", inputBase)}
                  />
                  <div className={cx("mt-1 text-xs", muted)}>Pomodoros</div>
                </div>
              </div>

              <div className="mt-6 space-y-3">
                <label className={cx("flex items-center justify-between rounded-xl border p-4", isDark ? "border-zinc-800" : "border-zinc-200")}>
                  <div>
                    <div className="font-semibold">Auto-start breaks</div>
                    <div className={cx("text-sm", muted)}>After feedback, start break automatically</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={timerCfg.autoStartBreak}
                    onChange={(e) => saveTimerSettings({ autoStartBreak: e.target.checked })}
                    className="h-5 w-5"
                  />
                </label>

                <label className={cx("flex items-center justify-between rounded-xl border p-4", isDark ? "border-zinc-800" : "border-zinc-200")}>
                  <div>
                    <div className="font-semibold">Auto-start next Pomodoro</div>
                    <div className={cx("text-sm", muted)}>After break ends, start Pomodoro</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={timerCfg.autoStartPomodoro}
                    onChange={(e) => saveTimerSettings({ autoStartPomodoro: e.target.checked })}
                    className="h-5 w-5"
                  />
                </label>

                <label className={cx("flex items-center justify-between rounded-xl border p-4", isDark ? "border-zinc-800" : "border-zinc-200")}>
                  <div>
                    <div className="font-semibold">End sound</div>
                    <div className={cx("text-sm", muted)}>Plays when timer hits 0</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={timerCfg.endSound}
                    onChange={(e) => saveTimerSettings({ endSound: e.target.checked })}
                    className="h-5 w-5"
                  />
                </label>

                <button
                  onClick={() => {
                    if (timerCfg.endSound) playEndSound();
                    showToast("Sound test ✅");
                  }}
                  className={cx("h-11 w-full rounded-xl font-semibold transition hover:scale-[1.01]", softBtn)}
                >
                  Test sound
                </button>

                <button
                  onClick={() => {
                    const next = { ...db, pomodoroCycleCount: 0 };
                    setDb(next);
                    saveDB(next);
                    showToast("Cycle reset to 0");
                  }}
                  className={cx("h-11 w-full rounded-xl font-semibold transition hover:scale-[1.01]", softBtn)}
                >
                  Reset cycle counter
                </button>
              </div>
            </div>
          </div>
        </Modal>
      ) : null}

      {modal === "review" ? (
        <Modal title="Review Feedback" onClose={() => setModal(null)} theme={db.theme}>
          <div className="text-center">
            <p className={muted}>How difficult was this review?</p>
            <h3 className="mt-4 text-2xl font-bold">{activeSubject?.name || "Your subject"}</h3>
            <p className={cx("mt-2 text-sm", muted)}>
              Current interval: <span className="font-semibold">{activeSubject?.intervalDays || 1} day(s)</span>
            </p>

            <div className="mt-6 text-left">
              <div className="font-semibold">Saved note</div>
              <div className={cx("mt-2 rounded-xl border p-3 text-sm", isDark ? "border-zinc-800 bg-zinc-950" : "border-zinc-200 bg-zinc-100")}>
                {sessionNote.trim() ? sessionNote.trim() : <span className={muted}>No note</span>}
              </div>
            </div>

            <div className="mt-8 space-y-4">
              <button
                onClick={() => applyDifficulty("easy")}
                className="h-14 w-full rounded-xl bg-green-600 text-lg font-bold text-white transition hover:scale-[1.01]"
              >
                Easy (interval grows)
              </button>
              <button
                onClick={() => applyDifficulty("medium")}
                className="h-14 w-full rounded-xl bg-amber-600 text-lg font-bold text-white transition hover:scale-[1.01]"
              >
                Medium (steady)
              </button>
              <button
                onClick={() => applyDifficulty("hard")}
                className="h-14 w-full rounded-xl bg-red-600 text-lg font-bold text-white transition hover:scale-[1.01]"
              >
                Hard (reset interval)
              </button>
            </div>

            <div className={cx("mt-6 text-sm", muted)}>
              After saving, StudyPace will start a break (short or long) depending on your cycle settings.
            </div>
          </div>
        </Modal>
      ) : null}

      {/* ✅ CALENDAR */}
      {modal === "calendar" ? (
        <Modal title="Calendar" onClose={() => setModal(null)} theme={db.theme} wide>
          <div className="flex flex-col gap-6 lg:flex-row">
            <div className="flex-1">
              <div className="flex items-center justify-between gap-3">
                <button
                  onClick={() => {
                    const d = new Date(calView.y, calView.m - 1, 1);
                    setCalView({ y: d.getFullYear(), m: d.getMonth() });
                  }}
                  className={cx("rounded-xl px-4 py-2 font-semibold transition hover:scale-[1.02]", softBtn)}
                >
                  ← Previous
                </button>

                <div className="text-xl font-bold">{monthTitle}</div>

                <button
                  onClick={() => {
                    const d = new Date(calView.y, calView.m + 1, 1);
                    setCalView({ y: d.getFullYear(), m: d.getMonth() });
                  }}
                  className={cx("rounded-xl px-4 py-2 font-semibold transition hover:scale-[1.02]", softBtn)}
                >
                  Next →
                </button>
              </div>

              <div className="mt-4 flex items-center justify-between gap-3">
                <button
                  onClick={jumpToToday}
                  className={cx("rounded-xl px-4 py-2 font-semibold transition hover:scale-[1.02]", softBtn)}
                >
                  Today
                </button>
                <div className={cx("text-sm", muted)}>Click a day to add notes / mark studied</div>
              </div>

              <div className={cx("mt-5 grid grid-cols-7 gap-2 text-center sm:gap-3", muted)}>
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                  <div key={d} className="font-semibold">
                    {d}
                  </div>
                ))}
              </div>

              <div className="mt-3 grid grid-cols-7 gap-2 sm:gap-3">
                {calendarCells.map((c) => {
                  const has = studiedDays.has(c.iso);
                  const selected = selectedDay === c.iso;
                  const note = (db.calendarNotes?.[c.iso] || "").trim();

                  return (
                    <button
                      type="button"
                      key={c.iso}
                      onClick={() => selectCalendarDay(c.iso)}
                      className={cx(
                        "h-20 sm:h-24 rounded-2xl border p-3 transition text-left",
                        isDark ? "border-zinc-800 bg-black" : "border-zinc-200 bg-white",
                        !c.inMonth && "opacity-40",
                        has && (isDark ? "outline outline-2 outline-white" : "outline outline-2 outline-zinc-950"),
                        selected && (isDark ? "ring-2 ring-blue-500" : "ring-2 ring-blue-600")
                      )}
                      title={note ? note : c.iso}
                    >
                      <div className="flex items-start justify-between">
                        <div className="font-bold">{c.day}</div>
                        <div className="flex items-center gap-2">
                          {note ? <span className="text-xs">📝</span> : null}
                          {has ? (
                            <div className="h-2 w-2 rounded-full" style={{ background: activeSubject?.color || "#2563eb" }} />
                          ) : null}
                        </div>
                      </div>
                      {note ? <div className={cx("mt-2 text-xs", muted)}>{note}</div> : null}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="w-full lg:w-[360px]">
              <div className={cx("rounded-2xl border p-5", isDark ? "border-zinc-800 bg-black" : "border-zinc-200 bg-white")}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">Selected Day</div>
                    <div className="mt-1 text-xl font-bold">{selectedDay}</div>
                    <div className={cx("mt-1 text-sm", muted)}>
                      Sessions: <span className="font-semibold">{sessionsOnSelectedDay}</span>
                      {" · "}
                      Studied: <span className="font-semibold">{studiedDays.has(selectedDay) ? "Yes ✅" : "No"}</span>
                    </div>
                  </div>

                  <button
                    onClick={() => toggleStudiedForDay(selectedDay)}
                    className={cx("rounded-xl px-4 py-2 font-semibold transition hover:scale-[1.02]", softBtn)}
                  >
                    {db.manualStudied?.[selectedDay] ? "Unmark" : "Mark"}
                  </button>
                </div>

                <div className="mt-5">
                  <div className="font-semibold">Notes</div>
                  <textarea
                    className={cx("mt-2 w-full rounded-xl border px-4 py-3 outline-none", inputBase)}
                    rows={5}
                    placeholder="What did you study? What to improve next time?"
                    value={dayNoteDraft}
                    onChange={(e) => setDayNoteDraft(e.target.value)}
                  />
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <button
                      onClick={() => saveDayNote(selectedDay)}
                      className={cx("h-11 w-full rounded-xl font-semibold transition hover:scale-[1.02]", primaryBtn)}
                    >
                      Save Note
                    </button>
                    <button
                      onClick={() => {
                        setDayNoteDraft("");
                        saveDayNote(selectedDay);
                      }}
                      className={cx("h-11 w-full rounded-xl font-semibold transition hover:scale-[1.02]", softBtn)}
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <div className="mt-6">
                  <div className="font-semibold">Due subjects on / before this day</div>
                  <div className={cx("mt-2 text-sm", muted)}>
                    {dueSubjectsOnSelectedDay.length === 0 ? "None 🎉" : `${dueSubjectsOnSelectedDay.length} subject(s)`}
                  </div>

                  {dueSubjectsOnSelectedDay.length ? (
                    <div className="mt-3 space-y-2">
                      {dueSubjectsOnSelectedDay.slice(0, 6).map((s) => (
                        <button
                          key={s.id}
                          onClick={() => openSubjectDetail(s.id)}
                          className={cx(
                            "w-full text-left rounded-xl border px-3 py-2 transition hover:scale-[1.01]",
                            isDark ? "border-zinc-800" : "border-zinc-200"
                          )}
                        >
                          <div className="flex items-center gap-2 font-semibold">
                            <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color || "#2563eb" }} />
                            {s.name}
                          </div>
                          <div className={cx("text-xs", muted)}>Next review: {s.nextReviewDate || isoDay()}</div>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </Modal>
      ) : null}

      {/* ✅ ANALYTICS */}
      {modal === "analytics" ? (
        <Modal title="Analytics" onClose={() => setModal(null)} theme={db.theme} wide>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2">
              {[
                ["overview", "Overview"],
                ["subjects", "Subjects"],
                ["history", "History"],
              ].map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setAnalyticsTab(k)}
                  className={cx("rounded-xl px-4 py-2 font-semibold transition hover:scale-[1.02]", analyticsTab === k ? primaryBtn : softBtn)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <span className={muted}>Range</span>
              {[7, 30].map((n) => (
                <button
                  key={n}
                  onClick={() => setAnalyticsRange(n)}
                  className={cx("rounded-xl px-3 py-2 font-semibold transition hover:scale-[1.02]", analyticsRange === n ? primaryBtn : softBtn)}
                >
                  {n}d
                </button>
              ))}
            </div>
          </div>

          {analyticsTab === "overview" ? (
            <>
              <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
                {[
                  ["📚", db.subjects.length, "Subjects"],
                  ["✅", db.sessions.length, "Reviews"],
                  ["⏱️", `${Math.round(((db.sessions.length * timerCfg.pomodoroMin) / 60) * 10) / 10}h`, "Study Time"],
                  ["🔥", stats ? stats.bestStreak : 0, "Best Streak"],
                  ["🎯", db.dailyGoal || 1, "Daily Goal"],
                ].map(([icon, value, label]) => (
                  <button
                    key={label}
                    onClick={() => {
                      if (label === "Subjects") setAnalyticsTab("subjects");
                      if (label === "Reviews") setAnalyticsTab("history");
                    }}
                    className={cx(
                      "text-left rounded-2xl border p-5 transition hover:scale-[1.01]",
                      isDark ? "border-zinc-800 bg-black" : "border-zinc-200 bg-white"
                    )}
                    title="Click to explore"
                  >
                    <div className="text-2xl">{icon}</div>
                    <div className="mt-2 text-3xl font-extrabold">{value}</div>
                    <div className={cx("mt-1", muted)}>{label} (click)</div>
                  </button>
                ))}
              </div>

              <div className={cx("mt-8 rounded-2xl border p-6", isDark ? "border-zinc-800 bg-black" : "border-zinc-200 bg-white")}>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-xl font-bold">Activity</div>
                    <div className={muted}>Tap bars to jump to that date in Calendar</div>
                  </div>
                  <button
                    onClick={() => {
                      selectCalendarDay(isoDay());
                      setModal("calendar");
                    }}
                    className={cx("rounded-xl px-4 py-2 font-semibold transition hover:scale-[1.02]", softBtn)}
                  >
                    Open Calendar
                  </button>
                </div>

                <div className="mt-6 grid grid-cols-7 items-end gap-3">
                  {rangeActivity.slice(-7).map((d) => (
                    <button
                      key={d.iso}
                      onClick={() => {
                        const dt = new Date(d.iso);
                        setCalView({ y: dt.getFullYear(), m: dt.getMonth() });
                        selectCalendarDay(d.iso);
                        setModal("calendar");
                      }}
                      className="text-center"
                      title={`${d.count} activity on ${d.iso}`}
                    >
                      <div
                        className={cx("mx-auto w-8 rounded-xl transition-all", isDark ? "bg-white" : "bg-zinc-950")}
                        style={{ height: `${10 + d.count * 18}px` }}
                      />
                      <div className={cx("mt-2 text-sm", muted)}>{d.label}</div>
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : null}

          {analyticsTab === "subjects" ? (
            <div className="mt-6 space-y-3">
              <div className={cx("rounded-2xl border p-5", subtleCard)}>
                <div className="font-bold">Subjects Breakdown</div>
                <div className={cx("mt-1 text-sm", muted)}>Click a subject to open details + quick actions.</div>
              </div>

              {subjectStats.map((s) => (
                <button
                  key={s.id}
                  onClick={() => openSubjectDetail(s.id)}
                  className={cx(
                    "w-full text-left rounded-2xl border p-5 transition hover:scale-[1.01]",
                    isDark ? "border-zinc-800 bg-black" : "border-zinc-200 bg-white"
                  )}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="inline-block h-3 w-3 rounded-full" style={{ background: s.color }} />
                        <div className="text-lg font-bold">{s.name}</div>
                        {s.due ? (
                          <span className="ml-2 rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">
                            DUE
                          </span>
                        ) : null}
                      </div>
                      <div className={cx("mt-1 text-sm", muted)}>
                        Next review: <span className="font-semibold">{s.nextReviewDate}</span> · Interval:{" "}
                        <span className="font-semibold">{s.intervalDays}d</span>
                      </div>
                      <div className={cx("mt-1 text-sm", muted)}>
                        Last 7 days: <span className="font-semibold">{s.sessionsLast7}</span> · Total:{" "}
                        <span className="font-semibold">{s.totalSessions}</span>
                      </div>
                    </div>

                    <div className={cx("rounded-xl px-3 py-2 text-sm font-semibold", softBtn)}>View →</div>
                  </div>
                </button>
              ))}
            </div>
          ) : null}

          {analyticsTab === "history" ? (
            <div className="mt-6 space-y-3">
              <div className={cx("rounded-2xl border p-5", subtleCard)}>
                <div className="font-bold">Recent Pomodoro History</div>
                <div className={cx("mt-1 text-sm", muted)}>Click an item to open that subject.</div>
              </div>

              {history.length === 0 ? (
                <div className={muted}>No sessions yet.</div>
              ) : (
                history.map((h) => (
                  <button
                    key={h.id}
                    onClick={() => {
                      if (h.subjectId) openSubjectDetail(h.subjectId);
                      else showToast("Subject not found (maybe deleted)");
                    }}
                    className={cx(
                      "w-full text-left rounded-2xl border p-5 transition hover:scale-[1.01]",
                      isDark ? "border-zinc-800 bg-black" : "border-zinc-200 bg-white"
                    )}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2 font-bold">
                          <span className="inline-block h-3 w-3 rounded-full" style={{ background: h.color }} />
                          {h.subjectName}
                        </div>
                        <div className={cx("mt-1 text-sm", muted)}>
                          {h.day} · {h.time} · {h.minutes}min {h.difficulty ? `· ${h.difficulty}` : ""}
                        </div>
                        {h.note ? <div className={cx("mt-2 text-sm", muted)}>📝 {h.note}</div> : null}
                      </div>
                      <div className={cx("rounded-xl px-3 py-2 text-sm font-semibold", softBtn)}>Open →</div>
                    </div>
                  </button>
                ))
              )}
            </div>
          ) : null}
        </Modal>
      ) : null}

      {/* ✅ SUBJECT DETAIL */}
      {modal === "subjectDetail" && subjectDetail ? (
        <Modal title="Subject Details" onClose={() => setModal("analytics")} theme={db.theme} wide>
          <div className={cx("rounded-2xl border p-6", isDark ? "border-zinc-800 bg-black" : "border-zinc-200 bg-white")}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="inline-block h-3 w-3 rounded-full" style={{ background: subjectDetail.color || "#2563eb" }} />
                  <div className="text-2xl font-bold">{subjectDetail.name}</div>
                </div>
                <div className={cx("mt-1", muted)}>Exam: {subjectDetail.examDate}</div>
                <div className={cx("mt-1", muted)}>
                  Next Review: <span className="font-semibold">{subjectDetail.nextReviewDate || isoDay()}</span>
                </div>
                <div className={cx("mt-1", muted)}>
                  Interval: <span className="font-semibold">{subjectDetail.intervalDays || 1}d</span> · Ease streak:{" "}
                  <span className="font-semibold">{subjectDetail.easeStreak || 0}</span>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <button
                  onClick={() => {
                    setActiveSubjectId(subjectDetail.id);
                    openTimer(subjectDetail.id);
                  }}
                  className={cx("rounded-xl px-4 py-2 font-semibold transition hover:scale-[1.02]", primaryBtn)}
                >
                  Start Pomodoro
                </button>

                <button
                  onClick={() => openEdit(subjectDetail)}
                  className={cx("rounded-xl px-4 py-2 font-semibold transition hover:scale-[1.02]", softBtn)}
                >
                  Edit Subject
                </button>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
              {[
                ["Total reviews", subjectDetail.totalSessions],
                ["Last 7 days", subjectDetail.last7],
                ["Interval days", subjectDetail.intervalDays || 1],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className={cx("rounded-2xl border p-5 text-center", isDark ? "border-zinc-800" : "border-zinc-200")}
                >
                  <div className="text-3xl font-extrabold">{value}</div>
                  <div className={cx("mt-1 text-sm", muted)}>{label}</div>
                </div>
              ))}
            </div>

            <div className="mt-6">
              <div className="text-lg font-bold">Recent sessions</div>
              <div className={cx("mt-1", muted)}>Last 10 sessions</div>

              {subjectDetail.sessions.length === 0 ? (
                <div className={cx("mt-3", muted)}>No sessions yet.</div>
              ) : (
                <div className="mt-3 space-y-2">
                  {subjectDetail.sessions.map((s) => (
                    <div
                      key={s.id}
                      className={cx("rounded-xl border px-4 py-3", isDark ? "border-zinc-800" : "border-zinc-200")}
                    >
                      <div className="font-semibold">{s.completedAt.slice(0, 10)}</div>
                      <div className={cx("text-sm", muted)}>
                        {s.completedAt.slice(11, 16)} · {s.minutes || timerCfg.pomodoroMin}min{" "}
                        {s.difficulty ? `· ${s.difficulty}` : ""}
                      </div>
                      {s.note ? <div className={cx("mt-2 text-sm", muted)}>📝 {s.note}</div> : null}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                onClick={() => setModal("analytics")}
                className={cx("h-11 rounded-xl px-5 font-semibold transition hover:scale-[1.02]", softBtn)}
              >
                Back to Analytics
              </button>
              <button
                onClick={() => {
                  selectCalendarDay(isoDay());
                  setModal("calendar");
                }}
                className={cx("h-11 rounded-xl px-5 font-semibold transition hover:scale-[1.02]", primaryBtn)}
              >
                Open Calendar
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {/* ✅ ACHIEVEMENTS */}
      {modal === "achievements" ? (
        <Modal title="Achievements" onClose={() => setModal(null)} theme={db.theme} wide>
          <div className={cx("rounded-2xl border p-6", isDark ? "border-zinc-800 bg-black" : "border-zinc-200 bg-white")}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xl font-bold">Your Progress</div>
                <div className={cx("mt-1", muted)}>
                  {achievementsSummary.unlocked} of {achievementsSummary.total} unlocked
                </div>
              </div>
              <div className="text-3xl">🏆</div>
            </div>

            <div className={cx("mt-5 h-3 w-full overflow-hidden rounded-full", isDark ? "bg-zinc-900" : "bg-zinc-100")}>
              <div
                className={cx("h-full transition-all duration-500", isDark ? "bg-white" : "bg-zinc-950")}
                style={{ width: `${achievementsSummary.pct}%` }}
              />
            </div>
            <div className={cx("mt-3 text-center", muted)}>{achievementsSummary.pct}%</div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {achievementModel.map((a) => (
              <button
                key={a.key}
                onClick={() => openAchievementDetail(a.key)}
                className={cx(
                  "text-left rounded-2xl border p-6 transition hover:scale-[1.01]",
                  isDark ? "border-zinc-800 bg-black" : "border-zinc-200 bg-white",
                  !a.done && "opacity-80"
                )}
                title="Click for details"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-bold text-lg">{a.title}</div>
                    <div className={muted}>{a.desc}</div>
                    <div className={cx("mt-2 text-sm", muted)}>
                      Progress: <span className="font-semibold">{a.progressText}</span>
                    </div>
                  </div>
                  <div className="text-2xl">{a.done ? "✅" : "🔒"}</div>
                </div>

                <div className={cx("mt-4 rounded-xl px-3 py-2 text-sm font-semibold", softBtn)}>
                  View details →
                </div>
              </button>
            ))}
          </div>
        </Modal>
      ) : null}

      {/* ✅ ACHIEVEMENT DETAIL */}
      {modal === "achievementDetail" && achievementDetail ? (
        <Modal title="Achievement Details" onClose={() => setModal("achievements")} theme={db.theme}>
          <div className={cx("rounded-2xl border p-6", isDark ? "border-zinc-800 bg-black" : "border-zinc-200 bg-white")}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-2xl font-bold">{achievementDetail.title}</div>
                <div className={cx("mt-2", muted)}>{achievementDetail.desc}</div>
                <div className={cx("mt-3", muted)}>
                  Progress: <span className="font-semibold">{achievementDetail.progressText}</span>
                </div>
                <div className={cx("mt-2", muted)}>
                  Status: <span className="font-semibold">{achievementDetail.done ? "Unlocked ✅" : "Locked 🔒"}</span>
                </div>
              </div>

              <div className="text-4xl">{achievementDetail.done ? "🏅" : "🎯"}</div>
            </div>

            <div className={cx("mt-6 rounded-2xl border p-5", subtleCard)}>
              <div className="font-bold">Quick actions</div>
              <div className={cx("mt-2", muted)}>Do these now to progress faster.</div>

              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <button
                  onClick={() => {
                    setModal(null);
                    openTimer();
                    showToast("Start a Pomodoro now ✅");
                  }}
                  className={cx("h-11 w-full rounded-xl px-5 font-semibold transition hover:scale-[1.02]", primaryBtn)}
                >
                  Start Pomodoro
                </button>

                <button
                  onClick={() => {
                    selectCalendarDay(isoDay());
                    setModal("calendar");
                    showToast("Log your day in Calendar 🗓️");
                  }}
                  className={cx("h-11 w-full rounded-xl px-5 font-semibold transition hover:scale-[1.02]", softBtn)}
                >
                  Open Calendar
                </button>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setModal("achievements")}
                className={cx("h-11 rounded-xl px-5 font-semibold transition hover:scale-[1.02]", softBtn)}
              >
                Back
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}