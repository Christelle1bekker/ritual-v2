import { useState, useEffect, useRef } from "react";

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

// Fix 4: Clean Monday-first todayIndex calculation
function getTodayIndex() {
  return (new Date().getDay() + 6) % 7;
}

function useLocalStorage(key, initial) {
  const [val, setVal] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored ? JSON.parse(stored) : initial;
    } catch { return initial; }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
  }, [key, val]);
  return [val, setVal];
}

// ─── CATEGORY TEMPLATES ──────────────────────────────────────────
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
      { name: "Be kind moment", icon: "💛", location: "Anywhere", target: 1, parentVerified: true },
      { name: "Screen-free afternoon", icon: "🌳", location: "Living room", target: 1 },
      { name: "Outdoor play", icon: "⚽", location: "Back door", target: 1 },
    ]
  },
];

// ─── INPUT STYLE ─────────────────────────────────────────────────
const inputStyle = {
  width: "100%", padding: "13px 16px", borderRadius: 14,
  border: `1.5px solid ${C.sandDark}`, background: C.white,
  fontSize: 15, color: C.slate, outline: "none",
  fontFamily: "'DM Sans', sans-serif", transition: "border-color 0.2s ease",
};

const btnPrimary = {
  width: "100%", padding: "15px", borderRadius: 16, border: "none",
  background: `linear-gradient(135deg, ${C.accent}, ${C.accentLight})`,
  color: C.white, fontSize: 15, fontWeight: 700, cursor: "pointer",
  fontFamily: "'DM Sans', sans-serif",
  boxShadow: `0 6px 20px ${C.accent}40`,
};

// ─── LOGIN / ONBOARDING ──────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [view, setView] = useState("welcome");
  const [familyName, setFamilyName] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [newFamily, setNewFamily] = useState(null);
  const [members, setMembers] = useState([]);
  const [memberName, setMemberName] = useState("");
  const [memberIsKid, setMemberIsKid] = useState(false);
  const [memberColorIdx, setMemberColorIdx] = useState(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setTimeout(() => setMounted(true), 80); }, []);

  const darkInput = {
    ...inputStyle,
    background: "rgba(255,255,255,0.1)",
    border: "1.5px solid rgba(255,255,255,0.2)",
    color: C.white,
  };

  const handleJoin = () => {
    setError("");
    if (!familyName.trim() || pin.length < 4) { setError("Enter your family name and a 4-digit PIN"); return; }
    try {
      const existing = localStorage.getItem(`ritual_family_${pin}`);
      if (!existing) { setError("No family found with that PIN. Check and try again."); return; }
      const family = JSON.parse(existing);
      if (family.name.toLowerCase() !== familyName.trim().toLowerCase()) {
        setError("Family name doesn't match that PIN."); return;
      }
      onLogin(family);
    } catch { setError("Something went wrong. Please try again."); }
  };

  const handleCreate = () => {
    setError("");
    if (!familyName.trim()) { setError("Enter a family name"); return; }
    if (pin.length !== 4 || !/^\d+$/.test(pin)) { setError("PIN must be exactly 4 digits"); return; }
    try {
      const existing = localStorage.getItem(`ritual_family_${pin}`);
      if (existing) { setError("That PIN is already taken. Choose a different one."); return; }
      const family = {
        id: Date.now(), name: familyName.trim(), pin, members: [],
        rewards: [
          { id: 1, name: "30 min extra screen time", points: 500, icon: "📱", who: "Kids", color: C.kids },
          { id: 2, name: "Choose dinner", points: 750, icon: "🍕", who: "Everyone", color: C.accent },
          { id: 3, name: "Family movie night", points: 2000, icon: "🎬", who: "Everyone", color: C.green },
        ],
        createdAt: Date.now(),
      };
      setNewFamily(family);
      setView("addMembers");
    } catch { setError("Something went wrong. Please try again."); }
  };

  const addMember = () => {
    if (!memberName.trim()) return;
    const m = {
      id: Date.now(),
      name: memberName.trim(),
      avatar: memberName.trim()[0].toUpperCase(),
      isKid: memberIsKid,
      color: MEMBER_COLORS[memberColorIdx],
      points: 0, streak: 0,
    };
    setMembers(prev => [...prev, m]);
    setMemberName("");
    setMemberIsKid(false);
    setMemberColorIdx(prev => (prev + 1) % MEMBER_COLORS.length);
  };

  const finishSetup = () => {
    if (members.length === 0) { setError("Add at least one family member"); return; }
    const family = { ...newFamily, members };
    localStorage.setItem(`ritual_family_${family.pin}`, JSON.stringify(family));
    onLogin(family);
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
          <div style={{ display: "flex", flexDirection: "column", gap: 16, animation: "fadeUp 0.4s ease" }}>
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
          <div style={{ animation: "fadeUp 0.3s ease" }}>
            <button onClick={() => { setView("welcome"); setError(""); }} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.6)", fontSize: 13, marginBottom: 24 }}>← Back</button>
            <div style={{ fontSize: 24, fontWeight: 700, color: C.white, fontFamily: "'Cormorant Garamond', serif", marginBottom: 6 }}>Join your family</div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", marginBottom: 28 }}>Enter the name and PIN your family set up</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <input style={darkInput} placeholder="Family name" value={familyName} onChange={e => setFamilyName(e.target.value)} autoComplete="off" />
              <input style={darkInput} placeholder="4-digit PIN" type="tel" maxLength={4} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} />
              {error && <div style={{ fontSize: 12, color: "#FF8A80", textAlign: "center" }}>{error}</div>}
              <button onClick={handleJoin} style={btnPrimary}>Join Family</button>
            </div>
          </div>
        )}

        {view === "create" && (
          <div style={{ animation: "fadeUp 0.3s ease" }}>
            <button onClick={() => { setView("welcome"); setError(""); }} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.6)", fontSize: 13, marginBottom: 24 }}>← Back</button>
            <div style={{ fontSize: 24, fontWeight: 700, color: C.white, fontFamily: "'Cormorant Garamond', serif", marginBottom: 6 }}>Create your family</div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", marginBottom: 28 }}>Choose a name and PIN — share the PIN so family can join on other devices</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <input style={darkInput} placeholder="Family name e.g. The Bekkers" value={familyName} onChange={e => setFamilyName(e.target.value)} autoComplete="off" />
              <input style={darkInput} placeholder="Choose a 4-digit PIN" type="tel" maxLength={4} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} />
              {error && <div style={{ fontSize: 12, color: "#FF8A80", textAlign: "center" }}>{error}</div>}
              <button onClick={handleCreate} style={btnPrimary}>Continue →</button>
            </div>
          </div>
        )}

        {view === "addMembers" && (
          <div style={{ animation: "fadeUp 0.3s ease" }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: C.white, fontFamily: "'Cormorant Garamond', serif", marginBottom: 4 }}>Add family members</div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", marginBottom: 20 }}>Add everyone who'll be using Ritual</div>

            {members.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                {members.map(m => (
                  <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px 6px 6px", background: "rgba(255,255,255,0.12)", borderRadius: 30 }}>
                    <div style={{ width: 28, height: 28, borderRadius: "50%", background: m.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: C.white }}>{m.avatar}</div>
                    <span style={{ fontSize: 13, color: C.white }}>{m.name}</span>
                    {m.isKid && <span style={{ fontSize: 10, color: C.kids }}>⭐</span>}
                    <button onClick={() => setMembers(ms => ms.filter(x => x.id !== m.id))} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.4)", fontSize: 14, padding: 0, lineHeight: 1 }}>×</button>
                  </div>
                ))}
              </div>
            )}

            <div style={{ background: "rgba(255,255,255,0.08)", borderRadius: 20, padding: 16, marginBottom: 12 }}>
              <input
                style={{ ...darkInput, marginBottom: 10 }}
                placeholder="Name"
                value={memberName}
                onChange={e => setMemberName(e.target.value)}
                autoComplete="off"
              />
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                {MEMBER_COLORS.map((col, i) => (
                  <div key={i} onClick={() => setMemberColorIdx(i)} style={{ flex: 1, height: 28, borderRadius: 8, background: col, cursor: "pointer", border: memberColorIdx === i ? `2.5px solid ${C.white}` : "2.5px solid transparent", transition: "all 0.2s ease" }} />
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
            {members.length > 0 && <button onClick={finishSetup} style={btnPrimary}>Start Ritual →</button>}
          </div>
        )}

      </div>
    </div>
  );
}


// ─── WHO DID THIS? ────────────────────────────────────────────────
function WhoDidThis({ habit, members, onSelect, onCancel }) {
  const kids = members.filter(m => m.isKid);
  const displayMembers = kids.length > 0 ? kids : members;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 990,
      background: "rgba(42, 52, 56, 0.97)",
      backdropFilter: "blur(12px)",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      padding: "0 28px", animation: "fadeUp 0.3s ease",
      overflowY: "auto",
    }}>
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        <div style={{ fontSize: 44, marginBottom: 12 }}>{habit.icon}</div>
        <div style={{ fontSize: 24, fontWeight: 700, color: C.white, fontFamily: "'Cormorant Garamond', serif", marginBottom: 8 }}>
          Who completed this?
        </div>
        <div style={{ fontSize: 14, color: "rgba(255,255,255,0.5)" }}>{habit.name}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%", maxWidth: 340 }}>
        {displayMembers.map(m => (
          <button key={m.id} onClick={() => onSelect(m)} style={{
            padding: "18px 20px", borderRadius: 22, border: "none",
            background: `linear-gradient(135deg, ${m.color}35, ${m.color}20)`,
            borderLeft: `4px solid ${m.color}`,
            display: "flex", alignItems: "center", gap: 16,
            cursor: "pointer", width: "100%",
          }}>
            <div style={{
              width: 52, height: 52, borderRadius: "50%",
              background: `linear-gradient(135deg, ${m.color}, ${m.color}CC)`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 22, fontWeight: 700, color: C.white, flexShrink: 0,
              boxShadow: `0 4px 16px ${m.color}50`,
            }}>{m.avatar}</div>
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
      <button onClick={onCancel} style={{
        marginTop: 28, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)",
        borderRadius: 20, padding: "10px 28px",
        fontSize: 13, color: "rgba(255,255,255,0.5)", cursor: "pointer",
        fontFamily: "'DM Sans', sans-serif",
      }}>Cancel</button>
    </div>
  );
}

// ─── COMPLETION FLASH ─────────────────────────────────────────────
function CompletionFlash({ habit, member, onDone, onUndo }) {
  const [countdown, setCountdown] = useState(10);
  const isKid = habit?.isKid || member?.isKid;

  useEffect(() => {
    const interval = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) { clearInterval(interval); onDone(); return 0; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const taps = habit?.taps || 0;
  const target = habit?.target || 1;
  const justCompleted = taps >= target;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 999,
      background: isKid
        ? `linear-gradient(135deg, ${C.kids}, ${C.kidsLight})`
        : `linear-gradient(135deg, ${C.slateDark}, ${C.slate})`,
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 14,
      animation: "flashIn 0.3s ease",
    }}>
      <div style={{ fontSize: 72, animation: "popIn 0.4s cubic-bezier(0.34,1.56,0.64,1)" }}>
        {isKid ? "🌟" : justCompleted ? "✦" : "◈"}
      </div>
      {member && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "8px 16px", borderRadius: 30, background: "rgba(255,255,255,0.15)",
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: "50%",
            background: member.color,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 13, fontWeight: 700, color: C.white,
          }}>{member.avatar}</div>
          <span style={{ fontSize: 14, color: C.white, fontWeight: 600 }}>{member.name}</span>
        </div>
      )}
      <div style={{
        fontSize: isKid ? 30 : 26, fontWeight: 700, color: C.white,
        fontFamily: "'Cormorant Garamond', serif",
        textAlign: "center", padding: "0 40px", lineHeight: 1.2,
      }}>
        {isKid ? "Amazing work!" : justCompleted ? "Ritual complete" : "Tap logged"}
      </div>
      <div style={{ fontSize: 14, color: "rgba(255,255,255,0.7)", textAlign: "center" }}>
        {habit?.name}
      </div>
      {habit?.target > 1 && (
        <div style={{ padding: "8px 20px", borderRadius: 20, background: "rgba(255,255,255,0.15)", fontSize: 14, color: C.white, fontWeight: 600 }}>
          {taps} / {target} today
        </div>
      )}
      {justCompleted && (habit?.streak || 0) > 0 && (
        <div style={{ padding: "8px 20px", borderRadius: 30, background: "rgba(255,255,255,0.15)", fontSize: 13, color: C.white, fontWeight: 600 }}>
          🔥 {(habit?.streak || 0) + 1} day streak
        </div>
      )}
      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>+10 points</div>
      <button onClick={() => { onUndo(); onDone(); }} style={{
        position: "absolute", bottom: 48,
        background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)",
        borderRadius: 20, padding: "10px 24px", cursor: "pointer",
        color: "rgba(255,255,255,0.6)", fontSize: 13, fontFamily: "'DM Sans', sans-serif",
        display: "flex", alignItems: "center", gap: 8,
      }}>
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

  const handleHoldStart = () => {
    holdInterval.current = setInterval(() => {
      setHoldProgress(p => {
        if (p >= 100) {
          clearInterval(holdInterval.current);
          if (isKidsHabit) {
            setExpanded(false);
            setShowDigital(false);
            setHoldProgress(0);
            onComplete(habit.id, null, true);
          } else {
            onComplete(habit.id, currentMember, false);
            setExpanded(false);
            setShowDigital(false);
            setHoldProgress(0);
          }
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
    <div
      onMouseDown={startLongPress} onMouseUp={endLongPress}
      onTouchStart={startLongPress} onTouchEnd={endLongPress}
      style={{
        background: C.white, borderRadius: 20, padding: 18,
        boxShadow: `0 4px 20px ${habit.color}18`,
        border: `1px solid ${habit.color}30`,
        position: "relative", overflow: "hidden", cursor: "pointer", userSelect: "none",
      }}>
      {longPressProgress > 0 && <div style={{ position: "absolute", inset: 0, background: `${habit.color}12`, width: `${longPressProgress}%`, zIndex: 0 }} />}
      <div style={{ display: "flex", alignItems: "center", gap: 12, position: "relative", zIndex: 1 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 13, flexShrink: 0,
          background: `linear-gradient(135deg, ${habit.color}, ${habit.color}CC)`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 18, color: C.white, boxShadow: `0 4px 10px ${habit.color}35`,
        }}>✓</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.slate }}>{habit.name}</div>
          <div style={{ fontSize: 11, color: C.slateLight, marginTop: 1 }}>
            Done · 🔥 {(habit.streak || 0) + 1} day streak · +10 pts
            {habit.completedBy && ` · ${habit.completedBy}`}
          </div>
        </div>
        <div style={{ fontSize: 9, color: `${C.slateLight}60`, textAlign: "right", lineHeight: 1.4 }}>
          {longPressProgress > 0 ? "Undoing…" : "Hold to\nundo"}
        </div>
      </div>
    </div>
  );

  return (
    <div style={{
      background: isKidsHabit ? `linear-gradient(135deg, ${habit.color}10, ${C.white})` : C.white,
      borderRadius: 20,
      border: isKidsHabit ? `1.5px solid ${habit.color}30` : "1px solid rgba(0,0,0,0.05)",
      boxShadow: "0 2px 10px rgba(0,0,0,0.05)", overflow: "hidden",
    }}>
      <div style={{ padding: 18 }} onClick={() => !expanded && setExpanded(true)}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
          <div style={{
            width: 44, height: 44, borderRadius: 13, flexShrink: 0,
            background: `${habit.color}15`,
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20,
          }}>{habit.icon}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.slate }}>{habit.name}</div>
            <div style={{ fontSize: 11, color: C.slateLight, marginTop: 1 }}>
              {habit.location ? `Tile at: ${habit.location}` : habit.category} · 🔥 {habit.streak || 0}
              {habit.isPersonal && <span style={{ color: C.accent }}> · Personal</span>}
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
          <div style={{
            fontSize: 11, color: C.accent, fontWeight: 600,
            padding: "4px 10px", borderRadius: 20, background: `${C.accent}12`, flexShrink: 0,
          }}>{isMulti ? `${taps}/${target}` : "Tap tile"}</div>
        </div>
      </div>

      {expanded && (
        <div style={{ padding: "0 18px 20px", borderTop: `1px solid ${C.sandLight}`, paddingTop: 16 }}>
          <div style={{ fontSize: 12, color: C.slateLight, marginBottom: 14, lineHeight: 1.6 }}>
            Go to your tile at your <span style={{ color: C.accent, fontWeight: 600 }}>{habit.location || "tile location"}</span> and tap your phone to it.
          </div>
          <div style={{
            background: `linear-gradient(135deg, ${C.slateDark}, ${C.slate})`,
            borderRadius: 20, padding: "20px", marginBottom: 12,
            display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
          }}>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", letterSpacing: 2, textTransform: "uppercase" }}>Your Ritual tile</div>
            <div style={{ fontSize: 36 }}>{habit.icon}</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", textAlign: "center" }}>
              At your <span style={{ color: C.accentLight, fontWeight: 600 }}>{habit.location || "tile location"}</span>
            </div>
          </div>

          {!showDigital ? (
            <button onClick={() => setShowDigital(true)} style={{
              background: "none", border: "none", fontSize: 10,
              color: `${C.slateLight}60`, cursor: "pointer",
              display: "block", width: "100%", textAlign: "center",
              letterSpacing: 0.5, textDecoration: "underline dotted", padding: "4px 0",
            }}>Don't have your tile with you?</button>
          ) : (
            <div>
              <div style={{ fontSize: 10, color: `${C.slateLight}70`, textAlign: "center", marginBottom: 8, lineHeight: 1.5 }}>
                The physical tile is the whole point of Ritual.<br />
                <span style={{ color: C.accent }}>We recommend going to your tile.</span>
              </div>
              <div
                onMouseDown={handleHoldStart} onMouseUp={handleHoldEnd}
                onTouchStart={handleHoldStart} onTouchEnd={handleHoldEnd}
                style={{
                  padding: "11px", borderRadius: 12, border: `1.5px solid ${C.sandDark}`,
                  background: C.offwhite, cursor: "pointer", textAlign: "center",
                  userSelect: "none", position: "relative", overflow: "hidden",
                }}>
                <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${holdProgress}%`, background: `${C.accent}20` }} />
                <div style={{ fontSize: 11, color: C.slateLight, position: "relative" }}>
                  {holdProgress > 0 ? `Hold… ${Math.round(holdProgress)}%` : "Hold to manually complete"}
                </div>
              </div>
            </div>
          )}

          <button onClick={() => { setExpanded(false); setShowDigital(false); setHoldProgress(0); }} style={{
            marginTop: 10, background: "none", border: "none",
            fontSize: 12, color: C.slateLight, cursor: "pointer",
            display: "block", width: "100%", textAlign: "center",
          }}>Cancel</button>
        </div>
      )}
    </div>
  );
}

// ─── TODAY SCREEN ─────────────────────────────────────────────────
function TodayScreen({ habits, weekData, currentMember, allMembers, onComplete, onUndo, flashData, onFlashDone, onFlashUndo, whoDidThis, onWhoCancel }) {
  const visibleHabits = habits.filter(h => !h.isPersonal || h.ownerId === currentMember?.id);
  const done = visibleHabits.filter(h => (h.taps || 0) >= (h.target || 1)).length;
  const total = visibleHabits.length;
  const todayPct = total > 0 ? Math.round((done / total) * 100) : 0;
  // Fix 4: Monday-first index — (day+6)%7 gives Mon=0, Tue=1, ..., Sun=6
  const todayIndex = getTodayIndex();
  const displayWeek = weekData.map((v, i) => i === todayIndex ? todayPct : v);
  const maxStreak = visibleHabits.length > 0 ? Math.max(...visibleHabits.map(h => h.streak || 0), 0) : 0;
  const dayLabels = ["M", "T", "W", "T", "F", "S", "S"];

  return (
    <>
      {whoDidThis && <WhoDidThis habit={whoDidThis} members={allMembers} onSelect={(m) => onComplete(whoDidThis.id, m, false)} onCancel={onWhoCancel} />}
      {flashData && <CompletionFlash habit={flashData.habit} member={flashData.member} onDone={onFlashDone} onUndo={onFlashUndo} />}
      <div style={{ padding: "0 20px 110px" }}>
        {/* Hero */}
        <div style={{
          background: `linear-gradient(135deg, ${C.slateDark} 0%, ${C.slate} 100%)`,
          borderRadius: 24, padding: 24, marginBottom: 16, position: "relative", overflow: "hidden",
        }}>
          <div style={{ position: "absolute", top: -30, right: -30, width: 150, height: 150, borderRadius: "50%", background: "rgba(255,255,255,0.06)", zIndex: 0 }} />
          <div style={{ position: "absolute", bottom: -20, left: 50, width: 90, height: 90, borderRadius: "50%", background: "rgba(255,255,255,0.04)", zIndex: 0 }} />
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
                <div style={{ padding: "8px 14px", borderRadius: 20, background: "rgba(255,255,255,0.12)", textAlign: "center", zIndex: 1 }}>
                  <div style={{ fontSize: 20 }}>🔥</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: C.white }}>{maxStreak}</div>
                  <div style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", letterSpacing: 1 }}>BEST</div>
                </div>
              )}
            </div>
            <div style={{ height: 5, background: "rgba(255,255,255,0.1)", borderRadius: 3, marginBottom: 10 }}>
              <div style={{
                height: "100%", borderRadius: 3,
                background: `linear-gradient(90deg, ${C.accent}, ${C.accentLight})`,
                width: `${(done / Math.max(total, 1)) * 100}%`,
                transition: "width 0.8s cubic-bezier(0.34,1.56,0.64,1)",
              }} />
            </div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.65)", fontFamily: "'Cormorant Garamond', serif", fontStyle: "italic" }}>
              {getMotivation(done, total)}
            </div>
          </div>
        </div>

        {/* Week chart — Fix 4: day labels below bars, correct Mon-first indexing */}
        <div style={{ background: C.white, borderRadius: 20, padding: 18, marginBottom: 16, boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.slate, letterSpacing: 0.5 }}>This Week</div>
            <div style={{ fontSize: 11, color: C.slateLight }}>{todayPct}% today</div>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 60 }}>
            {displayWeek.map((v, i) => {
              const isToday = i === todayIndex;
              const isFuture = v === null;
              const pct = v ?? 0;
              return (
                <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
                  <div style={{ width: "100%", position: "relative", height: 50, display: "flex", alignItems: "flex-end" }}>
                    <div style={{
                      width: "100%", borderRadius: 4, minHeight: 4,
                      height: `${Math.max(pct * 0.5, 4)}px`,
                      background: isFuture ? C.sandLight : isToday ? `linear-gradient(180deg, ${C.accent}, ${C.accentLight})` : `${C.slate}55`,
                      boxShadow: isToday ? `0 4px 12px ${C.accent}40` : "none",
                      transition: "height 0.6s cubic-bezier(0.34,1.56,0.64,1)",
                    }} />
                    {isToday && pct > 0 && (
                      <div style={{ position: "absolute", top: -18, left: "50%", transform: "translateX(-50%)", fontSize: 9, color: C.accent, fontWeight: 700, whiteSpace: "nowrap" }}>{pct}%</div>
                    )}
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
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {visibleHabits.map(h => (
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
function FamilyScreen({ family, setFamily }) {
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
      setFamily(f => ({ ...f, members: f.members.map(m => m.id === editing.id ? { ...m, name: form.name.trim(), avatar, isKid: form.isKid, color } : m) }));
    } else {
      setFamily(f => ({ ...f, members: [...f.members, { id: Date.now(), name: form.name.trim(), avatar, isKid: form.isKid, color, points: 0, streak: 0 }] }));
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
        {editing && <button onClick={() => { setFamily(f => ({ ...f, members: f.members.filter(m => m.id !== editing.id) })); setView("list"); }} style={{ ...btnPrimary, background: `${C.error}18`, color: C.error, boxShadow: "none" }}>Remove {editing.name}</button>}
      </div>
    </div>
  );

  const totalPoints = family.members.reduce((a, m) => a + (m.points || 0), 0);

  return (
    <div style={{ padding: "0 20px 110px" }}>
      <div style={{ background: `linear-gradient(135deg, ${C.warm}, ${C.accent})`, borderRadius: 24, padding: 24, marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", letterSpacing: 2.5, textTransform: "uppercase", marginBottom: 6 }}>The {family.name} Family</div>
        <div style={{ fontSize: 44, fontWeight: 700, color: C.white, fontFamily: "'Cormorant Garamond', serif", lineHeight: 1 }}>{totalPoints.toLocaleString()}</div>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", marginTop: 4 }}>combined points · PIN: {family.pin}</div>
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
                  <button onClick={() => { setEditing(m); setForm({ name: m.name, isKid: m.isKid, colorIdx: MEMBER_COLORS.indexOf(m.color) >= 0 ? MEMBER_COLORS.indexOf(m.color) : 0 }); setView("add"); }} style={{ background: "none", border: "none", cursor: "pointer", color: C.sandDark, fontSize: 16 }}>✎</button>
                </div>
              </div>
              <div style={{ marginTop: 6, height: 4, background: C.sandLight, borderRadius: 2 }}>
                <div style={{ height: "100%", borderRadius: 2, background: `linear-gradient(90deg, ${m.color}, ${m.color}99)`, width: `${totalPoints > 0 ? ((m.points || 0) / Math.max(...family.members.map(x => x.points || 0), 1)) * 100 : 0}%`, transition: "width 0.8s ease" }} />
              </div>
              <div style={{ marginTop: 5, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 11, color: C.slateLight }}>🔥 {m.streak || 0} day streak</div>
                <button onClick={() => handleNudge(m.id)} style={{ background: nudged[m.id] ? `${C.green}18` : `${C.accent}12`, border: "none", borderRadius: 12, padding: "4px 10px", fontSize: 11, fontWeight: 600, color: nudged[m.id] ? C.green : C.accent, cursor: "pointer" }}>
                  {nudged[m.id] ? "✓ Nudged!" : `Nudge 👋`}
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
          <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: i < family.rewards.length - 1 ? `1px solid ${C.sandLight}` : "none" }}>
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

// ─── ADD SCREEN ───────────────────────────────────────────────────
// Fix 2: Added habits prop + NFC Setup view
function AddScreen({ family, currentMember, onAddHabit, habits }) {
  const [view, setView] = useState("menu");
  const [selectedCat, setSelectedCat] = useState(null);
  const [selectedHabit, setSelectedHabit] = useState(null);
  const [targetCount, setTargetCount] = useState(1);
  const [isPersonal, setIsPersonal] = useState(false);
  const [copiedId, setCopiedId] = useState(null); // Fix 2: for NFC copy state

  // Fix 2: NFC Setup view
  if (view === "nfc") {
    const grouped = CATEGORIES.map(cat => ({
      ...cat,
      activeHabits: (habits || []).filter(h => h.categoryId === cat.id),
    })).filter(cat => cat.activeHabits.length > 0);

    return (
      <div style={{ padding: "0 20px 110px" }}>
        <button onClick={() => setView("menu")} style={{ background: "none", border: "none", cursor: "pointer", color: C.slateLight, fontSize: 13, marginBottom: 16 }}>← Back</button>
        <div style={{ fontSize: 18, fontWeight: 700, color: C.slate, fontFamily: "'Cormorant Garamond', serif", marginBottom: 4 }}>NFC Tag Setup</div>
        <div style={{ fontSize: 12, color: C.slateLight, marginBottom: 20, lineHeight: 1.6 }}>
          Program each NFC tag with its URL. When tapped, the app opens and logs that habit instantly.
        </div>

        {grouped.length === 0 ? (
          <div style={{ background: C.white, borderRadius: 20, padding: 36, textAlign: "center", boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📡</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: C.slate, marginBottom: 6 }}>No habits yet</div>
            <div style={{ fontSize: 13, color: C.slateLight, lineHeight: 1.6 }}>Add some habits first, then come back here to get your NFC URLs.</div>
          </div>
        ) : (
          grouped.map(cat => (
            <div key={cat.id} style={{ marginBottom: 24 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 16 }}>{cat.icon}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: C.slateLight, letterSpacing: 1.5, textTransform: "uppercase" }}>{cat.name}</span>
              </div>
              {cat.activeHabits.map(habit => {
                const url = `${window.location.origin}/complete?habit=${habit.id}`;
                const copied = copiedId === habit.id;
                return (
                  <div key={habit.id} style={{ background: C.white, borderRadius: 16, padding: 16, marginBottom: 8, boxShadow: "0 2px 8px rgba(0,0,0,0.04)", border: "1px solid rgba(0,0,0,0.04)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                      <div style={{ width: 36, height: 36, borderRadius: 10, background: `${habit.color}15`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>{habit.icon}</div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: C.slate }}>{habit.name}</div>
                    </div>
                    <div style={{ fontFamily: "monospace", fontSize: 10, color: C.slateLight, background: C.offwhite, borderRadius: 8, padding: "8px 10px", marginBottom: 8, wordBreak: "break-all", lineHeight: 1.6 }}>
                      {url}
                    </div>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(url)
                          .then(() => { setCopiedId(habit.id); setTimeout(() => setCopiedId(null), 2000); })
                          .catch(() => { setCopiedId(habit.id); setTimeout(() => setCopiedId(null), 2000); });
                      }}
                      style={{
                        width: "100%", padding: "9px", borderRadius: 10, border: "none",
                        background: copied ? `${C.green}18` : `${C.accent}15`,
                        color: copied ? C.green : C.accent,
                        fontSize: 13, fontWeight: 600, cursor: "pointer",
                        fontFamily: "'DM Sans', sans-serif", transition: "all 0.2s ease",
                      }}
                    >
                      {copied ? "✓ Copied" : "Copy URL"}
                    </button>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    );
  }

  if (view === "menu") return (
    <div style={{ padding: "0 20px 110px" }}>
      <div style={{ fontSize: 13, color: C.slateLight, marginBottom: 24 }}>What would you like to set up?</div>
      {[
        { id: "habits", icon: "◈", label: "Add a Ritual Habit", desc: "Choose from templates — ready to tap", color: C.slate },
        { id: "rewards", icon: "🎁", label: "Manage Rewards", desc: "Set up points rewards for your family", color: C.accent },
        { id: "nfc", icon: "📡", label: "NFC Tag Setup", desc: "Copy URLs to program your NFC tags", color: C.kidsBlue },
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
            {h.parentVerified && <span style={{ fontSize: 10, color: C.kids, background: `${C.kids}18`, padding: "3px 8px", borderRadius: 10, fontWeight: 600 }}>Parent verify</span>}
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
        <div style={{ fontSize: 12, color: C.slateLight, marginBottom: 20, lineHeight: 1.5 }}>Each tap earns points. Streak grows when you hit your target.</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 24 }}>
          <button onClick={() => setTargetCount(t => Math.max(1, t - 1))} style={{ width: 44, height: 44, borderRadius: "50%", border: "none", background: C.offwhite, fontSize: 22, cursor: "pointer", color: C.slate }}>−</button>
          <div style={{ textAlign: "center", minWidth: 60 }}>
            <div style={{ fontSize: 48, fontWeight: 700, color: C.slate, fontFamily: "'Cormorant Garamond', serif", lineHeight: 1 }}>{targetCount}</div>
            <div style={{ fontSize: 11, color: C.slateLight, marginTop: 4 }}>{targetCount === 1 ? "time per day" : "times per day"}</div>
          </div>
          <button onClick={() => setTargetCount(t => Math.min(20, t + 1))} style={{ width: 44, height: 44, borderRadius: "50%", border: "none", background: C.offwhite, fontSize: 22, cursor: "pointer", color: C.slate }}>+</button>
        </div>
        {targetCount > 1 && (
          <div style={{ marginTop: 16, padding: "10px 16px", borderRadius: 12, background: `${selectedHabit.color}10`, fontSize: 12, color: C.slate, textAlign: "center", lineHeight: 1.5 }}>
            <strong>+{targetCount * 10} points</strong> on days you hit all {targetCount} taps
          </div>
        )}
      </div>

      <div style={{ background: C.white, borderRadius: 20, padding: 20, marginBottom: 14, boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.slate, marginBottom: 4 }}>Who is this habit for?</div>
        <div style={{ fontSize: 12, color: C.slateLight, marginBottom: 14 }}>Shared habits are visible to everyone. Personal habits only show for you.</div>
        <div style={{ display: "flex", gap: 10 }}>
          {[{ label: "Whole family", val: false, icon: "👨‍👩‍👧" }, { label: "Just me", val: true, icon: "👤" }].map(opt => (
            <div key={String(opt.val)} onClick={() => setIsPersonal(opt.val)} style={{ flex: 1, padding: "14px 10px", borderRadius: 16, textAlign: "center", cursor: "pointer", background: isPersonal === opt.val ? `${selectedHabit.color}15` : C.offwhite, border: isPersonal === opt.val ? `2px solid ${selectedHabit.color}` : "2px solid transparent", transition: "all 0.2s ease" }}>
              <div style={{ fontSize: 22, marginBottom: 4 }}>{opt.icon}</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.slate }}>{opt.label}</div>
            </div>
          ))}
        </div>
      </div>

      <button onClick={() => { onAddHabit({ ...selectedHabit, target: targetCount, isPersonal, ownerId: isPersonal ? currentMember?.id : null }); setTargetCount(1); setIsPersonal(false); setView("menu"); }} style={btnPrimary}>
        Add to My Rituals
      </button>
    </div>
  );

  return null;
}

// ─── INSIGHTS ─────────────────────────────────────────────────────
function InsightsScreen({ habits, family }) {
  const best = habits.length > 0 ? Math.max(...habits.map(h => h.streak || 0), 0) : 0;
  const topHabit = [...habits].sort((a, b) => (b.streak || 0) - (a.streak || 0))[0];
  const totalFamilyPoints = (family.members || []).reduce((a, m) => a + (m.points || 0), 0);

  return (
    <div style={{ padding: "0 20px 110px" }}>
      {[
        { label: "Best streak", value: `${best} days`, icon: "🔥", color: C.accent },
        { label: "Most consistent", value: topHabit?.name || "—", icon: topHabit?.icon || "◈", color: C.green },
        { label: "Active rituals", value: `${habits.length}`, icon: "◈", color: C.slate },
        { label: "Family points total", value: totalFamilyPoints.toLocaleString(), icon: "🏆", color: C.warm },
        { label: "Family members", value: `${family.members?.length || 0} people`, icon: "👨‍👩‍👧", color: C.slateLight },
      ].map((s, i) => (
        <div key={i} style={{ background: C.white, borderRadius: 20, padding: 18, marginBottom: 10, boxShadow: "0 2px 10px rgba(0,0,0,0.05)", display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ width: 48, height: 48, borderRadius: 14, background: `${s.color}15`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>{s.icon}</div>
          <div>
            <div style={{ fontSize: 12, color: C.slateLight }}>{s.label}</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: C.slate, marginTop: 2 }}>{s.value}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── ROOT ─────────────────────────────────────────────────────────
export default function RitualApp() {
  const [family, setFamily] = useLocalStorage("ritual_current_family", null);
  const [habits, setHabits] = useLocalStorage("ritual_habits", []);
  const [weekData, setWeekData] = useLocalStorage("ritual_week", [null, null, null, null, null, null, null]);
  const [currentMember, setCurrentMember] = useLocalStorage("ritual_current_member", null);
  const [tab, setTab] = useState("today");
  const [flashData, setFlashData] = useState(null);
  const [whoDidThis, setWhoDidThis] = useState(null);
  const [mounted, setMounted] = useState(false);
  const nfcHandled = useRef(false);

  // Fix 4: consistent Monday-first todayIndex throughout
  const todayIndex = getTodayIndex();

  useEffect(() => { setTimeout(() => setMounted(true), 80); }, []);

  // Fix 3: Daily tap reset at midnight
  useEffect(() => {
    const lastReset = localStorage.getItem("ritual_lastReset");
    const today = new Date().toDateString();
    if (lastReset !== today) {
      setHabits(prev => prev.map(h => ({ ...h, taps: 0, completedBy: undefined, completedById: undefined })));
      localStorage.setItem("ritual_lastReset", today);
    }
  }, []);

  // Save family back to localStorage when it changes
  useEffect(() => {
    if (family) {
      try { localStorage.setItem(`ritual_family_${family.pin}`, JSON.stringify(family)); } catch {}
    }
  }, [family]);

  const handleLogin = (fam) => {
    setFamily(fam);
    if (fam.members?.length > 0 && !currentMember) {
      setCurrentMember(fam.members[0]);
    }
  };

  const handleLogout = () => {
    setFamily(null);
    setCurrentMember(null);
    setHabits([]);
    setWeekData([null, null, null, null, null, null, null]);
  };

  const handleComplete = (id, member, fromDigital) => {
    const habit = habits.find(h => h.id === id);
    if (!habit) return;

    if (habit.isKid && !member) {
      setWhoDidThis(habit);
      return;
    }

    const resolvedMember = member || currentMember;
    let updatedHabit;

    setHabits(prev => prev.map(h => {
      if (h.id !== id) return h;
      const newTaps = (h.taps || 0) + 1;
      // Fix 5: store completedById (not just name) so undo can reverse the right member
      updatedHabit = { ...h, taps: newTaps, completedBy: resolvedMember?.name, completedById: resolvedMember?.id };
      return updatedHabit;
    }));

    if (resolvedMember) {
      setFamily(f => ({
        ...f,
        members: f.members.map(m =>
          m.id === resolvedMember.id ? { ...m, points: (m.points || 0) + 10 } : m
        )
      }));
    }

    setWhoDidThis(null);

    setTimeout(() => {
      setFlashData({ habit: updatedHabit || { ...habit, taps: (habit.taps || 0) + 1 }, member: resolvedMember });
      const updated = [...weekData];
      const currentHabits = habits.map(h => h.id === id ? { ...h, taps: (h.taps || 0) + 1 } : h);
      const done = currentHabits.filter(h => (h.taps || 0) >= (h.target || 1)).length;
      updated[todayIndex] = Math.round((done / Math.max(currentHabits.length, 1)) * 100);
      setWeekData(updated);
    }, 0);
  };

  // Fix 5: Undo fully reverses — deducts from the member who actually completed it
  const handleUndo = (id) => {
    const habit = habits.find(h => h.id === id);
    const completedById = habit?.completedById;

    setHabits(prev => prev.map(h =>
      h.id === id ? { ...h, taps: Math.max((h.taps || 0) - 1, 0), completedBy: undefined, completedById: undefined } : h
    ));

    // Find the member who actually did it (not just currentMember)
    const memberToDeduct = completedById
      ? family?.members?.find(m => m.id === completedById)
      : currentMember;

    if (memberToDeduct) {
      setFamily(f => ({
        ...f,
        members: f.members.map(m =>
          m.id === memberToDeduct.id ? { ...m, points: Math.max((m.points || 0) - 10, 0) } : m
        )
      }));
    }

    const updated = [...weekData];
    const currentHabits = habits.map(h => h.id === id ? { ...h, taps: Math.max((h.taps || 0) - 1, 0) } : h);
    const done = currentHabits.filter(h => (h.taps || 0) >= (h.target || 1)).length;
    updated[todayIndex] = Math.round((done / Math.max(currentHabits.length, 1)) * 100);
    setWeekData(updated);
  };

  const handleAddHabit = (h) => {
    setHabits(prev => [...prev, {
      id: Date.now(), name: h.name, icon: h.icon,
      category: h.category, categoryId: h.categoryId,
      streak: 0, taps: 0, target: h.target || 1,
      color: h.color, location: h.location,
      isKid: h.isKid || false,
      isPersonal: h.isPersonal || false,
      ownerId: h.ownerId || null,
    }]);
    setTab("today");
  };

  // Fix 1: NFC URL parameter handling — runs once after login + habits load
  useEffect(() => {
    if (!family || !mounted || nfcHandled.current) return;
    const params = new URLSearchParams(window.location.search);
    const habitId = params.get("habit");
    if (habitId) {
      nfcHandled.current = true;
      const habit = habits.find(h => h.id === Number(habitId));
      if (habit) {
        handleComplete(habit.id, currentMember, false);
        window.history.replaceState({}, "", "/");
      }
    }
  }, [family, mounted]);

  if (!mounted) return null;
  if (!family) return <LoginScreen onLogin={handleLogin} />;

  const TABS = [
    { id: "today", icon: "◈", label: "Today" },
    { id: "family", icon: "◉", label: "Family" },
    { id: "add", icon: "⊕", label: "Add" },
    { id: "insights", icon: "◎", label: "Insights" },
  ];

  const headings = {
    today: `${getGreeting()}, ${currentMember?.name || family.name}`,
    family: `The ${family.name}s`,
    add: "Set Up",
    insights: "Insights",
  };

  const doneTodayCount = habits.filter(h => (h.taps || 0) >= (h.target || 1)).length;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400;1,600&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700&display=swap');
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
      `}</style>

      <div style={{ maxWidth: 390, margin: "0 auto", minHeight: "100vh", background: C.sandLight, position: "relative" }}>
        {/* Header */}
        <div style={{ padding: "20px 24px 16px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: C.slate, fontFamily: "'Cormorant Garamond', serif", letterSpacing: -0.3, lineHeight: 1.1 }}>{headings[tab]}</div>
            <div style={{ fontSize: 12, color: C.slateLight, marginTop: 3 }}>
              {tab === "today" && `${new Date().toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" })} · ${doneTodayCount} of ${habits.length} complete`}
              {tab === "family" && `${family.members?.length || 0} members · PIN: ${family.pin}`}
              {tab === "add" && "Habits, tiles & rewards"}
              {tab === "insights" && "Your habit data"}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {/* Member switcher */}
            {family.members?.length > 1 && (
              <div style={{ display: "flex", gap: 4 }}>
                {family.members.map(m => (
                  <div key={m.id} onClick={() => setCurrentMember(m)} style={{
                    width: 32, height: 32, borderRadius: "50%",
                    background: `linear-gradient(135deg, ${m.color}, ${m.color}CC)`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 12, fontWeight: 700, color: C.white, cursor: "pointer",
                    border: currentMember?.id === m.id ? `2.5px solid ${C.slate}` : "2.5px solid transparent",
                    boxShadow: currentMember?.id === m.id ? `0 0 0 1px ${C.white}, 0 0 0 3px ${m.color}` : "none",
                    transition: "all 0.2s ease", flexShrink: 0,
                  }}>{m.avatar}</div>
                ))}
              </div>
            )}
            <div onClick={handleLogout} style={{
              width: 36, height: 36, borderRadius: "50%",
              background: `linear-gradient(135deg, ${C.accent}, ${C.accentLight})`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 14, fontWeight: 700, color: C.white,
              boxShadow: `0 4px 12px ${C.accent}40`, flexShrink: 0, cursor: "pointer",
            }} title="Sign out">{currentMember?.avatar || family.name[0].toUpperCase()}</div>
          </div>
        </div>

        {/* Screen */}
        <div key={tab} style={{ animation: "slideUp 0.3s ease" }}>
          {tab === "today" && (
            <TodayScreen
              habits={habits} weekData={weekData}
              currentMember={currentMember} allMembers={family.members || []}
              onComplete={handleComplete} onUndo={handleUndo}
              flashData={flashData} onFlashDone={() => setFlashData(null)}
              onFlashUndo={() => { if (flashData) handleUndo(flashData.habit.id); }}
              whoDidThis={whoDidThis} onWhoCancel={() => setWhoDidThis(null)}
            />
          )}
          {tab === "family" && <FamilyScreen family={family} setFamily={setFamily} />}
          {tab === "add" && <AddScreen family={family} currentMember={currentMember} onAddHabit={handleAddHabit} habits={habits} />}
          {tab === "insights" && <InsightsScreen habits={habits} family={family} />}
        </div>

        {/* Tab bar */}
        <div style={{
          position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)",
          width: 390, background: "rgba(250,248,245,0.96)",
          backdropFilter: "blur(24px)", borderTop: `1px solid ${C.sandDark}50`,
          padding: "10px 0 26px", display: "flex", justifyContent: "space-around",
        }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "4px 18px" }}>
              <div style={{ fontSize: 20, color: tab === t.id ? C.accent : C.sandDark, transition: "all 0.2s ease", transform: tab === t.id ? "scale(1.2)" : "scale(1)" }}>{t.icon}</div>
              <div style={{ fontSize: 9, letterSpacing: 1.2, color: tab === t.id ? C.accent : C.sandDark, fontWeight: tab === t.id ? 700 : 400, textTransform: "uppercase" }}>{t.label}</div>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
