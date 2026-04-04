import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { supabase } from "./supabase";
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { PushNotifications } from '@capacitor/push-notifications';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Browser } from '@capacitor/browser';

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

// ─── SETUP / ONBOARDING DESIGN TOKENS ────────────────────────────
const SETUP_MEMBER_COLORS = ['#C47B4A', '#D4956A', '#7A9E87', '#8B9EC4', '#B07DB8', '#C4AA70'];
const D = {
  bgCream: "#F0EDE6", bgWhite: "#FFFFFF", bgInput: "#F7F4EF",
  border: "#E5DED4", borderDashed: "#D5CECC",
  terracotta: "#C47B4A", terracottaLt: "#D4956A",
  textDark: "#1E1C18", textMid: "#7A7060", textMuted: "#9A8E80", textFaint: "#B0A498",
  fontHeading: "'DM Serif Display', serif", fontBody: "'DM Sans', sans-serif",
};

// ─── NAMED CONSTANTS ──────────────────────────────────────────────
const ANALYTICS_WINDOW_DAYS = 30;      // days of history for analytics tab
const FLASH_COUNTDOWN_SECONDS = 5;     // seconds before completion flash auto-dismisses
const REDEMPTION_CACHE_MS = 60_000;    // 1 min: how long redemptions are cached before re-fetch
const ANALYTICS_CACHE_MS = 5 * 60_000; // 5 min: how long analytics are cached before re-fetch

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

const MELB_TZ = 'Australia/Melbourne';

function todayKey() {
  return new Date().toLocaleDateString('en-CA', { timeZone: MELB_TZ });
}

function getYesterdayKey() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString('en-CA', { timeZone: MELB_TZ });
}

function getTodayIndex() {
  const todayStr = todayKey();
  const [y, m, d] = todayStr.split('-').map(Number);
  return (new Date(y, m - 1, d).getDay() + 6) % 7;
}

function getWeekDates() {
  const todayStr = todayKey();
  const [y, m, d] = todayStr.split('-').map(Number);
  const today = new Date(y, m - 1, d);
  const day = today.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(y, m - 1, d + mondayOffset + i);
    return date.toLocaleDateString('en-CA');
  });
}

// Safe date arithmetic on YYYY-MM-DD strings — avoids UTC parsing issues (#11)
function isoAddDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return [dt.getFullYear(), String(dt.getMonth() + 1).padStart(2, '0'), String(dt.getDate()).padStart(2, '0')].join('-');
}

// Compute current consecutive-day streak from an array of completion date strings.
// Today is treated as "in progress" — not completing today does NOT break the streak.
// Streak breaks only if yesterday AND today are both absent.
function calcStreakFromDates(dates) {
  const today = todayKey();
  const yesterday = isoAddDays(today, -1);
  const unique = [...new Set(dates)].sort().reverse(); // newest first
  if (unique.length === 0) return 0;
  const most = unique[0];
  // Most recent completion is 2+ days ago — streak is definitively broken
  if (most < yesterday) return 0;
  // Count consecutive days backward from the most recent completion date
  let streak = 1;
  for (let i = 1; i < unique.length; i++) {
    if (unique[i] === isoAddDays(unique[i - 1], -1)) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

// ─── SUPABASE NORMALISERS ─────────────────────────────────────────
function normalizeMember(m) {
  const name = m.name || '';
  return {
    id: m.id, familyId: m.family_id,
    name,
    // If avatar was never saved to DB (legacy rows), derive it from the first letter of the name
    avatar: m.avatar || name[0]?.toUpperCase() || '?',
    color: m.color,
    isKid: m.is_kid || false, points: m.points || 0, streak: m.streak || 0,
    onboardingComplete: m.onboarding_complete || false,
    createdAt: m.created_at || null,
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
    points: h.points || 10,
    reminderTime: h.reminder_time || null,
  };
}

function normalizeReward(r) {
  return {
    id: r.id, familyId: r.family_id,
    name: r.name, points: r.points,
    icon: r.icon, who: r.who || 'Everyone',
    color: r.color || C.accent,
    assignedTo: r.assigned_to || null,
    status: r.status || 'active',
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
async function fetchFamilyData(pin, familyName) {
  if (!supabase) return null;
  const { data: famRows, error: famErr } = await supabase.rpc('login_family', { family_name: familyName, family_pin: pin });
  if (famErr || !famRows?.[0]) { console.error("❌ fetchFamilyData error:", famErr); return null; }
  const fam = famRows[0];
  const [{ data: members }, { data: habits }, { data: rewards }] = await Promise.all([
    supabase.from("members").select("*").eq("family_id", fam.id),
    supabase.from("habits").select("*").eq("family_id", fam.id),
    supabase.from("rewards").select("*").eq("family_id", fam.id),
  ]);
  return {
    id: fam.id, name: fam.name, pin,
    members: (members || []).map(normalizeMember),
    habits: (habits || []).map(normalizeHabit),
    rewards: (rewards || []).map(normalizeReward),
  };
}

async function fetchTodayCompletions(familyId) {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("completions").select("*")
      .eq("family_id", familyId).eq("date", todayKey());
    if (error) console.error("❌ fetchTodayCompletions error:", error);
    return (data || []).map(normalizeCompletion);
  } catch (e) {
    console.error("❌ fetchTodayCompletions exception:", e);
    return [];
  }
}

async function fetchWeekCompletions(familyId) {
  if (!supabase) return [];
  try {
    const dates = getWeekDates();
    const { data } = await supabase
      .from("completions").select("*")
      .eq("family_id", familyId)
      .gte("date", dates[0]).lte("date", dates[6]);
    return (data || []).map(normalizeCompletion);
  } catch (e) {
    console.error("❌ fetchWeekCompletions exception:", e);
    return [];
  }
}

async function fetchAnalyticsData(familyId) {
  if (!supabase) return [];
  const windowStart = new Date(Date.now() - ANALYTICS_WINDOW_DAYS * 86400000)
    .toLocaleDateString('en-CA', { timeZone: MELB_TZ });
  const { data } = await supabase
    .from("completions").select("*")
    .eq("family_id", familyId)
    .gte("date", windowStart);
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
  if (Capacitor.isNativePlatform()) {
    try {
      if (type === "milestone" || type === "kids") {
        Haptics.notification({ type: NotificationType.Success });
      } else if (type === "undo") {
        Haptics.impact({ style: ImpactStyle.Light });
      } else {
        Haptics.impact({ style: ImpactStyle.Medium });
      }
    } catch (_) {}
    return;
  }
  // Web fallback
  if (!navigator.vibrate) return;
  if (type === "kids") navigator.vibrate([50, 100, 50]);
  else if (type === "milestone") navigator.vibrate([30, 50, 50, 50, 80]);
  else if (type === "undo") navigator.vibrate(30);
  else navigator.vibrate(50);
}

// ─── GEAR ICON ────────────────────────────────────────────────────
function GearIcon({ color, size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
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

// ─── TILE ICON COMPONENT ──────────────────────────────────────────
function TileIcon({ size = "1em", style = {} }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      style={{ display: "inline-block", verticalAlign: "middle", flexShrink: 0, ...style }}
    >
      <defs>
        <radialGradient id="tileGrad" cx="38%" cy="32%" r="70%">
          <stop offset="0%" stopColor="#545454" />
          <stop offset="100%" stopColor="#2A2A2A" />
        </radialGradient>
      </defs>
      <polygon points="12,2 20.66,7 20.66,17 12,22 3.34,17 3.34,7" fill="url(#tileGrad)" />
      <polygon points="12,2 20.66,7 20.66,17 12,22 3.34,17 3.34,7" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="0.5" />
    </svg>
  );
}

// ─── PIN INPUT ────────────────────────────────────────────────────
function PinInput({ value, onChange }) {
  const inputRefs = useRef([]);
  const handleChange = (i, e) => {
    const char = e.target.value.replace(/\D/g, '').slice(-1);
    if (!char) return;
    const newVal = (value.slice(0, i) + char + value.slice(i + 1)).slice(0, 4);
    onChange(newVal);
    if (i < 3) setTimeout(() => inputRefs.current[i + 1]?.focus(), 0);
  };
  const handleKeyDown = (i, e) => {
    if (e.key === 'Backspace') {
      if (value[i]) { onChange(value.slice(0, i) + value.slice(i + 1)); }
      else if (i > 0) { inputRefs.current[i - 1]?.focus(); onChange(value.slice(0, i - 1) + value.slice(i)); }
    }
  };
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {[0, 1, 2, 3].map(i => (
        <input key={i} ref={el => { inputRefs.current[i] = el; }}
          type="tel" inputMode="numeric" maxLength={2}
          value={value[i] || ''} onChange={e => handleChange(i, e)} onKeyDown={e => handleKeyDown(i, e)}
          style={{
            flex: 1, maxWidth: 60, height: 52, borderRadius: 10,
            border: `1.5px solid ${value[i] ? '#C47B4A' : '#E5DED4'}`,
            background: '#F7F4EF', textAlign: 'center',
            fontSize: 20, fontWeight: 500, color: '#1E1C18',
            outline: 'none', fontFamily: "'DM Sans', sans-serif", caretColor: '#C47B4A',
          }}
        />
      ))}
    </div>
  );
}

// ─── LOGIN SCREEN ─────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [view, setView] = useState("welcome");
  const [useMode, setUseMode] = useState("solo"); // "solo" | "family"
  const [joinContext, setJoinContext] = useState("family"); // "solo" | "family" — adjusts join screen copy
  const [familyName, setFamilyName] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [createdFamilyId, setCreatedFamilyId] = useState(null);
  const [members, setMembers] = useState([]);
  const [expandedMemberId, setExpandedMemberId] = useState(null);
  const [addingNew, setAddingNew] = useState(false);
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
      else if (view === "createSolo") handleCreateSolo();
      else if (view === "addMembers") { if (memberName.trim() && addingNew) addMember(); else if (members.length > 0 && !addingNew) finishSetup(); }
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [view, familyName, pin, loading, memberName, members, addingNew]);

  // ── Shared setup styles ────────────────────────────────────────
  const lightInput = {
    width: "100%", padding: "13px 16px", borderRadius: 10,
    border: `1.5px solid ${D.border}`, background: D.bgInput,
    fontSize: 15, color: D.textDark, outline: "none",
    fontFamily: D.fontBody, boxSizing: "border-box",
  };
  const labelStyle = {
    fontSize: 11, fontFamily: D.fontBody, color: D.textMuted,
    letterSpacing: "0.08em", textTransform: "uppercase",
    marginBottom: 6, display: "block",
  };
  const btnSetup = {
    background: D.terracotta, color: "#F5EFE6", border: "none",
    borderRadius: 50, padding: "14px 20px", fontFamily: D.fontBody,
    fontWeight: 500, fontSize: 15, width: "100%",
    display: "flex", alignItems: "center", justifyContent: "space-between",
    cursor: "pointer",
  };
  const btnGhost = {
    background: "transparent", border: "none", color: D.textFaint,
    fontFamily: D.fontBody, fontSize: 13, textAlign: "center",
    width: "100%", padding: "8px 0", cursor: "pointer", display: "block",
  };
  const twoToneOuter = {
    minHeight: "100vh", width: "100%", maxWidth: 390, margin: "0 auto",
    background: D.bgCream, display: "flex", flexDirection: "column",
    boxSizing: "border-box",
    opacity: mounted ? 1 : 0, transition: "opacity 0.5s ease",
  };
  const topSection = { padding: "64px 24px 40px" };
  const bottomCard = {
    background: D.bgWhite, borderRadius: "20px 20px 0 0",
    flex: 1, padding: "28px 24px calc(40px + env(safe-area-inset-bottom))",
    marginTop: -20,
  };

  // ── Handlers ───────────────────────────────────────────────────
  const handleJoin = async () => {
    setError("");
    if (!familyName.trim() || pin.length < 4) { setError(joinContext === "solo" ? "Enter your name and 4-digit PIN" : "Enter your family name and a 4-digit PIN"); return; }
    if (!supabase) { setError("App not configured. Check Supabase credentials."); return; }
    setLoading(true);
    try {
      // Solo accounts are stored as "${name}'s Rituals" — try that variant first
      let familyData = null;
      if (joinContext === "solo") {
        const soloName = `${familyName.trim()}'s Rituals`;
        familyData = await fetchFamilyData(pin, soloName);
      }
      // Fall back to exact name match (works for both family joins and solo users who type the full name)
      if (!familyData) {
        familyData = await fetchFamilyData(pin, familyName.trim());
      }
      if (!familyData) { setError(joinContext === "solo" ? "No account found with that name and PIN." : "No family found with that name and PIN combination."); return; }
      localStorage.setItem("ritual_savedPin", pin);
      localStorage.setItem("ritual_savedFamilyName", familyData.name);
      if (joinContext === "solo") localStorage.setItem("ritual_soloMode", "true");
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
      const { data: existingRows } = await supabase.rpc('login_family', { family_name: familyName.trim(), family_pin: pin });
      if (existingRows?.length > 0) { setError("A family with this name and PIN already exists. Try a different name or PIN."); return; }
      const { data: newRows, error: fe } = await supabase.rpc('create_family', { family_name: familyName.trim(), family_pin: pin });
      if (fe || !newRows?.[0]) { setError("Failed to create family. Try again."); return; }
      setCreatedFamilyId(newRows[0].id);
      setView("addMembers");
      setAddingNew(true);
      setMemberColorIdx(0);
    } catch { setError("Something went wrong. Please try again."); }
    finally { setLoading(false); }
  };

  const handleCreateSolo = async () => {
    setError("");
    const soloName = familyName.trim() || "Me";
    const createdName = `${soloName}'s Rituals`;
    if (pin.length !== 4 || !/^\d+$/.test(pin)) { setError("Choose a 4-digit PIN to get back in"); return; }
    if (!supabase) { setError("App not configured. Check Supabase credentials."); return; }
    setLoading(true);
    try {
      const { data: existingRows } = await supabase.rpc('login_family', { family_name: createdName, family_pin: pin });
      if (existingRows?.length > 0) { setError("That name and PIN combination is already taken. Choose another."); return; }
      const { data: newRows, error: fe } = await supabase.rpc('create_family', { family_name: createdName, family_pin: pin });
      if (fe || !newRows?.[0]) { setError("Failed to set up. Try again."); return; }
      const familyId = newRows[0].id;
      const { error: me } = await supabase.from("members").insert({
        family_id: familyId, name: soloName, avatar: soloName[0].toUpperCase(),
        color: SETUP_MEMBER_COLORS[0], is_kid: false, points: 0, streak: 0,
      });
      if (me) { setError("Failed to set up. Try again."); return; }
      // Seed starter rewards for solo users (#17)
      await supabase.from("rewards").insert([
        { family_id: familyId, name: "Movie night pick", points: 30, icon: "🎬", who: "Everyone", color: C.accent },
        { family_id: familyId, name: "Choose dinner tonight", points: 20, icon: "🍕", who: "Everyone", color: C.accent },
        { family_id: familyId, name: "30 min guilt-free downtime", points: 25, icon: "📱", who: "Everyone", color: C.green },
      ]);
      localStorage.setItem("ritual_savedPin", pin);
      localStorage.setItem("ritual_savedFamilyName", createdName);
      localStorage.setItem("ritual_soloMode", "true");
      const familyData = await fetchFamilyData(pin, createdName);
      if (!familyData) { setError("Setup done but failed to load. Try logging in."); return; }
      onLogin(familyData);
    } catch { setError("Something went wrong. Please try again."); }
    finally { setLoading(false); }
  };

  const addMember = () => {
    if (!memberName.trim()) return;
    const newMember = {
      id: `local_${Date.now()}`, name: memberName.trim(),
      avatar: memberName.trim()[0].toUpperCase(),
      isKid: memberIsKid, color: SETUP_MEMBER_COLORS[memberColorIdx % SETUP_MEMBER_COLORS.length],
      points: 0, streak: 0,
    };
    setMembers(prev => [...prev, newMember]);
    setExpandedMemberId(newMember.id);
    setMemberName(""); setMemberIsKid(false);
    setMemberColorIdx(prev => (prev + 1) % SETUP_MEMBER_COLORS.length);
    setAddingNew(false);
  };

  const updateMember = (id, updates) => {
    setMembers(ms => ms.map(m => m.id === id ? { ...m, ...updates } : m));
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
        { family_id: createdFamilyId, name: "30 min extra screen time", points: 25, icon: "📱", who: "Kids", color: C.kids },
        { family_id: createdFamilyId, name: "Choose dinner", points: 20, icon: "🍕", who: "Everyone", color: C.accent },
        { family_id: createdFamilyId, name: "Family movie night", points: 30, icon: "🎬", who: "Everyone", color: C.green },
      ]);
      const familyData = await fetchFamilyData(pin, familyName.trim());
      if (!familyData) { setError("Setup done but failed to load. Try logging in."); return; }
      localStorage.setItem("ritual_savedPin", pin);
      localStorage.setItem("ritual_savedFamilyName", familyName.trim());
      onLogin(familyData);
    } catch { setError("Something went wrong. Please try again."); }
    finally { setLoading(false); }
  };

  // ── JSX ────────────────────────────────────────────────────────
  return (
    <div style={twoToneOuter}>

      {/* ── Screen 1: Welcome ─────────────────────────────────── */}
      {view === "welcome" && (<>
        <div style={topSection}>
          <div style={{ fontSize: 30, fontFamily: D.fontHeading, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.2, color: D.textDark, marginBottom: 10 }}>
            Habits that{" "}
            <span style={{ color: D.terracotta }}>stick.</span>
          </div>
          <div style={{ fontSize: 13, fontFamily: D.fontBody, color: D.textMid, lineHeight: 1.6 }}>
            A physical tile where the habit happens. A tap to say it's done.
          </div>
        </div>
        <div style={bottomCard}>
          <label style={labelStyle}>How will you use Ritual?</label>
          <div style={{ display: "flex", borderRadius: 50, overflow: "hidden", border: `1.5px solid ${D.border}`, marginBottom: 10 }}>
            {[{ val: "solo", label: "Just me" }, { val: "family", label: "Family" }].map(opt => (
              <div key={opt.val} onClick={() => setUseMode(opt.val)} style={{
                flex: 1, padding: "11px 0", textAlign: "center", cursor: "pointer",
                fontSize: 14, fontFamily: D.fontBody, fontWeight: 500,
                borderRadius: 50,
                background: useMode === opt.val ? D.terracotta : D.bgInput,
                color: useMode === opt.val ? "#F5EFE6" : D.textMuted,
                transition: "all 0.2s",
              }}>{opt.label}</div>
            ))}
          </div>
          <div style={{ fontSize: 11, fontFamily: D.fontBody, color: D.textMuted, marginBottom: 20 }}>
            {useMode === "solo"
              ? "Track habits solo — upgrade to family any time."
              : "Set up a shared space for everyone at home."}
          </div>
          <button
            onClick={() => { setError(""); setFamilyName(""); setPin(""); setView(useMode === "solo" ? "createSolo" : "create"); }}
            style={{ ...btnSetup, marginBottom: 8 }}
          >
            <span>Get started</span><span>→</span>
          </button>
          {useMode === "family" && (
            <button onClick={() => { setError(""); setFamilyName(""); setPin(""); setJoinContext("family"); setView("join"); }} style={btnGhost}>
              I already have a family code
            </button>
          )}
          {useMode === "solo" && (
            <button onClick={() => { setError(""); setFamilyName(""); setPin(""); setJoinContext("solo"); setView("join"); }} style={btnGhost}>
              I already have a PIN
            </button>
          )}
        </div>
      </>)}

      {/* ── Screen 2: Create family ────────────────────────────── */}
      {view === "create" && (<>
        <div style={topSection}>
          <button onClick={() => { setView("welcome"); setError(""); setFamilyName(""); setPin(""); }} style={{ background: "none", border: "none", cursor: "pointer", color: D.textMuted, fontSize: 13, fontFamily: D.fontBody, padding: 0, marginBottom: 16, display: "block" }}>← Back</button>
          <div style={{ fontSize: 28, fontFamily: D.fontHeading, fontWeight: 700, letterSpacing: "-0.03em", color: D.textDark, marginBottom: 8 }}>Create your family.</div>
          <div style={{ fontSize: 13, fontFamily: D.fontBody, color: D.textMid }}>You'll share this with everyone at home.</div>
        </div>
        <div style={bottomCard}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label style={labelStyle}>Family name</label>
              <input style={lightInput} placeholder="e.g. Jones" value={familyName} onChange={e => setFamilyName(e.target.value)} autoComplete="off" />
            </div>
            <div>
              <label style={labelStyle}>4-digit PIN</label>
              <PinInput value={pin} onChange={setPin} />
              <div style={{ fontSize: 11, fontFamily: D.fontBody, color: D.textMuted, marginTop: 6 }}>Members use this PIN to join on their own device.</div>
            </div>
            {error && <div style={{ fontSize: 12, color: C.error, textAlign: "center" }}>{error}</div>}
            <button onClick={handleCreate} disabled={loading} style={{ ...btnSetup, opacity: loading ? 0.7 : 1 }}>
              <span>{loading ? "Creating…" : "Next"}</span><span>→</span>
            </button>
            <button onClick={() => { setView("welcome"); setError(""); setFamilyName(""); setPin(""); }} style={btnGhost}>Back</button>
          </div>
        </div>
      </>)}

      {/* ── Screen 3: Add members ──────────────────────────────── */}
      {view === "addMembers" && (<>
        <div style={topSection}>
          <div style={{ fontSize: 28, fontFamily: D.fontHeading, fontWeight: 700, letterSpacing: "-0.03em", color: D.textDark, marginBottom: 8 }}>Who's in your home?</div>
          <div style={{ fontSize: 13, fontFamily: D.fontBody, color: D.textMid }}>Add everyone who'll use Ritual.</div>
        </div>
        <div style={bottomCard}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
            {members.map((m, idx) => {
              const isExpanded = expandedMemberId === m.id;
              const roleLabel = idx === 0 ? "Admin" : m.isKid ? "Child" : "Adult";
              return (
                <div key={m.id} style={{ background: D.bgWhite, border: `1.5px solid ${D.border}`, borderRadius: 11, overflow: "hidden" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", cursor: "pointer" }}
                    onClick={() => setExpandedMemberId(isExpanded ? null : m.id)}>
                    <div style={{ width: 28, height: 28, borderRadius: "50%", background: m.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#FFF", flexShrink: 0 }}>{m.avatar}</div>
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 500, fontFamily: D.fontBody, color: D.textDark }}>{m.name}</span>
                    <span style={{ fontSize: 10, fontFamily: D.fontBody, color: D.textMuted, marginRight: 8 }}>{roleLabel}</span>
                    <div style={{ display: "flex", gap: 4 }}>
                      {["Adult", "Child"].map(role => (
                        <div key={role} onClick={e => { e.stopPropagation(); updateMember(m.id, { isKid: role === "Child" }); }}
                          style={{ padding: "3px 8px", borderRadius: 50, fontSize: 10, fontFamily: D.fontBody, cursor: "pointer",
                            background: (role === "Child") === m.isKid ? D.textDark : D.bgInput,
                            color: (role === "Child") === m.isKid ? D.bgCream : D.textMuted,
                            border: `1px solid ${(role === "Child") === m.isKid ? D.textDark : D.border}`,
                          }}>{role}</div>
                      ))}
                    </div>
                  </div>
                  {isExpanded && (
                    <div style={{ borderTop: `1px solid ${D.bgCream}`, padding: "10px 10px 12px" }}>
                      <div style={{ fontSize: 9, fontFamily: D.fontBody, color: D.textFaint, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>Choose a colour</div>
                      <div style={{ display: "flex", gap: 6 }}>
                        {SETUP_MEMBER_COLORS.map((col, ci) => (
                          <div key={ci} onClick={() => updateMember(m.id, { color: col })}
                            style={{ width: 18, height: 18, borderRadius: "50%", background: col, cursor: "pointer",
                              outline: m.color === col ? `2.5px solid ${D.terracotta}` : "none",
                              outlineOffset: 2,
                            }} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Add new member form */}
          {addingNew ? (
            <div style={{ border: `1.5px solid ${D.border}`, borderRadius: 11, padding: "12px 12px 14px", marginBottom: 12 }}>
              <input style={{ ...lightInput, marginBottom: 10 }} placeholder="Name" value={memberName} onChange={e => setMemberName(e.target.value)} autoComplete="off" autoFocus />
              <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
                {SETUP_MEMBER_COLORS.map((col, i) => (
                  <div key={i} onClick={() => setMemberColorIdx(i)} style={{ width: 20, height: 20, borderRadius: "50%", background: col, cursor: "pointer",
                    outline: memberColorIdx === i ? `2.5px solid ${D.terracotta}` : "none", outlineOffset: 2 }} />
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                {[{ label: "Adult", val: false }, { label: "Child", val: true }].map(opt => (
                  <div key={String(opt.val)} onClick={() => setMemberIsKid(opt.val)}
                    style={{ flex: 1, padding: "7px", borderRadius: 50, textAlign: "center", cursor: "pointer",
                      fontSize: 12, fontFamily: D.fontBody,
                      background: memberIsKid === opt.val ? D.textDark : D.bgInput,
                      color: memberIsKid === opt.val ? D.bgCream : D.textMuted,
                      border: `1px solid ${memberIsKid === opt.val ? D.textDark : D.border}`,
                    }}>{opt.label}</div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={addMember} disabled={!memberName.trim()} style={{ ...btnSetup, opacity: memberName.trim() ? 1 : 0.5, fontSize: 13, padding: "10px 16px", flex: 2 }}>
                  <span>Add</span><span>+</span>
                </button>
                <button onClick={() => { setAddingNew(false); setMemberName(""); setMemberIsKid(false); }} style={{ ...btnGhost, border: `1px solid ${D.border}`, borderRadius: 50, padding: "10px 14px", flex: 1, color: D.textMuted }}>Cancel</button>
              </div>
            </div>
          ) : (
            <button onClick={() => { setAddingNew(true); setMemberName(""); setMemberIsKid(false); setExpandedMemberId(null); }}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", padding: "12px", borderRadius: 10, border: `1.5px dashed ${D.borderDashed}`, background: "none", cursor: "pointer", fontSize: 13, fontFamily: D.fontBody, color: D.terracotta, marginBottom: 16 }}>
              + Add another member
            </button>
          )}

          {error && <div style={{ fontSize: 12, color: C.error, textAlign: "center", marginBottom: 8 }}>{error}</div>}
          {members.length > 0 && !addingNew && (
            <button onClick={finishSetup} disabled={loading} style={{ ...btnSetup, opacity: loading ? 0.7 : 1 }}>
              <span>{loading ? "Setting up…" : "Continue"}</span><span>→</span>
            </button>
          )}
        </div>
      </>)}

      {/* ── Screen 4: Join / Sign back in ────────────────────── */}
      {view === "join" && (<>
        <div style={topSection}>
          <button onClick={() => { setView("welcome"); setError(""); setFamilyName(""); setPin(""); }} style={{ background: "none", border: "none", cursor: "pointer", color: D.textMuted, fontSize: 13, fontFamily: D.fontBody, padding: 0, marginBottom: 16, display: "block" }}>← Back</button>
          <div style={{ fontSize: 28, fontFamily: D.fontHeading, fontWeight: 700, letterSpacing: "-0.03em", color: D.textDark, marginBottom: 8 }}>{joinContext === "solo" ? "Welcome back." : "Join your family."}</div>
          <div style={{ fontSize: 13, fontFamily: D.fontBody, color: D.textMid }}>{joinContext === "solo" ? "Enter the name and PIN you chose during setup." : "Enter the details your admin shared."}</div>
        </div>
        <div style={bottomCard}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label style={labelStyle}>{joinContext === "solo" ? "Your name" : "Family name"}</label>
              <input style={lightInput} placeholder={joinContext === "solo" ? "e.g. Alex" : "e.g. Jones"} value={familyName} onChange={e => setFamilyName(e.target.value)} autoComplete="off" />
            </div>
            <div>
              <label style={labelStyle}>PIN</label>
              <PinInput value={pin} onChange={setPin} />
            </div>
            {error && <div style={{ fontSize: 12, color: C.error, textAlign: "center" }}>{error}</div>}
            <button onClick={handleJoin} disabled={loading} style={{ ...btnSetup, opacity: loading ? 0.7 : 1 }}>
              <span>{loading ? "Signing in…" : joinContext === "solo" ? "Sign in" : "Join family"}</span><span>→</span>
            </button>
            <button onClick={() => { setView("welcome"); setError(""); setFamilyName(""); setPin(""); }} style={btnGhost}>Back</button>
          </div>
        </div>
      </>)}

      {/* ── Solo setup ────────────────────────────────────────── */}
      {view === "createSolo" && (<>
        <div style={topSection}>
          <button onClick={() => { setView("welcome"); setError(""); setFamilyName(""); setPin(""); }} style={{ background: "none", border: "none", cursor: "pointer", color: D.textMuted, fontSize: 13, fontFamily: D.fontBody, padding: 0, marginBottom: 16, display: "block" }}>← Back</button>
          <div style={{ fontSize: 28, fontFamily: D.fontHeading, fontWeight: 700, letterSpacing: "-0.03em", color: D.textDark, marginBottom: 8 }}>Just you.</div>
          <div style={{ fontSize: 13, fontFamily: D.fontBody, color: D.textMid, lineHeight: 1.6 }}>Your space. Your pace.<br />Choose a name and a PIN to get back in.</div>
        </div>
        <div style={bottomCard}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label style={labelStyle}>Your name</label>
              <input style={lightInput} placeholder="e.g. Alex" value={familyName} onChange={e => setFamilyName(e.target.value)} autoComplete="off" />
            </div>
            <div>
              <label style={labelStyle}>4-digit PIN</label>
              <PinInput value={pin} onChange={setPin} />
            </div>
            {error && <div style={{ fontSize: 12, color: C.error, textAlign: "center" }}>{error}</div>}
            <button onClick={handleCreateSolo} disabled={loading} style={{ ...btnSetup, opacity: loading ? 0.7 : 1 }}>
              <span>{loading ? "Setting up…" : "Start my Rituals"}</span><span>→</span>
            </button>
          </div>
        </div>
      </>)}

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
        <div style={{ fontSize: 24, fontWeight: 700, color: C.white, fontFamily: "'DM Serif Display', serif", marginBottom: 8 }}>Who completed this?</div>
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
  const [countdown, setCountdown] = useState(FLASH_COUNTDOWN_SECONDS);
  const isKid = habit?.isKid || member?.isKid;
  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);

  useEffect(() => {
    const newStreak = (habit?.streak || 0) + 1;
    const type = isKid ? "kids" : newStreak >= 5 ? "milestone" : "regular";
    if (soundEnabled) playCompletionSound(type);
    triggerHaptic(type);
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
    <div style={{ position: "fixed", inset: 0, zIndex: 999, background: isKid ? 'linear-gradient(165deg, #E6DFD4 0%, #EDE8DF 40%, #F5F2EB 100%)' : `linear-gradient(135deg, ${C.slateDark}, ${C.slate})`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, animation: "flashIn 0.3s ease" }}>
      {isKid && <>
        <div style={{ position: "absolute", top: -30, right: -20, width: 120, height: 120, borderRadius: "50%", background: "rgba(183,175,160,0.15)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", bottom: 90, left: -25, width: 110, height: 110, borderRadius: "50%", background: "rgba(166,191,159,0.12)", pointerEvents: "none" }} />
      </>}
      <div style={{ fontSize: 72, animation: "popIn 0.4s cubic-bezier(0.34,1.56,0.64,1)" }}>{isKid ? "✦" : justCompleted ? "✦" : "◈"}</div>
      {member && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 16px", borderRadius: 30, background: isKid ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.15)" }}>
          <div style={{ width: 28, height: 28, borderRadius: "50%", background: member.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: C.white }}>{member.avatar}</div>
          <span style={{ fontSize: 14, color: isKid ? "#4A3F35" : C.white, fontWeight: 600 }}>{member.name}</span>
        </div>
      )}
      <div style={{ fontSize: isKid ? 24 : 26, fontWeight: 700, color: isKid ? "#4A3F35" : C.white, fontFamily: "'DM Serif Display', serif", textAlign: "center", padding: "0 40px", lineHeight: 1.2 }}>
        {isKid ? "Beautiful work!" : justCompleted ? "Ritual complete" : "Tap logged"}
      </div>
      <div style={{ fontSize: 14, color: isKid ? "#7A7060" : "rgba(255,255,255,0.7)", textAlign: "center" }}>{habit?.name}</div>
      {habit?.target > 1 && <div style={{ padding: "8px 20px", borderRadius: 20, background: isKid ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.15)", fontSize: 14, color: isKid ? "#5A6B55" : C.white, fontWeight: 600 }}>{taps} / {target} today</div>}
      {justCompleted && <div style={{ padding: "8px 20px", borderRadius: 30, background: isKid ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.15)", fontSize: 13, color: isKid ? "#7A9066" : C.white, fontWeight: 600 }}>{isKid ? "🌿" : "🔥"} {(habit?.streak || 0) + 1} day streak</div>}
      <div style={{ fontSize: 12, color: isKid ? "#A09480" : "rgba(255,255,255,0.4)" }}>+{habit?.points || 10} points</div>
      <button onClick={() => { if (soundEnabled) playCompletionSound("undo"); triggerHaptic("undo"); onUndo(); onDone(); }} style={{ position: "absolute", bottom: 48, background: isKid ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.1)", border: isKid ? "1px solid rgba(183,175,160,0.3)" : "1px solid rgba(255,255,255,0.2)", borderRadius: 20, padding: "10px 24px", cursor: "pointer", color: isKid ? "#8A7E70" : "rgba(255,255,255,0.6)", fontSize: 13, fontFamily: "'DM Sans', sans-serif", display: "flex", alignItems: "center", gap: 8 }}>
        <span>↩</span> Undo tap · {countdown}s
      </button>
    </div>
  );
}

// ─── HABIT CARD ───────────────────────────────────────────────────
const SWIPE_THRESHOLD = 60;
const ACTION_WIDTH = 140;

function HabitCard({ habit, currentMember, allMembers, onComplete, onUndo, onEdit, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const [showDigital, setShowDigital] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0);
  const [longPressProgress, setLongPressProgress] = useState(0);
  const [swipeX, setSwipeX] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const holdInterval = useRef(null);
  const longInterval = useRef(null);
  const swipeStartX = useRef(0);
  const swipeStartY = useRef(0);
  const swipeLocked = useRef(false);
  const swipeTimeout = useRef(null);

  const taps = habit.taps || 0;
  const target = habit.target || 1;
  const completed = taps >= target;
  const isMulti = target > 1;
  const isKidsHabit = habit.isKid || habit.categoryId === "kids";

  useEffect(() => { setSwipeX(0); setSwiping(false); }, [habit.id, completed]);

  useEffect(() => () => { clearInterval(holdInterval.current); clearInterval(longInterval.current); clearTimeout(swipeTimeout.current); }, []);

  useEffect(() => {
    if (!expanded) return;
    const handle = (e) => { if (e.key === "Escape") { setExpanded(false); setShowDigital(false); setHoldProgress(0); } };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [expanded]);

  useEffect(() => {
    if (swipeX === 0) return;
    const close = () => setSwipeX(0);
    document.addEventListener("touchstart", close, { passive: true });
    document.addEventListener("mousedown", close);
    document.addEventListener("pointerdown", close);
    return () => {
      document.removeEventListener("touchstart", close);
      document.removeEventListener("mousedown", close);
      document.removeEventListener("pointerdown", close);
    };
  }, [swipeX]);

  const handleSwipeStart = (e) => {
    swipeStartX.current = e.touches[0].clientX;
    swipeStartY.current = e.touches[0].clientY;
    swipeLocked.current = false;
    setSwiping(true);
    clearTimeout(swipeTimeout.current);
    swipeTimeout.current = setTimeout(() => { setSwiping(false); setSwipeX(0); }, 500);
  };
  const handleSwipeMove = (e) => {
    clearTimeout(swipeTimeout.current);
    swipeTimeout.current = setTimeout(() => { setSwiping(false); setSwipeX(0); }, 500);
    const dx = e.touches[0].clientX - swipeStartX.current;
    const dy = e.touches[0].clientY - swipeStartY.current;
    if (!swipeLocked.current && Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
    if (!swipeLocked.current) {
      if (Math.abs(dy) > Math.abs(dx)) { setSwiping(false); return; }
      swipeLocked.current = true;
    }
    e.preventDefault();
    const newX = Math.min(0, Math.max(-ACTION_WIDTH, dx));
    setSwipeX(newX);
  };
  const handleSwipeEnd = () => {
    clearTimeout(swipeTimeout.current);
    setSwiping(false);
    setSwipeX(prev => prev < -SWIPE_THRESHOLD ? -ACTION_WIDTH : 0);
  };

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
    <div style={{ position: "relative", borderRadius: 20 }}>
      {swipeX < 0 && (
        <div
          style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: ACTION_WIDTH, display: "flex" }}
          onTouchStart={(e) => e.nativeEvent.stopImmediatePropagation()}
          onPointerDown={(e) => e.nativeEvent.stopImmediatePropagation()}
        >
          <button onTouchEnd={(e) => { e.stopPropagation(); setSwipeX(0); onEdit?.(); }} style={{ flex: 1, background: C.warm, border: "none", cursor: "pointer", color: C.white, fontSize: 11, fontWeight: 600 }}>Edit</button>
          <button onTouchEnd={(e) => { e.stopPropagation(); setSwipeX(0); onDelete?.(); }} style={{ flex: 1, background: C.error, border: "none", cursor: "pointer", color: C.white, fontSize: 11, fontWeight: 600 }}>Delete</button>
        </div>
      )}
      <div
        onTouchStart={(e) => { handleSwipeStart(e); if (swipeX === 0) startLongPress(); }}
        onTouchEnd={(e) => { handleSwipeEnd(); if (swipeX === 0) endLongPress(); }}
        onTouchCancel={handleSwipeEnd}
        onTouchMove={handleSwipeMove}
        onMouseDown={startLongPress} onMouseUp={endLongPress}
        style={{ width: "100%", background: C.white, borderRadius: 20, padding: 18, boxShadow: `0 4px 20px ${habit.color}18`, border: `1px solid ${habit.color}30`, position: "relative", overflow: "hidden", cursor: "pointer", userSelect: "none", transform: `translateX(${swipeX}px)`, transition: swiping ? "none" : "transform 0.3s ease" }}>
        {longPressProgress > 0 && <div style={{ position: "absolute", inset: 0, background: `${habit.color}12`, width: `${longPressProgress}%`, zIndex: 0 }} />}
        <div style={{ display: "flex", alignItems: "center", gap: 12, position: "relative", zIndex: 1 }}>
          <div style={{ width: 44, height: 44, borderRadius: 13, flexShrink: 0, background: `linear-gradient(135deg, ${habit.color}, ${habit.color}CC)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: C.white, boxShadow: `0 4px 10px ${habit.color}35` }}>✓</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.slate }}>{habit.name}</div>
            <div style={{ fontSize: 11, color: C.slateLight, marginTop: 1 }}>Done · 🔥 {(habit.streak || 0) + 1} day streak · +{habit.points || 10} pts{habit.completedBy ? ` · ${habit.completedBy}` : ""}</div>
          </div>
          <div style={{ fontSize: 9, color: `${C.slateLight}60`, textAlign: "right", lineHeight: 1.4 }}>{longPressProgress > 0 ? "Undoing…" : "Hold to\nundo"}</div>
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ position: "relative", borderRadius: 20 }}>
      {swipeX < 0 && (
        <div
          style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: ACTION_WIDTH, display: "flex" }}
          onTouchStart={(e) => e.nativeEvent.stopImmediatePropagation()}
          onPointerDown={(e) => e.nativeEvent.stopImmediatePropagation()}
        >
          <button onTouchEnd={(e) => { e.stopPropagation(); setSwipeX(0); onEdit?.(); }} style={{ flex: 1, background: C.warm, border: "none", cursor: "pointer", color: C.white, fontSize: 11, fontWeight: 600 }}>Edit</button>
          <button onTouchEnd={(e) => { e.stopPropagation(); setSwipeX(0); onDelete?.(); }} style={{ flex: 1, background: C.error, border: "none", cursor: "pointer", color: C.white, fontSize: 11, fontWeight: 600 }}>Delete</button>
        </div>
      )}
      <div
        onTouchStart={handleSwipeStart} onTouchMove={handleSwipeMove} onTouchEnd={handleSwipeEnd} onTouchCancel={handleSwipeEnd}
        style={{ width: "100%", background: isKidsHabit ? `linear-gradient(135deg, ${habit.color}10, ${C.white})` : C.white, borderRadius: 20, border: isKidsHabit ? `1.5px solid ${habit.color}30` : "1px solid rgba(0,0,0,0.05)", boxShadow: "0 2px 10px rgba(0,0,0,0.05)", overflow: "hidden", transform: `translateX(${swipeX}px)`, transition: swiping ? "none" : "transform 0.3s ease" }}>
      <div style={{ padding: 18 }} onClick={() => swipeX === 0 && !expanded && setExpanded(true)}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
          <div style={{ width: 44, height: 44, borderRadius: 13, flexShrink: 0, background: `${habit.color}15`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>{habit.icon}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.slate }}>{habit.name}</div>
            <div style={{ fontSize: 11, color: C.slateLight, marginTop: 1 }}>
              {habit.location ? `${habit.tileUid ? "Tile at" : "At"}: ${habit.location}` : habit.category}{habit.streak > 0 ? ` · 🔥 ${habit.streak}` : ""}
              {habit.tileUid && <span style={{ color: C.accent, marginLeft: 6 }}>· <TileIcon size="11px" /></span>}
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
    </div>
  );
}

// ─── CELEBRATION OVERLAY ─────────────────────────────────────────
function CelebrationOverlay({ onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3000);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line
  const COLORS = ["#C4956A", "#7BA05B", "#F4B8A8", "#E8A090", "#9BC07A", "#C47B4A"];
  const particles = Array.from({ length: 20 }, (_, i) => ({
    id: i,
    left: `${5 + (i * 4.75) % 90}%`,
    color: COLORS[i % COLORS.length],
    size: 6 + (i % 4) * 3,
    delay: `${((i * 0.13) % 1.4).toFixed(2)}s`,
    duration: `${(2.2 + (i % 5) * 0.3).toFixed(1)}s`,
    radius: i % 3 === 0 ? "50%" : i % 3 === 1 ? "3px" : "2px",
  }));
  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, pointerEvents: "none", overflow: "hidden" }}>
      {particles.map(p => (
        <div key={p.id} style={{ position: "absolute", top: "-20px", left: p.left, width: p.size, height: p.size, borderRadius: p.radius, background: p.color, animation: `confettiFall ${p.duration} ${p.delay} ease-in forwards` }} />
      ))}
      <div style={{ textAlign: "center", animation: "celebFadeIn 0.5s ease forwards", width: "78%", position: "relative", zIndex: 1 }}>
        <div style={{ fontSize: 52, marginBottom: 12, lineHeight: 1 }}>🌸</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#1E1C18", fontFamily: "'DM Serif Display', serif", lineHeight: 1.3, background: "rgba(255,255,255,0.93)", borderRadius: 20, padding: "18px 24px", boxShadow: "0 8px 32px rgba(0,0,0,0.12)" }}>
          All done!<br />
          <span style={{ fontSize: 15, fontWeight: 500, color: "#7A7060" }}>Your tree is in full bloom!</span>
        </div>
      </div>
    </div>
  );
}

// ─── KIDS TREE VIEW ──────────────────────────────────────────────
function KidsTreeView({ habits, weekCompletions, currentMember, allMembers, onComplete, onUndo, onClaimReward, flashData, onFlashDone, onFlashUndo, whoDidThis, onWhoCancel, soundEnabled, onEditHabit, onDeleteHabit }) {
  // Only count habits assigned to this kid (or unassigned = everyone)
  const myHabits = habits.filter(h =>
    !h.assignedMemberIds?.length || h.assignedMemberIds.includes(currentMember?.id)
  );
  const myHabitIds = new Set(myHabits.map(h => h.id));
  const done = myHabits.filter(h => (h.taps || 0) >= (h.target || 1)).length;
  const total = myHabits.length;
  const allDone = total > 0 && done === total;
  const pts = currentMember?.points || 0;
  const streak = currentMember?.streak || 0;

  // ── Cumulative 7-day tree fill ─────────────────────────────────
  // Weekly completion count drives the tree stage across the whole week.
  // Full week = all habits done every day for 7 days.
  // Past days use weekCompletions; today uses live habit taps.
  const weekDates = getWeekDates();
  const todayIdx = getTodayIndex();
  let weekCount = done; // today's completions (live)
  if (weekCompletions && currentMember && total > 0) {
    for (let i = 0; i < todayIdx; i++) {
      const dateStr = weekDates[i];
      const dayDone = weekCompletions.filter(c =>
        c.date === dateStr &&
        c.memberId === currentMember.id &&
        c.taps > 0 &&
        myHabitIds.has(c.habitId)
      ).length;
      weekCount += Math.min(dayDone, total); // cap at total habits per day
    }
  }
  const maxCount = total * 7; // perfect week
  const fillPct = maxCount > 0 ? Math.min(weekCount / maxCount, 1) : 0;
  const pct = total > 0 ? (done / total) * 100 : 0;
  const stage = pct === 0 ? 1 : pct <= 25 ? 2 : pct <= 50 ? 3 : pct <= 75 ? 4 : 5;
  const stageLabels = ["", "Plant your first habit today", "Growing — keep going!", "Halfway there!", "Almost in full bloom!", "In full bloom! 🌸"];

  return (
    <>
      {whoDidThis && <WhoDidThis habit={whoDidThis} members={allMembers} onSelect={(m) => onComplete(whoDidThis.id, m, false)} onCancel={onWhoCancel} />}
      {flashData && <CompletionFlash habit={flashData.habit} member={flashData.member} onDone={onFlashDone} onUndo={onFlashUndo} soundEnabled={soundEnabled} />}
      <div style={{ padding: "0 20px 140px" }}>

        {/* Celebration banners */}
        {fillPct >= 1 && (
          <div style={{ background: "linear-gradient(135deg, #C47B4A, #D4956A)", borderRadius: 16, padding: "16px 20px", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between", boxShadow: "0 4px 16px rgba(196,123,74,0.3)" }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#fff", fontFamily: "'DM Serif Display', serif" }}>In full bloom! 🌸</div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.85)", marginTop: 2 }}>Amazing week — claim your reward!</div>
            </div>
            <button onClick={onClaimReward} style={{ background: "#fff", border: "none", borderRadius: 50, padding: "9px 16px", fontSize: 13, fontWeight: 700, color: "#C47B4A", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", whiteSpace: "nowrap" }}>
              Claim →
            </button>
          </div>
        )}
        {allDone && fillPct < 1 && (
          <div style={{ background: "linear-gradient(135deg, #5C7A5E, #7A9E7C)", borderRadius: 16, padding: "16px 20px", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between", boxShadow: "0 4px 16px rgba(92,122,94,0.3)" }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#fff", fontFamily: "'DM Serif Display', serif" }}>All done today! ⭐</div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.85)", marginTop: 2 }}>Keep it up — your tree keeps growing all week!</div>
            </div>
          </div>
        )}

        {/* Tree + stats */}
        <div style={{ background: "#fff", borderRadius: 24, padding: 24, marginBottom: 16, boxShadow: "0 2px 10px rgba(0,0,0,0.05)", display: "flex", alignItems: "center", gap: 24 }}>
          {/* SVG Tree — 5 stages */}
          <div style={{ flexShrink: 0 }}>
            <svg width="90" height="120" viewBox="0 0 90 120" xmlns="http://www.w3.org/2000/svg">
              {/* Ground */}
              <ellipse cx="45" cy="112" rx="34" ry="7" fill="#D4C9A8" />
              <ellipse cx="45" cy="112" rx="26" ry="5" fill="#C4B896" />
              {stage === 1 && <>
                {/* Seed */}
                <ellipse cx="45" cy="104" rx="7" ry="5" fill="#8B7355" />
                <ellipse cx="45" cy="103" rx="5" ry="3" fill="#6B5740" />
              </>}
              {stage === 2 && <>
                {/* Stem */}
                <rect x="43" y="84" width="4" height="22" rx="2" fill="#8B7355" />
                {/* Two small leaves */}
                <ellipse cx="36" cy="88" rx="9" ry="5" fill="#9BC07A" transform="rotate(-35 36 88)" />
                <ellipse cx="54" cy="88" rx="9" ry="5" fill="#9BC07A" transform="rotate(35 54 88)" />
              </>}
              {stage === 3 && <>
                {/* Trunk */}
                <rect x="41" y="78" width="8" height="28" rx="3" fill="#8B7355" />
                <rect x="42" y="80" width="3" height="24" rx="1.5" fill="#A0896B" opacity="0.5" />
                {/* Canopy */}
                <circle cx="45" cy="62" r="20" fill="#9BC07A" />
                <circle cx="30" cy="70" r="13" fill="#8BB06A" />
                <circle cx="60" cy="70" r="13" fill="#8BB06A" />
                <circle cx="45" cy="50" r="13" fill="#7BA05B" />
              </>}
              {stage === 4 && <>
                {/* Trunk */}
                <rect x="40" y="70" width="10" height="36" rx="4" fill="#8B7355" />
                <rect x="41" y="72" width="4" height="30" rx="2" fill="#A0896B" opacity="0.5" />
                {/* Canopy */}
                <circle cx="45" cy="52" r="24" fill="#9BC07A" />
                <circle cx="27" cy="62" r="17" fill="#8BB06A" />
                <circle cx="63" cy="62" r="17" fill="#8BB06A" />
                <circle cx="45" cy="36" r="17" fill="#7BA05B" />
                {/* A few blossom hints */}
                <circle cx="38" cy="46" r="4" fill="#F4B8A8" opacity="0.7" />
                <circle cx="54" cy="42" r="4" fill="#F4B8A8" opacity="0.7" />
              </>}
              {stage === 5 && <>
                {/* Trunk */}
                <rect x="40" y="66" width="10" height="40" rx="4" fill="#8B7355" />
                <rect x="41" y="68" width="4" height="34" rx="2" fill="#A0896B" opacity="0.5" />
                {/* Canopy */}
                <circle cx="45" cy="46" r="28" fill="#9BC07A" />
                <circle cx="24" cy="58" r="20" fill="#8BB06A" />
                <circle cx="66" cy="58" r="20" fill="#8BB06A" />
                <circle cx="45" cy="28" r="20" fill="#7BA05B" />
                {/* Blossoms */}
                <circle cx="35" cy="40" r="5" fill="#F4B8A8" opacity="0.9" />
                <circle cx="56" cy="36" r="5" fill="#F4B8A8" opacity="0.9" />
                <circle cx="45" cy="53" r="4" fill="#E8A090" opacity="0.9" />
                <circle cx="26" cy="54" r="4" fill="#F4B8A8" opacity="0.85" />
                <circle cx="64" cy="50" r="4" fill="#E8A090" opacity="0.85" />
                <circle cx="39" cy="25" r="4" fill="#F4B8A8" opacity="0.9" />
                <circle cx="53" cy="22" r="3" fill="#C4956A" opacity="0.85" />
                <circle cx="45" cy="18" r="3" fill="#F4B8A8" opacity="0.8" />
              </>}
            </svg>
          </div>

          {/* Stats */}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, color: "#9A8E80", marginBottom: 4 }}>Today</div>
            <div style={{ fontSize: 36, fontWeight: 700, color: "#1E1C18", fontFamily: "'DM Serif Display', serif", lineHeight: 1 }}>
              {done}<span style={{ fontSize: 18, color: "#B0A498", fontWeight: 400 }}>/{total}</span>
            </div>
            <div style={{ fontSize: 12, color: "#9A8E80", marginBottom: 4 }}>habits done</div>
            <div style={{ fontSize: 11, color: "#7BA05B", marginBottom: 8 }}>{stageLabels[stage]}</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {streak > 0 && (
                <div style={{ padding: "4px 10px", borderRadius: 20, background: "#FFF3EB", border: "1px solid #F5D9C4", fontSize: 12, fontWeight: 600, color: "#C47B4A" }}>
                  🔥 {streak} day streak
                </div>
              )}
              <div style={{ padding: "4px 10px", borderRadius: 20, background: "#F0EDE6", border: "1px solid #E5DED4", fontSize: 12, fontWeight: 600, color: "#7A7060" }}>
                ⭐ {pts} pts
              </div>
            </div>
          </div>
        </div>

        {/* Habits */}
        {total === 0 ? (
          <div style={{ background: "#fff", borderRadius: 24, padding: 36, textAlign: "center", boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🌱</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#1E1C18", fontFamily: "'DM Serif Display', serif", marginBottom: 8 }}>Ready to grow</div>
            <div style={{ fontSize: 13, color: "#9A8E80", lineHeight: 1.6 }}>No habits yet — ask a parent to add some!</div>
          </div>
        ) : (
          <>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 10, letterSpacing: 0.5 }}>Today's Rituals</div>
            <div className="habit-grid">
              {myHabits.map(h => (
                <HabitCard key={h.id} habit={h} currentMember={currentMember} allMembers={allMembers} onComplete={onComplete} onUndo={onUndo} onEdit={() => onEditHabit?.(h.id)} onDelete={() => onDeleteHabit?.(h.id)} />
              ))}
            </div>
          </>
        )}

        {/* Claim reward CTA */}
        <button onClick={onClaimReward} style={{ marginTop: 20, width: "100%", padding: "14px 20px", borderRadius: 50, background: allDone ? "#C47B4A" : "#F0EDE6", border: `1.5px solid ${allDone ? "#C47B4A" : "#D5CECC"}`, color: allDone ? "#fff" : "#9A8E80", fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 15, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", transition: "all 0.2s" }}>
          <span>Claim a Reward</span>
          <span>→</span>
        </button>
      </div>
    </>
  );
}

// ─── TODAY SCREEN ─────────────────────────────────────────────────
function TodayScreen({ habits, weekData, weekCompletions, currentMember, allMembers, onComplete, onUndo, flashData, onFlashDone, onFlashUndo, whoDidThis, onWhoCancel, soundEnabled, soloMode, onClaimReward, onEditHabit, onDeleteHabit }) {
  if (currentMember?.isKid) {
    return <KidsTreeView habits={habits} weekCompletions={weekCompletions} currentMember={currentMember} allMembers={allMembers} onComplete={onComplete} onUndo={onUndo} onClaimReward={onClaimReward} flashData={flashData} onFlashDone={onFlashDone} onFlashUndo={onFlashUndo} whoDidThis={whoDidThis} onWhoCancel={onWhoCancel} soundEnabled={soundEnabled} onEditHabit={onEditHabit} onDeleteHabit={onDeleteHabit} />;
  }

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
      <div style={{ padding: "0 20px 140px" }}>
        {/* Hero */}
        <div style={{ background: `linear-gradient(135deg, ${C.slateDark} 0%, ${C.slate} 100%)`, borderRadius: 24, padding: 24, marginBottom: 16, position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: -30, right: -30, width: 150, height: 150, borderRadius: "50%", background: "rgba(255,255,255,0.06)", zIndex: 0 }} />
          <div style={{ position: "relative", zIndex: 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", letterSpacing: 2.5, textTransform: "uppercase", marginBottom: 4 }}>Today's Progress</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{ fontSize: 52, fontWeight: 700, color: C.white, fontFamily: "'DM Serif Display', serif", lineHeight: 1 }}>{done}</span>
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
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.65)", fontFamily: "'DM Serif Display', serif", fontStyle: "italic" }}>{getMotivation(done, total)}</div>
          </div>
        </div>

        {/* Habits */}
        {total === 0 ? (
          <div style={{ background: C.white, borderRadius: 24, padding: 36, textAlign: "center", boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>◈</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: C.slate, fontFamily: "'DM Serif Display', serif", marginBottom: 8 }}>Your rituals live here</div>
            <div style={{ fontSize: 13, color: C.slateLight, lineHeight: 1.6 }}>Every great habit starts with one decision.<br />Choose your first ritual below.</div>
          </div>
        ) : (
          <>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 10, letterSpacing: 0.5 }}>Today's Rituals</div>
            <div className="habit-grid">
              {habits.map(h => (
                <HabitCard key={h.id} habit={h} currentMember={currentMember} allMembers={allMembers} onComplete={onComplete} onUndo={onUndo} onEdit={() => onEditHabit?.(h.id)} onDelete={() => onDeleteHabit?.(h.id)} />
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}

// ─── FAMILY SCREEN ────────────────────────────────────────────────
const REWARD_TEMPLATES = [
  { icon: "🍕", name: "Choose dinner", points: 50, who: "Everyone" },
  { icon: "🎬", name: "Movie night pick", points: 75, who: "Everyone" },
  { icon: "📱", name: "Extra screen time", points: 100, who: "Kids" },
  { icon: "🌙", name: "Stay up 30 mins late", points: 150, who: "Kids" },
  { icon: "🎵", name: "Car music choice", points: 25, who: "Everyone" },
  { icon: "🎡", name: "Weekend activity pick", points: 200, who: "Everyone" },
  { icon: "💵", name: "$5 pocket money", points: 50, who: "Kids" },
  { icon: "💰", name: "$10 pocket money", points: 100, who: "Kids" },
];

// REWARD_ICONS removed — was only used by the dead-code FamilyScreen modal (Wave 4.1 superseded by AddScreen Manage Rewards)

function FamilyScreen({ family, onAddMember, onEditMember, onRemoveMember, currentMember, redemptions, onRedeemReward, onFulfillRedemption, onCancelRedemption }) {
  // NOTE: FamilyScreen is a large component — candidate for splitting in Wave 5+
  const [view, setView] = useState("list");
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", isKid: false, colorIdx: 0 });
  const [nudged, setNudged] = useState({});
  const [redeemTarget, setRedeemTarget] = useState(null);

  const handleNudge = async (id) => {
    setNudged(n => ({ ...n, [id]: true }));
    triggerHaptic("regular");
    try {
      const senderName = currentMember?.name || "Someone";
      await fetch('/api/nudge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memberId: id,
          familyId: family.id,
          title: "👋 Nudge!",
          body: `${senderName} nudged you — time to check your rituals!`,
        }),
      });
    } catch (e) {
      console.warn('[Nudge] Failed to send:', e);
    }
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
    <div style={{ padding: "0 20px 140px" }}>
      <button onClick={() => setView("list")} style={{ background: "none", border: "none", cursor: "pointer", color: C.slateLight, fontSize: 13, marginBottom: 20 }}>← Back</button>
      <div style={{ fontSize: 18, fontWeight: 700, color: C.slate, fontFamily: "'DM Serif Display', serif", marginBottom: 24 }}>{editing ? "Edit Member" : "Add Member"}</div>
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
  const activeRewards = (family.rewards || []).filter(r => r.status !== 'archived');
  const visibleRewards = activeRewards.filter(r => {
    if (!currentMember) return true;
    if (r.who === 'Kids' && !currentMember.isKid) return false;
    if (r.assignedTo && !r.assignedTo.includes(currentMember.id)) return false;
    return true;
  });
  // Adults see all pending; kids see only their own
  const pendingRedemptions = (redemptions || []).filter(rd =>
    currentMember?.isKid ? rd.member_id === currentMember.id : true
  );

  return (
    <div style={{ padding: "0 20px 140px" }}>
      <div style={{ background: `linear-gradient(135deg, ${C.warm}, ${C.accent})`, borderRadius: 24, padding: 24, marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", letterSpacing: 2.5, textTransform: "uppercase", marginBottom: 6 }}>The {family.name} Family</div>
        <div style={{ fontSize: 44, fontWeight: 700, color: C.white, fontFamily: "'DM Serif Display', serif", lineHeight: 1 }}>{totalPoints.toLocaleString()}</div>
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
                  {!currentMember?.isKid && (
                    <button onClick={() => { setEditing(m); setForm({ name: m.name, isKid: m.isKid, colorIdx: Math.max(0, MEMBER_COLORS.indexOf(m.color)) }); setView("add"); }} style={{ background: "none", border: "none", cursor: "pointer", color: C.sandDark, fontSize: 16 }}>✎</button>
                  )}
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

      {/* Pending redemptions (adults see all; kids see their own) */}
      {pendingRedemptions.length > 0 && (
        <div style={{ background: C.white, borderRadius: 20, padding: 18, marginBottom: 14, boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 12, letterSpacing: 0.5 }}>
            {currentMember?.isKid ? "⏳ Your Pending Requests" : "⏳ Pending Requests"}
          </div>
          {pendingRedemptions.map(rd => {
            const reward = activeRewards.find(r => r.id === rd.reward_id);
            const redeemer = family.members.find(m => m.id === rd.member_id);
            return (
              <div key={rd.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid " + C.sandLight }}>
                <div style={{ fontSize: 24 }}>{reward?.icon || "🎁"}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.slate }}>{reward?.name || "Reward"}</div>
                  <div style={{ fontSize: 11, color: C.slateLight, marginTop: 1 }}>
                    {redeemer?.name || "Member"} · {rd.points_spent} pts · {new Date(rd.redeemed_at).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}
                  </div>
                </div>
                {!currentMember?.isKid && (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => onFulfillRedemption(rd.id)} style={{ padding: "5px 10px", borderRadius: 12, border: "none", background: `${C.green}18`, color: C.green, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>✓ Done</button>
                    <button onClick={() => onCancelRedemption(rd.id, rd.member_id, rd.points_spent)} style={{ padding: "5px 10px", borderRadius: 12, border: "none", background: `${C.error}12`, color: C.error, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>✕</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Rewards available */}
      <div style={{ background: C.white, borderRadius: 20, padding: 18, boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.slate, letterSpacing: 0.5 }}>Rewards Available</div>
        </div>
        {currentMember && <div style={{ fontSize: 11, color: C.slateLight, marginBottom: 14 }}>{currentMember.name} has {currentMember.points || 0} pts</div>}
        {visibleRewards.length === 0 ? (
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🎁</div>
            <div style={{ fontSize: 13, color: C.slate, fontWeight: 600, marginBottom: 4 }}>No rewards yet</div>
            <div style={{ fontSize: 12, color: C.slateLight, marginBottom: 16 }}>Add rewards in the Manage tab → Manage Rewards</div>
          </div>
        ) : visibleRewards.map((r, i) => {
          const canAfford = currentMember && (currentMember.points || 0) >= r.points;
          return (
            <div key={r.id || i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: i < visibleRewards.length - 1 ? `1px solid ${C.sandLight}` : "none" }}>
              <div style={{ fontSize: 26 }}>{r.icon}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, color: C.slate, fontWeight: 500 }}>{r.name}</div>
                <div style={{ fontSize: 11, color: C.slateLight, marginTop: 1 }}>{r.who === "Kids" ? "⭐ Kids" : "👥 Everyone"} · {r.points} pts</div>
              </div>
              <button
                onClick={() => { if (currentMember && canAfford) setRedeemTarget(r); }}
                disabled={!currentMember || !canAfford}
                style={{ padding: "7px 14px", borderRadius: 20, border: "none", fontSize: 12, fontWeight: 600, cursor: currentMember && canAfford ? "pointer" : "default", background: currentMember && canAfford ? `${C.accent}15` : C.offwhite, color: currentMember && canAfford ? C.accent : C.sandDark }}
              >
                {canAfford ? "Redeem" : "Need " + (r.points - (currentMember?.points || 0)) + " more"}
              </button>
            </div>
          );
        })}
      </div>

      {/* Redeem confirmation sheet */}
      {redeemTarget && currentMember && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(42,52,56,0.85)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 2000 }} onClick={() => setRedeemTarget(null)}>
          <div style={{ background: C.white, borderRadius: "24px 24px 0 0", padding: "24px 20px 48px", width: "100%", maxWidth: 500 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.slate, fontFamily: "'DM Serif Display', serif", marginBottom: 4 }}>Redeem Reward?</div>
            <div style={{ fontSize: 13, color: C.slateLight, marginBottom: 20 }}>This will use {redeemTarget.points} points from {currentMember.name}'s balance</div>
            <div style={{ display: "flex", alignItems: "center", gap: 14, background: C.offwhite, borderRadius: 16, padding: 16, marginBottom: 6 }}>
              <div style={{ fontSize: 36 }}>{redeemTarget.icon}</div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: C.slate }}>{redeemTarget.name}</div>
                <div style={{ fontSize: 12, color: C.slateLight, marginTop: 2 }}>{redeemTarget.points} pts · {currentMember.name} will have {Math.max((currentMember.points || 0) - redeemTarget.points, 0)} pts remaining</div>
              </div>
            </div>
            {currentMember.isKid
              ? <div style={{ fontSize: 11, color: C.slateLight, textAlign: "center", marginBottom: 20 }}>A parent will need to approve and fulfil this reward</div>
              : <div style={{ fontSize: 11, color: C.slateLight, textAlign: "center", marginBottom: 20 }}>Points will be deducted from your balance</div>
            }
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setRedeemTarget(null)} style={{ flex: 1, padding: 14, borderRadius: 14, border: "none", background: C.offwhite, fontSize: 14, color: C.slateLight, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>Cancel</button>
              <button onClick={() => { onRedeemReward(redeemTarget.id, currentMember.id); setRedeemTarget(null); }} style={{ ...btnPrimary, flex: 2 }}>Confirm Redeem</button>
            </div>
          </div>
        </div>
      )}
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
        <div style={{ fontSize: 18, fontWeight: 700, color: C.slate, fontFamily: "'DM Serif Display', serif", marginBottom: 4 }}>New Tile Detected</div>
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
    <div style={{ padding: "0 20px 140px" }}>
      <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", color: C.slateLight, fontSize: 13, marginBottom: 16 }}>← Back</button>
      <div style={{ fontSize: 18, fontWeight: 700, color: C.slate, fontFamily: "'DM Serif Display', serif", marginBottom: 4 }}>Manage Tiles</div>
      <div style={{ fontSize: 12, color: C.slateLight, marginBottom: 12, lineHeight: 1.6 }}>
        Tap a tile to assign it. Tiles come pre-programmed — just tap one near your phone.
      </div>
      <div style={{ background: `${C.slateLight}0D`, borderRadius: 14, padding: "11px 14px", marginBottom: 20, border: `1px solid ${C.sandLight}` }}>
        <div style={{ fontSize: 12, color: C.slateLight, lineHeight: 1.6 }}>💡 Unlock your phone first, then hold the back near a tile and keep still for 1–2 seconds. On iPhone a banner appears at the top — tap it. On Android, tap the notification.</div>
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
                  <div style={{ fontSize: 11, color: C.slateLight }}><TileIcon size="11px" style={{ marginRight: 2 }} /> {tileLabel(habit.tileUid)}{habit.location ? ` · ${habit.location}` : ""}</div>
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
          <div style={{ marginBottom: 12 }}><TileIcon size="40px" /></div>
          <div style={{ fontSize: 15, fontWeight: 600, color: C.slate, marginBottom: 8 }}>No habits yet</div>
          <div style={{ fontSize: 12, color: C.slateLight, lineHeight: 1.7 }}>Add some habits first, then tap a tile to assign it.</div>
        </div>
      )}

      {/* Reassign bottom sheet */}
      {showHabitPicker && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(42,52,56,0.85)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 1000 }} onClick={() => setShowHabitPicker(null)}>
          <div style={{ background: C.white, borderRadius: "24px 24px 0 0", padding: "24px 20px 48px", width: "100%", maxWidth: 500, maxHeight: "80vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.slate, fontFamily: "'DM Serif Display', serif", marginBottom: 4 }}>Reassign Tile</div>
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
function ManageHabitsScreen({ habits, family, currentMember, onEditHabit, onDeleteHabit, onBack, initialEditHabitId }) {
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", location: "", target: 1, isShared: true, assignedMemberIds: null, daysActive: null, completionType: 'individual', points: 10, reminderTime: null });

  useEffect(() => {
    if (!initialEditHabitId || !habits?.length) return;
    const h = habits.find(x => x.id === initialEditHabitId);
    if (!h) return;
    setEditing(h);
    setForm({ name: h.name, location: h.location || "", target: h.target || 1, isShared: h.isShared ?? true, assignedMemberIds: h.assignedMemberIds || null, daysActive: h.daysActive || null, completionType: h.completionType || 'individual', points: h.points || 10, reminderTime: h.reminderTime || null });
  }, [initialEditHabitId, habits]);

  useEffect(() => {
    if (!editing) return;
    const handle = (e) => { if (e.key === "Escape") setEditing(null); };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [editing]);

  if (editing) return (
    <div style={{ padding: "0 20px 140px" }}>
      <button onClick={() => setEditing(null)} style={{ background: "none", border: "none", cursor: "pointer", color: C.slateLight, fontSize: 13, marginBottom: 16 }}>← Back</button>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <div style={{ width: 44, height: 44, borderRadius: 13, background: `${editing.color}18`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>{editing.icon}</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: C.slate, fontFamily: "'DM Serif Display', serif" }}>Edit Habit</div>
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
            <div style={{ fontSize: 36, fontWeight: 700, color: C.slate, fontFamily: "'DM Serif Display', serif", minWidth: 40, textAlign: "center" }}>{form.target}</div>
            <button onClick={() => setForm(f => ({ ...f, target: Math.min(20, f.target + 1) }))} style={{ width: 40, height: 40, borderRadius: "50%", border: "none", background: C.offwhite, fontSize: 20, cursor: "pointer", color: C.slate }}>+</button>
          </div>
        </div>
        <div style={{ background: C.white, borderRadius: 20, padding: 16, boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.slate, marginBottom: 4 }}>Points per completion</div>
          <div style={{ fontSize: 11, color: C.slateLight, marginBottom: 10 }}>Awarded when habit is done</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[5, 10, 15, 25, 50].map(p => (
              <div key={p} onClick={() => setForm(f => ({ ...f, points: p }))} style={{ padding: "8px 16px", borderRadius: 20, cursor: "pointer", fontSize: 13, fontWeight: 600, background: form.points === p ? C.accent : C.offwhite, color: form.points === p ? C.white : C.slate, border: `1.5px solid ${form.points === p ? C.accent : C.sandDark}` }}>{p} pts</div>
            ))}
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
        <div style={{ background: C.white, borderRadius: 20, padding: 16, marginTop: 12, boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: form.reminderTime ? 12 : 0 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.slate }}>Daily Reminder</div>
              <div style={{ fontSize: 11, color: C.slateLight, marginTop: 2 }}>Send a push notification at this time</div>
            </div>
            <div onClick={() => setForm(f => ({ ...f, reminderTime: f.reminderTime ? null : "09:00" }))} style={{ width: 44, height: 26, borderRadius: 13, background: form.reminderTime ? C.accent : C.sandDark, cursor: "pointer", position: "relative", transition: "background 0.2s", flexShrink: 0 }}>
              <div style={{ position: "absolute", top: 3, left: form.reminderTime ? 21 : 3, width: 20, height: 20, borderRadius: "50%", background: C.white, transition: "left 0.2s", boxShadow: "0 1px 4px rgba(0,0,0,0.2)" }} />
            </div>
          </div>
          {form.reminderTime && (() => {
            const [hStr, mStr] = form.reminderTime.split(':');
            const h24 = parseInt(hStr, 10);
            const tHour = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24;
            const tMin = mStr || '00';
            const tAmpm = h24 < 12 ? 'AM' : 'PM';
            const saveTime = (hour, min, ap) => {
              let h = parseInt(hour, 10);
              if (ap === 'AM') h = h === 12 ? 0 : h;
              else h = h === 12 ? 12 : h + 12;
              setForm(f => ({ ...f, reminderTime: `${String(h).padStart(2, '0')}:${min}` }));
            };
            const sel = { flex: 1, padding: "10px 6px", borderRadius: 12, border: `1.5px solid ${C.sandDark}`, background: C.offwhite, fontSize: 14, color: C.slate, outline: "none", fontFamily: "'DM Sans', sans-serif", boxSizing: "border-box", cursor: "pointer", textAlign: "center", WebkitAppearance: "none", appearance: "none" };
            return (
              <div style={{ display: "flex", gap: 8 }}>
                <select style={sel} value={tHour} onChange={e => saveTime(e.target.value, tMin, tAmpm)}>
                  {[12,1,2,3,4,5,6,7,8,9,10,11].map(h => <option key={h} value={h}>{h}</option>)}
                </select>
                <select style={sel} value={tMin} onChange={e => saveTime(tHour, e.target.value, tAmpm)}>
                  {['00','05','10','15','20','25','30','35','40','45','50','55'].map(m => <option key={m} value={m}>{m}</option>)}
                </select>
                <select style={sel} value={tAmpm} onChange={e => saveTime(tHour, tMin, e.target.value)}>
                  <option value="AM">AM</option>
                  <option value="PM">PM</option>
                </select>
              </div>
            );
          })()}
        </div>
        <button onClick={() => { onEditHabit(editing.id, { ...form, assignedMemberIds: form.assignedMemberIds || null }); setEditing(null); }} style={{ ...btnPrimary, marginTop: 12 }}>Save Changes</button>
        <button onClick={() => { if (window.confirm(`Delete "${editing.name}"? This removes all completion history.`)) { onDeleteHabit(editing.id); setEditing(null); } }} style={{ ...btnPrimary, background: `${C.error}18`, color: C.error, boxShadow: "none" }}>Delete Habit</button>
      </div>
    </div>
  );

  return (
    <div style={{ padding: "0 20px 140px" }}>
      <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", color: C.slateLight, fontSize: 13, marginBottom: 16 }}>← Back</button>
      <div style={{ fontSize: 18, fontWeight: 700, color: C.slate, fontFamily: "'DM Serif Display', serif", marginBottom: 4 }}>Manage Habits</div>
      <div style={{ fontSize: 12, color: C.slateLight, marginBottom: 20 }}>Tap a habit to edit or delete it</div>
      {habits.length === 0 ? (
        <div style={{ background: C.white, borderRadius: 20, padding: 28, textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>◈</div>
          <div style={{ fontSize: 14, color: C.slateLight }}>No habits yet</div>
        </div>
      ) : Array.from(new Map(habits.map(h => [h.id, h])).values()).map(h => (
        <div key={h.id} onClick={() => { setEditing(h); setForm({ name: h.name, location: h.location || "", target: h.target || 1, isShared: h.isShared ?? true, assignedMemberIds: h.assignedMemberIds || null, daysActive: h.daysActive || null, completionType: h.completionType || 'individual', points: h.points || 10, reminderTime: h.reminderTime || null }); }} style={{ background: C.white, borderRadius: 16, padding: 16, marginBottom: 8, boxShadow: "0 2px 8px rgba(0,0,0,0.04)", cursor: "pointer", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: `${h.color}15`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>{h.icon}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.slate }}>{h.name}</div>
            <div style={{ fontSize: 11, color: C.slateLight, marginTop: 2 }}>
              {h.location || h.category}{h.tileUid ? <span> · <TileIcon size="11px" style={{ marginRight: 2 }} /> {tileLabel(h.tileUid)}</span> : ""}
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
function AddScreen({ family, currentMember, onAddHabit, habits, onAssignTile, onRemoveTile, onEditHabit, onDeleteHabit, onAddReward, onEditReward, onDeleteReward, initialView = "menu", onMounted, onBack, soloMode, initialEditHabitId }) {
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
  const [habitPoints, setHabitPoints] = useState(10);
  const [customPoints, setCustomPoints] = useState(10);
  // Reward form state
  const [rewardForm, setRewardForm] = useState({ name: "", icon: "🎁", points: 10, who: "Everyone" });
  const [editingReward, setEditingReward] = useState(null);
  // Loading state for async add operations
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (view === "tile") {
    return <ManageTilesScreen habits={habits} onAssignTile={onAssignTile} onRemoveTile={onRemoveTile} onBack={() => onBack ? onBack() : setView("menu")} />;
  }

  if (view === "habitsManage") {
    return <ManageHabitsScreen habits={habits} family={family} currentMember={currentMember} onEditHabit={onEditHabit} onDeleteHabit={onDeleteHabit} onBack={() => onBack ? onBack() : setView("menu")} initialEditHabitId={initialEditHabitId} />;
  }

  // FIX 8: Custom ritual creation view
  if (view === "custom") {
    const cat = CATEGORIES.find(c => c.id === customCatId) || CATEGORIES[0];
    return (
      <div style={{ padding: "0 20px 140px" }}>
        <button onClick={() => onBack ? onBack() : setView("menu")} style={{ background: "none", border: "none", cursor: "pointer", color: C.slateLight, fontSize: 13, marginBottom: 16 }}>← Back</button>
        <div style={{ fontSize: 18, fontWeight: 700, color: C.slate, fontFamily: "'DM Serif Display', serif", marginBottom: 4 }}>Create Custom Ritual</div>
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
              <div style={{ fontSize: 48, fontWeight: 700, color: C.slate, fontFamily: "'DM Serif Display', serif", lineHeight: 1 }}>{customTarget}</div>
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

        {/* Points */}
        <div style={{ background: C.white, borderRadius: 20, padding: 16, marginBottom: 12, boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.slate, marginBottom: 4 }}>Points per completion</div>
          <div style={{ fontSize: 11, color: C.slateLight, marginBottom: 10 }}>Awarded each time this habit is done</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[5, 10, 15, 25, 50].map(p => (
              <div key={p} onClick={() => setCustomPoints(p)} style={{ padding: "8px 16px", borderRadius: 20, cursor: "pointer", fontSize: 13, fontWeight: 600, background: customPoints === p ? C.accent : C.offwhite, color: customPoints === p ? C.white : C.slate, border: `1.5px solid ${customPoints === p ? C.accent : C.sandDark}` }}>{p} pts</div>
            ))}
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
          disabled={isSubmitting || !customName.trim()}
          onClick={async () => {
            if (!customName.trim() || isSubmitting) return;
            setIsSubmitting(true);
            try {
              const selectedCategory = CATEGORIES.find(c => c.id === customCatId) || CATEGORIES[0];
              const assignedMemberIds = customSelectedMembers.length === 0 ? null : customSelectedMembers;
              await onAddHabit({
                name: customName.trim(), icon: customEmoji,
                category: selectedCategory.name, categoryId: customCatId,
                color: selectedCategory.color, location: customLocation.trim() || null,
                target: customTarget, isKid: selectedCategory.isKids || false, isCustom: true,
                isShared: customSelectedMembers.length === 0,
                assignedMemberIds,
                daysActive: customDays,
                completionType: customCompletionType,
                points: customPoints,
              });
              setCustomName(""); setCustomLocation(""); setCustomEmoji("🎯"); setCustomTarget(1); setCustomCatId("family"); setCustomIsShared(true); setCustomSelectedMembers([]); setCustomDays(null); setCustomCompletionType('individual'); setCustomPoints(10);
            } catch (e) {
              console.error('Failed to add habit:', e);
            } finally {
              setIsSubmitting(false);
            }
          }}
          style={{ ...btnPrimary, opacity: customName.trim() && !isSubmitting ? 1 : 0.5 }}
        >
          {isSubmitting ? "Adding…" : "Add Custom Ritual"}
        </button>
      </div>
    );
  }

  if (view === "addRitual") return (
    <div style={{ padding: "0 20px 140px" }}>
      <button onClick={() => onBack ? onBack() : setView("menu")} style={{ background: "none", border: "none", cursor: "pointer", color: C.slateLight, fontSize: 13, marginBottom: 20 }}>← Back</button>
      <div style={{ fontSize: 18, fontWeight: 700, color: C.slate, fontFamily: "'DM Serif Display', serif", marginBottom: 4 }}>Add a Ritual</div>
      <div style={{ fontSize: 12, color: C.slateLight, marginBottom: 12 }}>How do you want to add it?</div>
      <div style={{ background: `${C.slateLight}0D`, borderRadius: 14, padding: "11px 14px", marginBottom: 20, border: `1px solid ${C.sandLight}` }}>
        <div style={{ fontSize: 12, color: C.slateLight, lineHeight: 1.6 }}>💡 Add a habit here first, then link it to a tile from Manage Tiles. Start with something small you already do every day.</div>
      </div>
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
    <div style={{ padding: "0 20px 140px" }}>
      <div style={{ fontSize: 13, color: C.slateLight, marginBottom: 24 }}>What would you like to set up?</div>
      {[
        { id: "addRitual", icon: "◈", label: "Add a Ritual", desc: "Browse templates or create your own", color: C.slate },
        !soloMode ? { id: "rewards", icon: "🎁", label: "Manage Rewards", desc: "Set up points rewards for your family", color: C.accent } : null,
        { id: "tile", icon: <TileIcon size="24px" />, label: "Manage Tiles", desc: "Assign tiles to habits, detect new tiles", color: C.kidsBlue },
        { id: "habitsManage", icon: "✏️", label: "Manage Habits", desc: "Edit names, locations, targets or delete", color: C.slateLight },
      ].filter(Boolean).map(item => (
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
    <div style={{ padding: "0 20px 140px" }}>
      <button onClick={() => onBack ? onBack() : setView("menu")} style={{ background: "none", border: "none", cursor: "pointer", color: C.slateLight, fontSize: 13, marginBottom: 16 }}>← Back</button>
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
    <div style={{ padding: "0 20px 140px" }}>
      <button onClick={() => setView("habits")} style={{ background: "none", border: "none", cursor: "pointer", color: C.slateLight, fontSize: 13, marginBottom: 16 }}>← Back</button>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <div style={{ fontSize: 28 }}>{selectedCat.icon}</div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.slate, fontFamily: "'DM Serif Display', serif" }}>{selectedCat.name}</div>
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
    <div style={{ padding: "0 20px 140px" }}>
      <button onClick={() => setView("category")} style={{ background: "none", border: "none", cursor: "pointer", color: C.slateLight, fontSize: 13, marginBottom: 20 }}>← Back</button>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <div style={{ width: 48, height: 48, borderRadius: 14, background: `${selectedHabit.color}18`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>{selectedHabit.icon}</div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.slate, fontFamily: "'DM Serif Display', serif" }}>{selectedHabit.name}</div>
          <div style={{ fontSize: 12, color: C.slateLight }}>Tile at: {selectedHabit.location}</div>
        </div>
      </div>
      <div style={{ background: C.white, borderRadius: 20, padding: 20, marginBottom: 14, boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.slate, marginBottom: 4 }}>How many times per day?</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 24, marginTop: 12 }}>
          <button onClick={() => setTargetCount(t => Math.max(1, t - 1))} style={{ width: 44, height: 44, borderRadius: "50%", border: "none", background: C.offwhite, fontSize: 22, cursor: "pointer", color: C.slate }}>−</button>
          <div style={{ textAlign: "center", minWidth: 60 }}>
            <div style={{ fontSize: 48, fontWeight: 700, color: C.slate, fontFamily: "'DM Serif Display', serif", lineHeight: 1 }}>{targetCount}</div>
            <div style={{ fontSize: 11, color: C.slateLight, marginTop: 4 }}>{targetCount === 1 ? "time per day" : "times per day"}</div>
          </div>
          <button onClick={() => setTargetCount(t => Math.min(20, t + 1))} style={{ width: 44, height: 44, borderRadius: "50%", border: "none", background: C.offwhite, fontSize: 22, cursor: "pointer", color: C.slate }}>+</button>
        </div>
      </div>
      <div style={{ background: C.white, borderRadius: 20, padding: 16, marginBottom: 12, boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.slate, marginBottom: 4 }}>Points per completion</div>
        <div style={{ fontSize: 11, color: C.slateLight, marginBottom: 10 }}>Awarded each time this habit is done</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[5, 10, 15, 25, 50].map(p => (
            <div key={p} onClick={() => setHabitPoints(p)} style={{ padding: "8px 16px", borderRadius: 20, cursor: "pointer", fontSize: 13, fontWeight: 600, background: habitPoints === p ? C.accent : C.offwhite, color: habitPoints === p ? C.white : C.slate, border: `1.5px solid ${habitPoints === p ? C.accent : C.sandDark}` }}>{p} pts</div>
          ))}
        </div>
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
      <button
        disabled={isSubmitting}
        onClick={async () => {
          if (isSubmitting) return;
          setIsSubmitting(true);
          try {
            const assignedMemberIds = habitSelectedMembers.length === 0 ? null : habitSelectedMembers;
            await onAddHabit({ ...selectedHabit, target: targetCount, isShared: habitSelectedMembers.length === 0, assignedMemberIds, daysActive: habitDays, completionType: habitCompletionType, points: habitPoints });
            setTargetCount(1); setHabitIsShared(true); setHabitSelectedMembers([]); setHabitDays(null); setHabitCompletionType('individual'); setHabitPoints(10); setView("menu");
          } catch (e) {
            console.error('Failed to add habit:', e);
          } finally {
            setIsSubmitting(false);
          }
        }}
        style={{ ...btnPrimary, opacity: isSubmitting ? 0.7 : 1 }}
      >
        {isSubmitting ? "Adding…" : "Add to My Rituals"}
      </button>
    </div>
  );

  if (view === "rewards") {
    const REWARD_EMOJIS = ["🎁","🎮","🎬","🍕","🍦","🎪","🏖️","🎠","🎯","⭐","🏆","🎤","🎨","📚","🎭","🎡","🎢","🚀","🦄","🎂"];
    const activeRewards = (family.rewards || []).filter(r => r.status !== 'archived');
    const saveReward = async () => {
      if (!rewardForm.name.trim() || rewardForm.points < 1 || isSubmitting) return;
      setIsSubmitting(true);
      try {
        if (editingReward) {
          await onEditReward(editingReward.id, { ...rewardForm });
          setEditingReward(null);
        } else {
          await onAddReward({ ...rewardForm });
        }
        setRewardForm({ name: "", icon: "🎁", points: 10, who: "Everyone" });
      } catch (e) {
        console.error('Failed to save reward:', e);
      } finally {
        setIsSubmitting(false);
      }
    };
    return (
      <div style={{ padding: "0 20px 140px" }}>
        <button onClick={() => { onBack ? onBack() : setView("menu"); setEditingReward(null); setRewardForm({ name: "", icon: "🎁", points: 10, who: "Everyone" }); }} style={{ background: "none", border: "none", cursor: "pointer", color: C.slateLight, fontSize: 13, marginBottom: 16 }}>← Back</button>
        <div style={{ fontSize: 18, fontWeight: 700, color: C.slate, fontFamily: "'DM Serif Display', serif", marginBottom: 4 }}>Manage Rewards</div>
        <div style={{ fontSize: 12, color: C.slateLight, marginBottom: 20 }}>Create and edit rewards for your family</div>

        {/* Templates grid — only when adding */}
        {!editingReward && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.slateLight, letterSpacing: 0.5, marginBottom: 10 }}>TEMPLATES</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {REWARD_TEMPLATES.map((t, i) => (
                <div key={i} onClick={() => setRewardForm(f => ({ ...f, name: t.name, icon: t.icon, points: t.points, who: t.who }))} style={{ background: rewardForm.name === t.name && rewardForm.icon === t.icon ? `${C.accent}15` : C.offwhite, border: `1.5px solid ${rewardForm.name === t.name && rewardForm.icon === t.icon ? C.accent : "transparent"}`, borderRadius: 14, padding: "10px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 22 }}>{t.icon}</span>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: C.slate }}>{t.name}</div>
                    <div style={{ fontSize: 11, color: C.slateLight }}>{t.points} pts</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Add / Edit form */}
        <div style={{ background: C.white, borderRadius: 20, padding: 18, marginBottom: 16, boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.slate, marginBottom: 12 }}>{editingReward ? "Edit Reward" : "Add New Reward"}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            {REWARD_EMOJIS.map(e => (
              <div key={e} onClick={() => setRewardForm(f => ({ ...f, icon: e }))} style={{ width: 36, height: 36, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, cursor: "pointer", background: rewardForm.icon === e ? `${C.accent}20` : C.offwhite, border: `2px solid ${rewardForm.icon === e ? C.accent : "transparent"}` }}>{e}</div>
            ))}
          </div>
          <input style={{ ...inputStyle, marginBottom: 10 }} placeholder="Reward name (e.g. Movie night)" value={rewardForm.name} onChange={e => setRewardForm(f => ({ ...f, name: e.target.value }))} />
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.slateLight, letterSpacing: 0.5, marginBottom: 6 }}>POINTS COST</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {[10, 15, 20, 25, 30, 40, 50, 100].map(p => (
                  <div key={p} onClick={() => setRewardForm(f => ({ ...f, points: p }))} style={{ padding: "6px 12px", borderRadius: 20, cursor: "pointer", fontSize: 12, fontWeight: 600, background: rewardForm.points === p ? C.accent : C.offwhite, color: rewardForm.points === p ? C.white : C.slate, border: `1.5px solid ${rewardForm.points === p ? C.accent : C.sandDark}` }}>{p}</div>
                ))}
              </div>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.slateLight, letterSpacing: 0.5, marginBottom: 6 }}>WHO CAN REDEEM</div>
            <div style={{ display: "flex", gap: 8 }}>
              {["Everyone", "Kids"].map(w => (
                <div key={w} onClick={() => setRewardForm(f => ({ ...f, who: w }))} style={{ flex: 1, padding: "10px", borderRadius: 12, cursor: "pointer", textAlign: "center", fontSize: 13, fontWeight: 600, background: rewardForm.who === w ? `${C.accent}15` : C.offwhite, border: `1.5px solid ${rewardForm.who === w ? C.accent : "transparent"}`, color: rewardForm.who === w ? C.slate : C.slateLight }}>{w === "Everyone" ? "👥 Everyone" : "⭐ Kids only"}</div>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            {editingReward && <button onClick={() => { setEditingReward(null); setRewardForm({ name: "", icon: "🎁", points: 10, who: "Everyone" }); }} style={{ flex: 1, padding: 12, borderRadius: 14, border: "none", background: C.offwhite, fontSize: 13, color: C.slateLight, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>Cancel</button>}
            <button onClick={saveReward} disabled={isSubmitting || !rewardForm.name.trim()} style={{ ...btnPrimary, flex: 2, opacity: rewardForm.name.trim() && !isSubmitting ? 1 : 0.5 }}>{isSubmitting ? "Saving…" : editingReward ? "Save Changes" : "Add Reward"}</button>
          </div>
        </div>

        {/* Existing rewards list */}
        {activeRewards.length > 0 && (
          <div style={{ fontSize: 12, fontWeight: 600, color: C.slateLight, marginBottom: 10, letterSpacing: 0.5 }}>EXISTING REWARDS</div>
        )}
        {activeRewards.map((r, i) => (
          <div key={r.id || i} style={{ background: C.white, borderRadius: 16, padding: 14, marginBottom: 8, display: "flex", alignItems: "center", gap: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
            <div style={{ fontSize: 26 }}>{r.icon}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.slate }}>{r.name}</div>
              <div style={{ fontSize: 11, color: C.slateLight, marginTop: 1 }}>{r.who === "Kids" ? "⭐ Kids only" : "👥 Everyone"} · {r.points} pts</div>
            </div>
            <button onClick={() => { setEditingReward(r); setRewardForm({ name: r.name, icon: r.icon, points: r.points, who: r.who || "Everyone" }); }} style={{ background: "none", border: "none", cursor: "pointer", color: C.slateLight, fontSize: 16, padding: 4 }}>✎</button>
            <button onClick={() => { if (window.confirm(`Delete "${r.name}"?`)) onDeleteReward(r.id); }} style={{ background: "none", border: "none", cursor: "pointer", color: `${C.error}80`, fontSize: 16, padding: 4 }}>✕</button>
          </div>
        ))}
        {activeRewards.length === 0 && (
          <div style={{ background: C.white, borderRadius: 20, padding: 24, textAlign: "center", boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>🎁</div>
            <div style={{ fontSize: 13, color: C.slateLight }}>No rewards yet — add your first one above</div>
          </div>
        )}
      </div>
    );
  }

  return null;
}

// ─── INSIGHTS SCREEN ──────────────────────────────────────────────
function InsightsScreen({ habits, family, weekCompletions = [], currentMember, analyticsData, soloMode, forcePersonal }) {
  const [showFamily, setShowFamily] = useState(false);
  const members = family?.members || [];
  const kids = members.filter(m => m.isKid);

  // Filter completions by member when in "My Stats" mode
  // Also excludes completions for habits not assigned to this member
  const showingFamily = !forcePersonal && showFamily;

  const filteredWeek = useMemo(() => {
    if (showingFamily || !currentMember) return weekCompletions;
    return weekCompletions.filter(c => {
      if (c.memberId !== currentMember.id) return false;
      const habit = habits.find(h => h.id === c.habitId);
      if (!habit) return false;
      if (!habit.assignedMemberIds || habit.assignedMemberIds.length === 0) return true;
      return habit.assignedMemberIds.includes(currentMember.id);
    });
  }, [weekCompletions, currentMember, showingFamily, habits]);

  const filteredAnalytics = useMemo(() => {
    if (!analyticsData) return null;
    if (showingFamily || !currentMember) return analyticsData;
    return analyticsData.filter(c => {
      if (c.memberId !== currentMember.id) return false;
      const habit = habits.find(h => h.id === c.habitId);
      if (!habit) return false;
      if (!habit.assignedMemberIds || habit.assignedMemberIds.length === 0) return true;
      return habit.assignedMemberIds.includes(currentMember.id);
    });
  }, [analyticsData, currentMember, showingFamily, habits]);

  // ── Family Highlights ──────────────────────────────────────────
  const highlights = useMemo(() => {
    const tapsByMember = {};
    weekCompletions.forEach(c => { if (c.taps > 0) tapsByMember[c.memberId] = (tapsByMember[c.memberId] || 0) + c.taps; });
    const hero = [...members].sort((a, b) => (tapsByMember[b.id] || 0) - (tapsByMember[a.id] || 0))[0];

    const streakChamp = [...members].sort((a, b) => (b.streak || 0) - (a.streak || 0))[0];

    const earlyTaps = {}, nightTaps = {};
    weekCompletions.forEach(c => {
      if (!c.completedAt || c.taps <= 0) return;
      const rawTs = c.completedAt;
      const h = new Date(/Z|[+-]\d{2}:?\d{2}$/.test(rawTs) ? rawTs : rawTs + 'Z').getHours();
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

  // ── Time-of-day patterns (3 buckets covering full 24h) ────────
  const timePatterns = useMemo(() => {
    const counts = [0, 0, 0]; // Morning, Afternoon, Evening
    let total = 0;
    filteredWeek.forEach(c => {
      if (!c.completedAt || c.taps <= 0) return;
      const rawTs = c.completedAt;
      const h = new Date(/Z|[+-]\d{2}:?\d{2}$/.test(rawTs) ? rawTs : rawTs + 'Z').getHours();
      total++;
      if (h >= 6 && h < 12) counts[0]++;
      else if (h >= 12 && h < 18) counts[1]++;
      else counts[2]++; // 6pm–6am wraps midnight
    });
    const pct = i => total > 0 ? Math.round((counts[i] / total) * 100) : 0;
    return {
      total,
      buckets: [
        { label: "Morning", sublabel: "6am – 12pm", pct: pct(0), icon: "🌅" },
        { label: "Afternoon", sublabel: "12pm – 6pm", pct: pct(1), icon: "☀️" },
        { label: "Evening", sublabel: "6pm – 6am", pct: pct(2), icon: "🌙" },
      ],
    };
  }, [filteredWeek]);

  // ── Streak Watch ───────────────────────────────────────────────
  const streakWatch = useMemo(() => {
    const milestones = [3, 7, 10, 14, 21, 30, 50, 100];
    return members
      .map(m => {
        // Compute live streak from analytics history; fall back to DB value if data not yet loaded
        let s;
        if (analyticsData) {
          const dates = analyticsData.filter(c => c.memberId === m.id && c.taps > 0).map(c => c.date);
          s = calcStreakFromDates(dates);
        } else {
          s = m.streak || 0;
        }
        const next = milestones.find(ms => ms > s);
        return { member: m, streak: s, next, daysAway: next ? next - s : null };
      })
      .filter(x => x.streak > 0)
      .sort((a, b) => (a.daysAway || 999) - (b.daysAway || 999));
  }, [members, analyticsData]);

  // ── Your Weekly Summary (My Stats only) ───────────────────────
  const weeklySummary = useMemo(() => {
    if (!currentMember) return null;
    const myCompletions = weekCompletions.filter(c => c.memberId === currentMember.id && c.taps > 0);
    const todayIdx = getTodayIndex(); // Mon=0 … Sun=6

    // Include ALL habits available to the member — not just ones already started
    const myHabits = habits.filter(h => {
      if (!h.assignedMemberIds || h.assignedMemberIds.length === 0) return true;
      return h.assignedMemberIds.includes(currentMember.id);
    });

    // Denominator: elapsed possible completions per habit, accounting for daysActive and target
    let totalPossible = 0;
    myHabits.forEach(h => {
      const activeDays = h.daysActive; // Mon=0 array, or null = every day
      const elapsedActive = (!activeDays || activeDays.length === 0)
        ? (todayIdx + 1)
        : activeDays.filter(d => d <= todayIdx).length;
      totalPossible += Math.max(elapsedActive, 0) * (h.target || 1);
    });

    // Numerator: actual taps, capped at target per record
    const completed = myCompletions.reduce((sum, c) => {
      const habit = habits.find(h => h.id === c.habitId);
      return sum + Math.min(c.taps, habit?.target || 1);
    }, 0);

    const percentage = totalPossible > 0 ? Math.round((completed / totalPossible) * 100) : 0;

    // Best habit: rate = completions / habit-specific possible days
    const habitStats = myHabits.map(h => {
      const activeDays = h.daysActive;
      const elapsedActive = (!activeDays || activeDays.length === 0)
        ? (todayIdx + 1)
        : activeDays.filter(d => d <= todayIdx).length;
      const possible = Math.max(elapsedActive, 1) * (h.target || 1);
      const count = myCompletions.filter(c => c.habitId === h.id)
        .reduce((s, c) => s + Math.min(c.taps, h.target || 1), 0);
      return { name: h.name, icon: h.icon, rate: Math.round((count / possible) * 100) };
    }).sort((a, b) => b.rate - a.rate);

    // Live streak from analytics history (not stale DB value)
    const memberDates = analyticsData
      ? analyticsData.filter(c => c.memberId === currentMember.id && c.taps > 0).map(c => c.date)
      : weekCompletions.filter(c => c.memberId === currentMember.id && c.taps > 0).map(c => c.date);
    const streak = calcStreakFromDates(memberDates);

    return { completed, totalPossible, percentage, bestHabit: habitStats[0] || null, streak };
  }, [weekCompletions, habits, currentMember, analyticsData]);

  // ── Habit Health (needs analyticsData) ────────────────────────
  const habitHealth = useMemo(() => {
    if (!filteredAnalytics) return null;
    const weekDates = getWeekDates();
    const thisWeekStart = weekDates[0];
    // Fix #11: use isoAddDays to avoid UTC-parse timezone drift
    const lwEndStr = isoAddDays(weekDates[0], -1);   // last Sunday
    const lwStartStr = isoAddDays(weekDates[0], -7); // last Monday
    // Days elapsed so far this week (Mon=1 … Sun=7) — fixes mid-week deflation
    const daysElapsed = getTodayIndex() + 1;

    const visibleHabits = (!showingFamily && currentMember)
      ? habits.filter(h => !h.assignedMemberIds || h.assignedMemberIds.length === 0 || h.assignedMemberIds.includes(currentMember.id))
      : habits;
    return visibleHabits.map(h => {
      const thisWeek = filteredAnalytics.filter(c => c.habitId === h.id && c.date >= thisWeekStart && c.taps > 0);
      const lastWeek = filteredAnalytics.filter(c => c.habitId === h.id && c.date >= lwStartStr && c.date <= lwEndStr && c.taps > 0);
      // twRate uses days elapsed (not 7) so early-week rates are comparable to last week
      const twRate = thisWeek.length / daysElapsed;
      const lwRate = lastWeek.length / 7;
      // Relative % change: how much better/worse is this week's pace vs last week?
      const delta = lwRate > 0 ? Math.round(((twRate - lwRate) / lwRate) * 100) : null;
      const twPct = Math.round(twRate * 100);
      return { habit: h, thisWeekDays: thisWeek.length, lastWeekDays: lastWeek.length, delta, twPct, daysElapsed };
    }).filter(x => x.thisWeekDays > 0 || x.lastWeekDays > 0).slice(0, 6);
  }, [filteredAnalytics, habits, showingFamily, currentMember]);

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
    const myComps = showingFamily ? filteredAnalytics : filteredAnalytics.filter(c => c.memberId === currentMember.id);
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

    // Live streak per habit from analytics history (not stale DB value)
    const habitStreaks = habits.map(h => {
      const dates = filteredAnalytics
        ? filteredAnalytics.filter(c => c.habitId === h.id && c.taps > 0).map(c => c.date)
        : [];
      const streak = dates.length > 0 ? calcStreakFromDates(dates) : (h.streak || 0);
      return { habit: h, streak };
    }).filter(x => x.streak >= 3).sort((a, b) => b.streak - a.streak).slice(0, 2);

    return { thisWeekCount, allTimeRecord, previousRecord, isNewRecord, habitStreaks };
  }, [filteredAnalytics, currentMember, habits, showingFamily]);

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
    <div style={{ padding: "0 20px 140px" }}>
      {/* My Stats / Family toggle */}
      {!soloMode && !forcePersonal && (
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
      )}

      {/* 0. Your Weekly Summary (My Stats only) */}
      {!showingFamily && currentMember && weeklySummary && insightCard(<>
        {cardHeader("📊", "Your Weekly Summary", C.accent)}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 13, color: C.slateLight }}>Habits completed this week</span>
            <span style={{ fontWeight: 700, fontSize: 16, color: C.accent }}>
              {weeklySummary.completed} / {weeklySummary.totalPossible}
              <span style={{ fontSize: 12, fontWeight: 400, color: C.slateLight }}> ({weeklySummary.percentage}%)</span>
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 13, color: C.slateLight }}>Current streak</span>
            <span style={{ fontWeight: 700, fontSize: 16, color: C.warm }}>🔥 {weeklySummary.streak} days</span>
          </div>
          {weeklySummary.bestHabit && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 13, color: C.slateLight }}>Best habit this week</span>
              <span style={{ fontWeight: 600, fontSize: 13, color: C.green }}>
                {weeklySummary.bestHabit.icon} {weeklySummary.bestHabit.name} ({weeklySummary.bestHabit.rate}%)
              </span>
            </div>
          )}
          {weeklySummary.completed === 0 && (
            <div style={{ fontSize: 13, color: C.slateLight, fontStyle: "italic" }}>
              No completions yet this week — let's get started! 🌟
            </div>
          )}
        </div>
      </>)}

      {/* Kids: Weekly Tree Strip */}
      {!showingFamily && currentMember?.isKid && insightCard(<>
        {cardHeader("🌱", "This Week's Growth", C.accent)}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 4 }}>
          {getWeekDates().map((date, i) => {
            const dayDone = filteredWeek.filter(c => c.date === date && c.taps > 0).length;
            const dayHabits = habits.filter(h => !h.assignedMemberIds || h.assignedMemberIds.length === 0 || h.assignedMemberIds.includes(currentMember.id));
            const possible = dayHabits.length;
            const dayFillPct = possible > 0 ? dayDone / possible : 0;
            const barH = Math.round(dayFillPct * 28);
            const dayLabel = ["M","T","W","T","F","S","S"][i];
            const isToday = i === getTodayIndex();
            const leafColor = dayFillPct >= 1 ? "#F4B8A8" : dayFillPct > 0 ? "#9BC07A" : "#E5DED4";
            const fillColor = isToday ? "#7BA05B" : "#9BC07A";
            return (
              <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                <svg width="28" height="42" viewBox="0 0 28 42" xmlns="http://www.w3.org/2000/svg">
                  {/* Bar background (stem) */}
                  <rect x="10" y="8" width="8" height="28" rx="4" fill="#F0EDE6" />
                  {/* Fill from bottom */}
                  {barH > 0 && <rect x="10" y={8 + (28 - barH)} width="8" height={barH} rx="4" fill={fillColor} />}
                  {/* Leaf/blossom at top */}
                  <circle cx="14" cy="5" r="4" fill={leafColor} />
                </svg>
                <div style={{ fontSize: 9, fontWeight: isToday ? 700 : 400, color: isToday ? C.accent : C.slateLight }}>{dayLabel}</div>
              </div>
            );
          })}
        </div>
      </>)}

      {/* 1. Family Highlights (Family view only) */}
      {!soloMode && showingFamily && insightCard(<>
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
      {(() => {
        const toShow = showingFamily
          ? streakWatch.slice(0, 4)
          : streakWatch.filter(x => x.member.id === currentMember?.id);
        if (toShow.length === 0) return null;
        return insightCard(<>
          {cardHeader("🔥", showingFamily ? "Everyone's Streaks" : "Your Streaks", C.accent)}
          {toShow.map((x, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: i < toShow.length - 1 ? 10 : 0 }}>
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
        </>);
      })()}

      {/* 3. When You Work Best */}
      {insightCard(<>
        {cardHeader("⏰", showingFamily ? "When Your Family Works Best" : "When You Work Best", C.green)}
        {timePatterns.total === 0 ? (
          <div style={{ textAlign: "center", padding: "16px 0", color: C.slateLight, fontSize: 13, fontStyle: "italic" }}>
            Complete more habits to see when you're most productive! 🌟
          </div>
        ) : (
          timePatterns.buckets.map((t, i) => (
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
            else { icon = "✓"; label = `${x.thisWeekDays} of ${x.daysElapsed} days`; color = C.slateLight; }
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
          <div style={{ textAlign: "center", padding: "16px 0", color: C.slateLight, fontSize: 13, fontStyle: "italic" }}>
            Track habits for a week to see health trends! 📈
          </div>
        )}
      </>)}

      {/* 5. Kids Leaderboard (Family view only) */}
      {!soloMode && showingFamily && kidsBoard && insightCard(<>
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
        {cardHeader("🎉", showingFamily ? "Family Records" : "Personal Bests", C.accent)}
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
                  <div style={{ fontSize: 11, color: C.slateLight }}>Best (last 30 days): {personalBests.allTimeRecord} in a week</div>
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
          <div style={{ textAlign: "center", padding: "16px 0", color: C.slateLight, fontSize: 13, fontStyle: "italic" }}>
            Complete more habits to unlock achievements! 🎉
          </div>
        )}
      </>)}

      {/* Rewards section */}
      {family?.rewards?.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.slate, letterSpacing: 0.5, marginBottom: 12, textTransform: "uppercase" }}>Rewards</div>

          {/* Points balances */}
          <div style={{ background: C.white, borderRadius: 20, padding: 18, marginBottom: 12, boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 12 }}>Points Balance</div>
            {(family.members || []).map(m => {
              const topReward = [...(family.rewards || [])].sort((a, b) => a.points - b.points).find(r => r.points <= (m.points || 0));
              return (
                <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <div style={{ width: 32, height: 32, borderRadius: "50%", background: m.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: C.white, flexShrink: 0 }}>{m.avatar}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: C.slate }}>{m.name}</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.accent }}>{m.points || 0} pts</div>
                    </div>
                    {topReward && (
                      <div style={{ fontSize: 11, color: C.slateLight }}>Can redeem: {topReward.icon} {topReward.name}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Available rewards */}
          <div style={{ background: C.white, borderRadius: 20, padding: 18, marginBottom: 12, boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 12 }}>Available Rewards</div>
            {(family.rewards || []).filter(r => r.status !== 'inactive').map(r => {
              const affordable = (family.members || []).filter(m => (m.points || 0) >= r.points);
              return (
                <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10, paddingBottom: 10, borderBottom: `1px solid ${C.sandLight}` }}>
                  <div style={{ width: 40, height: 40, borderRadius: 12, background: `${r.color || C.accent}15`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>{r.icon}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.slate }}>{r.name}</div>
                    <div style={{ fontSize: 11, color: C.slateLight, marginTop: 2 }}>{r.points} pts · {r.who || "Everyone"}</div>
                  </div>
                  {affordable.length > 0 && (
                    <div style={{ fontSize: 11, fontWeight: 600, color: C.green, background: `${C.green}12`, padding: "4px 8px", borderRadius: 8, flexShrink: 0 }}>
                      {affordable.length === 1 ? `${affordable[0].name} can redeem` : `${affordable.length} can redeem`}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── HELP TOPICS (module-level so ManageScreen can also reference them) ──────
const HELP_TOPICS = [
    { id: "add-first", icon: "⊕", title: "Add a habit before anything else", content: `Your tiles don't do anything until you've connected them to a habit. Think of the tile as the button — but first you need to tell Ritual what that button does. Start simple: go to the Manage tab, pick a category, choose one habit, and save it. Then connect a tile. That's it — you're ready to go. Don't overthink your first habit. Pick something you already do most days and make it official.` },
    { id: "how-to-tap", icon: "◻", title: "How to tap a tile", content: `This trips people up the first time, so here's exactly what to do:\n\n1. Unlock your phone first — it won't work on a locked screen\n2. Hold the back of your phone near the tile — the reader sits near your camera\n3. Hold still for 1–2 seconds — don't wave it, just hold it close\n4. On iPhone: a small banner appears at the top — tap it\n5. On Android: a notification appears — tap it\n\nDoesn't work? Try moving your phone slightly up or down — every phone model is a little different. Make sure you're using the back of the phone, not the front.` },
    { id: "what-are-tiles", icon: <TileIcon size="16px" color="#555" />, title: "What are Ritual tiles?", content: `Ritual tiles use the same technology as tap-to-pay — the kind you use when you tap your card or phone at a checkout, or hold a key card to a hotel door. It's been around for years and is used billions of times every day around the world.\n\nThe tile itself does absolutely nothing on its own. No signal, no emission, nothing at all. It only activates for the one second your phone is held next to it. No batteries. No charging. Ever.\n\nAnd if you want to move a tile from one habit to another, you can — they're completely reusable.\n\nIs it safe? Completely. The tile is passive — it has no power source and emits nothing. It simply waits. That's actually what makes tiles such a clever and perfect fit for Ritual — safe enough to place anywhere in your home, yet reliable enough to work every single time.\n\nOne practical note: tiles come with adhesive backing and should be secured to a surface — a wall, door frame, or shelf works well. Keep them out of reach of young children who may want to put them in their mouths.\n\nWant to know more? Reach out to us at support@ritualhabits.com.au` },
    { id: "why-tiles", icon: "◈", title: "Why tiles work better than buttons", content: `Let's be honest — most habit apps don't work. You download them full of good intentions, tap a button for a few days, and then forget they exist.\n\nThe problem isn't you. It's that a button on a screen is easy to ignore. Physical objects are different.\n\nHabit researchers have found that things in specific places are among the most powerful triggers for automatic behaviour. When something exists in your space, your brain starts connecting "I'm here" with "I do this." That's the whole idea behind Ritual's tiles.\n\nPut the tile where the habit happens — by the bathroom sink, on the fridge, at the front door. Tap it every day and within a few weeks, the location itself becomes the reminder.\n\nResearch shows that people who linked habits to physical cues in their environment had 58% higher success rates than those who relied on app reminders alone. Your phone notification is easy to swipe away. A tile on your bathroom mirror is a lot harder to ignore.` },
    { id: "individual-vs-family", icon: "◉", title: "Individual vs family habits", content: `When you create a habit, you choose how it gets tracked.\n\nIndividual means each person tracks it separately. Good for personal habits where it matters who did it, not just that it got done. Example: Homework. One child finishing their homework doesn't count for another child. They each need their own completion.\n\nFamily/shared means one completion counts for everyone assigned. Good for household tasks where it doesn't matter who does it — just that it happened. Example: Feeding the dog. If one person feeds the dog, that counts for the whole family. You don't need everyone else to feed the dog again just to tick their box.\n\nWhen in doubt: if the habit is personal to one person, use Individual. If it's a household job anyone can do, use Family.` },
    { id: "kids", icon: "✦", title: "How kids work in Ritual", content: `Kids earn points the same way adults do — complete a habit, earn points. The main difference is with rewards.\n\nWhen a child redeems a reward, it doesn't just happen — it creates a request that a parent needs to fulfil.\n\nExample: Your child earns enough points for "Choose a movie night." They tap redeem on Friday morning. Their points are set aside straight away — they can't spend them on anything else. When Friday night comes, a parent opens the Family tab and marks it as fulfilled. Done.\n\nThis keeps parents in the loop and means kids can't redeem rewards without it actually happening in real life.\n\nOne other thing — when a tile is tapped on a habit that belongs to a child, the app asks "Who did this?" This is because kids often share devices, so Ritual checks rather than assumes.` },
    { id: "fixing-mistakes", icon: "↩", title: "Fixing mistakes", content: `Tapped by accident? Hold your finger on the completed habit card — a progress bar fills up and it undoes the tap.\n\nMissed a tap and not near your tile? Tap on the habit card to expand it, then look for "Don't have your tile with you?" and hold the button to complete it manually. We make this slightly inconvenient on purpose — the tile tap is the whole point — but life happens.\n\nWrong person got the credit? Undo the completion first (hold the habit card), then complete it again and select the right person.` },
    { id: "managing-tiles", icon: "↻", title: "Managing your tiles", content: `Each tile can only be connected to one habit at a time — but you can reassign them whenever you want.\n\nTo move a tile to a different habit: go to Manage → Manage Tiles, remove it from the current habit, then assign it to a new one. Takes about 30 seconds.\n\nTiles work permanently — no batteries, no Wi-Fi, no setup beyond the first tap. They're completely reusable, so if a habit changes, the tile changes with it. Look after them and they'll last for years.` },
];

// ─── SETTINGS SCREEN ──────────────────────────────────────────────
function SettingsScreen({ family, currentMember, onLogout, onRefresh, onManageTiles, onManageHabits, soundEnabled, onToggleSound, onReplayOnboarding, onToast, onEditMember, onRemoveMember }) {
  const [openHelp, setOpenHelp] = useState(null);
  const toggleHelp = (id) => setOpenHelp(prev => prev === id ? null : id);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editIsKid, setEditIsKid] = useState(false);
  const [editColor, setEditColor] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  // All adults (non-kids) can manage members — not just the family creator
  const isAdmin = !currentMember?.isKid;

  const startEdit = (m) => {
    setEditingId(m.id);
    setEditName(m.name);
    setEditIsKid(!!m.isKid);
    setEditColor(m.color || SETUP_MEMBER_COLORS[0]);
    setConfirmDeleteId(null);
  };
  const cancelEdit = () => setEditingId(null);
  const saveEdit = async () => {
    if (!editName.trim()) return;
    try {
      await onEditMember(editingId, { name: editName.trim(), isKid: editIsKid, color: editColor, avatar: editName.trim()[0].toUpperCase() });
      setEditingId(null);
      onToast("Member updated");
    } catch { onToast("❌ Failed to update member", "error"); }
  };
  const confirmDelete = (id) => setConfirmDeleteId(id);
  const doDelete = async (id) => {
    try {
      await onRemoveMember(id);
      setConfirmDeleteId(null);
      onToast("Member removed");
    } catch { onToast("❌ Failed to remove member", "error"); }
  };

  return (
    <div style={{ padding: "0 20px 140px" }}>
      <div style={{ background: C.white, borderRadius: 20, padding: 20, marginBottom: 12, boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.slateLight, letterSpacing: 1, textTransform: "uppercase", marginBottom: 12 }}>Family</div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 44, height: 44, borderRadius: "50%", background: `linear-gradient(135deg, ${C.accent}, ${C.accentLight})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700, color: C.white }}>{family.name[0].toUpperCase()}</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: C.slate }}>{family.name.charAt(0).toUpperCase() + family.name.slice(1)}</div>
            <div style={{ fontSize: 12, color: C.slateLight }}>PIN: {family.pin}</div>
          </div>
        </div>
      </div>

      <div style={{ background: C.white, borderRadius: 20, padding: 20, marginBottom: 12, boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.slateLight, letterSpacing: 1, textTransform: "uppercase", marginBottom: 12 }}>Members</div>
        {family.members.map((m, idx) => (
          <div key={m.id} style={{ paddingBottom: 10, marginBottom: 10, borderBottom: `1px solid ${C.sandLight}` }}>
            {/* confirm delete banner */}
            {confirmDeleteId === m.id && (
              <div style={{ background: `${C.error}10`, border: `1px solid ${C.error}30`, borderRadius: 10, padding: "10px 12px", marginBottom: 8 }}>
                <div style={{ fontSize: 13, color: C.slate, marginBottom: 8 }}>Remove <strong>{m.name}</strong>? This cannot be undone.</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => doDelete(m.id)} style={{ flex: 1, padding: "8px", borderRadius: 8, background: C.error, border: "none", color: C.white, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>Remove</button>
                  <button onClick={() => setConfirmDeleteId(null)} style={{ flex: 1, padding: "8px", borderRadius: 8, background: C.sandLight, border: "none", color: C.slate, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>Cancel</button>
                </div>
              </div>
            )}
            {editingId === m.id ? (
              /* inline edit form */
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <input
                  value={editName} onChange={e => setEditName(e.target.value)}
                  placeholder="Name"
                  style={{ padding: "10px 12px", borderRadius: 8, border: `1.5px solid ${C.sandLight}`, fontSize: 14, fontFamily: "'DM Sans', sans-serif", outline: "none", color: C.slate, background: "#F7F4EF" }}
                />
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 13, color: C.slateLight }}>Child account</span>
                  <div onClick={() => setEditIsKid(v => !v)} style={{ width: 40, height: 22, borderRadius: 11, cursor: "pointer", background: editIsKid ? C.accent : C.sandDark, position: "relative", transition: "background 0.2s" }}>
                    <div style={{ width: 18, height: 18, borderRadius: "50%", background: C.white, position: "absolute", top: 2, left: editIsKid ? 20 : 2, transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {SETUP_MEMBER_COLORS.map(c => (
                    <div key={c} onClick={() => setEditColor(c)} style={{ width: 26, height: 26, borderRadius: "50%", background: c, cursor: "pointer", border: editColor === c ? "2.5px solid #1E1C18" : "2.5px solid transparent", boxSizing: "border-box" }} />
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={saveEdit} style={{ flex: 1, padding: "9px", borderRadius: 8, background: C.accent, border: "none", color: C.white, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>Save</button>
                  <button onClick={cancelEdit} style={{ flex: 1, padding: "9px", borderRadius: 8, background: C.sandLight, border: "none", color: C.slate, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>Cancel</button>
                </div>
              </div>
            ) : (
              /* read row */
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: "50%", background: m.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: C.white, flexShrink: 0 }}>{m.avatar}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, color: C.slate, fontWeight: 500 }}>{m.name}{idx === 0 ? " 👑" : ""}</div>
                  <div style={{ fontSize: 11, color: C.slateLight }}>{m.isKid ? "Kid" : "Adult"} · {m.points || 0} pts · 🔥 {m.streak || 0}</div>
                </div>
                {isAdmin && (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => startEdit(m)} style={{ background: "none", border: "none", padding: "4px 6px", cursor: "pointer", fontSize: 14, color: C.slateLight, lineHeight: 1 }} title="Edit">✏️</button>
                    {idx !== 0 && (
                      <button onClick={() => confirmDelete(m.id)} style={{ background: "none", border: "none", padding: "4px 6px", cursor: "pointer", fontSize: 14, color: `${C.error}99`, lineHeight: 1 }} title="Remove">🗑</button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <button onClick={() => {
        if (window.confirm(`Sign out? You'll need your PIN to log back in.`)) { onLogout(); }
      }} style={{ width: "100%", padding: "14px", borderRadius: 16, border: `1.5px solid ${C.error}30`, background: `${C.error}10`, color: C.error, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", marginBottom: 12 }}>
        Sign Out
      </button>

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
          <TileIcon size="16px" style={{ marginRight: 4 }} /> Manage Tiles
        </button>
        <button onClick={async () => { try { await onRefresh(); } catch (e) { console.warn('Refresh failed:', e); } }} style={{ flex: 1, padding: "14px", borderRadius: 16, border: `1.5px solid ${C.green}30`, background: `${C.green}10`, color: C.green, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>
          🔄 Refresh Data
        </button>
      </div>
      <button onClick={onManageHabits} style={{ width: "100%", padding: "14px", borderRadius: 16, border: `1.5px solid ${C.slateLight}30`, background: `${C.slateLight}10`, color: C.slateLight, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", marginBottom: 12 }}>
        ✏️ Manage Habits
      </button>

      {/* Admin: Reset all points — hidden from kids */}
      {!currentMember?.isKid && (
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
              onToast("✅ Points and streaks reset to zero");
            } catch (err) {
              console.error("Reset failed:", err);
              onToast("❌ Reset failed — check console", "error");
            }
          }}
          style={{ width: "100%", padding: "12px 16px", background: C.error, border: "none", borderRadius: 12, color: C.white, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}
        >
          🔄 Reset All Points &amp; Streaks
        </button>
        {window.location.hostname === 'localhost' && (
          <button onClick={async () => {
            const res = await fetch('/api/cron-streaks');
            const data = await res.json();
            console.log(data);
            onToast("Cron test complete — check console");
          }} style={{ width: "100%", padding: "12px 16px", background: C.slateLight, border: "none", borderRadius: 12, color: C.white, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", marginTop: 8 }}>
            🔧 Test Streak Reset (dev only)
          </button>
        )}
        {(window.location.hostname === 'localhost' || window.location.search.includes('debug=true')) && (
          <button onClick={() => {
            localStorage.removeItem("ritual_savedPin");
            localStorage.removeItem("ritual_savedFamilyName");
            localStorage.removeItem("ritual_currentMemberId");
            localStorage.removeItem("ritual_soloMode");
            localStorage.removeItem("ritual_soundEnabled");
            window.location.reload();
          }} style={{ width: "100%", padding: "12px 16px", background: "#6366f1", border: "none", borderRadius: 12, color: C.white, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", marginTop: 8 }}>
            🧹 Clear all data &amp; sign out
          </button>
        )}
      </div>
      )}

      {/* Help section */}
      <div style={{ marginTop: 24 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: C.slate, marginBottom: 12 }}>How it works</div>
        {HELP_TOPICS.map(topic => (
          <div key={topic.id} style={{ marginBottom: 8, borderRadius: 14, border: `1.5px solid ${C.sandLight}`, overflow: "hidden", background: C.white }}>
            <button
              onClick={() => toggleHelp(topic.id)}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "16px", background: "none", border: "none", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", textAlign: "left" }}
            >
              <span style={{ fontSize: 16, flexShrink: 0, color: C.slate, display: "flex", alignItems: "center", lineHeight: 1 }}>{topic.icon}</span>
              <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: C.slate }}>{topic.title}</span>
              <span style={{ fontSize: 16, color: C.slateLight, transform: openHelp === topic.id ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>⌄</span>
            </button>
            {openHelp === topic.id && (
              <div style={{ padding: "0 16px 14px 16px", fontSize: 14, color: C.slateLight, lineHeight: 1.6 }}>
                {topic.content}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Replay onboarding — hidden admin link, adults only */}
      {!currentMember?.isKid && (
        <div style={{ textAlign: "center", marginTop: 16, paddingBottom: 4 }}>
          <button onClick={onReplayOnboarding} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: C.slateLight, opacity: 0.35, fontFamily: "'DM Sans', sans-serif", padding: "10px 16px", minHeight: 44 }}>
            Replay onboarding
          </button>
        </div>
      )}

    </div>
  );
}

// ─── MANAGE SCREEN ────────────────────────────────────────────────
function ManageScreen({
  family, currentMember, soloMode,
  habits,
  onAddHabit, onAssignTile, onRemoveTile, onEditHabit, onDeleteHabit,
  onAddReward, onEditReward, onDeleteReward,
  onLogout, onRefresh, soundEnabled, onToggleSound, onReplayOnboarding,
  onToast, onEditMember, onRemoveMember, onAddMember,
  initialSubView = "main",
  onMounted,
  initialEditHabitId,
}) {
  const [activeSubView, setActiveSubView] = useState(initialSubView);
  const [editingMemberId, setEditingMemberId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editIsKid, setEditIsKid] = useState(false);
  const [editColor, setEditColor] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [openHelp, setOpenHelp] = useState(null);
  const [newMemberName, setNewMemberName] = useState("");
  const [newMemberIsKid, setNewMemberIsKid] = useState(true);
  const [newMemberColor, setNewMemberColor] = useState(SETUP_MEMBER_COLORS[0]);
  const isAdmin = true; // Parents navigate kid profiles too — all manage functions accessible

  useEffect(() => { onMounted?.(); }, []);

  useEffect(() => {
    document.querySelector('.ritual-root')?.scrollTo(0, 0);
  }, [activeSubView]);

  const goBack = () => setActiveSubView("main");

  const startMemberEdit = (m) => {
    setEditingMemberId(m.id);
    setEditName(m.name);
    setEditIsKid(!!m.isKid);
    setEditColor(m.color || SETUP_MEMBER_COLORS[0]);
    setConfirmDeleteId(null);
    setActiveSubView("editMember");
  };

  const saveMemberEdit = async () => {
    if (!editName.trim()) return;
    try {
      await onEditMember(editingMemberId, { name: editName.trim(), isKid: editIsKid, color: editColor, avatar: editName.trim()[0].toUpperCase() });
      setActiveSubView("main");
      onToast("Member updated");
    } catch { onToast("❌ Failed to update member", "error"); }
  };

  const doDeleteMember = async (id) => {
    try {
      await onRemoveMember(id);
      setConfirmDeleteId(null);
      setActiveSubView("main");
      onToast("Member removed");
    } catch { onToast("❌ Failed to remove member", "error"); }
  };

  // ─── Sub-views ────────────────────────────────────────────────
  if (activeSubView === "manageTiles") {
    return <ManageTilesScreen habits={habits} onAssignTile={onAssignTile} onRemoveTile={onRemoveTile} onBack={goBack} />;
  }
  if (activeSubView === "habitsManage") {
    return <ManageHabitsScreen habits={habits} family={family} currentMember={currentMember} onEditHabit={onEditHabit} onDeleteHabit={onDeleteHabit} onBack={goBack} initialEditHabitId={initialEditHabitId} />;
  }
  if (activeSubView === "addRitual" || activeSubView === "custom" || activeSubView === "manageRewards") {
    const initView = activeSubView === "manageRewards" ? "rewards" : activeSubView;
    return <AddScreen family={family} currentMember={currentMember} onAddHabit={onAddHabit} habits={habits} onAssignTile={onAssignTile} onRemoveTile={onRemoveTile} onEditHabit={onEditHabit} onDeleteHabit={onDeleteHabit} onAddReward={onAddReward} onEditReward={onEditReward} onDeleteReward={onDeleteReward} initialView={initView} onBack={goBack} soloMode={soloMode} />;
  }
  if (activeSubView === "howItWorks") {
    return (
      <div style={{ padding: "0 20px 140px" }}>
        <div onClick={goBack} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", marginBottom: 20 }}>
          <span style={{ fontSize: 20, color: C.slateLight, lineHeight: 1 }}>‹</span>
          <span style={{ fontSize: 13, color: C.slateLight }}>Back</span>
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: C.slate, fontFamily: "'DM Serif Display', serif", marginBottom: 16 }}>How it works</div>
        {HELP_TOPICS.map(topic => (
          <div key={topic.id} style={{ marginBottom: 8, borderRadius: 14, border: `1.5px solid ${C.sandLight}`, overflow: "hidden", background: C.white }}>
            <button onClick={() => setOpenHelp(prev => prev === topic.id ? null : topic.id)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "16px", background: "none", border: "none", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", textAlign: "left" }}>
              <span style={{ fontSize: 16, flexShrink: 0, color: C.slate, display: "flex", alignItems: "center", lineHeight: 1 }}>{topic.icon}</span>
              <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: C.slate }}>{topic.title}</span>
              <span style={{ fontSize: 16, color: C.slateLight, transform: openHelp === topic.id ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>⌄</span>
            </button>
            {openHelp === topic.id && (
              <div style={{ padding: "0 16px 14px 44px", fontSize: 14, color: C.slateLight, lineHeight: 1.6, whiteSpace: "pre-line" }}>
                {topic.content}
              </div>
            )}
          </div>
        ))}
        {!currentMember?.isKid && (
          <div style={{ textAlign: "center", marginTop: 16, paddingBottom: 4 }}>
            <button onClick={onReplayOnboarding} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: C.slateLight, opacity: 0.35, fontFamily: "'DM Sans', sans-serif", padding: "10px 16px", minHeight: 44 }}>
              Replay onboarding
            </button>
          </div>
        )}
      </div>
    );
  }
  if (activeSubView === "editMember") {
    const m = family.members.find(x => x.id === editingMemberId);
    if (!m) { goBack(); return null; }
    const memberIdx = family.members.findIndex(x => x.id === m.id);
    return (
      <div style={{ padding: "0 20px 140px" }}>
        <div onClick={goBack} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", marginBottom: 20 }}>
          <span style={{ fontSize: 20, color: C.slateLight, lineHeight: 1 }}>‹</span>
          <span style={{ fontSize: 13, color: C.slateLight }}>Back</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24 }}>
          <div style={{ width: 44, height: 44, borderRadius: "50%", background: m.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700, color: C.white, flexShrink: 0 }}>{m.avatar}</div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.slate, fontFamily: "'DM Serif Display', serif" }}>Edit Member</div>
            <div style={{ fontSize: 12, color: C.slateLight, marginTop: 2 }}>{m.isKid ? "Kid" : "Adult"} · {m.points || 0} pts · 🔥 {m.streak || 0}</div>
          </div>
        </div>
        {confirmDeleteId === m.id && (
          <div style={{ background: `${C.error}10`, border: `1px solid ${C.error}30`, borderRadius: 10, padding: "10px 12px", marginBottom: 16 }}>
            <div style={{ fontSize: 13, color: C.slate, marginBottom: 8 }}>Remove <strong>{m.name}</strong>? This cannot be undone.</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => doDeleteMember(m.id)} style={{ flex: 1, padding: "8px", borderRadius: 8, background: C.error, border: "none", color: C.white, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>Remove</button>
              <button onClick={() => setConfirmDeleteId(null)} style={{ flex: 1, padding: "8px", borderRadius: 8, background: C.sandLight, border: "none", color: C.slate, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>Cancel</button>
            </div>
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input value={editName} onChange={e => setEditName(e.target.value)} placeholder="Name" style={{ ...inputStyle }} />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: C.white, borderRadius: 14, padding: "14px 16px", border: `1.5px solid ${C.sandDark}` }}>
            <span style={{ fontSize: 14, color: C.slate }}>Child account</span>
            <div onClick={() => setEditIsKid(v => !v)} style={{ width: 40, height: 22, borderRadius: 11, cursor: "pointer", background: editIsKid ? C.accent : C.sandDark, position: "relative", transition: "background 0.2s" }}>
              <div style={{ width: 18, height: 18, borderRadius: "50%", background: C.white, position: "absolute", top: 2, left: editIsKid ? 20 : 2, transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", background: C.white, borderRadius: 14, padding: "14px 16px", border: `1.5px solid ${C.sandDark}` }}>
            {SETUP_MEMBER_COLORS.map(col => (
              <div key={col} onClick={() => setEditColor(col)} style={{ width: 32, height: 32, borderRadius: "50%", background: col, cursor: "pointer", border: editColor === col ? "2.5px solid #1E1C18" : "2.5px solid transparent", boxSizing: "border-box" }} />
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={saveMemberEdit} style={{ flex: 2, padding: "13px", borderRadius: 14, background: C.accent, border: "none", color: C.white, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>Save Changes</button>
            <button onClick={goBack} style={{ flex: 1, padding: "13px", borderRadius: 14, background: C.sandLight, border: "none", color: C.slate, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>Cancel</button>
          </div>
          {isAdmin && memberIdx > 0 && (
            <button onClick={() => setConfirmDeleteId(m.id)} style={{ width: "100%", padding: "12px", borderRadius: 14, background: `${C.error}10`, border: `1px solid ${C.error}30`, color: C.error, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>
              Remove {m.name} from family
            </button>
          )}
        </div>
      </div>
    );
  }

  if (activeSubView === "addMember") {
    const saveNewMember = async () => {
      if (!newMemberName.trim()) return;
      try {
        await onAddMember({ name: newMemberName.trim(), isKid: newMemberIsKid, color: newMemberColor, avatar: newMemberName.trim()[0].toUpperCase() });
        setNewMemberName("");
        setNewMemberIsKid(true);
        setNewMemberColor(SETUP_MEMBER_COLORS[0]);
        setActiveSubView("main");
        onToast("Member added");
      } catch { onToast("❌ Failed to add member", "error"); }
    };
    return (
      <div style={{ padding: "0 20px 140px" }}>
        <div onClick={goBack} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", marginBottom: 20 }}>
          <span style={{ fontSize: 20, color: C.slateLight, lineHeight: 1 }}>‹</span>
          <span style={{ fontSize: 13, color: C.slateLight }}>Back</span>
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: C.slate, fontFamily: "'DM Serif Display', serif", marginBottom: 24 }}>Add Family Member</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input value={newMemberName} onChange={e => setNewMemberName(e.target.value)} placeholder="Name" style={{ ...inputStyle }} />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: C.white, borderRadius: 14, padding: "14px 16px", border: `1.5px solid ${C.sandDark}` }}>
            <span style={{ fontSize: 14, color: C.slate }}>Child account</span>
            <div onClick={() => setNewMemberIsKid(v => !v)} style={{ width: 40, height: 22, borderRadius: 11, cursor: "pointer", background: newMemberIsKid ? C.accent : C.sandDark, position: "relative", transition: "background 0.2s" }}>
              <div style={{ width: 18, height: 18, borderRadius: "50%", background: C.white, position: "absolute", top: 2, left: newMemberIsKid ? 20 : 2, transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", background: C.white, borderRadius: 14, padding: "14px 16px", border: `1.5px solid ${C.sandDark}` }}>
            {SETUP_MEMBER_COLORS.map(col => (
              <div key={col} onClick={() => setNewMemberColor(col)} style={{ width: 32, height: 32, borderRadius: "50%", background: col, cursor: "pointer", border: newMemberColor === col ? "2.5px solid #1E1C18" : "2.5px solid transparent", boxSizing: "border-box" }} />
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={saveNewMember} style={{ flex: 2, padding: "13px", borderRadius: 14, background: C.accent, border: "none", color: C.white, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>Add Member</button>
            <button onClick={goBack} style={{ flex: 1, padding: "13px", borderRadius: 14, background: C.sandLight, border: "none", color: C.slate, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Main view helpers ─────────────────────────────────────────
  const sectionLabel = (text) => (
    <div style={{ fontSize: 11, fontWeight: 700, color: C.slateLight, letterSpacing: 1.2, textTransform: "uppercase", marginTop: 24, marginBottom: 8 }}>{text}</div>
  );
  const settingsRow = (icon, iconBg, label, desc, onClick, opts = {}) => (
    <div onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 0", cursor: onClick ? "pointer" : "default", borderBottom: opts.last ? "none" : `1px solid ${C.sandLight}` }}>
      <div style={{ width: 32, height: 32, borderRadius: 9, background: iconBg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flexShrink: 0 }}>{icon}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: opts.danger ? C.error : C.slate }}>{label}</div>
        {desc && <div style={{ fontSize: 12, color: C.slateLight, marginTop: 2 }}>{desc}</div>}
      </div>
      {!opts.noChevron && <span style={{ color: C.sandDark, fontSize: 20, fontWeight: 300, lineHeight: 1 }}>›</span>}
    </div>
  );
  const card = (children) => (
    <div style={{ background: C.white, borderRadius: 20, padding: "0 16px", boxShadow: "0 2px 10px rgba(0,0,0,0.05)", border: "1px solid rgba(0,0,0,0.05)" }}>
      {children}
    </div>
  );

  // ─── Main view ────────────────────────────────────────────────
  return (
    <div style={{ padding: "0 20px 140px" }}>

      {/* RITUALS */}
      {sectionLabel("RITUALS")}
      {card(<>
        {settingsRow("◈", `${C.slate}20`, "Add a ritual", "Browse templates or create your own", () => setActiveSubView("addRitual"))}
        {settingsRow("✏️", `${C.slateLight}20`, "Manage habits", "Edit names, locations, targets or delete", () => setActiveSubView("habitsManage"), { last: true })}
      </>)}

      {/* TILES */}
      {sectionLabel("TILES")}
      {card(<>
        {settingsRow(<TileIcon size="15px" />, `${C.kidsBlue}20`, "Manage tiles", "Assign tiles to habits, detect new tiles", () => setActiveSubView("manageTiles"), { last: true })}
      </>)}

      {/* REWARDS — hidden in solo mode */}
      {!soloMode && <>
        {sectionLabel("REWARDS")}
        {card(<>
          {settingsRow("🎁", `${C.accent}20`, "Manage rewards", "Set up points rewards for your family", () => setActiveSubView("manageRewards"), { last: true })}
        </>)}
      </>}

      {/* FAMILY */}
      {sectionLabel("FAMILY")}
      {card(<>
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 0", borderBottom: `1px solid ${C.sandLight}` }}>
          <div style={{ width: 32, height: 32, borderRadius: "50%", background: `linear-gradient(135deg, ${C.accent}, ${C.accentLight})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: C.white, flexShrink: 0 }}>{family.name[0].toUpperCase()}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.slate }}>{family.name.charAt(0).toUpperCase() + family.name.slice(1)}</div>
            <div style={{ fontSize: 12, color: C.slateLight, marginTop: 1 }}>PIN: {family.pin}</div>
          </div>
        </div>
        {family.members.map((m, idx) => (
          <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 0", borderBottom: `1px solid ${C.sandLight}` }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: m.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: C.white, flexShrink: 0 }}>{m.avatar}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: C.slate }}>{m.name}{idx === 0 ? " 👑" : ""}</div>
              <div style={{ fontSize: 11, color: C.slateLight, marginTop: 1 }}>{m.isKid ? "Kid" : "Adult"} · {m.points || 0} pts · 🔥 {m.streak || 0}</div>
            </div>
            {isAdmin && (
              <div onClick={() => startMemberEdit(m)} style={{ fontSize: 13, color: C.accent, fontWeight: 600, cursor: "pointer", padding: "4px 4px 4px 8px" }}>Edit</div>
            )}
          </div>
        ))}
        {isAdmin && settingsRow("+", `${C.accent}20`, "Add family member", "Add a new kid or adult", () => setActiveSubView("addMember"), { last: true })}
      </>)}

      {/* PREFERENCES */}
      {sectionLabel("PREFERENCES")}
      {card(<>
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 0" }}>
          <div style={{ width: 32, height: 32, borderRadius: 9, background: `${C.green}20`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flexShrink: 0 }}>🔊</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.slate }}>Sound effects</div>
            <div style={{ fontSize: 12, color: C.slateLight, marginTop: 2 }}>Play sounds on habit completion</div>
          </div>
          <div onClick={onToggleSound} style={{ width: 46, height: 26, borderRadius: 13, cursor: "pointer", background: soundEnabled ? C.green : C.sandDark, position: "relative", transition: "background 0.2s ease", flexShrink: 0 }}>
            <div style={{ width: 22, height: 22, borderRadius: "50%", background: C.white, position: "absolute", top: 2, left: soundEnabled ? 22 : 2, transition: "left 0.2s ease", boxShadow: "0 1px 4px rgba(0,0,0,0.2)" }} />
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 0", borderTop: `1px solid ${C.sandLight}` }}>
          <div style={{ width: 32, height: 32, borderRadius: 9, background: C.sandLight, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flexShrink: 0 }}>🔔</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.slate }}>Push notifications</div>
            <div style={{ fontSize: 12, color: C.slateLight, marginTop: 2 }}>Reminders and alerts</div>
          </div>
          <div style={{ fontSize: 11, color: C.accent, fontWeight: 600, padding: "3px 10px", borderRadius: 12, background: `${C.accent}12`, flexShrink: 0 }}>Coming soon</div>
        </div>
      </>)}

      {/* ACCOUNT */}
      {sectionLabel("ACCOUNT")}
      {card(<>
        {settingsRow("↺", `${C.green}20`, "Refresh data", "Sync latest data from server", async () => { try { await onRefresh(); } catch (e) {} })}
        {settingsRow("→", `${C.error}15`, "Sign out", null, () => { if (window.confirm("Sign out? You'll need your PIN to log back in.")) onLogout(); }, { danger: true })}
        {settingsRow("⚠", `${C.error}15`, "Reset all points & streaks", "Cannot be undone — affects all members", async () => {
          if (!window.confirm("Reset all points and streaks to zero?\n\nThis will:\n- Set everyone's points to 0\n- Set all streaks to 0\n- Cannot be undone\n\nAre you sure?")) return;
          try {
            await supabase.from("members").update({ points: 0, streak: 0 }).eq('family_id', family.id);
            await supabase.from("habits").update({ streak: 0 }).eq('family_id', family.id);
            await onRefresh();
            onToast("✅ Points and streaks reset to zero");
          } catch (err) { onToast("❌ Reset failed", "error"); }
        }, { last: !window.location.hostname.includes('localhost') && !window.location.search.includes('debug=true'), danger: true })}
        {(window.location.hostname === 'localhost' || window.location.search.includes('debug=true')) && settingsRow("🧹", `${C.error}15`, "Clear all data & sign out", null, () => {
          localStorage.removeItem("ritual_savedPin"); localStorage.removeItem("ritual_savedFamilyName");
          localStorage.removeItem("ritual_currentMemberId"); localStorage.removeItem("ritual_soloMode");
          localStorage.removeItem("ritual_soundEnabled"); window.location.reload();
        }, { last: true, danger: true, noChevron: true })}
      </>)}

      {/* HELP */}
      {sectionLabel("HELP")}
      {card(<>
        {settingsRow("◉", `${C.warm}20`, "How it works", "Guides and FAQs", () => setActiveSubView("howItWorks"), { last: !isAdmin })}
        {isAdmin && settingsRow("▷", `${C.slateLight}20`, "Replay onboarding", "Walk through the intro again", onReplayOnboarding, { last: true })}
      </>)}

      {/* ABOUT */}
      {sectionLabel("ABOUT")}
      {card(<>
        {settingsRow("🔒", `${C.slateLight}20`, "Privacy Policy", null, async () => { try { await Browser.open({ url: "https://ritualhabits.com.au/privacy" }); } catch { window.open("https://ritualhabits.com.au/privacy", "_blank"); } })}
        {settingsRow("📄", `${C.slateLight}20`, "Terms of Use", null, async () => { try { await Browser.open({ url: "https://ritualhabits.com.au/terms" }); } catch { window.open("https://ritualhabits.com.au/terms", "_blank"); } })}
        {settingsRow("✉️", `${C.accent}20`, "Contact Us", "hello@ritualhabits.com.au", () => { window.location.href = "mailto:hello@ritualhabits.com.au"; }, { last: true })}
      </>)}
      <div style={{ textAlign: "center", marginTop: 24, padding: "0 16px" }}>
        <p style={{ fontSize: 11, color: C.slateLight, lineHeight: 1.5, margin: 0 }}>
          By using Ritual, you agree to our{" "}
          <span onClick={async () => { try { await Browser.open({ url: "https://ritualhabits.com.au/privacy" }); } catch { window.open("https://ritualhabits.com.au/privacy", "_blank"); } }} style={{ color: C.accent, cursor: "pointer", textDecoration: "underline" }}>Privacy Policy</span>
          {" "}and{" "}
          <span onClick={async () => { try { await Browser.open({ url: "https://ritualhabits.com.au/terms" }); } catch { window.open("https://ritualhabits.com.au/terms", "_blank"); } }} style={{ color: C.accent, cursor: "pointer", textDecoration: "underline" }}>Terms of Use</span>.
        </p>
        <p style={{ fontSize: 11, color: C.sandDark, marginTop: 8 }}>Ritual v1.0.35</p>
      </div>
    </div>
  );
}

// ─── ONBOARDING FLOW ──────────────────────────────────────────────
function OnboardingFlow({ currentMember, onComplete, soloMode }) {
  const totalSlides = 6;
  const [slide, setSlide] = useState(0);
  const [navCount, setNavCount] = useState(0);
  const touchStartX = useRef(null);

  const bg = `linear-gradient(135deg, ${C.slateDark}, ${C.slate})`;
  const dotColor = C.accent;
  const isLastSlide = slide === totalSlides - 1;

  const goNext = () => {
    if (slide < totalSlides - 1) { setSlide(s => s + 1); setNavCount(n => n + 1); }
  };
  const goPrev = () => {
    if (slide > 0) { setSlide(s => s - 1); setNavCount(n => n + 1); }
  };

  const handleTouchStart = (e) => { touchStartX.current = e.touches[0].clientX; };
  const handleTouchEnd = (e) => {
    if (touchStartX.current === null) return;
    const delta = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(delta) >= 50) { delta < 0 ? goNext() : goPrev(); }
    touchStartX.current = null;
  };
  const handleContainerClick = (e) => {
    if (e.target.tagName === "BUTTON" || e.target.closest?.("button")) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const w = rect.width;
    if (x < w * 0.4) goPrev();
    else if (x > w * 0.6) goNext();
  };

  const adultSlides = [
    // Slide 0 — Entry point: two paths
    <div key="a0" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, padding: "0 32px", textAlign: "center", gap: 28 }}>
      <div key={`a0i-${navCount}`} style={{ fontSize: 64, animation: "pulse 2.5s ease-in-out infinite", lineHeight: 1, color: C.white }}>✦</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 36, fontWeight: 700, color: C.white, fontFamily: D.fontHeading, lineHeight: 1.2, letterSpacing: "-0.03em" }}>Welcome to Ritual</div>
        <div style={{ fontSize: 15, color: "rgba(255,255,255,0.6)", lineHeight: 1.6, fontFamily: "'DM Sans', sans-serif" }}>{soloMode ? "Your habits. Your pace. Your ritual." : "Habit tracking for the whole family"}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%" }}>
        <button onClick={(e) => { e.stopPropagation(); goNext(); }} style={{ ...btnPrimary, pointerEvents: "auto" }}>New to Ritual? Let's get set up →</button>
        <button onClick={(e) => { e.stopPropagation(); onComplete(); }} style={{ background: "none", border: "none", fontSize: 13, color: "rgba(255,255,255,0.5)", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", padding: "10px 16px", minHeight: 44, textDecoration: "underline dotted" }}>Skip to app</button>
      </div>
    </div>,
    // Slide 1 — Welcome
    <div key="a1" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, padding: "0 32px", textAlign: "center", gap: 28 }}>
      <div key={`a1i-${navCount}`} style={{ fontSize: 64, animation: "pulse 2.5s ease-in-out infinite", lineHeight: 1, color: C.white }}>◈</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ fontSize: 36, fontWeight: 700, color: C.white, fontFamily: D.fontHeading, lineHeight: 1.2, letterSpacing: "-0.03em" }}>{soloMode ? "Build habits that stick" : "Build habits as a family"}</div>
        <div style={{ fontSize: 15, color: "rgba(255,255,255,0.7)", lineHeight: 1.6, fontFamily: "'DM Sans', sans-serif" }}>{soloMode
          ? "Ritual uses physical tiles placed around your home. Tap your phone to a tile and it logs instantly — no friction, no forgetting."
          : "Ritual uses physical tiles placed around your home. Tap your phone to a tile and the habit logs instantly — no app hunting, no friction."}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%" }}>
        <button onClick={(e) => { e.stopPropagation(); goNext(); }} style={{ ...btnPrimary, pointerEvents: "auto" }}>Next →</button>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", letterSpacing: 2, fontFamily: "'DM Sans', sans-serif", textTransform: "uppercase" }}>SWIPE TO SEE HOW IT WORKS</div>
      </div>
    </div>,
    // Slide 2 — How it works
    <div key="a2" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, padding: "0 32px", textAlign: "center", gap: 28 }}>
      <div key={`a2i-${navCount}`} style={{ animation: "popIn 0.4s cubic-bezier(0.34,1.56,0.64,1)", lineHeight: 1 }}><TileIcon size="64px" /></div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ fontSize: 36, fontWeight: 700, color: C.white, fontFamily: D.fontHeading, lineHeight: 1.2, letterSpacing: "-0.03em" }}>Tap a tile, done.</div>
        <div style={{ fontSize: 15, color: "rgba(255,255,255,0.7)", lineHeight: 1.6, fontFamily: "'DM Sans', sans-serif" }}>Every habit has a tile you place where it happens — by the bed, at the front door, in the kitchen. Tap your phone to it and the habit logs instantly.</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
        {[[<TileIcon size="13px" />, "tile"], ["📱", "tap"], ["✦", "logged"]].map(([icon, label], i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ padding: "8px 14px", borderRadius: 20, background: C.offwhite, fontSize: 13, color: C.slate, fontWeight: 600, fontFamily: "'DM Sans', sans-serif", display: "flex", alignItems: "center", gap: 5 }}>
              <span>{icon}</span><span>{label}</span>
            </div>
            {i < 2 && <span style={{ fontSize: 14, color: "rgba(255,255,255,0.4)" }}>→</span>}
          </div>
        ))}
      </div>
      <div style={{ width: "100%" }}>
        <button onClick={(e) => { e.stopPropagation(); goNext(); }} style={{ ...btnPrimary, pointerEvents: "auto", width: "100%" }}>Next →</button>
      </div>
    </div>,
    // Slide 3 — NEW: Let's build your first habit
    <div key="a3" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, padding: "0 32px", textAlign: "center", gap: 24 }}>
      <div key={`a3i-${navCount}`} style={{ fontSize: 64, animation: "popIn 0.4s cubic-bezier(0.34,1.56,0.64,1)", lineHeight: 1 }}>🛏️</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 36, fontWeight: 700, color: C.white, fontFamily: D.fontHeading, lineHeight: 1.2, letterSpacing: "-0.03em" }}>Let's build your first habit</div>
        <div style={{ fontSize: 15, color: "rgba(255,255,255,0.7)", lineHeight: 1.6, fontFamily: "'DM Sans', sans-serif" }}>Pick something small — something you already do — and make it official. Here's an easy one to start with:</div>
      </div>
      <div style={{ background: "rgba(255,255,255,0.12)", borderRadius: 20, padding: "14px 18px", width: "100%", display: "flex", alignItems: "center", gap: 12, textAlign: "left" }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: "rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>🛏️</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.white, fontFamily: "'DM Sans', sans-serif" }}>Make your bed</div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", fontFamily: "'DM Sans', sans-serif", marginTop: 2 }}>Bedroom · 10 pts</div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%" }}>
        <button onClick={(e) => { e.stopPropagation(); goNext(); }} style={{ ...btnPrimary, pointerEvents: "auto" }}>Next →</button>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", letterSpacing: 2, textTransform: "uppercase", fontFamily: "'DM Sans', sans-serif" }}>YOU CAN ADD THIS AND MORE ON THE NEXT SCREEN</div>
      </div>
    </div>,
    // Slide 4 — NEW: Connect a tile
    <div key="a4" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, padding: "0 32px", textAlign: "center", gap: 24 }}>
      <div key={`a4i-${navCount}`} style={{ animation: "popIn 0.4s cubic-bezier(0.34,1.56,0.64,1)", lineHeight: 1 }}>
        <svg width="64" height="64" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="marble" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" style={{ stopColor: "#F2EDE8", stopOpacity: 1 }} />
              <stop offset="40%" style={{ stopColor: "#EDE8E1", stopOpacity: 1 }} />
              <stop offset="100%" style={{ stopColor: "#E0D9D0", stopOpacity: 1 }} />
            </linearGradient>
          </defs>
          <polygon points="32,4 56,18 56,46 32,60 8,46 8,18" fill="url(#marble)" stroke="#C4B8A8" strokeWidth="2" />
          <polygon points="32,10 51,21 51,43 32,54 13,43 13,21" fill="none" stroke="#D8D0C4" strokeWidth="0.75" opacity="0.6" />
        </svg>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 36, fontWeight: 700, color: C.white, fontFamily: D.fontHeading, lineHeight: 1.2, letterSpacing: "-0.03em" }}>Now connect a tile</div>
        <div style={{ fontSize: 15, color: "rgba(255,255,255,0.7)", lineHeight: 1.6, fontFamily: "'DM Sans', sans-serif" }}>Place a tile where the habit happens — bedroom door, bathroom mirror, kitchen bench. Tap your phone to it once to link it.</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
        {[
          "Takes about 10 seconds to set up",
          "You can reassign any tile to a different habit any time",
          "No tile yet? You can skip this and add one later"
        ].map((text, i) => (
          <div key={i} style={{ background: "rgba(255,255,255,0.1)", borderRadius: 12, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, textAlign: "left" }}>
            <span style={{ color: C.accentLight, fontSize: 14, flexShrink: 0 }}>✦</span>
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.8)", fontFamily: "'DM Sans', sans-serif", lineHeight: 1.4 }}>{text}</span>
          </div>
        ))}
      </div>
      <div style={{ width: "100%" }}>
        <button onClick={(e) => { e.stopPropagation(); goNext(); }} style={{ ...btnPrimary, pointerEvents: "auto", width: "100%" }}>Next →</button>
      </div>
    </div>,
    // Slide 5 — NEW: You're ready (final slide with CTA)
    <div key="a5" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, padding: "0 32px", textAlign: "center", gap: 24 }}>
      <div key={`a5i-${navCount}`} style={{ fontSize: 64, animation: "pulse 2.5s ease-in-out infinite", lineHeight: 1, color: C.white }}>✦</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 36, fontWeight: 700, color: C.white, fontFamily: D.fontHeading, lineHeight: 1.2, letterSpacing: "-0.03em" }}>You're all set</div>
        <div style={{ fontSize: 15, color: "rgba(255,255,255,0.7)", lineHeight: 1.6, fontFamily: "'DM Sans', sans-serif" }}>{soloMode
          ? "Tap a tile and the habit logs instantly. Your streak grows. Your rituals become automatic."
          : "When someone taps a tile, you'll see who did it, their streak, and their points. The whole family in one place."}</div>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
        {[["🔥", "Streaks"], ["⭐", "Points"]].map(([icon, label], i) => (
          <div key={i} style={{ background: "rgba(255,255,255,0.15)", borderRadius: 20, padding: "6px 14px", fontSize: 12, color: C.white, fontWeight: 600, fontFamily: "'DM Sans', sans-serif", display: "flex", alignItems: "center", gap: 5 }}>
            <span>{icon}</span><span>{label}</span>
          </div>
        ))}
        {!soloMode && (
          <div style={{ background: "rgba(255,255,255,0.15)", borderRadius: 20, padding: "6px 14px", fontSize: 12, color: C.white, fontWeight: 600, fontFamily: "'DM Sans', sans-serif", display: "flex", alignItems: "center", gap: 5 }}>
            <span>👨‍👩‍👧</span><span>Family</span>
          </div>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, width: "100%", marginTop: 4 }}>
        <button onClick={(e) => { e.stopPropagation(); onComplete(); }} style={{ ...btnPrimary, width: "100%", pointerEvents: "auto" }}>Let's add your first ritual →</button>
        <button onClick={(e) => { e.stopPropagation(); onComplete(); }} style={{ background: "none", border: "none", fontSize: 12, color: "rgba(255,255,255,0.45)", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", padding: "8px 16px", minHeight: 44, textDecoration: "underline dotted" }}>I'll explore on my own</button>
      </div>
    </div>,
  ];

  const slides = adultSlides;

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 500, background: bg, display: "flex", flexDirection: "column", overflow: "hidden" }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onClick={handleContainerClick}
    >
      {/* Top nav: back + skip */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "max(20px, env(safe-area-inset-top)) 20px 12px", flexShrink: 0, position: "relative", zIndex: 10 }}>
        {slide > 0 ? (
          <button onClick={(e) => { e.stopPropagation(); goPrev(); }} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.6)", fontSize: 20, padding: "12px 8px", minHeight: 44, minWidth: 44, display: "flex", alignItems: "center", fontFamily: "'DM Sans', sans-serif" }}>←</button>
        ) : <div style={{ minWidth: 44, minHeight: 44 }} />}
        {!isLastSlide && slide !== 0 ? (
          <button onClick={(e) => { e.stopPropagation(); onComplete(); }} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.5)", fontSize: 13, fontWeight: 500, padding: "12px 8px", minHeight: 44, fontFamily: "'DM Sans', sans-serif" }}>Skip</button>
        ) : <div style={{ minWidth: 44, minHeight: 44 }} />}
      </div>

      {/* Carousel */}
      <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, display: "flex", transform: `translateX(-${slide * (100 / totalSlides)}%)`, transition: "transform 300ms ease", width: `${totalSlides * 100}%` }}>
          {slides.map((slideContent, i) => (
            <div key={i} style={{ width: `${100 / totalSlides}%`, flexShrink: 0, display: "flex", flexDirection: "column" }}>
              {slideContent}
            </div>
          ))}
        </div>
      </div>

      {/* Progress dots */}
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 8, padding: "16px 20px", paddingBottom: "calc(28px + env(safe-area-inset-bottom))", flexShrink: 0, position: "relative", zIndex: 10 }}>
        {Array.from({ length: totalSlides }, (_, i) => (
          <div key={i} onClick={(e) => { e.stopPropagation(); if (i !== slide) { setSlide(i); setNavCount(n => n + 1); } }} style={{ width: i === slide ? 20 : 8, height: 8, borderRadius: 4, background: i === slide ? dotColor : "rgba(255,255,255,0.35)", transition: "all 0.3s ease", cursor: "pointer" }} />
        ))}
      </div>
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
  const [showCelebration, setShowCelebration] = useState(false);
  const [celebratedDate, setCelebratedDate] = useState(null);
  const [mounted, setMounted] = useState(false);
  const tileHandled = useRef(null);
  const [unassignedTileUID, setUnassignedTileUID] = useState(null);
  const [deepLinkTileUID, setDeepLinkTileUID] = useState(null);
  const currentMemberRef = useRef(currentMember);
  useEffect(() => { currentMemberRef.current = currentMember; }, [currentMember]);
  const [manageInitialView, setManageInitialView] = useState("main");
  const [manageResetKey, setManageResetKey] = useState(0);
  const [editHabitId, setEditHabitId] = useState(null);
  const [soundEnabled, setSoundEnabled] = useState(() => localStorage.getItem("ritual_soundEnabled") !== "false");
  const [lastFetchDate, setLastFetchDate] = useState(() => todayKey());
  const [analyticsData, setAnalyticsData] = useState(null);
  const analyticsLastFetched = useRef(null);
  const [redemptions, setRedemptions] = useState([]);
  const redemptionsLastFetched = useRef(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [soloMode, setSoloMode] = useState(() => localStorage.getItem("ritual_soloMode") === "true");
  const toggleSoloMode = () => {
    const next = !soloMode;
    setSoloMode(next);
    localStorage.setItem("ritual_soloMode", String(next));
    if (next && tab === "family") setTab("today");
  };

  // ─── Toast notification system ──────────────────────────────────
  const [toasts, setToasts] = useState([]);
  const toastCounter = useRef(0);
  const addToast = useCallback((message, type = 'success') => {
    const id = ++toastCounter.current;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  }, []);

  // ─── Service Worker registration (PWA) ─────────────────────────
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js')
          .then(reg => console.log('SW registered:', reg.scope))
          .catch(err => console.warn('SW registration failed:', err));
      });
    }
  }, []);

  // ─── Capacitor native integrations ────────────────────────────
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    // Capgo: signal app is alive (belt-and-suspenders — primary call is in index.js)
    try {
      CapacitorUpdater.notifyAppReady();
      console.log('[Capgo] notifyAppReady() confirmed from App.js useEffect');
    } catch (e) {
      console.warn('[Capgo] notifyAppReady() failed in useEffect:', e);
    }

    // Capgo: lifecycle event listeners for diagnostics
    try {
      CapacitorUpdater.addListener('updateAvailable', (info) => {
        console.log('[Capgo] Update available:', info);
      });
      CapacitorUpdater.addListener('downloadComplete', (info) => {
        console.log('[Capgo] Download complete:', info);
      });
      CapacitorUpdater.addListener('downloadFailed', (info) => {
        console.error('[Capgo] Download failed:', info);
      });
      CapacitorUpdater.addListener('updateFailed', (info) => {
        console.error('[Capgo] Update failed:', info);
      });
      CapacitorUpdater.addListener('appReloaded', () => {
        console.log('[Capgo] App reloaded with new bundle');
      });
      console.log('[Capgo] Event listeners registered');
    } catch (e) {
      console.warn('[Capgo] Could not register event listeners:', e);
    }

    // Deep links: handle tile URLs opened via Universal Links
    try { CapApp.addListener('appUrlOpen', (event) => {
      try {
        let urlStr = event.url || '';
        // Ensure the URL has a protocol — NFC tags sometimes omit https://
        if (urlStr && !urlStr.includes('://')) urlStr = 'https://' + urlStr;
        const url = new URL(urlStr);
        const pathMatch = url.pathname.match(/^\/t\/(.+)$/);
        let raw = pathMatch ? decodeURIComponent(pathMatch[1]) : null;
        if (!raw) raw = url.searchParams.get('tile');
        if (raw) {
          // Normalise: strip colons and dots (tile UIDs may arrive as 04:A3:2B or 04.A3.2B)
          setDeepLinkTileUID(raw.replace(/[:.]/g, '').toUpperCase());
        }
      } catch (e) {
        // Silently ignore malformed URLs
      }
    }); } catch (e) { console.warn('[Capgo] appUrlOpen listener failed:', e); }

    // Push Notifications: request permission and register (wrapped in try/catch — must not crash app)
    try {
      PushNotifications.requestPermissions().then(result => {
        if (result.receive === 'granted') {
          PushNotifications.register();
        }
      }).catch(e => console.warn('[PushNotifications] requestPermissions failed:', e));

      PushNotifications.addListener('registration', token => {
        if (process.env.NODE_ENV === 'development') {
          console.log('Push registration success, token:', token.value);
        }
        const memberId = currentMemberRef.current?.id;
        if (memberId && supabase && token.value) {
          supabase.from('members').update({ push_token: token.value }).eq('id', memberId)
            .then(({ error }) => {
              if (error) console.error('❌ Failed to save push token:', error);
            }).catch(() => {});
        }
      });

      PushNotifications.addListener('pushNotificationReceived', notification => {
        if (process.env.NODE_ENV === 'development') {
          console.log('Push notification received:', notification);
        }
      });

      PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
        try {
          console.log('Push notification action performed:', notification);
        } catch (e) {
          console.error('pushNotificationActionPerformed error:', e);
        }
      });
    } catch (e) {
      console.warn('[PushNotifications] Init failed — continuing without push:', e);
    }
  }, []);

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

  // ─── myHabitsWithTaps: habits for Today tab, soloMode-aware ────
  const myHabitsWithTaps = useMemo(() => {
    if (!currentMember) return habitsWithTaps;
    return habits
      .filter(h => {
        if (soloMode && h.isKid) return false;
        if (soloMode && h.assignedMemberIds && h.assignedMemberIds.length > 0 && !h.assignedMemberIds.includes(currentMember.id)) return false;
        // Kids always see only their assigned habits, regardless of soloMode
        if (currentMember.isKid && h.assignedMemberIds && h.assignedMemberIds.length > 0 && !h.assignedMemberIds.includes(currentMember.id)) return false;
        if (h.daysActive && h.daysActive.length > 0 && !h.daysActive.includes(todayIndex)) return false;
        return true;
      })
      .map(h => {
        if (soloMode) {
          const myCompletions = todayCompletions.filter(c => c.habitId === h.id && c.memberId === currentMember.id);
          const myTaps = myCompletions.reduce((sum, c) => sum + c.taps, 0);
          const topCompletion = [...myCompletions].sort((a, b) => b.taps - a.taps)[0];
          return { ...h, taps: myTaps, completedById: topCompletion?.memberId || null, completedBy: topCompletion ? family?.members?.find(m => m.id === topCompletion.memberId)?.name : null };
        } else {
          const allCompletions = todayCompletions.filter(c => c.habitId === h.id);
          const totalTaps = allCompletions.reduce((sum, c) => sum + c.taps, 0);
          const topCompletion = [...allCompletions].sort((a, b) => b.taps - a.taps)[0];
          return { ...h, taps: totalTaps, completedById: topCompletion?.memberId || null, completedBy: topCompletion ? family?.members?.find(m => m.id === topCompletion.memberId)?.name : null };
        }
      });
  }, [habits, todayCompletions, currentMember, family?.members, soloMode, todayIndex, habitsWithTaps]);

  // ─── weekData: compute from completions, soloMode-aware (#4) ────
  const weekData = useMemo(() => {
    if (habits.length === 0) return [null, null, null, null, null, null, null];
    const weekDates = getWeekDates();
    const result = Array(7).fill(null);
    if (soloMode && currentMember) {
      // Solo mode: show only this member's personal completions
      const myHabitIds = new Set(habits
        .filter(h => !h.isKid && (!h.assignedMemberIds?.length || h.assignedMemberIds.includes(currentMember.id)))
        .map(h => h.id));
      const denominator = Math.max(myHabitIds.size, 1);
      // Today: count from myHabitsWithTaps (already filtered to member)
      const todayDone = myHabitsWithTaps.filter(h => (h.taps || 0) >= (h.target || 1)).length;
      result[todayIndex] = Math.round((todayDone / denominator) * 100);
      // Past days: filter completions to this member's habits only
      for (let i = 0; i < todayIndex; i++) {
        const dateStr = weekDates[i];
        const dayCompletions = weekCompletions.filter(c => c.date === dateStr && c.memberId === currentMember.id && c.taps > 0 && myHabitIds.has(c.habitId));
        result[i] = Math.round((dayCompletions.length / denominator) * 100);
      }
    } else {
      // Family mode: household aggregate (any habit done by anyone)
      const todayDone = habitsWithTaps.filter(h => (h.taps || 0) >= (h.target || 1)).length;
      result[todayIndex] = Math.round((todayDone / habits.length) * 100);
      for (let i = 0; i < todayIndex; i++) {
        const dateStr = weekDates[i];
        const dayCompletions = weekCompletions.filter(c => c.date === dateStr);
        const completedIds = new Set(dayCompletions.filter(c => c.taps > 0).map(c => c.habitId));
        result[i] = Math.round((completedIds.size / habits.length) * 100);
      }
    }
    return result;
  }, [habitsWithTaps, myHabitsWithTaps, habits, weekCompletions, todayIndex, soloMode, currentMember]);

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
        }).catch(() => {});
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
    if (analyticsData && analyticsLastFetched.current && now - analyticsLastFetched.current < ANALYTICS_CACHE_MS) return;
    fetchAnalyticsData(family.id).then(data => {
      setAnalyticsData(data);
      analyticsLastFetched.current = Date.now();
    }).catch(() => {});
  }, [tab, family]); // intentionally excludes analyticsData/analyticsLastFetched (refs/stable)

  // ─── Redemptions lazy-load (family tab) ─────────────────────────
  useEffect(() => {
    if (tab !== 'family' || !family || !supabase) return;
    const now = Date.now();
    if (redemptionsLastFetched.current && now - redemptionsLastFetched.current < REDEMPTION_CACHE_MS) return;
    supabase.from('reward_redemptions')
      .select('*')
      .eq('family_id', family.id)
      .eq('status', 'pending')
      .order('redeemed_at', { ascending: false })
      .then(({ data }) => {
        setRedemptions(data || []);
        redemptionsLastFetched.current = Date.now();
      }).catch(() => {});
  }, [tab, family]);

  // ─── Load family data after login ───────────────────────────────
  const loadDataForFamily = async (familyData) => {
    setFamily(familyData);
    setHabits(familyData.habits || []);
    const savedMemberId = localStorage.getItem("ritual_currentMemberId");
    const savedMember = familyData.members?.find(m => m.id === savedMemberId);
    const activeMember = savedMember || familyData.members?.[0] || null;
    setCurrentMember(activeMember);
    if (activeMember && !activeMember.onboardingComplete) {
      const isReturning = activeMember.createdAt &&
        (Date.now() - new Date(activeMember.createdAt).getTime()) > 24 * 60 * 60 * 1000;
      const activeMemberIsAdmin = familyData.members?.[0]?.id === activeMember.id;
      if (isReturning || (activeMember.isKid && !activeMemberIsAdmin)) {
        supabase?.from("members").update({ onboarding_complete: true }).eq("id", activeMember.id).then(null, () => {});
      } else {
        setShowOnboarding(true);
      }
    }
    if (supabase) {
      try {
        const [todayData, weekData] = await Promise.all([
          fetchTodayCompletions(familyData.id),
          fetchWeekCompletions(familyData.id),
        ]);
        setTodayCompletions(todayData);
        setWeekCompletions(weekData);
      } catch (e) {
        console.error("❌ Completions fetch failed, retrying:", e);
        setTimeout(async () => {
          try {
            const [todayData, weekData] = await Promise.all([
              fetchTodayCompletions(familyData.id),
              fetchWeekCompletions(familyData.id),
            ]);
            setTodayCompletions(todayData);
            setWeekCompletions(weekData);
          } catch (e2) {
            console.error("❌ Completions retry also failed:", e2);
          }
        }, 2000);
      }
    }
  };

  // ─── Auto-login on mount ─────────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      try {
        const savedPin = localStorage.getItem("ritual_savedPin");
        const savedFamilyName = localStorage.getItem("ritual_savedFamilyName");
        if (savedPin && savedFamilyName && supabase) {
          const familyData = await fetchFamilyData(savedPin, savedFamilyName);
          if (familyData) { await loadDataForFamily(familyData); return; }
          console.warn("⚠️ Saved credentials invalid, clearing");
          localStorage.removeItem("ritual_savedPin");
          localStorage.removeItem("ritual_savedFamilyName");
        } else if (savedPin) {
          // Migration: old session without family name — force re-login
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
    try {
      await loadDataForFamily(familyData);
      setSoloMode(localStorage.getItem("ritual_soloMode") === "true");
    } catch (e) {
      console.error('❌ handleLogin error:', e);
    }
  };

  const completeOnboarding = () => {
    const isFirstTime = !currentMember?.onboardingComplete;
    if (currentMember?.id && supabase) {
      supabase.from("members").update({ onboarding_complete: true }).eq("id", currentMember.id).then(null, () => {});
      setCurrentMember(m => ({ ...m, onboardingComplete: true }));
      setFamily(f => ({ ...f, members: f.members.map(m => m.id === currentMember.id ? { ...m, onboardingComplete: true } : m) }));
    }
    setShowOnboarding(false);
    if (!currentMember?.isKid && isFirstTime) setTab("manage");
  };

  const handleLogout = () => {
    setFamily(null); setHabits([]); setTodayCompletions([]); setWeekCompletions([]);
    setCurrentMember(null); setFlashData(null); setWhoDidThis(null);
    setSoloMode(false);
    localStorage.removeItem("ritual_savedPin"); localStorage.removeItem("ritual_savedFamilyName"); localStorage.removeItem("ritual_currentMemberId");
    localStorage.removeItem("ritual_soloMode");
  };

  const handleComplete = async (habitId, member, fromDigital) => {
    const habit = habitsWithTaps.find(h => h.id === habitId);
    if (!habit) return;

    // ── Resolve who completed this habit (#6, #7) ──────────────────
    // Logic mirrors tile-tap: ask WhoDidThis for kid/unassigned/multi-person habits;
    // auto-assign individual habits to their single assigned member.
    let resolvedMember = member;
    if (!resolvedMember) {
      const ids = habit.assignedMemberIds;
      const askWho = !soloMode && (
        habit.isKid ||          // kid habit always asks
        !ids ||                 // unassigned = everyone
        ids.length === 0 ||     // unassigned = everyone
        ids.length > 1          // multi-person habit
      );
      if (askWho) { setWhoDidThis(habit); return; }
      // Individual habit assigned to exactly one specific member: auto-assign (#6)
      if (ids?.length === 1 && ids[0] !== currentMember?.id) {
        resolvedMember = family?.members?.find(m => m.id === ids[0]) || currentMember;
      } else {
        resolvedMember = currentMember;
      }
    }

    const today = todayKey();
    // Fix #13: use this member's own tap count, not the family aggregate from habit.taps
    const memberCompletion = todayCompletions.find(c => c.habitId === habitId && c.memberId === resolvedMember?.id);
    const memberCurrentTaps = memberCompletion?.taps || 0;
    const memberNewTaps = memberCurrentTaps + 1;
    // Display taps = aggregate + 1, used for flash animation and UI "done" check
    const displayTaps = (habit.taps || 0) + 1;

    // Optimistic update first (instant UI feedback)
    setTodayCompletions(prev => {
      const existing = prev.find(c => c.habitId === habitId && c.memberId === resolvedMember?.id);
      if (existing) return prev.map(c => c.habitId === habitId && c.memberId === resolvedMember?.id ? { ...c, taps: c.taps + 1 } : c);
      return [...prev, { id: `opt_${Date.now()}`, habitId, memberId: resolvedMember?.id, familyId: family.id, date: today, taps: 1 }];
    });
    const habitPointValue = habit.points || 10;
    if (resolvedMember) {
      setFamily(f => ({ ...f, members: f.members.map(m => m.id === resolvedMember.id ? { ...m, points: (m.points || 0) + habitPointValue } : m) }));
      // Fix #2: keep currentMember in sync so KidsTreeView points badge updates live
      if (currentMember?.id === resolvedMember.id) {
        setCurrentMember(m => ({ ...m, points: (m.points || 0) + habitPointValue }));
      }
    }
    setWhoDidThis(null);
    setFlashData({ habit: { ...habit, taps: displayTaps }, member: resolvedMember });

    // All-done celebration: check if this completion finishes every habit for the current member today
    if (myHabitsWithTaps.length > 0 && celebratedDate !== today) {
      const newTaps = (habit.taps || 0) + 1;
      if (newTaps >= (habit.target || 1)) {
        const othersDone = myHabitsWithTaps.filter(h => h.id !== habitId).every(h => (h.taps || 0) >= (h.target || 1));
        if (othersDone) {
          setCelebratedDate(today);
          triggerHaptic("milestone");
          setTimeout(() => setShowCelebration(true), 2700);
        }
      }
    }

    // Await Supabase sync (ensures multi-device consistency)
    if (supabase && resolvedMember) {
      // Fix #13: upsert uses per-member tap count, not aggregate
      const { error } = await supabase.from("completions").upsert(
        { habit_id: habitId, member_id: resolvedMember.id, family_id: family.id, date: today, taps: memberNewTaps },
        { onConflict: "habit_id,member_id,date" }
      );
      if (error) console.error("❌ Completion sync failed:", error);

      // Shared/household habit: sync same tap count to all other assigned members
      if (habit.completionType === 'shared' && habit.assignedMemberIds && habit.assignedMemberIds.length > 0) {
        const otherMembers = habit.assignedMemberIds.filter(id => id !== resolvedMember.id);
        if (otherMembers.length > 0) {
          const sharedCompletions = otherMembers.map(memberId => ({
            habit_id: habitId, member_id: memberId, family_id: family.id, date: today, taps: memberNewTaps,
          }));
          await supabase.from("completions").upsert(sharedCompletions, { onConflict: 'habit_id,member_id,date' });
          setTodayCompletions(prev => {
            let updated = [...prev];
            otherMembers.forEach(memberId => {
              const idx = updated.findIndex(c => c.habitId === habitId && c.memberId === memberId);
              if (idx >= 0) { updated[idx] = { ...updated[idx], taps: memberNewTaps }; }
              else { updated.push({ id: `opt_shared_${Date.now()}_${memberId}`, habitId, memberId, familyId: family.id, date: today, taps: memberNewTaps }); }
            });
            return updated;
          });
        }
      }

      // Read fresh points from DB before writing to avoid stale-overwrite race condition
      const { data: freshMember } = await supabase.from("members").select("points").eq("id", resolvedMember.id).single();
      const freshPoints = freshMember?.points ?? (resolvedMember.points || 0);
      const { error: pe } = await supabase.from("members").update({ points: freshPoints + habitPointValue }).eq("id", resolvedMember.id);
      if (pe) console.error("❌ Points sync failed:", pe);

      // Streak logic: only on first tap of this habit by this member today
      if (memberCurrentTaps === 0) {
        const { data: yComp } = await supabase.from("completions").select("id").eq("habit_id", habitId).eq("date", getYesterdayKey()).maybeSingle();
        const newHabitStreak = yComp ? (habit.streak || 0) + 1 : 1;
        await supabase.from("habits").update({ streak: newHabitStreak }).eq("id", habitId);
        setHabits(prev => prev.map(h => h.id === habitId ? { ...h, streak: newHabitStreak } : h));

        // Member streak: only on their very first completion of ANY habit today (#3 fix: === 0 not <= 1)
        const memberTodayCount = todayCompletions.filter(c => c.memberId === resolvedMember.id).length;
        if (memberTodayCount === 0) {
          const { data: mYest } = await supabase.from("completions").select("id").eq("member_id", resolvedMember.id).eq("date", getYesterdayKey()).limit(1).maybeSingle();
          const newMemberStreak = mYest ? (resolvedMember.streak || 0) + 1 : 1;
          await supabase.from("members").update({ streak: newMemberStreak }).eq("id", resolvedMember.id);
          setFamily(f => ({ ...f, members: f.members.map(m => m.id === resolvedMember.id ? { ...m, streak: newMemberStreak } : m) }));
          // Fix #2: sync currentMember streak so KidsTreeView badge updates live
          if (currentMember?.id === resolvedMember.id) {
            setCurrentMember(m => ({ ...m, streak: newMemberStreak }));
          }
        }
      }
    }
  };

  const handleUndo = async (habitId) => {
    const habit = habitsWithTaps.find(h => h.id === habitId);
    if (!habit) return;
    const habitPointValue = habit.points || 10;
    const completedById = habit.completedById;
    const memberToDeduct = completedById ? family?.members?.find(m => m.id === completedById) : currentMember;
    const newTaps = Math.max((habit.taps || 0) - 1, 0);
    const isSharedHabit = habit.completionType === 'shared' && habit.assignedMemberIds && habit.assignedMemberIds.length > 0;

    // Optimistic local update: decrement trigger member
    setTodayCompletions(prev => prev.map(c =>
      c.habitId === habitId && c.memberId === completedById ? { ...c, taps: Math.max(c.taps - 1, 0) } : c
    ));
    if (memberToDeduct) {
      setFamily(f => ({ ...f, members: f.members.map(m => m.id === memberToDeduct.id ? { ...m, points: Math.max((m.points || 0) - habitPointValue, 0) } : m) }));
    }

    // Optimistic local update: decrement other assigned members for shared habits
    if (isSharedHabit) {
      const otherMembers = habit.assignedMemberIds.filter(id => id !== (completedById || memberToDeduct?.id));
      if (otherMembers.length > 0) {
        setTodayCompletions(prev => prev.map(c =>
          c.habitId === habitId && otherMembers.includes(c.memberId) ? { ...c, taps: Math.max(c.taps - 1, 0) } : c
        ));
      }
    }

    const undoMemberId = completedById || memberToDeduct?.id;
    if (supabase && undoMemberId) {
      const today = todayKey();
      const { error } = await supabase.from("completions").upsert(
        { habit_id: habitId, member_id: undoMemberId, family_id: family.id, date: today, taps: newTaps },
        { onConflict: "habit_id,member_id,date" }
      );
      if (error) console.error("❌ Undo sync failed:", error);

      // Shared/household habit: sync decremented taps to all other assigned members
      if (isSharedHabit) {
        const otherMembers = habit.assignedMemberIds.filter(id => id !== undoMemberId);
        if (otherMembers.length > 0) {
          const sharedUndos = otherMembers.map(memberId => ({
            habit_id: habitId, member_id: memberId, family_id: family.id, date: today, taps: newTaps,
          }));
          await supabase.from("completions").upsert(sharedUndos, { onConflict: 'habit_id,member_id,date' });
        }
      }

      if (memberToDeduct) {
        // Read fresh points to avoid stale-overwrite race condition
        const { data: freshMember } = await supabase.from("members").select("points").eq("id", memberToDeduct.id).single();
        const freshPoints = freshMember?.points ?? (memberToDeduct.points || 0);
        const { error: pe } = await supabase.from("members").update({ points: Math.max(freshPoints - habitPointValue, 0) }).eq("id", memberToDeduct.id);
        if (pe) console.error("❌ Points undo failed:", pe);
      }
    }
  };

  const handleAddHabit = async (h) => {
    const tempId = `temp_${Date.now()}`;
    const tempHabit = {
      id: tempId, familyId: family?.id, name: h.name.trim(), icon: h.icon,
      category: h.category, categoryId: h.categoryId, color: h.color,
      location: h.location, target: h.target || 1, streak: 0,
      isKid: h.isKid || false, isCustom: h.isCustom || false, tileUid: null,
      isShared: h.isShared ?? true,
      assignedMemberIds: h.assignedMemberIds || null,
      daysActive: h.daysActive || null,
      completionType: h.completionType || 'individual',
      points: h.points || 10,
      reminderTime: h.reminderTime || null,
    };
    setHabits(prev => [...prev, tempHabit]);
    if (supabase && family) {
      const { data, error } = await supabase.from("habits").insert({
        family_id: family.id, name: h.name.trim(), icon: h.icon,
        category: h.category, category_id: h.categoryId, color: h.color,
        location: h.location || null, target: h.target || 1, streak: 0,
        is_kid: h.isKid || false, is_custom: h.isCustom || false, is_shared: h.isShared ?? true,
        assigned_member_ids: h.assignedMemberIds || null,
        days_active: h.daysActive || null,
        completion_type: h.completionType || 'individual',
        points: h.points || 10,
        reminder_time: h.reminderTime || null,
      }).select().single();
      if (data) {
        setHabits(prev => prev.map(x => x.id === tempId ? normalizeHabit(data) : x));
        addToast(`✓ "${h.name.trim()}" added to your rituals`);
      } else {
        console.error("❌ Add habit failed:", error);
        setHabits(prev => prev.filter(x => x.id !== tempId));
        addToast(`Failed to add habit: ${error?.message || 'unknown error'}`, 'error');
      }
    } else {
      addToast(`✓ "${h.name.trim()}" added to your rituals`);
    }
    setTab("today");
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
      if ('points' in updates) dbUpdates.points = updates.points || 10;
      if ('reminderTime' in updates) dbUpdates.reminder_time = updates.reminderTime || null;
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
    setWeekCompletions(prev => prev.filter(c => c.habitId !== habitId));
    if (supabase) {
      // Delete all historical completions first (#9), then the habit itself
      await supabase.from("completions").delete().eq("habit_id", habitId);
      await supabase.from("habits").delete().eq("id", habitId);
    }
  };

  // ─── Reward handlers ─────────────────────────────────────────────
  const handleAddReward = async (rewardData) => {
    if (!supabase) {
      addToast('Cannot save — Supabase not configured', 'error');
      console.error('❌ handleAddReward: supabase client is null');
      return;
    }
    if (!family) return;
    const { data, error } = await supabase.from('rewards').insert({
      family_id: family.id, name: rewardData.name.trim(), points: rewardData.points,
      icon: rewardData.icon, who: rewardData.who || 'Everyone',
      color: rewardData.who === 'Kids' ? C.kids : C.accent,
    }).select().single();
    if (data) {
      setFamily(f => ({ ...f, rewards: [...(f.rewards || []), normalizeReward(data)] }));
      addToast(`✓ Reward "${rewardData.name.trim()}" created`);
    } else {
      console.error('❌ Add reward failed:', error);
      addToast(`Failed to save reward: ${error?.message || 'unknown error'}`, 'error');
    }
  };

  const handleEditReward = async (rewardId, updates) => {
    setFamily(f => ({ ...f, rewards: f.rewards.map(r => r.id === rewardId ? { ...r, ...updates } : r) }));
    if (supabase) {
      await supabase.from('rewards').update({
        name: updates.name, points: updates.points, icon: updates.icon,
        who: updates.who, color: updates.who === 'Kids' ? C.kids : C.accent,
      }).eq('id', rewardId);
    }
  };

  const handleDeleteReward = async (rewardId) => {
    setFamily(f => ({ ...f, rewards: f.rewards.filter(r => r.id !== rewardId) }));
    if (supabase) await supabase.from('rewards').delete().eq('id', rewardId);
  };

  const handleRedeemReward = async (rewardId, memberId) => {
    const reward = family.rewards.find(r => r.id === rewardId);
    const member = family.members.find(m => m.id === memberId);
    if (!reward || !member || (member.points || 0) < reward.points) return;
    const cost = reward.points;
    // Deduct points optimistically for everyone
    setFamily(f => ({ ...f, members: f.members.map(m => m.id === memberId ? { ...m, points: Math.max((m.points || 0) - cost, 0) } : m) }));
    if (!supabase) return;
    // Sync points to DB
    const { data: fm } = await supabase.from('members').select('points').eq('id', memberId).single();
    const fp = fm?.points ?? (member.points || 0);
    await supabase.from('members').update({ points: Math.max(fp - cost, 0) }).eq('id', memberId);
    // Kids only: create pending redemption for parent to fulfil
    if (member.isKid) {
      const { data: row, error } = await supabase.from('reward_redemptions').insert({
        reward_id: rewardId, member_id: memberId, family_id: family.id, points_spent: cost, status: 'pending',
      }).select().single();
      if (error) { console.error('❌ Redemption failed:', error); addToast('Failed to create redemption request', 'error'); return; }
      if (row) setRedemptions(prev => [row, ...prev]);
      redemptionsLastFetched.current = Date.now();
      triggerHaptic("milestone");
      addToast(`✓ ${reward.name} requested — a parent will fulfil it`);
    } else {
      triggerHaptic("milestone");
      addToast(`✓ ${reward.name} redeemed — enjoy!`);
    }
  };

  const handleFulfillRedemption = async (redemptionId) => {
    // Optimistic: remove from pending list immediately
    setRedemptions(prev => prev.filter(r => r.id !== redemptionId));
    redemptionsLastFetched.current = null; // force refresh next time family tab opens
    if (supabase) {
      const { error } = await supabase.from('reward_redemptions').update({
        status: 'fulfilled',
      }).eq('id', redemptionId);
      if (error) {
        console.error('❌ Fulfill failed:', error);
        // Revert optimistic update — force a fresh fetch on next tab visit
        redemptionsLastFetched.current = null;
        addToast('Failed to mark as fulfilled — please try again', 'error');
      } else {
        addToast('✓ Reward fulfilled!');
      }
    } else {
      addToast('✓ Reward fulfilled!');
    }
  };

  const handleCancelRedemption = async (redemptionId, memberId, pointsToRefund) => {
    setRedemptions(prev => prev.filter(r => r.id !== redemptionId));
    setFamily(f => ({ ...f, members: f.members.map(m => m.id === memberId ? { ...m, points: (m.points || 0) + pointsToRefund } : m) }));
    if (supabase) {
      await supabase.from('reward_redemptions').update({ status: 'cancelled' }).eq('id', redemptionId);
      const { data: fm } = await supabase.from('members').select('points').eq('id', memberId).single();
      const fp = fm?.points ?? 0;
      await supabase.from('members').update({ points: fp + pointsToRefund }).eq('id', memberId);
    }
    addToast(`↩ Redemption cancelled — ${pointsToRefund} pts refunded`);
  };

  const handleRemoveTile = async (habitId) => {
    if (!supabase) return;
    const { error } = await supabase.from("habits").update({ tile_uid: null }).eq("id", habitId);
    if (error) { console.error("❌ Remove tile failed:", error); return; }
    setHabits(prev => prev.map(h => h.id === habitId ? { ...h, tileUid: null } : h));
  };

  const handleRefreshData = async () => {
    if (!supabase || !family) return;
    try {
      const [freshFamily, todayData, weekData] = await Promise.all([
        fetchFamilyData(family.pin, family.name),
        fetchTodayCompletions(family.id),
        fetchWeekCompletions(family.id),
      ]);
      if (freshFamily) {
        setHabits(freshFamily.habits || []);
        setFamily(prev => ({ ...prev, members: freshFamily.members, rewards: freshFamily.rewards }));
        setCurrentMember(prev => freshFamily.members.find(m => m.id === prev.id) || prev);
      }
      setTodayCompletions(todayData);
      setWeekCompletions(weekData);
      addToast("✓ Data refreshed");
    } catch (err) {
      console.error("❌ Refresh failed:", err);
      addToast("Failed to refresh — check your connection");
    }
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
    // Clean this member's ID out of all habit assignedMemberIds (#10)
    setHabits(prev => prev.map(h => {
      if (!h.assignedMemberIds?.includes(memberId)) return h;
      const updated = h.assignedMemberIds.filter(id => id !== memberId);
      return { ...h, assignedMemberIds: updated.length > 0 ? updated : null };
    }));
    if (currentMember?.id === memberId) setCurrentMember(family?.members?.find(m => m.id !== memberId) || null);
    if (supabase) {
      await supabase.from("members").delete().eq("id", memberId);
      // Update any habits in Supabase that referenced this member
      const affectedHabits = habits.filter(h => h.assignedMemberIds?.includes(memberId));
      for (const h of affectedHabits) {
        const updated = h.assignedMemberIds.filter(id => id !== memberId);
        await supabase.from("habits").update({ assigned_member_ids: updated.length > 0 ? updated : null }).eq("id", h.id);
      }
    }
  };

  // ─── Tile URL trigger ────────────────────────────────────────────
  useEffect(() => {
    if (!family || !mounted) return;
    try {
      // Support URL formats, deep links (Capacitor), and query params:
      let raw = null;
      if (deepLinkTileUID) {
        raw = deepLinkTileUID;
        setDeepLinkTileUID(null);
      } else {
        const pathMatch = window.location.pathname.match(/^\/t\/(.+)$/);
        if (pathMatch) {
          raw = decodeURIComponent(pathMatch[1]);
        } else {
          raw = new URLSearchParams(window.location.search).get("tile");
        }
      }
      if (!raw) return;
      // Normalise: strip colons and dots (tile UIDs may arrive as 04:A3:2B or 04.A3.2B)
      const tileUID = raw.replace(/[:.]/g, "").toUpperCase();
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
          // Always complete for the assigned member regardless of who is currently
          // active in the app — the tile is the identity signal, not the UI state.
          // Auto-switch the active member to them so the UI reflects the right person.
          if (currentMemberRef.current?.id !== assignedMember.id) {
            setCurrentMember(assignedMember);
          }
          handleComplete(assignedHabit.id, assignedMember, false);
        }
      } else {
        setUnassignedTileUID(tileUID);
      }
    } catch (e) {
      console.warn('[Ritual] Tile URL handling failed:', e);
      // Graceful fallback — clear pending tile state, stay on home screen
      setDeepLinkTileUID(null);
    }
  }, [family, mounted, habitsWithTaps, deepLinkTileUID]);

  if (!mounted) return (
    <div style={{ minHeight: "100vh", background: C.sandLight, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
      <div style={{ fontSize: 40, color: C.sandDark, opacity: 0.5, animation: "pulse 1.5s ease-in-out infinite" }}>◈</div>
      <div style={{ fontSize: 12, color: C.sandDark, opacity: 0.4, fontFamily: "'DM Sans', sans-serif", letterSpacing: 1 }}>Loading…</div>
    </div>
  );
  if (!family) return <LoginScreen onLogin={handleLogin} />;

  const TABS = [
    { id: "today", icon: "◈", label: "Today" },
    ...(!soloMode ? [{ id: "family", icon: "◉", label: "Family" }] : []),
    { id: "insights", icon: "◎", label: "Insights" },
    { id: "manage", icon: "⚙", label: "Manage" },
  ];

  const headings = {
    today: `${getGreeting()}, ${currentMember?.name || family.name}`,
    family: soloMode ? "Your Progress" : `The ${family.name.charAt(0).toUpperCase() + family.name.slice(1)}${/[sxz]$|[^aeiou]h$/i.test(family.name) ? 'es' : 's'}`,
    insights: "Insights",
    manage: "Manage",
  };

  const doneTodayCount = myHabitsWithTaps.filter(h => (h.taps || 0) >= (h.target || 1)).length;

  return (
    <>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0;}
        body{background:${C.sandLight};font-family:'DM Sans',sans-serif;-webkit-overflow-scrolling:touch;}
        @keyframes ripple{0%{transform:scale(0.8);opacity:1;}100%{transform:scale(2.2);opacity:0;}}
        @keyframes pulse{0%,100%{opacity:1;}50%{opacity:0.25;}}
        @keyframes flashIn{from{opacity:0;}to{opacity:1;}}
        @keyframes popIn{from{transform:scale(0.5);opacity:0;}to{transform:scale(1);opacity:1;}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(12px);}to{opacity:1;transform:translateY(0);}}
        @keyframes slideUp{from{opacity:0;transform:translateY(14px);}to{opacity:1;transform:translateY(0);}}
        @keyframes confettiFall{0%{transform:translateY(-20px) rotate(0deg);opacity:1;}100%{transform:translateY(110vh) rotate(720deg);opacity:0;}}
        @keyframes celebFadeIn{0%{opacity:0;transform:scale(0.7);}60%{opacity:1;transform:scale(1.05);}100%{opacity:1;transform:scale(1);}}
        @keyframes celebFadeOut{0%{opacity:1;}100%{opacity:0;}}
        ::-webkit-scrollbar{display:none;}
        input:focus{border-color:${C.accent} !important;outline:none;}
        input::placeholder{color:${C.sandDark};}
        /* FIX 1: Responsive layout */
        .ritual-root{max-width:390px;margin:0 auto;background:${C.sandLight};position:relative;min-height:100vh;overflow-y:auto;-webkit-overflow-scrolling:touch;}
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
        {/* Toast notifications — auto-dismiss after 3s, stacks from bottom */}
        {toasts.map((t, i) => (
          <div key={t.id} style={{
            position: "fixed",
            bottom: `calc(90px + env(safe-area-inset-bottom) + ${i * 52}px)`,
            left: "50%", transform: "translateX(-50%)",
            zIndex: 9998,
            background: t.type === 'error' ? C.error : C.slateDark,
            color: C.white, borderRadius: 14, padding: "11px 18px",
            fontSize: 13, fontWeight: 600,
            boxShadow: "0 4px 20px rgba(0,0,0,0.25)",
            maxWidth: 320, textAlign: "center",
            fontFamily: "'DM Sans', sans-serif",
            whiteSpace: "nowrap",
            animation: "slideUp 0.3s ease",
            pointerEvents: "none",
          }}>
            {t.message}
          </div>
        ))}
        {/* Header */}
        <div style={{ padding: "20px 24px 12px", paddingTop: "max(20px, env(safe-area-inset-top))" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 4 }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, color: C.slate, fontFamily: "'DM Serif Display', serif", letterSpacing: -0.3, lineHeight: 1.1 }}>{headings[tab]}</div>
              <div style={{ fontSize: 12, color: C.slateLight, marginTop: 3 }}>
                {tab === "today" && `${new Date().toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" })} · ${doneTodayCount} of ${myHabitsWithTaps.length} complete`}
                {tab === "family" && (soloMode ? "personal dashboard" : `${family.members?.length || 0} members`)}
                {tab === "insights" && "Your habit data"}
                {tab === "manage" && "Habits, tiles & settings"}
              </div>
            </div>
            {family.members?.length > 1 && (
              <div style={{
                display: "inline-flex", background: C.sand,
                borderRadius: 20, padding: 3, gap: 2, flexShrink: 0, marginTop: 2,
              }}>
                {[
                  { label: "Family", active: !soloMode },
                  { label: "Just me", active: soloMode },
                ].map(({ label, active }) => (
                  <div key={label} onClick={toggleSoloMode} style={{
                    padding: "5px 12px", borderRadius: 14, fontSize: 11,
                    fontWeight: 500, cursor: "pointer", transition: "all 0.2s",
                    background: active ? C.white : "transparent",
                    color: active ? C.slate : C.slateLight,
                    boxShadow: active ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                    whiteSpace: "nowrap",
                  }}>{label}</div>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", minHeight: soloMode ? 0 : "auto", marginTop: soloMode ? 0 : 12 }}>
            {!soloMode && family.members?.length > 0 && family.members.map(m => {
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
        </div>

        {/* Screen */}
        <div key={tab} style={{ animation: "slideUp 0.3s ease" }}>
          {tab === "today" && (
            <TodayScreen
              habits={myHabitsWithTaps} weekData={weekData}
              weekCompletions={weekCompletions}
              currentMember={currentMember} allMembers={family.members || []}
              onComplete={handleComplete} onUndo={handleUndo}
              flashData={flashData} onFlashDone={() => setFlashData(null)}
              onFlashUndo={() => { if (flashData) handleUndo(flashData.habit.id); }}
              whoDidThis={whoDidThis} onWhoCancel={() => setWhoDidThis(null)}
              soundEnabled={soundEnabled}
              soloMode={soloMode}
              onClaimReward={() => setTab("family")}
              onEditHabit={(habitId) => { setEditHabitId(habitId || null); setManageInitialView("habitsManage"); setTab("manage"); }}
              onDeleteHabit={(habitId) => { if (window.confirm("Delete this habit? This removes all completion history.")) handleDeleteHabit(habitId); }}
            />
          )}
          {tab === "family" && !soloMode && (
            <FamilyScreen family={family} currentMember={currentMember} onAddMember={handleAddMember} onEditMember={handleEditMember} onRemoveMember={handleRemoveMember} redemptions={redemptions} onRedeemReward={handleRedeemReward} onFulfillRedemption={handleFulfillRedemption} onCancelRedemption={handleCancelRedemption} />
          )}
          {tab === "family" && soloMode && (
            <InsightsScreen habits={habitsWithTaps} family={family} weekCompletions={weekCompletions} currentMember={currentMember} analyticsData={analyticsData} soloMode={soloMode} forcePersonal={true} />
          )}
          {tab === "insights" && <InsightsScreen habits={habitsWithTaps} family={family} weekCompletions={weekCompletions} currentMember={currentMember} analyticsData={analyticsData} soloMode={soloMode} />}
          {tab === "manage" && <ManageScreen key={manageResetKey} family={family} currentMember={currentMember} soloMode={soloMode} habits={habits} onAddHabit={handleAddHabit} onAssignTile={handleAssignTile} onRemoveTile={handleRemoveTile} onEditHabit={handleEditHabit} onDeleteHabit={handleDeleteHabit} onAddReward={handleAddReward} onEditReward={handleEditReward} onDeleteReward={handleDeleteReward} onLogout={handleLogout} onRefresh={handleRefreshData} soundEnabled={soundEnabled} onToggleSound={() => { const next = !soundEnabled; setSoundEnabled(next); localStorage.setItem("ritual_soundEnabled", String(next)); }} onReplayOnboarding={async () => { if (currentMember?.id && supabase) { await supabase.from("members").update({ onboarding_complete: false }).eq("id", currentMember.id); setCurrentMember(m => ({ ...m, onboardingComplete: false })); } setShowOnboarding(true); }} onToast={addToast} onEditMember={handleEditMember} onRemoveMember={handleRemoveMember} onAddMember={handleAddMember} initialSubView={manageInitialView} onMounted={() => { setManageInitialView("main"); setEditHabitId(null); }} initialEditHabitId={editHabitId} />}
        </div>

        {/* Branding footer */}
        <div style={{ position: "fixed", bottom: 8, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 390, textAlign: "center", fontSize: 10, color: `${C.slateLight}55`, letterSpacing: 0.5, zIndex: 49, pointerEvents: "none", fontFamily: "'DM Sans', sans-serif" }}>
          Ritual · Build better habits
        </div>

        {/* Tab bar */}
        <div className="tab-bar">
          {TABS.map(t => (
            <button key={t.id} onClick={() => {
              if (t.id === "manage" && tab === "manage") {
                // Re-tap on active Manage tab: reset to main view
                setManageInitialView("main");
                setManageResetKey(k => k + 1);
              } else {
                setTab(t.id);
              }
            }} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "4px 12px" }}>
              <div style={{ fontSize: 20, color: tab === t.id ? C.accent : C.sandDark, transition: "all 0.2s ease", transform: tab === t.id ? "scale(1.2)" : "scale(1)", display: "flex", alignItems: "center", justifyContent: "center", height: 24, width: 24 }}>
                {t.id === "manage" ? <GearIcon color={tab === t.id ? C.accent : C.sandDark} size={20} /> : t.icon}
              </div>
              <div style={{ fontSize: 9, letterSpacing: 1.2, color: tab === t.id ? C.accent : C.sandDark, fontWeight: tab === t.id ? 700 : 400, textTransform: "uppercase" }}>{t.label}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Onboarding overlay — shown on first login per device */}
      {showOnboarding && family && (
        <OnboardingFlow currentMember={currentMember} family={family} onComplete={completeOnboarding} soloMode={soloMode} />
      )}

      {/* Celebration overlay — shown on 100% daily completion (once per day) */}
      {showCelebration && <CelebrationOverlay onDone={() => setShowCelebration(false)} />}

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
            setManageInitialView("custom");
            setTab("manage");
          }}
        />
      )}
    </>
  );
}
