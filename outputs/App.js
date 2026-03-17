import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { supabase } from "./supabase";

// ─── DESIGN TOKENS ───────────────────────────────────────────────
const C = {
  sand: "#E8E0D5", sandLight: "#F2EDE7", sandDark: "#C9BFB3",
  slate: "#3D4A4F", slateLight: "#5A6B72", slateDark: "#2A3438",
  warm: "#8B7355", warmLight: "#A08C6E",
  accent: "#C17B4E", accentLight: "#D4956A",
  green: "#5C7A5E", greenLight: "#7A9E7C",
  white: "#FAF8F5", offwhite: "#F5F0EB",
  kids: "#E8854A", kidsLight: "#F0A070",
  kidsBlue: "#5B8DB8", kidsPurple: "#9B7EC8",
  error: "#C0504D",
};

const MEMBER_COLORS = [C.accent, C.green, C.warm, C.kids, C.kidsBlue, C.slateLight, C.kidsPurple, C.warmLight];

// ─── HELPERS ──────────────────────────────────────────────────────
function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function getMotivation(done, total) {
  if (total === 0) return "Add your first ritual below";
  if (done === 0) return "Ready when you are — let's build something good";
  if (done === total) return "Every ritual complete. You showed up today. ✦";
  if (done / total >= 0.6) return "You're on a roll — keep the momentum going";
  if (done === 1) return "One down. The hardest one is always the first";
  return `${total - done} ritual${total - done > 1 ? "s" : ""} left — you've got this`;
}

function todayKey() {
  return new Date().toISOString().split("T")[0];
}

function getYesterdayKey() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split("T")[0];
}

function getTodayIndex() {
  return (new Date().getDay() + 6) % 7;
}

function getWeekDates() {
  const today = new Date();
  const day = today.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(today);
  monday.setDate(today.getDate() + mondayOffset);
  monday.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d.toISOString().split("T")[0];
  });
}

// ─── SUPABASE NORMALISERS ─────────────────────────────────────────
function normalizeMember(m) {
  return {
    id: m.id, familyId: m.family_id,
    name: m.name, avatar: m.avatar, color: m.color,
    isKid: m.is_kid || false, points: m.points || 0, streak: m.streak || 0,
  };
}

function normalizeHabit(h) {
  return {
    id: h.id, familyId: h.family_id,
    name: h.name, icon: h.icon,
    category: h.category, categoryId: h.category_id,
    color: h.color, location: h.location,
    target: h.target || 1, streak: h.streak || 0,
    isKid: h.is_kid || false, isCustom: h.is_custom || false,
    tileUid: h.tile_uid || null,
    isShared: h.is_shared ?? true,
    assignedMemberIds: h.assigned_member_ids || null,
    daysActive: h.days_active || null,
    completionType: h.completion_type || 'individual',
  };
}

function normalizeCompletion(c) {
  return {
    id: c.id, habitId: c.habit_id, memberId: c.member_id,
    familyId: c.family_id, date: c.date, taps: c.taps || 0,
    completedAt: c.completed_at || null,
  };
}

// ─── SUPABASE FETCH HELPERS ───────────────────────────────────────
async function fetchFamilyData(pin) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("families")
    .select("*, members(*), habits(*), rewards(*)")
    .eq("pin", pin)
    .single();
  if (error || !data) { console.error("❌ fetchFamilyData error:", error); return null; }
  return {
    id: data.id, name: data.name, pin: data.pin,
    members: (data.members || []).map(normalizeMember),
    habits: (data.habits || []).map(normalizeHabit),
    rewards: data.rewards || [],
  };
}

async function fetchTodayCompletions(familyId) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("completions").select("*")
    .eq("family_id", familyId).eq("date", todayKey());
  if (error) console.error("❌ fetchTodayCompletions error:", error);
  return (data || []).map(normalizeCompletion);
}

async function fetchWeekCompletions(familyId) {
  if (!supabase) return [];
  const dates = getWeekDates();
  const { data } = await supabase
    .from("completions").select("*")
    .eq("family_id", familyId)
    .gte("date", dates[0]).lte("date", dates[6]);
  return (data || []).map(normalizeCompletion);
}

async function fetchAnalyticsData(familyId) {
  if (!supabase) return [];
  const d = new Date();
  d.setDate(d.getDate() - 30);
  const { data } = await supabase
    .from("completions").select("*")
    .eq("family_id", familyId)
    .gte("date", d.toISOString().split("T")[0]);
  return (data || []).map(normalizeCompletion);
}

// ─── STYLES ───────────────────────────────────────────────────────
const inputStyle = {
  width: "100%", padding: "13px 16px", borderRadius: 14,
  border: `1.5px solid ${C.sandDark}`, background: C.white,
  fontSize: 15, color: C.slate, outline: "none",
  fontFamily: "'DM Sans', sans-serif", transition: "border-color 0.2s ease",
  boxSizing: "border-box",
};

const btnPrimary = {
  width: "100%", padding: "15px", borderRadius: 16, border: "none",
  background: `linear-gradient(135deg, ${C.accent}, ${C.accentLight})`,
  color: C.white, fontSize: 15, fontWeight: 700, cursor: "pointer",
  fontFamily: "'DM Sans', sans-serif",
  boxShadow: `0 6px 20px ${C.accent}40`,
};

// ─── TILE HELPERS ─────────────────────────────────────────────────
function tileLabel(uid) {
  if (!uid) return "";
  const clean = uid.replace(/:/g, "");
  return clean.length <= 8 ? clean : "…" + clean.slice(-6);
}

// ─── SOUND + HAPTICS ──────────────────────────────────────────────
function playCompletionSound(type = "regular") {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const note = (freq, t, dur, vol = 0.28) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.connect(g); g.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.02);
      g.gain.linearRampToValueAtTime(0, t + dur);
      osc.start(t); osc.stop(t + dur + 0.05);
    };
    const n = ctx.currentTime;
    if (type === "kids") {
      note(261.63, n, 0.15); note(329.63, n + 0.1, 0.15);
      note(392, n + 0.2, 0.15); note(523.25, n + 0.3, 0.2);
    } else if (type === "milestone") {
      note(261.63, n, 0.15); note(329.63, n + 0.1, 0.15);
      note(392, n + 0.2, 0.15); note(523.25, n + 0.3, 0.15);
      note(392, n + 0.45, 0.25, 0.38);
    } else if (type === "undo") {
      note(392, n, 0.1, 0.18); note(329.63, n + 0.08, 0.1, 0.13);
      note(261.63, n + 0.16, 0.15, 0.08);
    } else {
      note(261.63, n, 0.18); note(329.63, n + 0.06, 0.18); note(392, n + 0.12, 0.18);
    }
    setTimeout(() => ctx.close(), 900);
  } catch (_) {}
}

function triggerHaptic(type = "regular") {
  if (!navigator.vibrate) return;
  if (type === "kids") navigator.vibrate([50, 100, 50]);
  else if (type === "milestone") navigator.vibrate([30, 50, 50, 50, 80]);
  else if (type === "undo") navigator.vibrate(30);
  else navigator.vibrate(50);
}

// ─── GEAR ICON ────────────────────────────────────────────────────
function GearIcon({ color, size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  );
}

// ─── CATEGORIES ───────────────────────────────────────────────────
const CATEGORIES = [
  {
    id: "family", name: "Family & Chores", icon: "🏠", color: C.warm,
    description: "Build routines at home",
    habits: [
      { name: "Make your bed", icon: "🛏", location: "Bedroom", target: 1 },
      { name: "Clear the dinner table", icon: "🍽", location: "Dining table", target: 1 },
      { name: "Empty the dishwasher", icon: "✨", location: "Kitchen", target: 1 },
      { name: "Take out the trash", icon: "🗑", location: "Kitchen door", target: 1 },
      { name: "Feed the pet", icon: "🐾", location: "Kitchen", target: 1 },
      { name: "Tidy your room", icon: "📦", location: "Bedroom", target: 1 },
      { name: "Pack your school bag", icon: "🎒", location: "Bedroom", target: 1 },
    ]
  },
  {
    id: "health", name: "Health & Body", icon: "💊", color: C.green,
    description: "Care for yourself daily",
    habits: [
      { name: "Morning medication", icon: "💊", location: "Bathroom shelf", target: 1 },
      { name: "Evening medication", icon: "🌙", location: "Bedside table", target: 1 },
      { name: "Drink a glass of water", icon: "💧", location: "Kitchen", target: 8 },
      { name: "Take vitamins", icon: "🌿", location: "Kitchen", target: 1 },
      { name: "Morning stretch", icon: "🧘", location: "Bedroom floor", target: 1 },
      { name: "Weigh in", icon: "⚖️", location: "Bathroom", target: 1 },
      { name: "Skincare routine", icon: "✨", location: "Bathroom mirror", target: 1 },
    ]
  },
  {
    id: "screenfree", name: "Screen-Free Time", icon: "📵", color: C.slateLight,
    description: "Presence over phones",
    habits: [
      { name: "Phone down at dinner", icon: "🍴", location: "Dining table", target: 1 },
      { name: "Phone down at bedtime", icon: "🌙", location: "Bedside table", target: 1 },
      { name: "Homework focus mode", icon: "📚", location: "Desk", target: 1 },
      { name: "Family screen-free hour", icon: "👨‍👩‍👧", location: "Living room", target: 1 },
      { name: "Morning phone-free time", icon: "☀️", location: "Kitchen", target: 1 },
    ]
  },
  {
    id: "morning", name: "Morning Routine", icon: "☀️", color: C.accent,
    description: "Own your morning",
    habits: [
      { name: "Wake up on time", icon: "⏰", location: "Bedside table", target: 1 },
      { name: "Make coffee / breakfast", icon: "☕", location: "Kitchen", target: 1 },
      { name: "Brush teeth", icon: "🦷", location: "Bathroom", target: 1 },
      { name: "Exercise or movement", icon: "🏃", location: "Home entrance", target: 1 },
      { name: "Journal or gratitude", icon: "📓", location: "Desk", target: 1 },
      { name: "Review daily priorities", icon: "📋", location: "Desk", target: 1 },
      { name: "No phone 30 minutes", icon: "📵", location: "Bedroom", target: 1 },
    ]
  },
  {
    id: "learning", name: "Learning & Growth", icon: "📖", color: C.warm,
    description: "Keep growing every day",
    habits: [
      { name: "Read for 20 minutes", icon: "📖", location: "Armchair / Desk", target: 1 },
      { name: "Practice an instrument", icon: "🎸", location: "Living room", target: 1 },
      { name: "Language learning", icon: "🌍", location: "Desk", target: 1 },
      { name: "Study block", icon: "📚", location: "Desk", target: 1 },
      { name: "Educational podcast", icon: "🎧", location: "Anywhere", target: 1 },
      { name: "Flashcard review", icon: "🃏", location: "Desk", target: 1 },
    ]
  },
  {
    id: "mindfulness", name: "Mindfulness", icon: "🧘", color: C.slateLight,
    description: "Quiet the noise",
    habits: [
      { name: "Meditate", icon: "🧘", location: "Bedroom", target: 1 },
      { name: "Gratitude journaling", icon: "📓", location: "Desk", target: 1 },
      { name: "Evening wind-down", icon: "🌙", location: "Bedside table", target: 1 },
      { name: "Breathing exercise", icon: "🌬", location: "Anywhere", target: 1 },
      { name: "Digital detox hour", icon: "📵", location: "Living room", target: 1 },
      { name: "Pray or reflect", icon: "🙏", location: "Anywhere", target: 1 },
    ]
  },
  {
    id: "fitness", name: "Fitness", icon: "🏋️", color: C.green,
    description: "Move your body",
    habits: [
      { name: "Morning workout", icon: "💪", location: "Gym bag / Door", target: 1 },
      { name: "Evening walk", icon: "🚶", location: "Front door", target: 1 },
      { name: "Stretching routine", icon: "🤸", location: "Living room", target: 1 },
      { name: "Log water intake", icon: "💧", location: "Kitchen", target: 1 },
      { name: "Meal prep", icon: "🥗", location: "Kitchen", target: 1 },
      { name: "Post-workout recovery", icon: "🛁", location: "Bathroom", target: 1 },
    ]
  },
  {
    id: "kids", name: "Kids Special", icon: "⭐", color: C.kids,
    description: "Made for little champions", isKids: true,
    habits: [
      { name: "Homework done", icon: "📚", location: "Desk", target: 1 },
      { name: "Reading time", icon: "📖", location: "Bedroom", target: 1 },
      { name: "Practice instrument", icon: "🎵", location: "Living room", target: 1 },
      { name: "Help with dinner", icon: "🍳", location: "Kitchen", target: 1 },
      { name: "Be kind moment", icon: "💛", location: "Anywhere", target: 1 },
      { name: "Screen-free afternoon", icon: "🌳", location: "Living room", target: 1 },
      { name: "Outdoor play", icon: "⚽", location: "Back door", target: 1 },
    ]
  },
];

const CUSTOM_EMOJIS = ["😊","🏠","💪","📚","🎯","🌟","⭐","✨","🔥","💧","🍎","🥗","🏃","🧘","📖","🎵","☕","🍕","🌱","💼","🎨","🎮","📱","💻","🛏","🍽","🧹","🚿","🎉","🌈","🦋","🌸","🎸","🏆","💎","🌍","🎧","📓","🌙","☀️"];

// ─── LOGIN SCREEN ─────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [view, setView] = useState("welcome");
  const [familyName, setFamilyName] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [createdFamilyId, setCreatedFamilyId] = useState(null);
  const [members, setMembers] = useState([]);
  const [memberName, setMemberName] = useState("");
  const [memberIsKid, setMemberIsKid] = useState(false);
  const [memberColorIdx, setMemberColorIdx] = useState(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { const t = setTimeout(() => setMounted(true), 80); return () => clearTimeout(t); }, []);

  useEffect(() => {
    const handle = (e) => {
      if (e.key !== "Enter") return;
      if (view === "join") handleJoin();
      else if (view === "create") handleCreate();
      else if (view === "addMembers") { if (memberName.trim()) addMember(); else if (members.length > 0) finishSetup(); }
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [view, familyName, pin, loading, memberName, members]);


  const darkInput = {
    ...inputStyle,
    background: "rgba(255,255,255,0.1)",
    border: "1.5px solid rgba(255,255,255,0.2)",
    color: C.white,
  };

  const handleJoin = async () => {
    setError("");
    if (!familyName.trim() || pin.length < 4) { setError("Enter your family name and a 4-digit PIN"); return; }
    if (!supabase) { setError("App not configured. Check Supabase credentials."); return; }
    setLoading(true);
    try {
      const { data: fam } = await supabase.from("families").select("id,name,pin").eq("pin", pin).single();
      if (!fam) { setError("No family found with that PIN."); return; }
      if (fam.name.toLowerCase() !== familyName.trim().toLowerCase()) { setError("Family name doesn't match that PIN."); return; }
      const familyData = await fetchFamilyData(pin);
      if (!familyData) { setError("Failed to load family. Try again."); return; }
      localStorage.setItem("ritual_savedPin", pin);
      onLogin(familyData);
    } catch { setError("Something went wrong. Please try again."); }
    finally { setLoading(false); }
  };

  const handleCreate = async () => {
    setError("");
    if (!familyName.trim()) { setError("Enter a family name"); return; }
    if (pin.length !== 4 || !/^\d+$/.test(pin)) { setError("PIN must be exactly 4 digits"); return; }
    if (!supabase) { setError("App not configured. Check Supabase credentials."); return; }
    setLoading(true);
    try {
      const { data: existing } = await supabase.from("families").select("id").eq("pin", pin).single();
      if (existing) { setError("That PIN is already taken. Choose another."); return; }
      const { data: newFam, error: fe } = await supabase.from("families").insert({ name: familyName.trim(), pin }).select().single();
      if (fe || !newFam) { setError("Failed to create family. Try again."); return; }
      setCreatedFamilyId(newFam.id);
      setView("addMembers");
    } catch { setError("Something went wrong. Please try again."); }
    finally { setLoading(false); }
  };

  const addMember = () => {
    if (!memberName.trim()) return;
    setMembers(prev => [...prev, {
      id: `local_${Date.now()}`, name: memberName.trim(),
      avatar: memberName.trim()[0].toUpperCase(),
      isKid: memberIsKid, color: MEMBER_COLORS[memberColorIdx],
      points: 0, streak: 0,
    }]);
    setMemberName(""); setMemberIsKid(false);
    setMemberColorIdx(prev => (prev + 1) % MEMBER_COLORS.length);
  };

  const finishSetup = async () => {
    if (members.length === 0) { setError("Add at least one family member"); return; }
    setLoading(true);
    try {
      await supabase.from("members").insert(members.map(m => ({
        family_id: createdFamilyId, name: m.name, avatar: m.avatar,
        color: m.color, is_kid: m.isKid, points: 0, streak: 0,
      })));
      await supabase.from("rewards").insert([
        { family_id: createdFamilyId, name: "30 min extra screen time", points: 500, icon: "📱", who: "Kids", color: C.kids },
        { family_id: createdFamilyId, name: "Choose dinner", points: 750, icon: "🍕", who: "Everyone", color: C.accent },
        { family_id: createdFamilyId, name: "Family movie night", points: 2000, icon: "🎬", who: "Everyone", color: C.green },
      ]);
      const familyData = await fetchFamilyData(pin);
      if (!familyData) { setError("Setup done but failed to load. Try logging in."); return; }
      localStorage.setItem("ritual_savedPin", pin);
      onLogin(familyData);
    } catch { setError("Something went wrong. Please try again."); }
    finally { setLoading(false); }
  };

  return (
    <div style={{
      minHeight: "100vh", maxWidth: 390, margin: "0 auto",
      background: `linear-gradient(160deg, ${C.slateDark} 0%, ${C.slate} 60%, ${C.warm}40 100%)`,
      padding: "48px 28px 40px",
      opacity: mounted ? 1 : 0, transition: "opacity 0.5s ease",
      position: "relative", overflow: "hidden",
    }}>
      <div style={{ position: "absolute", top: -60, right: -60, width: 200, height: 200, borderRadius: "50%", background: `${C.accent}15` }} />
      <div style={{ position: "absolute", bottom: -40, left: -40, width: 160, height: 160, borderRadius: "50%", background: `${C.warm}10` }} />
      <div style={{ position: "relative", zIndex: 1 }}>

        {view === "welcome" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ textAlign: "center", padding: "32px 0 16px" }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>◈</div>
              <div style={{ fontSize: 36, fontWeight: 700, color: C.white, fontFamily: "'Cormorant Garamond', serif", lineHeight: 1.1, marginBottom: 8 }}>Welcome to Ritual</div>
              <div style={{ fontSize: 14, color: "rgba(255,255,255,0.6)", lineHeight: 1.6 }}>Build habits that actually stick.<br />Start your family's ritual today.</div>
            </div>
            <button onClick={() => setView("create")} style={btnPrimary}>Create a new family</button>
            <button onClick={() => setView("join")} style={{ ...btnPrimary, background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.2)", boxShadow: "none" }}>Join existing family</button>
          </div>
        )}

        {view === "join" && (
          <div>
            <button onClick={() => { setView("welcome"); setError(""); }} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.6)", fontSize: 13, marginBottom: 24 }}>← Back</button>
            <div style={{ fontSize: 24, fontWeight: 700, color: C.white, fontFamily: "'Cormorant Garamond', serif", marginBottom: 6 }}>Join your family</div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", marginBottom: 28 }}>Enter the name and PIN your family set up</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <input style={darkInput} placeholder="Family name" value={familyName} onChange={e => setFamilyName(e.target.value)} autoComplete="off" />
              <input style={darkInput} placeholder="4-digit PIN" type="tel" maxLength={4} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} />
              {error && <div style={{ fontSize: 12, color: "#FF8A80", textAlign: "center" }}>{error}</div>}
              <button onClick={handleJoin} disabled={loading} style={{ ...btnPrimary, opacity: loading ? 0.7 : 1 }}>{loading ? "Joining…" : "Join Family"}</button>
            </div>
          </div>
        )}

        {view === "create" && (
          <div>
            <button onClick={() => { setView("welcome"); setError(""); }} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.6)", fontSize: 13, marginBottom: 24 }}>← Back</button>
            <div style={{ fontSize: 24, fontWeight: 700, color: C.white, fontFamily: "'Cormorant Garamond', serif", marginBottom: 6 }}>Create your family</div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", marginBottom: 28 }}>Choose a name and PIN — share the PIN so family can join on other devices</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <input style={darkInput} placeholder="Family name e.g. The Bekkers" value={familyName} onChange={e => setFamilyName(e.target.value)} autoComplete="off" />
              <input style={darkInput} placeholder="Choose a 4-digit PIN" type="tel" maxLength={4} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} />
              {error && <div style={{ fontSize: 12, color: "#FF8A80", textAlign: "center" }}>{error}</div>}
              <button onClick={handleCreate} disabled={loading} style={{ ...btnPrimary, opacity: loading ? 0.7 : 1 }}>{loading ? "Creating…" : "Continue →"}</button>
            </div>
          </div>
        )}

        {view === "addMembers" && (
          <div>
            <div style={{ fontSize: 24, fontWeight: 700, color: C.white, fontFamily: "'Cormorant Garamond', serif", marginBottom: 4 }}>Add family members</div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", marginBottom: 20 }}>Add everyone who'll be using Ritual</div>
            {members.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                {members.map(m => (
                  <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px 6px 6px", background: "rgba(255,255,255,0.12)", borderRadius: 30 }}>
                    <div style={{ width: 28, height: 28, borderRadius: "50%", background: m.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: C.white }}>{m.avatar}</div>
                    <span style={{ fontSize: 13, color: C.white }}>{m.name}</span>
                    {m.isKid && <span style={{ fontSize: 10, color: C.kids }}>⭐</span>}
                    <button onClick={() => setMembers(ms => ms.filter(x => x.id !== m.id))} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.4)", fontSize: 14, padding: 0 }}>×</button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ background: "rgba(255,255,255,0.08)", borderRadius: 20, padding: 16, marginBottom: 12 }}>
              <input style={{ ...darkInput, marginBottom: 10 }} placeholder="Name" value={memberName} onChange={e => setMemberName(e.target.value)} autoComplete="off" />
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                {MEMBER_COLORS.map((col, i) => (
                  <div key={i} onClick={() => setMemberColorIdx(i)} style={{ flex: 1, height: 28, borderRadius: 8, background: col, cursor: "pointer", border: memberColorIdx === i ? `2.5px solid ${C.white}` : "2.5px solid transparent" }} />
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                {[{ label: "Adult", val: false }, { label: "Kid ⭐", val: true }].map(opt => (
                  <div key={String(opt.val)} onClick={() => setMemberIsKid(opt.val)} style={{ flex: 1, padding: "8px", borderRadius: 12, textAlign: "center", cursor: "pointer", fontSize: 13, fontWeight: 600, background: memberIsKid === opt.val ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.08)", border: memberIsKid === opt.val ? "1.5px solid rgba(255,255,255,0.4)" : "1.5px solid transparent", color: C.white }}>{opt.label}</div>
                ))}
              </div>
              <button onClick={addMember} style={{ ...btnPrimary, padding: "11px", background: "rgba(255,255,255,0.15)", boxShadow: "none", fontSize: 14, border: "1px solid rgba(255,255,255,0.2)" }}>+ Add member</button>
            </div>
            {error && <div style={{ fontSize: 12, color: "#FF8A80", textAlign: "center", marginBottom: 8 }}>{error}</div>}
            {members.length > 0 && (
              <button onClick={finishSetup} disabled={loading} style={{ ...btnPrimary, opacity: loading ? 0.7 : 1 }}>{loading ? "Setting up…" : "Start Ritual →"}</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── WHO DID THIS? ────────────────────────────────────────────────
function WhoDidThis({ habit, members, onSelect, onCancel }) {
  // Filter to only show assigned members (if habit has specific assignments)
  let displayMembers;
  if (habit.assignedMemberIds && habit.assignedMemberIds.length > 0) {
    displayMembers = members.filter(m => habit.assignedMemberIds.includes(m.id));
    // Fallback: if assigned IDs are orphaned, show kids or all
    if (displayMembers.length === 0) {
      const kids = members.filter(m => m.isKid);
      displayMembers = kids.length > 0 ? kids : members;
    }
  } else {
    // Everyone habit — show kids if it's a kids habit, otherwise all members
    const kids = members.filter(m => m.isKid);
    displayMembers = habit.isKid && kids.length > 0 ? kids : members;
  }

  useEffect(() => {
    const handle = (e) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [onCancel]);
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 990, background: "rgba(42,52,56,0.97)", backdropFilter: "blur(12px)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 28px", animation: "fadeUp 0.3s ease", overflowY: "auto" }}>
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        <div style={{ fontSize: 44, marginBottom: 12 }}>{habit.icon}</div>
        <div style={{ fontSize: 24, fontWeight: 700, color: C.white, fontFamily: "'Cormorant Garamond', serif", marginBottom: 8 }}>Who completed this?</div>
        <div style={{ fontSize: 14, color: "rgba(255,255,255,0.5)" }}>{habit.name}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%", maxWidth: 340 }}>
        {displayMembers.map(m => (
          <button key={m.id} onClick={() => onSelect(m)} style={{ padding: "18px 20px", borderRadius: 22, border: "none", background: `linear-gradient(135deg, ${m.color}35, ${m.color}20)`, borderLeft: `4px solid ${m.color}`, display: "flex", alignItems: "center", gap: 16, cursor: "pointer", width: "100%" }}>
            <div style={{ width: 52, height: 52, borderRadius: "50%", background: `linear-gradient(135deg, ${m.color}, ${m.color}CC)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 700, color: C.white, flexShrink: 0, boxShadow: `0 4px 16px ${m.color}50` }}>{m.avatar}</div>
            <div style={{ textAlign: "left", flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                <span style={{ fontSize: 17, fontWeight: 700, color: C.white }}>{m.name}</span>
                {m.isKid && <span style={{ fontSize: 10, color: C.kids, background: `${C.kids}30`, padding: "2px 7px", borderRadius: 8, fontWeight: 700 }}>Kid ⭐</span>}
              </div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>🔥 {m.streak || 0} streak · {m.points || 0} pts</div>
            </div>
            <div style={{ fontSize: 22, color: "rgba(255,255,255,0.4)" }}>›</div>
          </button>
        ))}
      </div>
      <button onClick={onCancel} style={{ marginTop: 28, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 20, padding: "10px 28px", fontSize: 13, color: "rgba(255,255,255,0.5)", cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>Cancel</button>
    </div>
  );
}

// ─── COMPLETION FLASH ─────────────────────────────────────────────
function CompletionFlash({ habit, member, onDone, onUndo, soundEnabled }) {
  const [countdown, setCountdown] = useState(5);
  const isKid = habit?.isKid || member?.isKid;
  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);

  useEffect(() => {
    if (soundEnabled) {
      const newStreak = (habit?.streak || 0) + 1;
      const type = isKid ? "kids" : newStreak >= 5 ? "milestone" : "regular";
      playCompletionSound(type);
      triggerHaptic(type);
    }
  }, []); // eslint-disable-line

  useEffect(() => {
    const interval = setInterval(() => {
      setCountdown(c => { if (c <= 1) { clearInterval(interval); onDoneRef.current(); return 0; } return c - 1; });
    }, 1000);
    return () => clearInterval(interval);
  }, []);
  const taps = habit?.taps || 0;
  const target = habit?.target || 1;
  const justCompleted = taps >= target;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 999, background: isKid ? `linear-gradient(135deg, ${C.kids}, ${C.kidsLight})` : `linear-gradient(135deg, ${C.slateDark}, ${C.slate})`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, animation: "flashIn 0.3s ease" }}>
      <div style={{ fontSize: 72, animation: "popIn 0.4s cubic-bezier(0.34,1.56,0.64,1)" }}>{isKid ? "🌟" : justCompleted ? "✦" : "◈"}</div>
      {member && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 16px", borderRadius: 30, background: "rgba(255,255,255,0.15)" }}>
          <div style={{ width: 28, height: 28, borderRadius: "50%", background: member.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: C.white }}>{member.avatar}</div>
          <span style={{ fontSize: 14, color: C.white, fontWeight: 600 }}>{member.name}</span>
        </div>
      )}
      <div style={{ fontSize: isKid ? 30 : 26, fontWeight: 700, color: C.white, fontFamily: "'Cormorant Garamond', serif", textAlign: "center", padding: "0 40px", lineHeight: 1.2 }}>
        {isKid ? "Amazing work!" : justCompleted ? "Ritual complete" : "Tap logged"}
      </div>
      <div style={{ fontSize: 14, color: "rgba(255,255,255,0.7)", textAlign: "center" }}>{habit?.name}</div>
      {habit?.target > 1 && <div style={{ padding: "8px 20px", borderRadius: 20, background: "rgba(255,255,255,0.15)", fontSize: 14, color: C.white, fontWeight: 600 }}>{taps} / {target} today</div>}
      {justCompleted && <div style={{ padding: "8px 20px", borderRadius: 30, background: "rgba(255,255,255,0.15)", fontSize: 13, color: C.white, fontWeight: 600 }}>🔥 {(habit?.streak || 0) + 1} day streak</div>}
      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>+10 points</div>
      <button onClick={() => { if (soundEnabled) { playCompletionSound("undo"); triggerHaptic("undo"); } onUndo(); onDone(); }} style={{ position: "absolute", bottom: 48, background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 20, padding: "10px 24px", cursor: "pointer", color: "rgba(255,255,255,0.6)", fontSize: 13, fontFamily: "'DM Sans', sans-serif", display: "flex", alignItems: "center", gap: 8 }}>
        <span>↩</span> Undo tap · {countdown}s
      </button>
    </div>
  );
}

// ─── HABIT CARD ───────────────────────────────────────────────────
function HabitCard({ habit, currentMember, allMembers, onComplete, onUndo }) {
  const [expanded, setExpanded] = useState(false);
  const [showDigital, setShowDigital] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0);
  const [longPressProgress, setLongPressProgress] = useState(0);
  const holdInterval = useRef(null);
  const longInterval = useRef(null);

  const taps = habit.taps || 0;
  const target = habit.target || 1;
  const completed = taps >= target;
  const isMulti = target > 1;
  const isKidsHabit = habit.isKid || habit.categoryId === "kids";

  useEffect(() => () => { clearInterval(holdInterval.current); clearInterval(longInterval.current); }, []);

  useEffect(() => {
    if (!expanded) return;
    const handle = (e) => { if (e.key === "Escape") { setExpanded(false); setShowDigital(false); setHoldProgress(0); } };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [expanded]);

  const handleHoldStart = () => {
    holdInterval.current = setInterval(() => {
      setHoldProgress(p => {
        if (p >= 100) {
          clearInterval(holdInterval.current);
          // Multi-user habits always ask "Who did this?"
          const isMultiUser = habit.assignedMemberIds && habit.assignedMemberIds.length > 1;
          if (isKidsHabit || habit.isShared || isMultiUser) { onComplete(habit.id, null, true); }
          else { onComplete(habit.id, currentMember, false); }
          setExpanded(false); setShowDigital(false); setHoldProgress(0);
          return 100;
        }
        return p + 4;
      });
    }, 40);
  };
  const handleHoldEnd = () => { clearInterval(holdInterval.current); setHoldProgress(0); };

  const startLongPress = () => {
    if (!completed) return;
    longInterval.current = setInterval(() => {
      setLongPressProgress(p => {
        if (p >= 100) { clearInterval(longInterval.current); onUndo(habit.id); setLongPressProgress(0); return 100; }
        return p + 5;
      });
    }, 40);
  };
  const endLongPress = () => { clearInterval(longInterval.current); setLongPressProgress(0); };

  if (completed && !isMulti) return (
    <div onMouseDown={startLongPress} onMouseUp={endLongPress} onTouchStart={startLongPress} onTouchEnd={endLongPress}
      style={{ background: C.white, borderRadius: 20, padding: 18, boxShadow: `0 4px 20px ${habit.color}18`, border: `1px solid ${habit.color}30`, position: "relative", overflow: "hidden", cursor: "pointer", userSelect: "none" }}>
      {longPressProgress > 0 && <div style={{ position: "absolute", inset: 0, background: `${habit.color}12`, width: `${longPressProgress}%`, zIndex: 0 }} />}
      <div style={{ display: "flex", alignItems: "center", gap: 12, position: "relative", zIndex: 1 }}>
        <div style={{ width: 44, height: 44, borderRadius: 13, flexShrink: 0, background: `linear-gradient(135deg, ${habit.color}, ${habit.color}CC)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: C.white, boxShadow: `0 4px 10px ${habit.color}35` }}>✓</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.slate }}>{habit.name}</div>
          <div style={{ fontSize: 11, color: C.slateLight, marginTop: 1 }}>Done · 🔥 {(habit.streak || 0) + 1} day streak · +10 pts{habit.completedBy ? ` · ${habit.completedBy}` : ""}</div>
        </div>
        <div style={{ fontSize: 9, color: `${C.slateLight}60`, textAlign: "right", lineHeight: 1.4 }}>{longPressProgress > 0 ? "Undoing…" : "Hold to\nundo"}</div>
      </div>
    </div>
  );

  return (
    <div style={{ background: isKidsHabit ? `linear-gradient(135deg, ${habit.color}10, ${C.white})` : C.white, borderRadius: 20, border: isKidsHabit ? `1.5px solid ${habit.color}30` : "1px solid rgba(0,0,0,0.05)", boxShadow: "0 2px 10px rgba(0,0,0,0.05)", overflow: "hidden" }}>
      <div style={{ padding: 18 }} onClick={() => !expanded && setExpanded(true)}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
          <div style={{ width: 44, height: 44, borderRadius: 13, flexShrink: 0, background: `${habit.color}15`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>{habit.icon}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.slate }}>{habit.name}</div>
            <div style={{ fontSize: 11, color: C.slateLight, marginTop: 1 }}>
              {habit.location ? `${habit.tileUid ? "Tile at" : "At"}: ${habit.location}` : habit.category}{habit.streak > 0 ? ` · 🔥 ${habit.streak}` : ""}
              {habit.tileUid && <span style={{ color: C.accent, marginLeft: 6 }}>· 🏷️ {tileLabel(habit.tileUid)}</span>}
            </div>
            {isMulti && taps > 0 && (
              <div style={{ marginTop: 6 }}>
                <div style={{ height: 3, background: C.sandLight, borderRadius: 2, marginBottom: 2 }}>
                  <div style={{ height: "100%", borderRadius: 2, background: `linear-gradient(90deg, ${habit.color}, ${habit.color}CC)`, width: `${(taps / target) * 100}%`, transition: "width 0.4s ease" }} />
                </div>
                <div style={{ fontSize: 10, color: habit.color, fontWeight: 600 }}>{taps} of {target} today</div>
              </div>
            )}
          </div>
          <div style={{ fontSize: 11, color: C.accent, fontWeight: 600, padding: "4px 10px", borderRadius: 20, background: `${C.accent}12`, flexShrink: 0 }}>{isMulti ? `${taps}/${target}` : "Tap tile"}</div>
        </div>
      </div>

      {expanded && (
        <div style={{ padding: "0 18px 20px", borderTop: `1px solid ${C.sandLight}`, paddingTop: 16 }}>
          <div style={{ fontSize: 12, color: C.slateLight, marginBottom: 14, lineHeight: 1.6 }}>
            Go to your tile at your <span style={{ color: C.accent, fontWeight: 600 }}>{habit.location || "tile location"}</span> and tap your phone to it.
          </div>
          <div style={{ background: `linear-gradient(135deg, ${C.slateDark}, ${C.slate})`, borderRadius: 20, padding: "20px", marginBottom: 12, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", letterSpacing: 2, textTransform: "uppercase" }}>Your Ritual tile</div>
            <div style={{ fontSize: 36 }}>{habit.icon}</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", textAlign: "center" }}>At your <span style={{ color: C.accentLight, fontWeight: 600 }}>{habit.location || "tile location"}</span></div>
          </div>
          {!showDigital ? (
            <button onClick={() => setShowDigital(true)} style={{ background: "none", border: "none", fontSize: 10, color: `${C.slateLight}60`, cursor: "pointer", display: "block", width: "100%", textAlign: "center", letterSpacing: 0.5, textDecoration: "underline dotted", padding: "4px 0" }}>Don't have your tile with you?</button>
          ) : (
            <div>
              <div style={{ fontSize: 10, color: `${C.slateLight}70`, textAlign: "center", marginBottom: 8, lineHeight: 1.5 }}>
                The physical tile is the whole point of Ritual.<br /><span style={{ color: C.accent }}>We recommend going to your tile.</span>
              </div>
              <div onMouseDown={handleHoldStart} onMouseUp={handleHoldEnd} onTouchStart={handleHoldStart} onTouchEnd={handleHoldEnd}
                style={{ padding: "11px", borderRadius: 12, border: `1.5px solid ${C.sandDark}`, background: C.offwhite, cursor: "pointer", textAlign: "center", userSelect: "none", position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${holdProgress}%`, background: `${C.accent}20` }} />
                <div style={{ fontSize: 11, color: C.slateLight, position: "relative" }}>{holdProgress > 0 ? `Hold… ${Math.round(holdProgress)}%` : "Hold to manually complete"}</div>
              </div>
            </div>
          )}
          <button onClick={() => { setExpanded(false); setShowDigital(false); setHoldProgress(0); }} style={{ marginTop: 10, background: "none", border: "none", fontSize: 12, color: C.slateLight, cursor: "pointer", display: "block", width: "100%", textAlign: "center" }}>Cancel</button>
        </div>
      )}
    </div>
  );
}

// ─── TODAY SCREEN ─────────────────────────────────────────────────
function TodayScreen({ habits, weekData, currentMember, allMembers, onComplete, onUndo, flashData, onFlashDone, onFlashUndo, whoDidThis, onWhoCancel, soundEnabled }) {
  const done = habits.filter(h => (h.taps || 0) >= (h.target || 1)).length;
  const total = habits.length;
  const todayPct = total > 0 ? Math.round((done / total) * 100) : 0;
  const todayIndex = getTodayIndex();
  const maxStreak = habits.length > 0 ? Math.max(...habits.map(h => h.streak || 0), 0) : 0;
  const dayLabels = ["M", "T", "W", "T", "F", "S", "S"];

  return (
    <>
      {whoDidThis && <WhoDidThis habit={whoDidThis} members={allMembers} onSelect={(m) => onComplete(whoDidThis.id, m, false)} onCancel={onWhoCancel} />}
      {flashData && <CompletionFlash habit={flashData.habit} member={flashData.member} onDone={onFlashDone} onUndo={onFlashUndo} soundEnabled={soundEnabled} />}
      <div style={{ padding: "0 20px 110px" }}>
        {/* Hero */}
        <div style={{ background: `linear-gradient(135deg, ${C.slateDark} 0%, ${C.slate} 100%)`, borderRadius: 24, padding: 24, marginBottom: 16, position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: -30, right: -30, width: 150, height: 150, borderRadius: "50%", background: "rgba(255,255,255,0.06)", zIndex: 0 }} />
          <div style={{ position: "relative", zIndex: 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", letterSpacing: 2.5, textTransform: "uppercase", marginBottom: 4 }}>Today's Progress</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{ fontSize: 52, fontWeight: 700, color: C.white, fontFamily: "'Cormorant Garamond', serif", lineHeight: 1 }}>{done}</span>
                  <span style={{ fontSize: 20, color: "rgba(255,255,255,0.4)" }}>/ {total}</span>
                </div>
              </div>
              {maxStreak > 0 && (
                <div style={{ padding: "8px 14px", borderRadius: 20, background: "rgba(255,255,255,0.12)", textAlign: "center" }}>
                  <div style={{ fontSize: 20 }}>🔥</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: C.white }}>{maxStreak}</div>
                  <div style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", letterSpacing: 1 }}>BEST</div>
                </div>
              )}
            </div>
            <div style={{ height: 5, background: "rgba(255,255,255,0.1)", borderRadius: 3, marginBottom: 10 }}>
              <div style={{ height: "100%", borderRadius: 3, background: `linear-gradient(90deg, ${C.accent}, ${C.accentLight})`, width: `${(done / Math.max(total, 1)) * 100}%`, transition: "width 0.8s cubic-bezier(0.34,1.56,0.64,1)" }} />
            </div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.65)", fontFamily: "'Cormorant Garamond', serif", fontStyle: "italic" }}>{getMotivation(done, total)}</div>
          </div>
        </div>

        {/* Week chart */}
        <div style={{ background: C.white, borderRadius: 20, padding: 18, marginBottom: 16, boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.slate, letterSpacing: 0.5 }}>Family Progress This Week</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 10, color: C.slateLight, marginTop: 2 }}>Household completion rate</div>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.accent, flexShrink: 0 }}>
                {weekData[todayIndex] !== null ? `${weekData[todayIndex]}%` : "—"}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 70, paddingTop: 22 }}>
            {weekData.map((v, i) => {
              const isToday = i === todayIndex;
              const isFuture = v === null;
              const pct = v ?? 0;
              return (
                <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
                  <div style={{ width: "100%", position: "relative", height: 50, display: "flex", alignItems: "flex-end" }}>
                    <div style={{ width: "100%", borderRadius: 4, minHeight: 4, height: `${Math.max(pct * 0.5, 4)}px`, background: isFuture ? C.sandLight : isToday ? `linear-gradient(180deg, ${C.accent}, ${C.accentLight})` : `${C.slate}55`, boxShadow: isToday ? `0 4px 12px ${C.accent}40` : "none", transition: "height 0.6s cubic-bezier(0.34,1.56,0.64,1)" }} />
                  </div>
                  <div style={{ fontSize: 9, fontWeight: isToday ? 700 : 400, color: isToday ? C.accent : isFuture ? C.sandDark : C.slateLight }}>{dayLabels[i]}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Habits */}
        {total === 0 ? (
          <div style={{ background: C.white, borderRadius: 24, padding: 36, textAlign: "center", boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>◈</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: C.slate, fontFamily: "'Cormorant Garamond', serif", marginBottom: 8 }}>Your rituals live here</div>
            <div style={{ fontSize: 13, color: C.slateLight, lineHeight: 1.6 }}>Every great habit starts with one decision.<br />Choose your first ritual below.</div>
          </div>
        ) : (
          <>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 10, letterSpacing: 0.5 }}>Today's Rituals</div>
            <div className="habit-grid">
              {habits.map(h => (
                <HabitCard key={h.id} habit={h} currentMember={currentMember} allMembers={allMembers} onComplete={onComplete} onUndo={onUndo} />
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}

// ─── FAMILY SCREEN ────────────────────────────────────────────────
function FamilyScreen({ family, onAddMember, onEditMember, onRemoveMember }) {
  const [view, setView] = useState("list");
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", isKid: false, colorIdx: 0 });
  const [nudged, setNudged] = useState({});

  const handleNudge = (id) => {
    setNudged(n => ({ ...n, [id]: true }));
    setTimeout(() => setNudged(n => ({ ...n, [id]: false })), 3000);
  };

  const saveMember = () => {
    if (!form.name.trim()) return;
    const avatar = form.name.trim()[0].toUpperCase();
    const color = MEMBER_COLORS[form.colorIdx];
    if (editing) {
      onEditMember(editing.id, { name: form.name.trim(), avatar, isKid: form.isKid, color });
    } else {
      onAddMember({ name: form.name.trim(), avatar, isKid: form.isKid, color, points: 0, streak: 0 });
    }
    setView("list");
  };

  if (view === "add") return (
    <div style={{ padding: "0 20px 110px" }}>
      <button onClick={() => setView("list")} style={{ background: "none", border: "none", cursor: "pointer", color: C.slateLight, fontSize: 13, marginBottom: 20 }}>← Back</button>
      <div style={{ fontSize: 18, fontWeight: 700, color: C.slate, fontFamily: "'Cormorant Garamond', serif", marginBottom: 24 }}>{editing ? "Edit Member" : "Add Member"}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <input style={inputStyle} placeholder="Name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: C.slateLight, marginBottom: 8, letterSpacing: 0.5, textTransform: "uppercase" }}>Colour</div>
          <div style={{ display: "flex", gap: 8 }}>
            {MEMBER_COLORS.map((col, i) => (
              <div key={i} onClick={() => setForm(f => ({ ...f, colorIdx: i }))} style={{ flex: 1, height: 32, borderRadius: 8, background: col, cursor: "pointer", border: form.colorIdx === i ? `3px solid ${C.slate}` : "3px solid transparent", boxShadow: form.colorIdx === i ? `0 0 0 2px ${C.white}, 0 0 0 4px ${col}` : "none" }} />
            ))}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {[{ label: "Adult", val: false }, { label: "Kid ⭐", val: true }].map(opt => (
            <div key={String(opt.val)} onClick={() => setForm(f => ({ ...f, isKid: opt.val }))} style={{ flex: 1, padding: "12px", borderRadius: 14, textAlign: "center", cursor: "pointer", fontSize: 14, fontWeight: 600, background: form.isKid === opt.val ? `${MEMBER_COLORS[form.colorIdx]}20` : C.offwhite, border: form.isKid === opt.val ? `2px solid ${MEMBER_COLORS[form.colorIdx]}` : "2px solid transparent", color: form.isKid === opt.val ? C.slate : C.slateLight }}>{opt.label}</div>
          ))}
        </div>
        <div style={{ background: C.offwhite, borderRadius: 16, padding: 16, display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 44, height: 44, borderRadius: "50%", background: `linear-gradient(135deg, ${MEMBER_COLORS[form.colorIdx]}, ${MEMBER_COLORS[form.colorIdx]}CC)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700, color: C.white }}>{form.name ? form.name[0].toUpperCase() : "?"}</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.slate }}>{form.name || "Preview"}</div>
            <div style={{ fontSize: 12, color: C.slateLight }}>{form.isKid ? "Kid ⭐" : "Adult"}</div>
          </div>
        </div>
        <button onClick={saveMember} style={btnPrimary}>{editing ? "Save" : "Add Member"}</button>
        {editing && <button onClick={() => { onRemoveMember(editing.id); setView("list"); }} style={{ ...btnPrimary, background: `${C.error}18`, color: C.error, boxShadow: "none" }}>Remove {editing.name}</button>}
      </div>
    </div>
  );

  const totalPoints = family.members.reduce((a, m) => a + (m.points || 0), 0);

  return (
    <div style={{ padding: "0 20px 110px" }}>
      {/* FIX 6: Removed PIN from family header */}
      <div style={{ background: `linear-gradient(135deg, ${C.warm}, ${C.accent})`, borderRadius: 24, padding: 24, marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", letterSpacing: 2.5, textTransform: "uppercase", marginBottom: 6 }}>The {family.name} Family</div>
        <div style={{ fontSize: 44, fontWeight: 700, color: C.white, fontFamily: "'Cormorant Garamond', serif", lineHeight: 1 }}>{totalPoints.toLocaleString()}</div>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", marginTop: 4 }}>combined points</div>
      </div>

      {family.members.map(m => (
        <div key={m.id} style={{ background: m.isKid ? `linear-gradient(135deg, ${m.color}10, ${C.white})` : C.white, borderRadius: 20, padding: 18, marginBottom: 10, boxShadow: "0 2px 10px rgba(0,0,0,0.05)", border: m.isKid ? `1px solid ${m.color}25` : "1px solid rgba(0,0,0,0.05)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 46, height: 46, borderRadius: "50%", background: `linear-gradient(135deg, ${m.color}, ${m.color}CC)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, fontWeight: 700, color: C.white, boxShadow: `0 4px 12px ${m.color}40`, flexShrink: 0 }}>{m.avatar}</div>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 15, fontWeight: 600, color: C.slate }}>{m.name}</span>
                  {m.isKid && <span style={{ fontSize: 10, color: C.kids, background: `${C.kids}18`, padding: "2px 8px", borderRadius: 10, fontWeight: 600 }}>Kid ⭐</span>}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: m.color }}>{m.points || 0} pts</span>
                  <button onClick={() => { setEditing(m); setForm({ name: m.name, isKid: m.isKid, colorIdx: Math.max(0, MEMBER_COLORS.indexOf(m.color)) }); setView("add"); }} style={{ background: "none", border: "none", cursor: "pointer", color: C.sandDark, fontSize: 16 }}>✎</button>
                </div>
              </div>
              <div style={{ marginTop: 6, height: 4, background: C.sandLight, borderRadius: 2 }}>
                <div style={{ height: "100%", borderRadius: 2, background: `linear-gradient(90deg, ${m.color}, ${m.color}99)`, width: `${totalPoints > 0 ? ((m.points || 0) / Math.max(...family.members.map(x => x.points || 0), 1)) * 100 : 0}%`, transition: "width 0.8s ease" }} />
              </div>
              <div style={{ marginTop: 5, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 11, color: C.slateLight }}>🔥 {m.streak || 0} day streak</div>
                <button onClick={() => handleNudge(m.id)} style={{ background: nudged[m.id] ? `${C.green}18` : `${C.accent}12`, border: "none", borderRadius: 12, padding: "4px 10px", fontSize: 11, fontWeight: 600, color: nudged[m.id] ? C.green : C.accent, cursor: "pointer" }}>
                  {nudged[m.id] ? "✓ Nudged!" : "Nudge 👋"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ))}

      <div onClick={() => { setEditing(null); setForm({ name: "", isKid: false, colorIdx: family.members.length % MEMBER_COLORS.length }); setView("add"); }} style={{ padding: 16, borderRadius: 20, border: `1.5px dashed ${C.sandDark}`, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, cursor: "pointer", color: C.slateLight, fontSize: 14, marginBottom: 16 }}>
        <span style={{ fontSize: 20 }}>+</span> Add family member
      </div>

      <div style={{ background: C.white, borderRadius: 20, padding: 20, boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 14, letterSpacing: 0.5 }}>Rewards Available</div>
        {(family.rewards || []).map((r, i) => (
          <div key={r.id || i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: i < family.rewards.length - 1 ? `1px solid ${C.sandLight}` : "none" }}>
            <div style={{ fontSize: 26 }}>{r.icon}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, color: C.slate, fontWeight: 500 }}>{r.name}</div>
              <div style={{ fontSize: 11, color: C.slateLight, marginTop: 1 }}>{r.who} · {r.points} pts</div>
            </div>
            <div style={{ padding: "6px 12px", borderRadius: 20, background: C.offwhite, fontSize: 12, color: C.warm, fontWeight: 600 }}>Redeem</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── ASSIGN TILE MODAL ────────────────────────────────────────────
function AssignTileModal({ tileUID, habits, onAssign, onClose, onCreateHabit }) {
  useEffect(() => {
    const handle = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [onClose]);

  const byCategory = habits.reduce((acc, h) => {
    const cat = h.category || "Other";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(h);
    return acc;
  }, {});

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(42,52,56,0.85)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 2000 }} onClick={onClose}>
      <div style={{ background: C.white, borderRadius: "24px 24px 0 0", padding: "24px 20px 48px", width: "100%", maxWidth: 500, maxHeight: "80vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 18, fontWeight: 700, color: C.slate, fontFamily: "'Cormorant Garamond', serif", marginBottom: 4 }}>New Tile Detected</div>
        <div style={{ fontSize: 13, color: C.slateLight, marginBottom: 6 }}>Tile ID: <span style={{ fontFamily: "monospace", color: C.slate }}>{tileLabel(tileUID)}</span></div>
        <div style={{ fontSize: 12, color: C.slateLight, marginBottom: 20 }}>Which habit should this tile trigger?</div>
        {habits.length === 0 ? (
          <div style={{ fontSize: 14, color: C.slateLight, textAlign: "center", padding: "20px 0" }}>No habits yet — add some habits first.</div>
        ) : (
          Object.entries(byCategory).map(([category, catHabits]) => (
            <div key={category} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.slateLight, letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 }}>{category}</div>
              {catHabits.map(h => {
                const alreadyAssigned = !!h.tileUid;
                return (
                  <button
                    key={h.id}
                    onClick={() => !alreadyAssigned && onAssign(tileUID, h.id)}
                    disabled={alreadyAssigned}
                    style={{ width: "100%", padding: "12px 14px", background: alreadyAssigned ? C.offwhite : C.white, border: `1px solid ${alreadyAssigned ? C.sandDark : C.sand}`, borderRadius: 12, marginBottom: 6, textAlign: "left", fontSize: 14, fontWeight: 500, color: alreadyAssigned ? C.sandDark : C.slate, cursor: alreadyAssigned ? "default" : "pointer", fontFamily: "'DM Sans', sans-serif", display: "flex", alignItems: "center", gap: 10, opacity: alreadyAssigned ? 0.6 : 1 }}
                  >
                    <span style={{ fontSize: 18 }}>{h.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div>{h.name}</div>
                      {alreadyAssigned && <div style={{ fontSize: 10, color: C.slateLight }}>Already has a tile · {tileLabel(h.tileUid)}</div>}
                    </div>
                  </button>
                );
              })}
            </div>
          ))
        )}
        <button onClick={onClose} style={{ width: "100%", padding: 13, background: C.offwhite, border: "none", borderRadius: 14, fontSize: 14, color: C.slateLight, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", marginTop: 4 }}>Skip for now</button>
        {onCreateHabit && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.sandDark}` }}>
            <button onClick={onCreateHabit} style={{ width: "100%", padding: "12px 16px", background: `${C.accent}15`, border: `1.5px solid ${C.accent}`, borderRadius: 12, color: C.accent, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>
              ➕ Create new habit for this tile
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ManageTilesScreen({ habits, onAssignTile, onRemoveTile, onBack }) {
  const [showHabitPicker, setShowHabitPicker] = useState(null);

  const assignedHabits = habits.filter(h => h.tileUid);
  const unassignedHabits = habits.filter(h => !h.tileUid);

  const doAssign = async (tileUID, habitId) => {
    await onAssignTile(tileUID, habitId);
    setShowHabitPicker(null);
  };

  return (
    <div style={{ padding: "0 20px 110px" }}>
      <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", color: C.slateLight, fontSize: 13, marginBottom: 16 }}>← Back</button>
      <div style={{ fontSize: 18, fontWeight: 700, color: C.slate, fontFamily: "'Cormorant Garamond', serif", marginBottom: 4 }}>Manage Tiles</div>
      <div style={{ fontSize: 12, color: C.slateLight, marginBottom: 20, lineHeight: 1.6 }}>
        Tap a tile to assign it. Tiles come pre-programmed — just tap one near your phone.
      </div>

      {/* Assigned tiles */}
      {assignedHabits.length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.slateLight, letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 }}>Active Tiles</div>
          {assignedHabits.map(habit => (
            <div key={habit.id} style={{ background: C.white, borderRadius: 16, padding: 16, marginBottom: 10, boxShadow: "0 2px 8px rgba(0,0,0,0.04)", border: `1px solid ${C.green}25` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                <div style={{ width: 40, height: 40, borderRadius: 12, background: `${habit.color}15`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>{habit.icon}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: C.slate }}>{habit.name}</div>
                  <div style={{ fontSize: 11, color: C.slateLight }}>🏷️ {tileLabel(habit.tileUid)}{habit.location ? ` · ${habit.location}` : ""}</div>
                </div>
                <span style={{ fontSize: 11, color: C.green, fontWeight: 600 }}>✓ Active</span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setShowHabitPicker({ tileUID: habit.tileUid, currentHabitId: habit.id })} style={{ flex: 1, padding: "8px", background: C.offwhite, border: "none", borderRadius: 10, fontSize: 12, fontWeight: 600, color: C.slate, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>Reassign</button>
                <button onClick={() => { if (window.confirm("Remove this tile assignment?")) onRemoveTile(habit.id); }} style={{ flex: 1, padding: "8px", background: `${C.error}10`, border: "none", borderRadius: 10, fontSize: 12, fontWeight: 600, color: C.error, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>Remove</button>
              </div>
            </div>
          ))}
        </>
      )}

      {/* Unassigned habits */}
      {unassignedHabits.length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.sandDark, letterSpacing: 1, textTransform: "uppercase", marginBottom: 10, marginTop: assignedHabits.length > 0 ? 20 : 0 }}>No Tile Yet</div>
          {unassignedHabits.map(habit => (
            <div key={habit.id} style={{ background: C.offwhite, borderRadius: 16, padding: 16, marginBottom: 8, border: `1px solid ${C.sand}`, display: "flex", alignItems: "center", gap: 12, opacity: 0.7 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: `${habit.color}15`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>{habit.icon}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: C.slate }}>{habit.name}</div>
                <div style={{ fontSize: 11, color: C.slateLight }}>Tap a tile to assign it here</div>
              </div>
            </div>
          ))}
        </>
      )}

      {assignedHabits.length === 0 && unassignedHabits.length === 0 && (
        <div style={{ background: C.white, borderRadius: 20, padding: 28, textAlign: "center", boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🏷️</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: C.slate, marginBottom: 8 }}>No habits yet</div>
          <div style={{ fontSize: 12, color: C.slateLight, lineHeight: 1.7 }}>Add some habits first, then tap a tile to assign it.</div>
        </div>
      )}

      {/* Reassign bottom sheet */}
      {showHabitPicker && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(42,52,56,0.85)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 1000 }} onClick={() => setShowHabitPicker(null)}>
          <div style={{ background: C.white, borderRadius: "24px 24px 0 0", padding: "24px 20px 48px", width: "100%", maxWidth: 500, maxHeight: "80vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.slate, fontFamily: "'Cormorant Garamond', serif", marginBottom: 4 }}>Reassign Tile</div>
            <div style={{ fontSize: 12, color: C.slateLight, marginBottom: 20 }}>Which habit should this tile trigger?</div>
            {Object.entries(habits.reduce((acc, h) => {
              const cat = h.category || "Other";
              if (!acc[cat]) acc[cat] = [];
              acc[cat].push(h);
              return acc;
            }, {})).map(([category, catHabits]) => (
              <div key={category} style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.slateLight, letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 }}>{category}</div>
                {catHabits.map(h => (
                  <button key={h.id} onClick={() => doAssign(showHabitPicker.tileUID, h.id)} style={{ width: "100%", padding: "12px 14px", background: h.id === showHabitPicker.currentHabitId ? `${C.accent}15` : C.offwhite, border: "none", borderRadius: 12, marginBottom: 6, textAlign: "left", fontSize: 14, fontWeight: 500, color: C.slate, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 18 }}>{h.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div>{h.name}</div>
                      {h.tileUid && h.id !== showHabitPicker.currentHabitId && <div style={{ fontSize: 10, color: C.slateLight }}>Currently assigned · {tileLabel(h.tileUid)}</div>}
                    </div>
                    {h.id === showHabitPicker.currentHabitId && <span style={{ fontSize: 10, color: C.accent }}>Current</span>}
                  </button>
                ))}
              </div>
            ))}
            <button onClick={() => setShowHabitPicker(null)} style={{ width: "100%", padding: 13, background: C.offwhite, border: "none", borderRadius: 14, fontSize: 14, color: C.slateLight, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── MANAGE HABITS SCREEN ─────────────────────────────────────────
function ManageHabitsScreen({ habits, family, currentMember, onEditHabit, onDeleteHabit, onBack }) {
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", location: "", target: 1, isShared: true, assignedMemberIds: null, daysActive: null, completionType: 'individual' });

  useEffect(() => {
    if (!editing) return;
    const handle = (e) => { if (e.key === "Escape") setEditing(null); };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [editing]);

  if (editing) return (
    <div style={{ padding: "0 20px 110px" }}>
      <button onClick={() => setEditing(null)} style={{ background: "none", border: "none", cursor: "pointer", color: C.slateLight, fontSize: 13, marginBottom: 16 }}>← Back</button>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <div style={{ width: 44, height: 44, borderRadius: 13, background: `${editing.color}18`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>{editing.icon}</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: C.slate, fontFamily: "'Cormorant Garamond', serif" }}>Edit Habit</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.slateLight, letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 }}>Name</div>
          <input style={inputStyle} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.slateLight, letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 }}>Tile Location</div>
          <input style={inputStyle} value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} />
        </div>
        <div style={{ background: C.white, borderRadius: 20, padding: 20, boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.slate, marginBottom: 12 }}>Times per day</div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 24 }}>
            <button onClick={() => setForm(f => ({ ...f, target: Math.max(1, f.target - 1) }))} style={{ width: 40, height: 40, borderRadius: "50%", border: "none", background: C.offwhite, fontSize: 20, cursor: "pointer", color: C.slate }}>−</button>
            <div style={{ fontSize: 36, fontWeight: 700, color: C.slate, fontFamily: "'Cormorant Garamond', serif", minWidth: 40, textAlign: "center" }}>{form.target}</div>
            <button onClick={() => setForm(f => ({ ...f, target: Math.min(20, f.target + 1) }))} style={{ width: 40, height: 40, borderRadius: "50%", border: "none", background: C.offwhite, fontSize: 20, cursor: "pointer", color: C.slate }}>+</button>
          </div>
        </div>
        <div style={{ background: C.white, borderRadius: 20, padding: 16, boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.slate, marginBottom: 10 }}>Who is this for?</div>
          {/* Everyone checkbox */}
          <div onClick={() => setForm(f => ({ ...f, assignedMemberIds: null, isShared: true }))} style={{ padding: "10px 14px", borderRadius: 12, marginBottom: 6, cursor: "pointer", background: !form.assignedMemberIds ? `${C.accent}15` : C.offwhite, border: `1.5px solid ${!form.assignedMemberIds ? C.accent : "transparent"}`, fontSize: 13, fontWeight: 500, color: C.slate, display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${!form.assignedMemberIds ? C.accent : C.sandDark}`, background: !form.assignedMemberIds ? C.accent : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{!form.assignedMemberIds && <span style={{ color: C.white, fontSize: 11, lineHeight: 1 }}>✓</span>}</div>
            👥 Everyone in the family
          </div>
          {/* Individual member checkboxes */}
          {(family?.members || []).map(m => {
            const isSelected = form.assignedMemberIds?.includes(m.id) || false;
            return (
              <div key={m.id} onClick={() => {
                const current = form.assignedMemberIds || [];
                let next;
                if (isSelected) {
                  next = current.filter(id => id !== m.id);
                } else {
                  next = [...current, m.id];
                }
                // If all members selected, treat as "everyone"
                const everyone = next.length === 0 || next.length === (family?.members?.length || 0);
                setForm(f => ({ ...f, assignedMemberIds: everyone ? null : next, isShared: everyone }));
              }} style={{ padding: "10px 14px", borderRadius: 12, marginBottom: 6, cursor: "pointer", background: isSelected && form.assignedMemberIds ? `${C.accent}15` : C.offwhite, border: `1.5px solid ${isSelected && form.assignedMemberIds ? C.accent : "transparent"}`, fontSize: 13, fontWeight: 500, color: C.slate, display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${isSelected && form.assignedMemberIds ? C.accent : C.sandDark}`, background: isSelected && form.assignedMemberIds ? C.accent : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{isSelected && form.assignedMemberIds && <span style={{ color: C.white, fontSize: 11, lineHeight: 1 }}>✓</span>}</div>
                <div style={{ width: 22, height: 22, borderRadius: "50%", background: m.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: C.white, flexShrink: 0 }}>{m.avatar}</div>
                {m.name}
              </div>
            );
          })}
          {form.assignedMemberIds && form.assignedMemberIds.length > 0 && (
            <div style={{ fontSize: 11, color: C.accent, marginTop: 4, fontWeight: 600 }}>{form.assignedMemberIds.length} {form.assignedMemberIds.length === 1 ? "person" : "people"} selected</div>
          )}
        </div>
        <div style={{ background: C.white, borderRadius: 20, padding: 16, marginTop: 12, boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.slate, marginBottom: 10 }}>Which days?</div>
          <div onClick={() => setForm(f => ({ ...f, daysActive: null }))} style={{ padding: "10px 14px", borderRadius: 12, marginBottom: 6, cursor: "pointer", background: !form.daysActive ? `${C.accent}15` : C.offwhite, border: `1.5px solid ${!form.daysActive ? C.accent : "transparent"}`, fontSize: 13, fontWeight: 500, color: C.slate }}>📅 Every day</div>
          <div onClick={() => setForm(f => ({ ...f, daysActive: [0,1,2,3,4] }))} style={{ padding: "10px 14px", borderRadius: 12, marginBottom: 8, cursor: "pointer", background: Array.isArray(form.daysActive) && form.daysActive.length === 5 && [0,1,2,3,4].every(d => form.daysActive.includes(d)) ? `${C.accent}15` : C.offwhite, border: `1.5px solid ${Array.isArray(form.daysActive) && form.daysActive.length === 5 && [0,1,2,3,4].every(d => form.daysActive.includes(d)) ? C.accent : "transparent"}`, fontSize: 13, fontWeight: 500, color: C.slate }}>📚 Weekdays only (Mon–Fri)</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((day, idx) => {
              const sel = Array.isArray(form.daysActive) && form.daysActive.includes(idx);
              return (
                <div key={idx} onClick={() => {
                  if (!Array.isArray(form.daysActive)) { setForm(f => ({ ...f, daysActive: [idx] })); }
                  else if (sel) { const nd = form.daysActive.filter(d => d !== idx); setForm(f => ({ ...f, daysActive: nd.length === 0 ? null : nd })); }
                  else { setForm(f => ({ ...f, daysActive: [...form.daysActive, idx].sort() })); }
                }} style={{ padding: "7px 11px", borderRadius: 10, cursor: "pointer", fontSize: 12, fontWeight: 600, background: sel ? C.accent : C.offwhite, color: sel ? C.white : C.slate, border: `1.5px solid ${sel ? C.accent : C.sandDark}` }}>{day}</div>
              );
            })}
          </div>
        </div>
        {/* Completion tracking type */}
        <div style={{ background: C.white, borderRadius: 20, padding: 16, marginTop: 12, boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.slate, marginBottom: 4 }}>Completion tracking</div>
          <div style={{ fontSize: 11, color: C.slateLight, marginBottom: 10 }}>How should progress be tracked?</div>
          <div onClick={() => setForm(f => ({ ...f, completionType: 'individual' }))} style={{ padding: "12px 14px", borderRadius: 12, marginBottom: 8, cursor: "pointer", background: form.completionType === 'individual' ? `${C.accent}15` : C.offwhite, border: `1.5px solid ${form.completionType === 'individual' ? C.accent : "transparent"}`, fontSize: 13, fontWeight: 500, color: C.slate }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
              <div style={{ width: 18, height: 18, borderRadius: "50%", border: `2px solid ${form.completionType === 'individual' ? C.accent : C.sandDark}`, background: form.completionType === 'individual' ? C.accent : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>{form.completionType === 'individual' && <div style={{ width: 8, height: 8, borderRadius: "50%", background: C.white }} />}</div>
              <span style={{ fontWeight: 600 }}>👤 Individual tracking</span>
            </div>
            <div style={{ fontSize: 11, color: C.slateLight, marginLeft: 26 }}>Each person tracks their own progress separately</div>
          </div>
          <div onClick={() => setForm(f => ({ ...f, completionType: 'shared' }))} style={{ padding: "12px 14px", borderRadius: 12, cursor: "pointer", background: form.completionType === 'shared' ? `${C.accent}15` : C.offwhite, border: `1.5px solid ${form.completionType === 'shared' ? C.accent : "transparent"}`, fontSize: 13, fontWeight: 500, color: C.slate }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
              <div style={{ width: 18, height: 18, borderRadius: "50%", border: `2px solid ${form.completionType === 'shared' ? C.accent : C.sandDark}`, background: form.completionType === 'shared' ? C.accent : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>{form.completionType === 'shared' && <div style={{ width: 8, height: 8, borderRadius: "50%", background: C.white }} />}</div>
              <span style={{ fontWeight: 600 }}>👥 Shared/Household tracking</span>
            </div>
            <div style={{ fontSize: 11, color: C.slateLight, marginLeft: 26 }}>One completion counts for everyone assigned</div>
            <div style={{ fontSize: 11, color: C.warm, marginLeft: 26, marginTop: 2 }}>Example: "Feed the pet" — anyone can do it, counts for all</div>
          </div>
        </div>
        <button onClick={() => { onEditHabit(editing.id, { ...form, assignedMemberIds: form.assignedMemberIds || null }); setEditing(null); }} style={{ ...btnPrimary, marginTop: 12 }}>Save Changes</button>
        <button onClick={() => { if (window.confirm(`Delete "${editing.name}"? This removes all completion history.`)) { onDeleteHabit(editing.id); setEditing(null); } }} style={{ ...btnPrimary, background: `${C.error}18`, color: C.error, boxShadow: "none" }}>Delete Habit</button>
      </div>
    </div>
  );

  return (
    <div style={{ padding: "0 20px 110px" }}>
      <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", color: C.slateLight, fontSize: 13, marginBottom: 16 }}>← Back</button>
      <div style={{ fontSize: 18, fontWeight: 700, color: C.slate, fontFamily: "'Cormorant Garamond', serif", marginBottom: 4 }}>Manage Habits</div>
      <div style={{ fontSize: 12, color: C.slateLight, marginBottom: 20 }}>Tap a habit to edit or delete it</div>
      {habits.length === 0 ? (
        <div style={{ background: C.white, borderRadius: 20, padding: 28, textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>◈</div>
          <div style={{ fontSize: 14, color: C.slateLight }}>No habits yet</div>
        </div>
      ) : Array.from(new Map(habits.map(h => [h.id, h])).values()).map(h => (
        <div key={h.id} onClick={() => { setEditing(h); setForm({ name: h.name, location: h.location || "", target: h.target || 1, isShared: h.isShared ?? true, assignedMemberIds: h.assignedMemberIds || null, daysActive: h.daysActive || null, completionType: h.completionType || 'individual' }); }} style={{ background: C.white, borderRadius: 16, padding: 16, marginBottom: 8, boxShadow: "0 2px 8px rgba(0,0,0,0.04)", cursor: "pointer", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: `${h.color}15`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>{h.icon}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.slate }}>{h.name}</div>
            <div style={{ fontSize: 11, color: C.slateLight, marginTop: 2 }}>
              {h.location || h.category}{h.tileUid ? ` · 🏷️ ${tileLabel(h.tileUid)}` : ""}
              {!h.assignedMemberIds || h.assignedMemberIds.length === 0 ? " · 👥 Everyone" : (() => {
                const assigned = (family?.members || []).filter(m => h.assignedMemberIds.includes(m.id));
                if (assigned.length === 0) return " · 👤 Personal";
                if (assigned.length === 1) return ` · 👤 ${assigned[0].name}`;
                return ` · 👤 ${assigned.map(m => m.name).join(", ")}`;
              })()}
            </div>
          </div>
          <div style={{ color: C.sandDark, fontSize: 18 }}>›</div>
        </div>
      ))}
    </div>
  );
}

// ─── ADD SCREEN ───────────────────────────────────────────────────
function AddScreen({ family, currentMember, onAddHabit, habits, onAssignTile, onRemoveTile, onEditHabit, onDeleteHabit, initialView = "menu", onMounted }) {
  const [view, setView] = useState(initialView);
  useEffect(() => { onMounted?.(); }, []);
  const [selectedCat, setSelectedCat] = useState(null);
  const [selectedHabit, setSelectedHabit] = useState(null);
  const [targetCount, setTargetCount] = useState(1);
  const [habitIsShared, setHabitIsShared] = useState(true);
  const [habitSelectedMembers, setHabitSelectedMembers] = useState([]);
  const [habitDays, setHabitDays] = useState(null);
  // Custom ritual state
  const [customEmoji, setCustomEmoji] = useState("🎯");
  const [customName, setCustomName] = useState("");
  const [customLocation, setCustomLocation] = useState("");
  const [customTarget, setCustomTarget] = useState(1);
  const [customIsShared, setCustomIsShared] = useState(true);
  const [customSelectedMembers, setCustomSelectedMembers] = useState([]);
  const [customDays, setCustomDays] = useState(null);
  const [customCatId, setCustomCatId] = useState("family");
  const [customCompletionType, setCustomCompletionType] = useState('individual');
  const [habitCompletionType, setHabitCompletionType] = useState('individual');

  if (view === "tile") {
    return <ManageTilesScreen habits={habits} onAssignTile={onAssignTile} onRemoveTile={onRemoveTile} onBack={() => setView("menu")} />;
  }

  if (view === "habitsManage") {
    return <ManageHabitsScreen habits={habits} family={family} currentMember={currentMember} onEditHabit={onEditHabit} onDeleteHabit={onDeleteHabit} onBack={() => setView("menu")} />;
  }

  // FIX 8: Custom ritual creation view
  if (view === "custom") {
    const cat = CATEGORIES.find(c => c.id === customCatId) || CATEGORIES[0];
    return (
      <div style={{ padding: "0 20px 110px" }}>
        <button onClick={() => setView("menu")} style={{ background: "none", border: "none", cursor: "pointer", color: C.slateLight, fontSize: 13, marginBottom: 16 }}>← Back</button>
        <div style={{ fontSize: 18, fontWeight: 700, color: C.slate, fontFamily: "'Cormorant Garamond', serif", marginBottom: 4 }}>Create Custom Ritual</div>
        <div style={{ fontSize: 12, color: C.slateLight, marginBottom: 20 }}>Design your own habit</div>

        {/* Emoji picker */}
        <div style={{ background: C.white, borderRadius: 20, padding: 16, marginBottom: 12, boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.slateLight, letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 }}>Choose an icon</div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: `${cat.color}15`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, flexShrink: 0 }}>{customEmoji}</div>
            <div style={{ fontSize: 13, color: C.slateLight }}>Selected icon</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 6 }}>
            {CUSTOM_EMOJIS.map(e => (
              <div key={e} onClick={() => setCustomEmoji(e)} style={{ height: 38, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, cursor: "pointer", background: customEmoji === e ? `${C.accent}20` : C.offwhite, border: customEmoji === e ? `2px solid ${C.accent}` : "2px solid transparent" }}>{e}</div>
            ))}
          </div>
        </div>

        {/* Name & location */}
        <div style={{ background: C.white, borderRadius: 20, padding: 16, marginBottom: 12, boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.slateLight, letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 }}>Ritual name</div>
              <input style={inputStyle} placeholder="e.g. Evening yoga" value={customName} onChange={e => setCustomName(e.target.value)} />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.slateLight, letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 }}>Tile location</div>
              <input style={inputStyle} placeholder="e.g. Bedroom door" value={customLocation} onChange={e => setCustomLocation(e.target.value)} />
            </div>
          </div>
        </div>

        {/* Target */}
        <div style={{ background: C.white, borderRadius: 20, padding: 20, marginBottom: 12, boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.slate, marginBottom: 4 }}>How many times per day?</div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 24, marginTop: 12 }}>
            <button onClick={() => setCustomTarget(t => Math.max(1, t - 1))} style={{ width: 44, height: 44, borderRadius: "50%", border: "none", background: C.offwhite, fontSize: 22, cursor: "pointer", color: C.slate }}>−</button>
            <div style={{ textAlign: "center", minWidth: 60 }}>
              <div style={{ fontSize: 48, fontWeight: 700, color: C.slate, fontFamily: "'Cormorant Garamond', serif", lineHeight: 1 }}>{customTarget}</div>
              <div style={{ fontSize: 11, color: C.slateLight, marginTop: 4 }}>{customTarget === 1 ? "time per day" : "times per day"}</div>
            </div>
            <button onClick={() => setCustomTarget(t => Math.min(20, t + 1))} style={{ width: 44, height: 44, borderRadius: "50%", border: "none", background: C.offwhite, fontSize: 22, cursor: "pointer", color: C.slate }}>+</button>
          </div>
        </div>

        {/* Category */}
        <div style={{ background: C.white, borderRadius: 20, padding: 16, marginBottom: 16, boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.slateLight, letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 }}>Category</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {CATEGORIES.map(c => (
              <div key={c.id} onClick={() => setCustomCatId(c.id)} style={{ padding: "10px 12px", borderRadius: 12, cursor: "pointer", background: customCatId === c.id ? `${c.color}20` : C.offwhite, border: customCatId === c.id ? `2px solid ${c.color}` : "2px solid transparent", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 16 }}>{c.icon}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: C.slate }}>{c.name.split(" ")[0]}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ background: C.white, borderRadius: 20, padding: 16, marginBottom: 12, boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.slate, marginBottom: 10 }}>Who is this for?</div>
          <div onClick={() => { setCustomSelectedMembers([]); setCustomIsShared(true); }} style={{ padding: "10px 14px", borderRadius: 12, marginBottom: 6, cursor: "pointer", background: customSelectedMembers.length === 0 ? `${C.accent}15` : C.offwhite, border: `1.5px solid ${customSelectedMembers.length === 0 ? C.accent : "transparent"}`, fontSize: 13, fontWeight: 500, color: C.slate, display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${customSelectedMembers.length === 0 ? C.accent : C.sandDark}`, background: customSelectedMembers.length === 0 ? C.accent : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{customSelectedMembers.length === 0 && <span style={{ color: C.white, fontSize: 11, lineHeight: 1 }}>✓</span>}</div>
            👥 Everyone in the family
          </div>
          {(family.members || []).map(m => {
            const isSelected = customSelectedMembers.includes(m.id);
            return (
              <div key={m.id} onClick={() => {
                let next;
                if (isSelected) { next = customSelectedMembers.filter(id => id !== m.id); }
                else { next = [...customSelectedMembers, m.id]; }
                const everyone = next.length === 0 || next.length === (family.members?.length || 0);
                setCustomSelectedMembers(everyone ? [] : next);
                setCustomIsShared(everyone);
              }} style={{ padding: "10px 14px", borderRadius: 12, marginBottom: 6, cursor: "pointer", background: isSelected ? `${C.accent}15` : C.offwhite, border: `1.5px solid ${isSelected ? C.accent : "transparent"}`, fontSize: 13, fontWeight: 500, color: C.slate, display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${isSelected ? C.accent : C.sandDark}`, background: isSelected ? C.accent : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{isSelected && <span style={{ color: C.white, fontSize: 11, lineHeight: 1 }}>✓</span>}</div>
                <div style={{ width: 22, height: 22, borderRadius: "50%", background: m.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: C.white, flexShrink: 0 }}>{m.avatar}</div>
                {m.name}
              </div>
            );
          })}
          {customSelectedMembers.length > 0 && <div style={{ fontSize: 11, color: C.accent, marginTop: 4, fontWeight: 600 }}>{customSelectedMembers.length} {customSelectedMembers.length === 1 ? "person" : "people"} selected</div>}
        </div>

        <div style={{ background: C.white, borderRadius: 20, padding: 16, marginBottom: 16, boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.slate, marginBottom: 10 }}>Which days?</div>
          <div onClick={() => setCustomDays(null)} style={{ padding: "10px 14px", borderRadius: 12, marginBottom: 6, cursor: "pointer", background: customDays === null ? `${C.accent}15` : C.offwhite, border: `1.5px solid ${customDays === null ? C.accent : "transparent"}`, fontSize: 13, fontWeight: 500, color: C.slate }}>📅 Every day</div>
          <div onClick={() => setCustomDays([0,1,2,3,4])} style={{ padding: "10px 14px", borderRadius: 12, marginBottom: 8, cursor: "pointer", background: Array.isArray(customDays) && customDays.length === 5 && [0,1,2,3,4].every(d => customDays.includes(d)) ? `${C.accent}15` : C.offwhite, border: `1.5px solid ${Array.isArray(customDays) && customDays.length === 5 && [0,1,2,3,4].every(d => customDays.includes(d)) ? C.accent : "transparent"}`, fontSize: 13, fontWeight: 500, color: C.slate }}>📚 Weekdays only (Mon–Fri)</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((day, idx) => {
              const sel = Array.isArray(customDays) && customDays.includes(idx);
              return (
                <div key={idx} onClick={() => {
                  if (!Array.isArray(customDays)) { setCustomDays([idx]); }
                  else if (sel) { const nd = customDays.filter(d => d !== idx); setCustomDays(nd.length === 0 ? null : nd); }
                  else { setCustomDays([...customDays, idx].sort()); }
                }} style={{ padding: "7px 11px", borderRadius: 10, cursor: "pointer", fontSize: 12, fontWeight: 600, background: sel ? C.accent : C.offwhite, color: sel ? C.white : C.slate, border: `1.5px solid ${sel ? C.accent : C.sandDark}` }}>{day}</div>
              );
            })}
          </div>
        </div>

        {/* Completion tracking type */}
        <div style={{ background: C.white, borderRadius: 20, padding: 16, marginBottom: 16, boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.slate, marginBottom: 4 }}>Completion tracking</div>
          <div style={{ fontSize: 11, color: C.slateLight, marginBottom: 10 }}>How should progress be tracked?</div>
          <div onClick={() => setCustomCompletionType('individual')} style={{ padding: "12px 14px", borderRadius: 12, marginBottom: 8, cursor: "pointer", background: customCompletionType === 'individual' ? `${C.accent}15` : C.offwhite, border: `1.5px solid ${customCompletionType === 'individual' ? C.accent : "transparent"}`, fontSize: 13, fontWeight: 500, color: C.slate }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
              <div style={{ width: 18, height: 18, borderRadius: "50%", border: `2px solid ${customCompletionType === 'individual' ? C.accent : C.sandDark}`, background: customCompletionType === 'individual' ? C.accent : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>{customCompletionType === 'individual' && <div style={{ width: 8, height: 8, borderRadius: "50%", background: C.white }} />}</div>
              <span style={{ fontWeight: 600 }}>👤 Individual tracking</span>
            </div>
            <div style={{ fontSize: 11, color: C.slateLight, marginLeft: 26 }}>Each person tracks their own progress separately</div>
          </div>
          <div onClick={() => setCustomCompletionType('shared')} style={{ padding: "12px 14px", borderRadius: 12, cursor: "pointer", background: customCompletionType === 'shared' ? `${C.accent}15` : C.offwhite, border: `1.5px solid ${customCompletionType === 'shared' ? C.accent : "transparent"}`, fontSize: 13, fontWeight: 500, color: C.slate }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
              <div style={{ width: 18, height: 18, borderRadius: "50%", border: `2px solid ${customCompletionType === 'shared' ? C.accent : C.sandDark}`, background: customCompletionType === 'shared' ? C.accent : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>{customCompletionType === 'shared' && <div style={{ width: 8, height: 8, borderRadius: "50%", background: C.white }} />}</div>
              <span style={{ fontWeight: 600 }}>👥 Shared/Household tracking</span>
            </div>
            <div style={{ fontSize: 11, color: C.slateLight, marginLeft: 26 }}>One completion counts for everyone assigned</div>
            <div style={{ fontSize: 11, color: C.warm, marginLeft: 26, marginTop: 2 }}>Example: "Feed the pet" — anyone can do it, counts for all</div>
          </div>
        </div>

        <button
          onClick={() => {
            if (!customName.trim()) return;
            const selectedCategory = CATEGORIES.find(c => c.id === customCatId) || CATEGORIES[0];
            const assignedMemberIds = customSelectedMembers.length === 0 ? null : customSelectedMembers;
            onAddHabit({
              name: customName.trim(), icon: customEmoji,
              category: selectedCategory.name, categoryId: customCatId,
              color: selectedCategory.color, location: customLocation.trim() || null,
              target: customTarget, isKid: selectedCategory.isKids || false, isCustom: true,
              isShared: customSelectedMembers.length === 0,
              assignedMemberIds,
              daysActive: customDays,
              completionType: customCompletionType,
            });
            setCustomName(""); setCustomLocation(""); setCustomEmoji("🎯"); setCustomTarget(1); setCustomCatId("family"); setCustomIsShared(true); setCustomSelectedMembers([]); setCustomDays(null); setCustomCompletionType('individual');
          }}
          style={{ ...btnPrimary, opacity: customName.trim() ? 1 : 0.5 }}
        >
          Add Custom Ritual
        </button>
      </div>
    );
  }

  if (view === "addRitual") return (
    <div style={{ padding: "0 20px 110px" }}>
      <button onClick={() => setView("menu")} style={{ background: "none", border: "none", cursor: "pointer", color: C.slateLight, fontSize: 13, marginBottom: 20 }}>← Back</button>
      <div style={{ fontSize: 18, fontWeight: 700, color: C.slate, fontFamily: "'Cormorant Garamond', serif", marginBottom: 4 }}>Add a Ritual</div>
      <div style={{ fontSize: 12, color: C.slateLight, marginBottom: 20 }}>How do you want to add it?</div>
      <div style={{ display: "flex", gap: 10 }}>
        <div onClick={() => setView("habits")} style={{ flex: 1, background: C.white, borderRadius: 20, padding: 20, cursor: "pointer", boxShadow: "0 2px 10px rgba(0,0,0,0.05)", border: "1px solid rgba(0,0,0,0.05)", textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>📚</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.slate }}>Browse Templates</div>
          <div style={{ fontSize: 11, color: C.slateLight, marginTop: 4 }}>Choose from pre-made habits</div>
        </div>
        <div onClick={() => setView("custom")} style={{ flex: 1, background: C.white, borderRadius: 20, padding: 20, cursor: "pointer", boxShadow: "0 2px 10px rgba(0,0,0,0.05)", border: "1px solid rgba(0,0,0,0.05)", textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>✨</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.slate }}>Create Custom</div>
          <div style={{ fontSize: 11, color: C.slateLight, marginTop: 4 }}>Design your own habit</div>
        </div>
      </div>
    </div>
  );

  if (view === "menu") return (
    <div style={{ padding: "0 20px 110px" }}>
      <div style={{ fontSize: 13, color: C.slateLight, marginBottom: 24 }}>What would you like to set up?</div>
      {[
        { id: "addRitual", icon: "◈", label: "Add a Ritual", desc: "Browse templates or create your own", color: C.slate },
        { id: "rewards", icon: "🎁", label: "Manage Rewards", desc: "Set up points rewards for your family", color: C.accent },
        { id: "tile", icon: "🏷️", label: "Manage Tiles", desc: "Assign tiles to habits, detect new tiles", color: C.kidsBlue },
        { id: "habitsManage", icon: "✏️", label: "Manage Habits", desc: "Edit names, locations, targets or delete", color: C.slateLight },
      ].map(item => (
        <div key={item.id} onClick={() => setView(item.id)} style={{ background: C.white, borderRadius: 20, padding: 20, marginBottom: 12, boxShadow: "0 2px 10px rgba(0,0,0,0.05)", cursor: "pointer", border: "1px solid rgba(0,0,0,0.05)", display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ width: 50, height: 50, borderRadius: 15, background: `${item.color}15`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>{item.icon}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: C.slate }}>{item.label}</div>
            <div style={{ fontSize: 12, color: C.slateLight, marginTop: 2 }}>{item.desc}</div>
          </div>
          <div style={{ color: C.sandDark, fontSize: 20 }}>›</div>
        </div>
      ))}
    </div>
  );

  if (view === "habits") return (
    <div style={{ padding: "0 20px 110px" }}>
      <button onClick={() => setView("menu")} style={{ background: "none", border: "none", cursor: "pointer", color: C.slateLight, fontSize: 13, marginBottom: 16 }}>← Back</button>
      <div style={{ fontSize: 13, color: C.slateLight, marginBottom: 20, lineHeight: 1.6 }}>Every habit is pre-loaded and ready to link to your tile.</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {CATEGORIES.map(cat => (
          <div key={cat.id} onClick={() => { setSelectedCat(cat); setView("category"); }} style={{ background: cat.isKids ? `linear-gradient(135deg, ${C.kids}15, ${C.kidsLight}10)` : C.white, borderRadius: 20, padding: 18, cursor: "pointer", boxShadow: "0 2px 10px rgba(0,0,0,0.05)", border: cat.isKids ? `1.5px solid ${C.kids}30` : "1px solid rgba(0,0,0,0.05)" }}>
            <div style={{ width: 42, height: 42, borderRadius: 13, background: `${cat.color}18`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, marginBottom: 10 }}>{cat.icon}</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.slate, lineHeight: 1.3 }}>{cat.name}</div>
            <div style={{ fontSize: 11, color: C.slateLight, marginTop: 3 }}>{cat.habits.length} habits</div>
            {cat.isKids && <div style={{ marginTop: 8, fontSize: 10, color: C.kids, fontWeight: 700 }}>⭐ Kids Special</div>}
          </div>
        ))}
      </div>
    </div>
  );

  if (view === "category" && selectedCat) return (
    <div style={{ padding: "0 20px 110px" }}>
      <button onClick={() => setView("habits")} style={{ background: "none", border: "none", cursor: "pointer", color: C.slateLight, fontSize: 13, marginBottom: 16 }}>← Back</button>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <div style={{ fontSize: 28 }}>{selectedCat.icon}</div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.slate, fontFamily: "'Cormorant Garamond', serif" }}>{selectedCat.name}</div>
          <div style={{ fontSize: 12, color: C.slateLight }}>{selectedCat.description}</div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {selectedCat.habits.map((h, i) => (
          <div key={i} onClick={() => { setSelectedHabit({ ...h, categoryId: selectedCat.id, category: selectedCat.name, color: selectedCat.color, isKid: selectedCat.isKids }); setTargetCount(h.target || 1); setView("setTarget"); }} style={{ background: C.white, borderRadius: 16, padding: 16, cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,0.04)", border: "1px solid rgba(0,0,0,0.05)", display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: `${selectedCat.color}15`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>{h.icon}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: C.slate }}>{h.name}</div>
              <div style={{ fontSize: 11, color: C.slateLight, marginTop: 1 }}>Tile at: {h.location}</div>
            </div>
            <div style={{ color: C.sandDark, fontSize: 18 }}>+</div>
          </div>
        ))}
      </div>
    </div>
  );

  if (view === "setTarget" && selectedHabit) return (
    <div style={{ padding: "0 20px 110px" }}>
      <button onClick={() => setView("category")} style={{ background: "none", border: "none", cursor: "pointer", color: C.slateLight, fontSize: 13, marginBottom: 20 }}>← Back</button>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <div style={{ width: 48, height: 48, borderRadius: 14, background: `${selectedHabit.color}18`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>{selectedHabit.icon}</div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.slate, fontFamily: "'Cormorant Garamond', serif" }}>{selectedHabit.name}</div>
          <div style={{ fontSize: 12, color: C.slateLight }}>Tile at: {selectedHabit.location}</div>
        </div>
      </div>
      <div style={{ background: C.white, borderRadius: 20, padding: 20, marginBottom: 14, boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.slate, marginBottom: 4 }}>How many times per day?</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 24, marginTop: 12 }}>
          <button onClick={() => setTargetCount(t => Math.max(1, t - 1))} style={{ width: 44, height: 44, borderRadius: "50%", border: "none", background: C.offwhite, fontSize: 22, cursor: "pointer", color: C.slate }}>−</button>
          <div style={{ textAlign: "center", minWidth: 60 }}>
            <div style={{ fontSize: 48, fontWeight: 700, color: C.slate, fontFamily: "'Cormorant Garamond', serif", lineHeight: 1 }}>{targetCount}</div>
            <div style={{ fontSize: 11, color: C.slateLight, marginTop: 4 }}>{targetCount === 1 ? "time per day" : "times per day"}</div>
          </div>
          <button onClick={() => setTargetCount(t => Math.min(20, t + 1))} style={{ width: 44, height: 44, borderRadius: "50%", border: "none", background: C.offwhite, fontSize: 22, cursor: "pointer", color: C.slate }}>+</button>
        </div>
        {targetCount > 1 && <div style={{ marginTop: 16, padding: "10px 16px", borderRadius: 12, background: `${selectedHabit.color}10`, fontSize: 12, color: C.slate, textAlign: "center", lineHeight: 1.5 }}><strong>+{targetCount * 10} points</strong> on days you hit all {targetCount} taps</div>}
      </div>
      <div style={{ background: C.white, borderRadius: 20, padding: 16, marginBottom: 12, boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.slate, marginBottom: 10 }}>Who is this for?</div>
        <div onClick={() => { setHabitSelectedMembers([]); setHabitIsShared(true); }} style={{ padding: "10px 14px", borderRadius: 12, marginBottom: 6, cursor: "pointer", background: habitSelectedMembers.length === 0 ? `${C.accent}15` : C.offwhite, border: `1.5px solid ${habitSelectedMembers.length === 0 ? C.accent : "transparent"}`, fontSize: 13, fontWeight: 500, color: C.slate, display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${habitSelectedMembers.length === 0 ? C.accent : C.sandDark}`, background: habitSelectedMembers.length === 0 ? C.accent : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{habitSelectedMembers.length === 0 && <span style={{ color: C.white, fontSize: 11, lineHeight: 1 }}>✓</span>}</div>
          👥 Everyone in the family
        </div>
        {(family.members || []).map(m => {
          const isSelected = habitSelectedMembers.includes(m.id);
          return (
            <div key={m.id} onClick={() => {
              let next;
              if (isSelected) { next = habitSelectedMembers.filter(id => id !== m.id); }
              else { next = [...habitSelectedMembers, m.id]; }
              const everyone = next.length === 0 || next.length === (family.members?.length || 0);
              setHabitSelectedMembers(everyone ? [] : next);
              setHabitIsShared(everyone);
            }} style={{ padding: "10px 14px", borderRadius: 12, marginBottom: 6, cursor: "pointer", background: isSelected ? `${C.accent}15` : C.offwhite, border: `1.5px solid ${isSelected ? C.accent : "transparent"}`, fontSize: 13, fontWeight: 500, color: C.slate, display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${isSelected ? C.accent : C.sandDark}`, background: isSelected ? C.accent : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{isSelected && <span style={{ color: C.white, fontSize: 11, lineHeight: 1 }}>✓</span>}</div>
              <div style={{ width: 22, height: 22, borderRadius: "50%", background: m.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: C.white, flexShrink: 0 }}>{m.avatar}</div>
              {m.name}
            </div>
          );
        })}
        {habitSelectedMembers.length > 0 && <div style={{ fontSize: 11, color: C.accent, marginTop: 4, fontWeight: 600 }}>{habitSelectedMembers.length} {habitSelectedMembers.length === 1 ? "person" : "people"} selected</div>}
      </div>
      <div style={{ background: C.white, borderRadius: 20, padding: 16, marginBottom: 14, boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.slate, marginBottom: 10 }}>Which days?</div>
        <div onClick={() => setHabitDays(null)} style={{ padding: "10px 14px", borderRadius: 12, marginBottom: 6, cursor: "pointer", background: habitDays === null ? `${C.accent}15` : C.offwhite, border: `1.5px solid ${habitDays === null ? C.accent : "transparent"}`, fontSize: 13, fontWeight: 500, color: C.slate }}>📅 Every day</div>
        <div onClick={() => setHabitDays([0,1,2,3,4])} style={{ padding: "10px 14px", borderRadius: 12, marginBottom: 8, cursor: "pointer", background: Array.isArray(habitDays) && habitDays.length === 5 && [0,1,2,3,4].every(d => habitDays.includes(d)) ? `${C.accent}15` : C.offwhite, border: `1.5px solid ${Array.isArray(habitDays) && habitDays.length === 5 && [0,1,2,3,4].every(d => habitDays.includes(d)) ? C.accent : "transparent"}`, fontSize: 13, fontWeight: 500, color: C.slate }}>📚 Weekdays only (Mon–Fri)</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((day, idx) => {
            const sel = Array.isArray(habitDays) && habitDays.includes(idx);
            return (
              <div key={idx} onClick={() => {
                if (!Array.isArray(habitDays)) { setHabitDays([idx]); }
                else if (sel) { const nd = habitDays.filter(d => d !== idx); setHabitDays(nd.length === 0 ? null : nd); }
                else { setHabitDays([...habitDays, idx].sort()); }
              }} style={{ padding: "7px 11px", borderRadius: 10, cursor: "pointer", fontSize: 12, fontWeight: 600, background: sel ? C.accent : C.offwhite, color: sel ? C.white : C.slate, border: `1.5px solid ${sel ? C.accent : C.sandDark}` }}>{day}</div>
            );
          })}
        </div>
      </div>
      {/* Completion tracking type */}
      <div style={{ background: C.white, borderRadius: 20, padding: 16, marginBottom: 14, boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.slate, marginBottom: 4 }}>Completion tracking</div>
        <div style={{ fontSize: 11, color: C.slateLight, marginBottom: 10 }}>How should progress be tracked?</div>
        <div onClick={() => setHabitCompletionType('individual')} style={{ padding: "12px 14px", borderRadius: 12, marginBottom: 8, cursor: "pointer", background: habitCompletionType === 'individual' ? `${C.accent}15` : C.offwhite, border: `1.5px solid ${habitCompletionType === 'individual' ? C.accent : "transparent"}`, fontSize: 13, fontWeight: 500, color: C.slate }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
            <div style={{ width: 18, height: 18, borderRadius: "50%", border: `2px solid ${habitCompletionType === 'individual' ? C.accent : C.sandDark}`, background: habitCompletionType === 'individual' ? C.accent : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>{habitCompletionType === 'individual' && <div style={{ width: 8, height: 8, borderRadius: "50%", background: C.white }} />}</div>
            <span style={{ fontWeight: 600 }}>👤 Individual tracking</span>
          </div>
          <div style={{ fontSize: 11, color: C.slateLight, marginLeft: 26 }}>Each person tracks their own progress separately</div>
        </div>
        <div onClick={() => setHabitCompletionType('shared')} style={{ padding: "12px 14px", borderRadius: 12, cursor: "pointer", background: habitCompletionType === 'shared' ? `${C.accent}15` : C.offwhite, border: `1.5px solid ${habitCompletionType === 'shared' ? C.accent : "transparent"}`, fontSize: 13, fontWeight: 500, color: C.slate }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
            <div style={{ width: 18, height: 18, borderRadius: "50%", border: `2px solid ${habitCompletionType === 'shared' ? C.accent : C.sandDark}`, background: habitCompletionType === 'shared' ? C.accent : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>{habitCompletionType === 'shared' && <div style={{ width: 8, height: 8, borderRadius: "50%", background: C.white }} />}</div>
            <span style={{ fontWeight: 600 }}>👥 Shared/Household tracking</span>
          </div>
          <div style={{ fontSize: 11, color: C.slateLight, marginLeft: 26 }}>One completion counts for everyone assigned</div>
          <div style={{ fontSize: 11, color: C.warm, marginLeft: 26, marginTop: 2 }}>Example: "Feed the pet" — anyone can do it, counts for all</div>
        </div>
      </div>
      <button onClick={() => {
        const assignedMemberIds = habitSelectedMembers.length === 0 ? null : habitSelectedMembers;
        onAddHabit({ ...selectedHabit, target: targetCount, isShared: habitSelectedMembers.length === 0, assignedMemberIds, daysActive: habitDays, completionType: habitCompletionType });
        setTargetCount(1); setHabitIsShared(true); setHabitSelectedMembers([]); setHabitDays(null); setHabitCompletionType('individual'); setView("menu");
      }} style={btnPrimary}>Add to My Rituals</button>
    </div>
  );

  if (view === "rewards") return (
    <div style={{ padding: "0 20px 110px" }}>
      <button onClick={() => setView("menu")} style={{ background: "none", border: "none", cursor: "pointer", color: C.slateLight, fontSize: 13, marginBottom: 16 }}>← Back</button>
      <div style={{ fontSize: 18, fontWeight: 700, color: C.slate, fontFamily: "'Cormorant Garamond', serif", marginBottom: 4 }}>Rewards</div>
      <div style={{ fontSize: 12, color: C.slateLight, marginBottom: 16 }}>View and manage rewards for your family</div>
      {(family.rewards || []).map((r, i) => (
        <div key={r.id || i} style={{ background: C.white, borderRadius: 16, padding: 16, marginBottom: 10, display: "flex", alignItems: "center", gap: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
          <div style={{ fontSize: 28 }}>{r.icon}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.slate }}>{r.name}</div>
            <div style={{ fontSize: 12, color: C.slateLight }}>{r.who} · {r.points} pts</div>
          </div>
        </div>
      ))}
    </div>
  );

  return null;
}

// ─── INSIGHTS SCREEN ──────────────────────────────────────────────
function InsightsScreen({ habits, family, weekCompletions = [], currentMember, analyticsData }) {
  const [showFamily, setShowFamily] = useState(false);
  const members = family?.members || [];
  const kids = members.filter(m => m.isKid);

  // Filter completions by member when in "My Stats" mode
  // Also excludes completions for habits not assigned to this member
  const filteredWeek = useMemo(() => {
    if (showFamily || !currentMember) return weekCompletions;
    return weekCompletions.filter(c => {
      if (c.memberId !== currentMember.id) return false;
      const habit = habits.find(h => h.id === c.habitId);
      if (!habit) return false;
      if (!habit.assignedMemberIds || habit.assignedMemberIds.length === 0) return true;
      return habit.assignedMemberIds.includes(currentMember.id);
    });
  }, [weekCompletions, currentMember, showFamily, habits]);

  const filteredAnalytics = useMemo(() => {
    if (!analyticsData) return null;
    if (showFamily || !currentMember) return analyticsData;
    return analyticsData.filter(c => {
      if (c.memberId !== currentMember.id) return false;
      const habit = habits.find(h => h.id === c.habitId);
      if (!habit) return false;
      if (!habit.assignedMemberIds || habit.assignedMemberIds.length === 0) return true;
      return habit.assignedMemberIds.includes(currentMember.id);
    });
  }, [analyticsData, currentMember, showFamily, habits]);

  // ── Family Highlights ──────────────────────────────────────────
  const highlights = useMemo(() => {
    const tapsByMember = {};
    weekCompletions.forEach(c => { if (c.taps > 0) tapsByMember[c.memberId] = (tapsByMember[c.memberId] || 0) + c.taps; });
    const hero = [...members].sort((a, b) => (tapsByMember[b.id] || 0) - (tapsByMember[a.id] || 0))[0];

    const streakChamp = [...members].sort((a, b) => (b.streak || 0) - (a.streak || 0))[0];

    const earlyTaps = {}, nightTaps = {};
    weekCompletions.forEach(c => {
      if (!c.completedAt || c.taps <= 0) return;
      const h = new Date(c.completedAt).getHours();
      if (h < 9) earlyTaps[c.memberId] = (earlyTaps[c.memberId] || 0) + 1;
      if (h >= 20) nightTaps[c.memberId] = (nightTaps[c.memberId] || 0) + 1;
    });
    const earlyBird = members.filter(m => earlyTaps[m.id] > 0).sort((a, b) => (earlyTaps[b.id] || 0) - (earlyTaps[a.id] || 0))[0];
    const nightOwl = members.filter(m => nightTaps[m.id] > 0).sort((a, b) => (nightTaps[b.id] || 0) - (nightTaps[a.id] || 0))[0];

    const sharedIds = new Set(habits.filter(h => h.completionType === 'shared').map(h => h.id));
    const sharedTaps = {};
    weekCompletions.forEach(c => { if (sharedIds.has(c.habitId) && c.taps > 0) sharedTaps[c.memberId] = (sharedTaps[c.memberId] || 0) + c.taps; });
    const sharedMVP = members.filter(m => sharedTaps[m.id] > 0).sort((a, b) => (sharedTaps[b.id] || 0) - (sharedTaps[a.id] || 0))[0];

    const daysByMember = {};
    const seen = new Set();
    weekCompletions.forEach(c => {
      if (c.taps <= 0) return;
      const key = `${c.memberId}_${c.date}`;
      if (!seen.has(key)) { seen.add(key); daysByMember[c.memberId] = (daysByMember[c.memberId] || 0) + 1; }
    });
    const consistency = [...members].sort((a, b) => (daysByMember[b.id] || 0) - (daysByMember[a.id] || 0))[0];

    return {
      hero: tapsByMember[hero?.id] > 0 ? { member: hero, count: tapsByMember[hero.id] } : null,
      streakChamp: streakChamp?.streak > 0 ? { member: streakChamp, streak: streakChamp.streak } : null,
      earlyBird: earlyBird ? { member: earlyBird, count: earlyTaps[earlyBird.id] } : null,
      nightOwl: nightOwl ? { member: nightOwl, count: nightTaps[nightOwl.id] } : null,
      sharedMVP: sharedMVP ? { member: sharedMVP, count: sharedTaps[sharedMVP.id] } : null,
      consistency: daysByMember[consistency?.id] > 0 ? { member: consistency, days: daysByMember[consistency.id] } : null,
    };
  }, [weekCompletions, members, habits]);

  // ── Time-of-day patterns ───────────────────────────────────────
  const timePatterns = useMemo(() => {
    const buckets = { early: 0, morning: 0, afternoon: 0, evening: 0, night: 0 };
    let total = 0;
    filteredWeek.forEach(c => {
      if (!c.completedAt || c.taps <= 0) return;
      const h = new Date(c.completedAt).getHours();
      total++;
      if (h < 9) buckets.early++;
      else if (h < 12) buckets.morning++;
      else if (h < 17) buckets.afternoon++;
      else if (h < 20) buckets.evening++;
      else buckets.night++;
    });
    if (total === 0) return null;
    const pct = k => Math.round((buckets[k] / total) * 100);
    return [
      { label: "Early morning", sublabel: "before 9am", pct: pct('early'), icon: "🌅" },
      { label: "Morning", sublabel: "9am – 12pm", pct: pct('morning'), icon: "☀️" },
      { label: "Afternoon", sublabel: "12pm – 5pm", pct: pct('afternoon'), icon: "🌤️" },
      { label: "Evening", sublabel: "5pm – 8pm", pct: pct('evening'), icon: "🌇" },
      { label: "Night", sublabel: "after 8pm", pct: pct('night'), icon: "🌙" },
    ].sort((a, b) => b.pct - a.pct);
  }, [filteredWeek]);

  // ── Streak Watch ───────────────────────────────────────────────
  const streakWatch = useMemo(() => {
    const milestones = [3, 7, 10, 14, 21, 30, 50, 100];
    return members
      .map(m => {
        const s = m.streak || 0;
        const next = milestones.find(ms => ms > s);
        return { member: m, streak: s, next, daysAway: next ? next - s : null };
      })
      .filter(x => x.streak > 0)
      .sort((a, b) => (a.daysAway || 999) - (b.daysAway || 999));
  }, [members]);

  // ── Habit Health (needs analyticsData) ────────────────────────
  const habitHealth = useMemo(() => {
    if (!filteredAnalytics) return null;
    const weekDates = getWeekDates();
    const thisWeekStart = weekDates[0];
    const lastWeekEnd = new Date(weekDates[0]);
    lastWeekEnd.setDate(lastWeekEnd.getDate() - 1);
    const lastWeekStart = new Date(lastWeekEnd);
    lastWeekStart.setDate(lastWeekStart.getDate() - 6);
    const lwStartStr = lastWeekStart.toISOString().split("T")[0];
    const lwEndStr = lastWeekEnd.toISOString().split("T")[0];

    const visibleHabits = (!showFamily && currentMember)
      ? habits.filter(h => !h.assignedMemberIds || h.assignedMemberIds.length === 0 || h.assignedMemberIds.includes(currentMember.id))
      : habits;
    return visibleHabits.map(h => {
      const thisWeek = filteredAnalytics.filter(c => c.habitId === h.id && c.date >= thisWeekStart && c.taps > 0);
      const lastWeek = filteredAnalytics.filter(c => c.habitId === h.id && c.date >= lwStartStr && c.date <= lwEndStr && c.taps > 0);
      const twRate = thisWeek.length / 7;
      const lwRate = lastWeek.length / 7;
      const delta = lwRate > 0 ? Math.round((twRate - lwRate) * 100) : null;
      const twPct = Math.round(twRate * 100);
      return { habit: h, thisWeekDays: thisWeek.length, lastWeekDays: lastWeek.length, delta, twPct };
    }).filter(x => x.thisWeekDays > 0 || x.lastWeekDays > 0).slice(0, 6);
  }, [filteredAnalytics, habits, showFamily, currentMember]);

  // ── Kids Leaderboard ──────────────────────────────────────────
  const kidsBoard = useMemo(() => {
    if (kids.length === 0) return null;
    const tapsByKid = {};
    weekCompletions.forEach(c => {
      if (c.taps > 0 && kids.find(k => k.id === c.memberId)) tapsByKid[c.memberId] = (tapsByKid[c.memberId] || 0) + c.taps;
    });
    return kids.map(k => ({ member: k, taps: tapsByKid[k.id] || 0 })).sort((a, b) => b.taps - a.taps);
  }, [kids, weekCompletions]);

  // ── Personal Bests (needs analyticsData) ──────────────────────
  const personalBests = useMemo(() => {
    if (!filteredAnalytics || !currentMember) return null;
    const myComps = showFamily ? filteredAnalytics : filteredAnalytics.filter(c => c.memberId === currentMember.id);
    if (myComps.length === 0) return null;

    // Count completions per week
    const byWeek = {};
    myComps.forEach(c => {
      if (c.taps <= 0) return;
      const d = new Date(c.date);
      const monday = new Date(d);
      monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      const wk = monday.toISOString().split("T")[0];
      byWeek[wk] = (byWeek[wk] || 0) + 1;
    });
    const weekTotals = Object.values(byWeek).sort((a, b) => b - a);
    const allTimeRecord = weekTotals[0] || 0;
    const currentWeekKey = getWeekDates()[0];
    const thisWeekCount = byWeek[currentWeekKey] || 0;
    const previousRecord = weekTotals.find((_, i, arr) => i > 0) || 0;
    const isNewRecord = thisWeekCount > 0 && thisWeekCount >= allTimeRecord && Object.keys(byWeek).length > 1;

    // Longest streak per habit
    const habitStreaks = habits.map(h => ({ habit: h, streak: h.streak || 0 })).filter(x => x.streak >= 3).sort((a, b) => b.streak - a.streak).slice(0, 2);

    return { thisWeekCount, allTimeRecord, previousRecord, isNewRecord, habitStreaks };
  }, [filteredAnalytics, currentMember, habits, showFamily]);

  const insightCard = (content) => (
    <div style={{ background: C.white, borderRadius: 20, padding: 18, marginBottom: 12, boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
      {content}
    </div>
  );

  const cardHeader = (icon, title, color = C.slate) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
      <div style={{ width: 32, height: 32, borderRadius: 10, background: `${color}18`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>{icon}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.slate, letterSpacing: 0.3 }}>{title}</div>
    </div>
  );

  const highlightRow = (icon, label, value, color = C.slate) => value ? (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
      <span style={{ fontSize: 18, width: 24, textAlign: "center", flexShrink: 0 }}>{icon}</span>
      <span style={{ fontSize: 13, color: C.slateLight, flex: 1 }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color, flexShrink: 0 }}>{value}</span>
    </div>
  ) : null;

  const loadingSkeleton = (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {[70, 85, 60].map((w, i) => (
        <div key={i} style={{ height: 14, borderRadius: 7, background: C.sandLight, width: `${w}%`, animation: "pulse 1.5s ease-in-out infinite" }} />
      ))}
      <div style={{ fontSize: 11, color: C.sandDark, marginTop: 4 }}>Loading analytics…</div>
    </div>
  );

  const hasWeekData = weekCompletions.length > 0;

  return (
    <div style={{ padding: "0 20px 110px" }}>
      {/* My Stats / Family toggle */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {["My Stats", "Family"].map((label, i) => {
          const active = i === 0 ? !showFamily : showFamily;
          return (
            <button key={label} onClick={() => setShowFamily(i === 1)}
              style={{ flex: 1, padding: "9px 0", borderRadius: 12, border: `1.5px solid ${active ? C.accent : C.sandDark}`, background: active ? `${C.accent}12` : C.white, color: active ? C.accent : C.slateLight, fontSize: 13, fontWeight: active ? 700 : 400, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>
              {label}
            </button>
          );
        })}
      </div>

      {/* 1. Family Highlights */}
      {insightCard(<>
        {cardHeader("🏆", "Family Highlights", C.warm)}
        {!hasWeekData ? (
          <div style={{ fontSize: 13, color: C.slateLight }}>Complete some habits this week to see highlights!</div>
        ) : <>
          {highlightRow("🥇", "Household Hero", highlights.hero ? `${highlights.hero.member.avatar} ${highlights.hero.member.name} (${highlights.hero.count} tasks)` : null, C.accent)}
          {highlightRow("🔥", "Streak Champion", highlights.streakChamp ? `${highlights.streakChamp.member.avatar} ${highlights.streakChamp.member.name} (${highlights.streakChamp.streak} days)` : null, C.accent)}
          {highlightRow("🌅", "Early Bird", highlights.earlyBird ? `${highlights.earlyBird.member.avatar} ${highlights.earlyBird.member.name} (${highlights.earlyBird.count} before 9am)` : null, C.green)}
          {highlightRow("🌙", "Night Owl", highlights.nightOwl ? `${highlights.nightOwl.member.avatar} ${highlights.nightOwl.member.name} (${highlights.nightOwl.count} after 8pm)` : null, C.slate)}
          {highlightRow("🤝", "Shared Task MVP", highlights.sharedMVP ? `${highlights.sharedMVP.member.avatar} ${highlights.sharedMVP.member.name} (${highlights.sharedMVP.count} shared)` : null, C.warm)}
          {highlightRow("📅", "Most Consistent", highlights.consistency ? `${highlights.consistency.member.avatar} ${highlights.consistency.member.name} (${highlights.consistency.days} days active)` : null, C.green)}
          {!highlights.hero && !highlights.streakChamp && (
            <div style={{ fontSize: 13, color: C.slateLight }}>Tap some habits to start earning highlights!</div>
          )}
        </>}
      </>)}

      {/* 2. Streak Watch */}
      {streakWatch.length > 0 && insightCard(<>
        {cardHeader("🔥", "Streak Watch", C.accent)}
        {streakWatch.slice(0, 4).map((x, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: i < streakWatch.length - 1 ? 10 : 0 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: `${C.accent}15`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flexShrink: 0 }}>{x.member.avatar}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.slate }}>{x.member.name}</div>
              <div style={{ fontSize: 11, color: C.slateLight }}>
                {x.daysAway === 1
                  ? `🎯 1 day from ${x.next}-day streak!`
                  : x.daysAway && x.daysAway <= 3
                  ? `✨ ${x.daysAway} days from ${x.next}-day streak!`
                  : `🔥 ${x.streak} day streak`}
              </div>
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.accent }}>{x.streak}</div>
          </div>
        ))}
      </>)}

      {/* 3. When You Work Best */}
      {insightCard(<>
        {cardHeader("⏰", showFamily ? "When Your Family Works Best" : "When You Work Best", C.green)}
        {!timePatterns ? (
          <div style={{ fontSize: 13, color: C.slateLight }}>Complete habits with timestamps to see your patterns.</div>
        ) : (
          timePatterns.slice(0, 3).map((t, i) => (
            <div key={i} style={{ marginBottom: i < 2 ? 10 : 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <div style={{ fontSize: 12, color: C.slate }}>{t.icon} {t.label} <span style={{ color: C.slateLight }}>({t.sublabel})</span></div>
                <div style={{ fontSize: 12, fontWeight: 700, color: t.pct >= 40 ? C.accent : C.slateLight }}>{t.pct}%</div>
              </div>
              <div style={{ height: 6, background: C.sandLight, borderRadius: 3 }}>
                <div style={{ height: "100%", borderRadius: 3, background: t.pct >= 40 ? `linear-gradient(90deg, ${C.accent}, ${C.accentLight})` : `${C.slate}55`, width: `${t.pct}%`, transition: "width 0.6s ease" }} />
              </div>
            </div>
          ))
        )}
      </>)}

      {/* 4. Habit Health */}
      {insightCard(<>
        {cardHeader("📊", "Habit Health", C.green)}
        {!filteredAnalytics ? loadingSkeleton : habitHealth && habitHealth.length > 0 ? (
          habitHealth.map((x, i) => {
            let icon = "🎯", label = "Locked in", color = C.green;
            if (x.twPct === 100 && x.thisWeekDays >= 5) { icon = "🎯"; label = "100% this week!"; color = C.green; }
            else if (x.delta !== null && x.delta >= 15) { icon = "📈"; label = `+${x.delta}% vs last week`; color = C.green; }
            else if (x.delta !== null && x.delta <= -15) { icon = "📉"; label = `${x.delta}% vs last week`; color = C.error; }
            else if (x.thisWeekDays <= 1 && x.lastWeekDays >= 4) { icon = "⚠️"; label = "Needs attention"; color = C.warm; }
            else { icon = "✓"; label = `${x.thisWeekDays} of 7 days`; color = C.slateLight; }
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: i < habitHealth.length - 1 ? 10 : 0 }}>
                <div style={{ width: 34, height: 34, borderRadius: 10, background: `${x.habit.color}15`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>{x.habit.icon}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.slate }}>{x.habit.name}</div>
                  <div style={{ fontSize: 11, color }}>
                    {icon} {label}
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div style={{ fontSize: 13, color: C.slateLight }}>Complete habits over a few days to see health trends.</div>
        )}
      </>)}

      {/* 5. Kids Leaderboard */}
      {kidsBoard && insightCard(<>
        {cardHeader("🏆", "Kids Leaderboard", C.kids)}
        {kidsBoard.every(k => k.taps === 0) ? (
          <div style={{ fontSize: 13, color: C.slateLight }}>No completions this week yet — let's go!</div>
        ) : (
          kidsBoard.map((k, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: i < kidsBoard.length - 1 ? 10 : 0 }}>
              <div style={{ fontSize: 22, width: 28, textAlign: "center", flexShrink: 0 }}>{["🥇","🥈","🥉"][i] || "▫️"}</div>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: `${k.member.color}20`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, flexShrink: 0 }}>{k.member.avatar}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.slate }}>{k.member.name}</div>
                <div style={{ fontSize: 11, color: C.slateLight }}>{k.taps} task{k.taps !== 1 ? "s" : ""} this week</div>
              </div>
              {k.member.streak > 0 && (
                <div style={{ fontSize: 11, color: C.accent, fontWeight: 600, padding: "3px 8px", borderRadius: 10, background: `${C.accent}12` }}>🔥 {k.member.streak}</div>
              )}
            </div>
          ))
        )}
      </>)}

      {/* 6. Personal Bests */}
      {currentMember && insightCard(<>
        {cardHeader("🎉", showFamily ? "Family Records" : "Personal Bests", C.accent)}
        {!filteredAnalytics ? loadingSkeleton : personalBests ? (
          <div>
            {personalBests.isNewRecord && (
              <div style={{ background: `${C.accent}12`, borderRadius: 12, padding: "10px 14px", marginBottom: 10, border: `1px solid ${C.accent}30` }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.accent }}>🎊 New record this week!</div>
                <div style={{ fontSize: 12, color: C.slateLight, marginTop: 2 }}>{personalBests.thisWeekCount} habits completed</div>
              </div>
            )}
            {!personalBests.isNewRecord && personalBests.thisWeekCount > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 13, color: C.slate }}>This week: <span style={{ fontWeight: 700 }}>{personalBests.thisWeekCount} habits</span></div>
                {personalBests.allTimeRecord > personalBests.thisWeekCount && (
                  <div style={{ fontSize: 11, color: C.slateLight }}>All-time best: {personalBests.allTimeRecord} in a week</div>
                )}
              </div>
            )}
            {personalBests.habitStreaks.map((x, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 16 }}>{x.habit.icon}</span>
                <span style={{ fontSize: 12, color: C.slate, flex: 1 }}>{x.habit.name}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: C.accent }}>🔥 {x.streak} day streak</span>
              </div>
            ))}
            {personalBests.thisWeekCount === 0 && personalBests.habitStreaks.length === 0 && (
              <div style={{ fontSize: 13, color: C.slateLight }}>Start completing habits to build your records!</div>
            )}
          </div>
        ) : (
          <div style={{ fontSize: 13, color: C.slateLight }}>Complete habits over multiple weeks to see records.</div>
        )}
      </>)}
    </div>
  );
}

// ─── SETTINGS SCREEN ──────────────────────────────────────────────
function SettingsScreen({ family, onLogout, onRefresh, onManageTiles, onManageHabits, soundEnabled, onToggleSound }) {
  return (
    <div style={{ padding: "0 20px 110px" }}>
      <div style={{ background: C.white, borderRadius: 20, padding: 20, marginBottom: 12, boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.slateLight, letterSpacing: 1, textTransform: "uppercase", marginBottom: 12 }}>Family</div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 44, height: 44, borderRadius: "50%", background: `linear-gradient(135deg, ${C.accent}, ${C.accentLight})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700, color: C.white }}>{family.name[0].toUpperCase()}</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: C.slate }}>{family.name}</div>
            <div style={{ fontSize: 12, color: C.slateLight }}>PIN: {family.pin}</div>
          </div>
        </div>
      </div>

      <div style={{ background: C.white, borderRadius: 20, padding: 20, marginBottom: 12, boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.slateLight, letterSpacing: 1, textTransform: "uppercase", marginBottom: 12 }}>Members</div>
        {family.members.map(m => (
          <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 10, paddingBottom: 10, marginBottom: 10, borderBottom: `1px solid ${C.sandLight}` }}>
            <div style={{ width: 32, height: 32, borderRadius: "50%", background: m.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: C.white }}>{m.avatar}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, color: C.slate, fontWeight: 500 }}>{m.name}</div>
              <div style={{ fontSize: 11, color: C.slateLight }}>{m.isKid ? "Kid" : "Adult"} · {m.points || 0} pts · 🔥 {m.streak || 0}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ background: C.white, borderRadius: 20, padding: 20, marginBottom: 12, boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.slateLight, letterSpacing: 1, textTransform: "uppercase", marginBottom: 14 }}>Preferences</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 500, color: C.slate }}>Sound Effects</div>
            <div style={{ fontSize: 11, color: C.slateLight, marginTop: 2 }}>Play sounds on habit completion</div>
          </div>
          <div onClick={onToggleSound} style={{ width: 46, height: 26, borderRadius: 13, cursor: "pointer", background: soundEnabled ? C.green : C.sandDark, position: "relative", transition: "background 0.2s ease", flexShrink: 0 }}>
            <div style={{ width: 22, height: 22, borderRadius: "50%", background: C.white, position: "absolute", top: 2, left: soundEnabled ? 22 : 2, transition: "left 0.2s ease", boxShadow: "0 1px 4px rgba(0,0,0,0.2)" }} />
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
        <button onClick={onManageTiles} style={{ flex: 1, padding: "14px", borderRadius: 16, border: `1.5px solid ${C.accent}30`, background: `${C.accent}10`, color: C.accent, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>
          🏷️ Manage Tiles
        </button>
        <button onClick={async () => { await onRefresh(); }} style={{ flex: 1, padding: "14px", borderRadius: 16, border: `1.5px solid ${C.green}30`, background: `${C.green}10`, color: C.green, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>
          🔄 Refresh Data
        </button>
      </div>
      <button onClick={onManageHabits} style={{ width: "100%", padding: "14px", borderRadius: 16, border: `1.5px solid ${C.slateLight}30`, background: `${C.slateLight}10`, color: C.slateLight, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", marginBottom: 12 }}>
        ✏️ Manage Habits
      </button>

      {/* Admin: Reset all points */}
      <div style={{ marginBottom: 12, padding: "20px", background: `${C.error}08`, borderRadius: 16, border: `1px solid ${C.error}30` }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.slate, marginBottom: 6 }}>⚠️ Admin Actions</div>
        <div style={{ fontSize: 11, color: C.slateLight, marginBottom: 12 }}>These actions affect all family members and cannot be undone.</div>
        <button
          onClick={async () => {
            if (!window.confirm("Reset all points and streaks to zero?\n\nThis will:\n- Set everyone's points to 0\n- Set all streaks to 0\n- Cannot be undone\n\nAre you sure?")) return;
            try {
              await supabase.from("members").update({ points: 0, streak: 0 }).eq('family_id', family.id);
              await supabase.from("habits").update({ streak: 0 }).eq('family_id', family.id);
              await onRefresh();
              alert("✅ All points and streaks have been reset to zero.");
            } catch (err) {
              console.error("Reset failed:", err);
              alert("❌ Reset failed. Check console for details.");
            }
          }}
          style={{ width: "100%", padding: "12px 16px", background: C.error, border: "none", borderRadius: 12, color: C.white, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}
        >
          🔄 Reset All Points &amp; Streaks
        </button>
      </div>

      <button onClick={() => {
        if (window.confirm(`Sign out of ${family.name}? You'll need your PIN to log back in.`)) {
          onLogout();
        }
      }} style={{ width: "100%", padding: "14px", borderRadius: 16, border: `1.5px solid ${C.error}30`, background: `${C.error}10`, color: C.error, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>
        Sign Out of {family.name}
      </button>
    </div>
  );
}

// ─── ROOT ─────────────────────────────────────────────────────────
export default function RitualApp() {
  const [family, setFamily] = useState(null);
  const [habits, setHabits] = useState([]);
  const [todayCompletions, setTodayCompletions] = useState([]);
  const [weekCompletions, setWeekCompletions] = useState([]);
  const [currentMember, setCurrentMember] = useState(null);
  const [tab, setTab] = useState("today");
  const [flashData, setFlashData] = useState(null);
  const [whoDidThis, setWhoDidThis] = useState(null);
  const [mounted, setMounted] = useState(false);
  const tileHandled = useRef(null);
  const [unassignedTileUID, setUnassignedTileUID] = useState(null);
  const currentMemberRef = useRef(currentMember);
  useEffect(() => { currentMemberRef.current = currentMember; }, [currentMember]);
  const [addInitialView, setAddInitialView] = useState("menu");
  const [soundEnabled, setSoundEnabled] = useState(() => localStorage.getItem("ritual_soundEnabled") !== "false");
  const [lastFetchDate, setLastFetchDate] = useState(() => todayKey());
  const [analyticsData, setAnalyticsData] = useState(null);
  const analyticsLastFetched = useRef(null);

  const todayIndex = getTodayIndex();

  // ─── habitsWithTaps: merge habits + today's completions ──────────
  const habitsWithTaps = useMemo(() => {
    return habits.map(h => {
      const completionsForHabit = todayCompletions.filter(c => c.habitId === h.id);
      const totalTaps = completionsForHabit.reduce((sum, c) => sum + c.taps, 0);
      const topCompletion = [...completionsForHabit].sort((a, b) => b.taps - a.taps)[0];
      return {
        ...h,
        taps: totalTaps,
        completedById: topCompletion?.memberId || null,
        completedBy: topCompletion ? family?.members?.find(m => m.id === topCompletion.memberId)?.name : null,
      };
    });
  }, [habits, todayCompletions, family?.members]);

  // ─── myHabitsWithTaps: habits visible to current member, per-member taps ────
  const myHabitsWithTaps = useMemo(() => {
    if (!currentMember) return habitsWithTaps;
    const today = new Date().getDay();
    const todayConverted = (today + 6) % 7; // 0=Mon … 6=Sun
    return habits
      .filter(h => {
        if (h.assignedMemberIds && h.assignedMemberIds.length > 0 && !h.assignedMemberIds.includes(currentMember.id)) return false;
        if (h.daysActive && h.daysActive.length > 0 && !h.daysActive.includes(todayConverted)) return false;
        return true;
      })
      .map(h => {
        const myCompletions = todayCompletions.filter(c => c.habitId === h.id && c.memberId === currentMember.id);
        const myTaps = myCompletions.reduce((sum, c) => sum + c.taps, 0);
        const topCompletion = [...myCompletions].sort((a, b) => b.taps - a.taps)[0];
        return {
          ...h,
          taps: myTaps,
          completedById: topCompletion?.memberId || null,
          completedBy: topCompletion ? family?.members?.find(m => m.id === topCompletion.memberId)?.name : null,
        };
      });
  }, [habits, todayCompletions, currentMember, family?.members, habitsWithTaps]);

  // ─── weekData: compute from completions ─────────────────────────
  const weekData = useMemo(() => {
    if (habits.length === 0) return [null, null, null, null, null, null, null];
    const weekDates = getWeekDates();
    const result = Array(7).fill(null);
    // Today
    const todayDone = habitsWithTaps.filter(h => (h.taps || 0) >= (h.target || 1)).length;
    result[todayIndex] = Math.round((todayDone / habits.length) * 100);
    // Past days
    for (let i = 0; i < todayIndex; i++) {
      const dateStr = weekDates[i];
      const dayCompletions = weekCompletions.filter(c => c.date === dateStr);
      const completedIds = new Set(dayCompletions.filter(c => c.taps > 0).map(c => c.habitId));
      result[i] = Math.round((completedIds.size / habits.length) * 100);
    }
    return result;
  }, [habitsWithTaps, habits, weekCompletions, todayIndex]);

  // ─── Daily reset detection ───────────────────────────────────────
  const checkDateBoundary = useCallback(() => {
    const today = todayKey();
    if (lastFetchDate && lastFetchDate !== today) {
      setLastFetchDate(today);
      setAnalyticsData(null); // invalidate analytics cache on new day
      if (supabase && family) {
        Promise.all([
          fetchTodayCompletions(family.id),
          fetchWeekCompletions(family.id),
        ]).then(([td, wd]) => {
          setTodayCompletions(td);
          setWeekCompletions(wd);
        });
      }
    }
  }, [lastFetchDate, family]);

  useEffect(() => {
    const handler = () => { if (document.visibilityState === 'visible') checkDateBoundary(); };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [checkDateBoundary]);

  // ─── Insights lazy-load ──────────────────────────────────────────
  useEffect(() => {
    if (tab !== 'insights' || !family) return;
    const now = Date.now();
    if (analyticsData && analyticsLastFetched.current && now - analyticsLastFetched.current < 5 * 60 * 1000) return;
    fetchAnalyticsData(family.id).then(data => {
      setAnalyticsData(data);
      analyticsLastFetched.current = Date.now();
    });
  }, [tab, family]); // intentionally excludes analyticsData/analyticsLastFetched (refs/stable)

  // ─── Load family data after login ───────────────────────────────
  const loadDataForFamily = async (familyData) => {
    setFamily(familyData);
    setHabits(familyData.habits || []);
    const savedMemberId = localStorage.getItem("ritual_currentMemberId");
    const savedMember = familyData.members?.find(m => m.id === savedMemberId);
    setCurrentMember(savedMember || familyData.members?.[0] || null);
    if (supabase) {
      const [todayData, weekData] = await Promise.all([
        fetchTodayCompletions(familyData.id),
        fetchWeekCompletions(familyData.id),
      ]);
      setTodayCompletions(todayData);
      setWeekCompletions(weekData);
    }
  };

  // ─── Auto-login on mount ─────────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      try {
        const savedPin = localStorage.getItem("ritual_savedPin");
        if (savedPin && supabase) {
          const familyData = await fetchFamilyData(savedPin);
          if (familyData) { await loadDataForFamily(familyData); return; }
          console.warn("⚠️ Saved PIN invalid, clearing");
          localStorage.removeItem("ritual_savedPin");
        }
      } catch (e) {
        console.error("❌ Auto-login error:", e);
      } finally {
        setMounted(true);
      }
    };
    init();
  }, []);

  // ─── Save currentMember to localStorage ─────────────────────────
  useEffect(() => {
    if (currentMember?.id) localStorage.setItem("ritual_currentMemberId", currentMember.id);
  }, [currentMember]);

  // ─── Handlers ───────────────────────────────────────────────────
  const handleLogin = async (familyData) => {
    await loadDataForFamily(familyData);
  };

  const handleLogout = () => {
    setFamily(null); setHabits([]); setTodayCompletions([]); setWeekCompletions([]);
    setCurrentMember(null); setFlashData(null); setWhoDidThis(null);
    localStorage.removeItem("ritual_savedPin"); localStorage.removeItem("ritual_currentMemberId");
  };

  const handleComplete = async (habitId, member, fromDigital) => {
    checkDateBoundary(); // detect midnight crossing before recording
    const habit = habitsWithTaps.find(h => h.id === habitId);
    if (!habit) return;
    // Show "Who did this?" for kids habits OR shared habits when no member specified
    if ((habit.isKid || habit.isShared) && !member) { setWhoDidThis(habit); return; }
    const resolvedMember = member || currentMember;
    const today = todayKey();
    const currentTaps = habit.taps || 0;
    const newTaps = currentTaps + 1;

    // Optimistic update first (instant UI feedback)
    setTodayCompletions(prev => {
      const existing = prev.find(c => c.habitId === habitId && c.memberId === resolvedMember?.id);
      if (existing) return prev.map(c => c.habitId === habitId && c.memberId === resolvedMember?.id ? { ...c, taps: c.taps + 1 } : c);
      return [...prev, { id: `opt_${Date.now()}`, habitId, memberId: resolvedMember?.id, familyId: family.id, date: today, taps: 1 }];
    });
    if (resolvedMember) {
      setFamily(f => ({ ...f, members: f.members.map(m => m.id === resolvedMember.id ? { ...m, points: (m.points || 0) + 10 } : m) }));
    }
    setWhoDidThis(null);
    setFlashData({ habit: { ...habit, taps: newTaps }, member: resolvedMember });

    // Await Supabase sync (ensures multi-device consistency)
    if (supabase && resolvedMember) {
      const { error } = await supabase.from("completions").upsert(
        { habit_id: habitId, member_id: resolvedMember.id, family_id: family.id, date: today, taps: newTaps },
        { onConflict: "habit_id,member_id,date" }
      );
      if (error) console.error("❌ Completion sync failed:", error);

      // Shared/household habit: sync same tap count to all other assigned members
      if (habit.completionType === 'shared' && habit.assignedMemberIds && habit.assignedMemberIds.length > 0) {
        const otherMembers = habit.assignedMemberIds.filter(id => id !== resolvedMember.id);
        if (otherMembers.length > 0) {
          const sharedCompletions = otherMembers.map(memberId => ({
            habit_id: habitId, member_id: memberId, family_id: family.id, date: today, taps: newTaps,
          }));
          await supabase.from("completions").upsert(sharedCompletions, { onConflict: 'habit_id,member_id,date' });
          // Also update local state so switching members shows correct progress
          setTodayCompletions(prev => {
            let updated = [...prev];
            otherMembers.forEach(memberId => {
              const idx = updated.findIndex(c => c.habitId === habitId && c.memberId === memberId);
              if (idx >= 0) { updated[idx] = { ...updated[idx], taps: newTaps }; }
              else { updated.push({ id: `opt_shared_${Date.now()}_${memberId}`, habitId, memberId, familyId: family.id, date: today, taps: newTaps }); }
            });
            return updated;
          });
        }
      }

      // Read fresh points from DB before writing to avoid stale-overwrite race condition
      const { data: freshMember } = await supabase.from("members").select("points").eq("id", resolvedMember.id).single();
      const freshPoints = freshMember?.points ?? (resolvedMember.points || 0);
      const { error: pe } = await supabase.from("members").update({ points: freshPoints + 10 }).eq("id", resolvedMember.id);
      if (pe) console.error("❌ Points sync failed:", pe);

      // ── Streak logic: only on first tap of this habit today ──────
      if (currentTaps === 0) {
        const { data: yComp } = await supabase.from("completions").select("id").eq("habit_id", habitId).eq("date", getYesterdayKey()).maybeSingle();
        const newHabitStreak = yComp ? (habit.streak || 0) + 1 : 1;
        await supabase.from("habits").update({ streak: newHabitStreak }).eq("id", habitId);
        setHabits(prev => prev.map(h => h.id === habitId ? { ...h, streak: newHabitStreak } : h));

        // Member streak: only on their first completion of any habit today
        const memberTodayCount = todayCompletions.filter(c => c.memberId === resolvedMember.id).length;
        if (memberTodayCount <= 1) {
          const { data: mYest } = await supabase.from("completions").select("id").eq("member_id", resolvedMember.id).eq("date", getYesterdayKey()).limit(1).maybeSingle();
          const newMemberStreak = mYest ? (resolvedMember.streak || 0) + 1 : 1;
          await supabase.from("members").update({ streak: newMemberStreak }).eq("id", resolvedMember.id);
          setFamily(f => ({ ...f, members: f.members.map(m => m.id === resolvedMember.id ? { ...m, streak: newMemberStreak } : m) }));
        }
      }
    }
  };

  const handleUndo = async (habitId) => {
    const habit = habitsWithTaps.find(h => h.id === habitId);
    if (!habit) return;
    const completedById = habit.completedById;
    const memberToDeduct = completedById ? family?.members?.find(m => m.id === completedById) : currentMember;
    const newTaps = Math.max((habit.taps || 0) - 1, 0);

    setTodayCompletions(prev => prev.map(c =>
      c.habitId === habitId && c.memberId === completedById ? { ...c, taps: Math.max(c.taps - 1, 0) } : c
    ));
    if (memberToDeduct) {
      setFamily(f => ({ ...f, members: f.members.map(m => m.id === memberToDeduct.id ? { ...m, points: Math.max((m.points || 0) - 10, 0) } : m) }));
    }

    const undoMemberId = completedById || memberToDeduct?.id;
    if (supabase && undoMemberId) {
      const { error } = await supabase.from("completions").upsert(
        { habit_id: habitId, member_id: undoMemberId, family_id: family.id, date: todayKey(), taps: newTaps },
        { onConflict: "habit_id,member_id,date" }
      );
      if (error) console.error("❌ Undo sync failed:", error);
      if (memberToDeduct) {
        // Read fresh points to avoid stale-overwrite race condition
        const { data: freshMember } = await supabase.from("members").select("points").eq("id", memberToDeduct.id).single();
        const freshPoints = freshMember?.points ?? (memberToDeduct.points || 0);
        const { error: pe } = await supabase.from("members").update({ points: Math.max(freshPoints - 10, 0) }).eq("id", memberToDeduct.id);
        if (pe) console.error("❌ Points undo failed:", pe);
      }
    }
  };

  const handleAddHabit = async (h) => {
    const tempId = `temp_${Date.now()}`;
    const tempHabit = {
      id: tempId, familyId: family?.id, name: h.name, icon: h.icon,
      category: h.category, categoryId: h.categoryId, color: h.color,
      location: h.location, target: h.target || 1, streak: 0,
      isKid: h.isKid || false, isCustom: h.isCustom || false, tileUid: null,
      isShared: h.isShared ?? true,
      assignedMemberIds: h.assignedMemberIds || null,
      daysActive: h.daysActive || null,
      completionType: h.completionType || 'individual',
    };
    setHabits(prev => [...prev, tempHabit]);
    setTab("today");
    if (supabase && family) {
      const { data, error } = await supabase.from("habits").insert({
        family_id: family.id, name: h.name, icon: h.icon,
        category: h.category, category_id: h.categoryId, color: h.color,
        location: h.location || null, target: h.target || 1, streak: 0,
        is_kid: h.isKid || false, is_custom: h.isCustom || false, is_shared: h.isShared ?? true,
        assigned_member_ids: h.assignedMemberIds || null,
        days_active: h.daysActive || null,
        completion_type: h.completionType || 'individual',
      }).select().single();
      if (data) {
        setHabits(prev => prev.map(x => x.id === tempId ? normalizeHabit(data) : x));
      } else {
        console.error("❌ Add habit failed:", error);
        setHabits(prev => prev.filter(x => x.id !== tempId));
      }
    }
  };

  const handleAssignTile = async (tileUID, habitId) => {
    if (!supabase) return;
    // Clear tile from any other habit that currently has it
    await supabase.from("habits").update({ tile_uid: null }).eq("tile_uid", tileUID).neq("id", habitId);
    // Assign to new habit
    const { error } = await supabase.from("habits").update({ tile_uid: tileUID }).eq("id", habitId);
    if (error) { console.error("❌ Assign tile failed:", error); return; }
    setHabits(prev => prev.map(h => {
      if (h.tileUid === tileUID && h.id !== habitId) return { ...h, tileUid: null };
      if (h.id === habitId) return { ...h, tileUid: tileUID };
      return h;
    }));
  };

  const handleEditHabit = async (habitId, updates) => {
    setHabits(prev => prev.map(h => h.id === habitId ? { ...h, ...updates } : h));
    if (supabase) {
      const dbUpdates = {
        name: updates.name, location: updates.location || null,
        target: updates.target, is_shared: updates.isShared,
      };
      if ('assignedMemberIds' in updates) dbUpdates.assigned_member_ids = updates.assignedMemberIds || null;
      if ('daysActive' in updates) dbUpdates.days_active = updates.daysActive || null;
      if ('completionType' in updates) dbUpdates.completion_type = updates.completionType || 'individual';
      await supabase.from("habits").update(dbUpdates).eq("id", habitId);

      // Shared completion backfill: if switching to 'shared', sync today's max taps to all assigned members
      if (updates.completionType === 'shared' && updates.assignedMemberIds?.length > 0) {
        const today = todayKey();
        const { data: existing } = await supabase
          .from('completions').select('member_id, taps')
          .eq('habit_id', habitId).eq('date', today);
        if (existing && existing.length > 0) {
          const maxTaps = Math.max(...existing.map(c => c.taps));
          const upserts = updates.assignedMemberIds.map(memberId => ({
            habit_id: habitId, member_id: memberId,
            family_id: family.id, date: today, taps: maxTaps,
          }));
          await supabase.from('completions').upsert(upserts, { onConflict: 'habit_id,member_id,date' });
          setTodayCompletions(prev => {
            let updated = [...prev];
            updates.assignedMemberIds.forEach(memberId => {
              const idx = updated.findIndex(c => c.habitId === habitId && c.memberId === memberId);
              if (idx >= 0) updated[idx] = { ...updated[idx], taps: maxTaps };
              else updated.push({ id: `backfill_${memberId}_${Date.now()}`, habitId, memberId, familyId: family.id, date: today, taps: maxTaps });
            });
            return updated;
          });
        }
      }
    }
  };

  const handleDeleteHabit = async (habitId) => {
    setHabits(prev => prev.filter(h => h.id !== habitId));
    setTodayCompletions(prev => prev.filter(c => c.habitId !== habitId));
    if (supabase) await supabase.from("habits").delete().eq("id", habitId);
  };

  const handleRemoveTile = async (habitId) => {
    if (!supabase) return;
    const { error } = await supabase.from("habits").update({ tile_uid: null }).eq("id", habitId);
    if (error) { console.error("❌ Remove tile failed:", error); return; }
    setHabits(prev => prev.map(h => h.id === habitId ? { ...h, tileUid: null } : h));
  };

  const handleRefreshData = async () => {
    if (!supabase || !family) return;
    const [freshFamily, todayData, weekData] = await Promise.all([
      fetchFamilyData(family.pin),
      fetchTodayCompletions(family.id),
      fetchWeekCompletions(family.id),
    ]);
    if (freshFamily) {
      setHabits(freshFamily.habits || []);
      setFamily(prev => ({ ...prev, members: freshFamily.members, rewards: freshFamily.rewards }));
    }
    setTodayCompletions(todayData);
    setWeekCompletions(weekData);
  };

  const handleAddMember = async (memberData) => {
    const tempId = `temp_${Date.now()}`;
    setFamily(f => ({ ...f, members: [...f.members, { ...memberData, id: tempId, familyId: f.id }] }));
    if (supabase && family) {
      const { data } = await supabase.from("members").insert({ family_id: family.id, name: memberData.name, avatar: memberData.avatar, color: memberData.color, is_kid: memberData.isKid, points: 0, streak: 0 }).select().single();
      if (data) setFamily(f => ({ ...f, members: f.members.map(m => m.id === tempId ? normalizeMember(data) : m) }));
    }
  };

  const handleEditMember = async (memberId, updates) => {
    setFamily(f => ({ ...f, members: f.members.map(m => m.id === memberId ? { ...m, ...updates } : m) }));
    if (supabase) {
      const dbUp = {};
      if (updates.name !== undefined) { dbUp.name = updates.name; dbUp.avatar = updates.avatar; }
      if (updates.isKid !== undefined) dbUp.is_kid = updates.isKid;
      if (updates.color !== undefined) dbUp.color = updates.color;
      await supabase.from("members").update(dbUp).eq("id", memberId);
    }
    if (currentMember?.id === memberId) setCurrentMember(m => ({ ...m, ...updates }));
  };

  const handleRemoveMember = async (memberId) => {
    setFamily(f => ({ ...f, members: f.members.filter(m => m.id !== memberId) }));
    if (currentMember?.id === memberId) setCurrentMember(family?.members?.find(m => m.id !== memberId) || null);
    if (supabase) await supabase.from("members").delete().eq("id", memberId);
  };

  // ─── Tile URL trigger ────────────────────────────────────────────
  useEffect(() => {
    if (!family || !mounted) return;
    // Support both URL formats:
    //   Path-based (production): /t/04:96:9E:5A:C2:2A:81  → ritual.app/t/{TAG-ID}
    //   Query param (legacy):    ?tile=04:96:9E:5A:C2:2A:81
    let raw = null;
    const pathMatch = window.location.pathname.match(/^\/t\/(.+)$/);
    if (pathMatch) {
      raw = decodeURIComponent(pathMatch[1]);
    } else {
      raw = new URLSearchParams(window.location.search).get("tile");
    }
    if (!raw) return;
    // Normalize UID: strip colons, uppercase — handles both "04:96:9E:5A" and "04969E5A" formats
    const tileUID = raw.replace(/:/g, "").toUpperCase();
    // Prevent handling the same tile URL twice within this page load
    if (tileHandled.current === tileUID) return;
    tileHandled.current = tileUID;
    window.history.replaceState({}, "", "/");
    const assignedHabit = habitsWithTaps.find(h => h.tileUid === tileUID);
    if (assignedHabit) {
      const ids = assignedHabit.assignedMemberIds;
      // Multi-person habits ALWAYS ask "Who did this?"
      const shouldAskWho =
        assignedHabit.isKid ||    // Kids habits always ask
        !ids ||                    // Everyone habits ask
        ids.length === 0 ||        // Everyone habits ask
        ids.length > 1;            // Multi-person habits ALWAYS ask
      if (shouldAskWho) {
        setWhoDidThis(assignedHabit);
      } else {
        // Single-person habit — check if the right person is tapping
        const assignedMember = family?.members?.find(m => m.id === ids[0]);
        if (!assignedMember) {
          console.error("Assigned member not found");
          return;
        }
        if (currentMemberRef.current?.id === assignedMember.id) {
          handleComplete(assignedHabit.id, assignedMember, false);
        } else {
          alert(`This is ${assignedMember.name}'s personal habit.`);
        }
      }
    } else {
      setUnassignedTileUID(tileUID);
    }
  }, [family, mounted, habitsWithTaps]);

  if (!mounted) return (
    <div style={{ minHeight: "100vh", background: C.sandLight, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ fontSize: 40, color: C.sandDark, opacity: 0.5 }}>◈</div>
    </div>
  );
  if (!family) return <LoginScreen onLogin={handleLogin} />;

  const TABS = [
    { id: "today", icon: "◈", label: "Today" },
    { id: "family", icon: "◉", label: "Family" },
    { id: "add", icon: "⊕", label: "Add" },
    { id: "insights", icon: "◎", label: "Insights" },
    { id: "settings", icon: "⚙", label: "Settings" },
  ];

  const headings = {
    today: `${getGreeting()}, ${currentMember?.name || family.name}`,
    family: `The ${family.name}s`,
    add: "Set Up",
    insights: "Insights",
    settings: "Settings",
  };

  const doneTodayCount = myHabitsWithTaps.filter(h => (h.taps || 0) >= (h.target || 1)).length;

  return (
    <>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0;}
        body{background:${C.sandLight};font-family:'DM Sans',sans-serif;}
        @keyframes ripple{0%{transform:scale(0.8);opacity:1;}100%{transform:scale(2.2);opacity:0;}}
        @keyframes pulse{0%,100%{opacity:1;}50%{opacity:0.25;}}
        @keyframes flashIn{from{opacity:0;}to{opacity:1;}}
        @keyframes popIn{from{transform:scale(0.5);opacity:0;}to{transform:scale(1);opacity:1;}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(12px);}to{opacity:1;transform:translateY(0);}}
        @keyframes slideUp{from{opacity:0;transform:translateY(14px);}to{opacity:1;transform:translateY(0);}}
        ::-webkit-scrollbar{display:none;}
        input:focus{border-color:${C.accent} !important;outline:none;}
        input::placeholder{color:${C.sandDark};}
        /* FIX 1: Responsive layout */
        .ritual-root{max-width:390px;margin:0 auto;background:${C.sandLight};position:relative;}
        .habit-grid{display:flex;flex-direction:column;gap:10px;}
        .tab-bar{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:390px;background:rgba(250,248,245,0.96);backdrop-filter:blur(24px);border-top:1px solid ${C.sandDark}50;padding:10px 0 26px;display:flex;justify-content:space-around;}
        @media(min-width:768px){
          .ritual-root{max-width:900px;}
          .habit-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:16px;}
          .tab-bar{width:900px;}
        }
        @supports(padding-bottom:env(safe-area-inset-bottom)){
          .tab-bar{padding-bottom:calc(26px + env(safe-area-inset-bottom));}
        }
      `}</style>

      <div className="ritual-root">
        {/* Header */}
        <div style={{ padding: "20px 24px 12px", paddingTop: "max(20px, env(safe-area-inset-top))" }}>
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: C.slate, fontFamily: "'Cormorant Garamond', serif", letterSpacing: -0.3, lineHeight: 1.1 }}>{headings[tab]}</div>
            <div style={{ fontSize: 12, color: C.slateLight, marginTop: 3 }}>
              {tab === "today" && `${new Date().toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" })} · ${doneTodayCount} of ${myHabitsWithTaps.length} complete`}
              {tab === "family" && `${family.members?.length || 0} members`}
              {tab === "add" && "Habits, tiles & rewards"}
              {tab === "insights" && "Your habit data"}
              {tab === "settings" && family.name}
            </div>
          </div>
          {family.members?.length > 0 && (
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              {family.members.map(m => {
                const isActive = currentMember?.id === m.id;
                return (
                  <div key={m.id} onClick={() => setCurrentMember(m)} style={{
                    width: 34, height: 34, borderRadius: "50%",
                    background: `linear-gradient(135deg, ${m.color}, ${m.color}CC)`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 12, fontWeight: 700, color: C.white, cursor: "pointer",
                    flexShrink: 0, transition: "all 0.2s ease",
                    transform: isActive ? "scale(1.25)" : "scale(1)",
                    opacity: isActive ? 1 : 0.4,
                    boxShadow: isActive ? `0 0 0 2px ${C.white}, 0 0 16px ${m.color}, 0 4px 20px ${m.color}60` : "none",
                    border: isActive ? `2px solid ${m.color}` : "2px solid transparent",
                    zIndex: isActive ? 10 : 1,
                    filter: isActive ? "none" : "grayscale(30%)",
                  }}>{m.avatar}</div>
                );
              })}
            </div>
          )}
        </div>

        {/* Screen */}
        <div key={tab} style={{ animation: "slideUp 0.3s ease" }}>
          {tab === "today" && (
            <TodayScreen
              habits={myHabitsWithTaps} weekData={weekData}
              currentMember={currentMember} allMembers={family.members || []}
              onComplete={handleComplete} onUndo={handleUndo}
              flashData={flashData} onFlashDone={() => setFlashData(null)}
              onFlashUndo={() => { if (flashData) handleUndo(flashData.habit.id); }}
              whoDidThis={whoDidThis} onWhoCancel={() => setWhoDidThis(null)}
              soundEnabled={soundEnabled}
            />
          )}
          {tab === "family" && <FamilyScreen family={family} onAddMember={handleAddMember} onEditMember={handleEditMember} onRemoveMember={handleRemoveMember} />}
          {tab === "add" && <AddScreen family={family} currentMember={currentMember} onAddHabit={handleAddHabit} habits={habits} onAssignTile={handleAssignTile} onRemoveTile={handleRemoveTile} onEditHabit={handleEditHabit} onDeleteHabit={handleDeleteHabit} initialView={addInitialView} onMounted={() => setAddInitialView("menu")} />}
          {tab === "insights" && <InsightsScreen habits={habitsWithTaps} family={family} weekCompletions={weekCompletions} currentMember={currentMember} analyticsData={analyticsData} />}
          {tab === "settings" && <SettingsScreen family={family} onLogout={handleLogout} onRefresh={handleRefreshData} onManageTiles={() => { setAddInitialView("tile"); setTab("add"); }} onManageHabits={() => { setAddInitialView("habitsManage"); setTab("add"); }} soundEnabled={soundEnabled} onToggleSound={() => { const next = !soundEnabled; setSoundEnabled(next); localStorage.setItem("ritual_soundEnabled", String(next)); }} />}
        </div>

        {/* Branding footer */}
        <div style={{ position: "fixed", bottom: 8, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 390, textAlign: "center", fontSize: 10, color: `${C.slateLight}55`, letterSpacing: 0.5, zIndex: 49, pointerEvents: "none", fontFamily: "'DM Sans', sans-serif" }}>
          Ritual · Build better habits
        </div>

        {/* Tab bar */}
        <div className="tab-bar">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "4px 12px" }}>
              <div style={{ fontSize: 20, color: tab === t.id ? C.accent : C.sandDark, transition: "all 0.2s ease", transform: tab === t.id ? "scale(1.2)" : "scale(1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {t.id === "settings" ? <GearIcon color={tab === t.id ? C.accent : C.sandDark} size={20} /> : t.icon}
              </div>
              <div style={{ fontSize: 9, letterSpacing: 1.2, color: tab === t.id ? C.accent : C.sandDark, fontWeight: tab === t.id ? 700 : 400, textTransform: "uppercase" }}>{t.label}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Assign Tile Modal — shown whenever an unassigned tile is tapped */}
      {unassignedTileUID && (
        <AssignTileModal
          tileUID={unassignedTileUID}
          habits={habits}
          onAssign={async (uid, habitId) => {
            await handleAssignTile(uid, habitId);
            setUnassignedTileUID(null);
          }}
          onClose={() => setUnassignedTileUID(null)}
          onCreateHabit={() => {
            setUnassignedTileUID(null);
            setAddInitialView("custom");
            setTab("add");
          }}
        />
      )}
    </>
  );
}
