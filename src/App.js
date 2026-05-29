import { useState, useEffect, useRef, useCallback } from "react";

const STORAGE_KEY = "lyrics_v2";

const defaultSongs = [
  {
    id: "demo1",
    title: "Exemple",
    artist: "Comment utiliser l'appli",
    speed: 45,
    fontSize: 26,
    lyrics: `Bienvenue dans Lyrics 🎤

Appuie sur ▶ pour démarrer le défilement
Règle la vitesse avec le curseur

Tape à gauche pour reculer
Tape à droite pour avancer

Laisse une ligne vide entre les strophes
Pour avoir une pause naturelle

Ajoute tes chansons avec le bouton +
Colle les paroles depuis le presse-papier

Bonne chanson ! 🎶`,
  },
];

function loadSongs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return defaultSongs;
}

function saveSongs(songs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(songs));
  } catch {}
}

function vibrate(ms = 10) {
  try { navigator.vibrate?.(ms); } catch {}
}

// ─── Wake Lock ───────────────────────────────────────────────────────────────
function useWakeLock(active) {
  const lockRef = useRef(null);
  useEffect(() => {
    if (!active) { lockRef.current?.release?.(); lockRef.current = null; return; }
    navigator.wakeLock?.request("screen").then(l => { lockRef.current = l; }).catch(() => {});
    return () => { lockRef.current?.release?.(); lockRef.current = null; };
  }, [active]);
}

export default function App() {
  const [songs, setSongs] = useState(loadSongs);
  const [view, setView] = useState("library"); // library | edit | sing
  const [editSong, setEditSong] = useState(null);
  const [activeSong, setActiveSong] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [scrollY, setScrollY] = useState(0);
  const [locked, setLocked] = useState(false);
  const [search, setSearch] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [form, setForm] = useState({ title: "", artist: "", lyrics: "", speed: 45, fontSize: 26 });
  const [darkMode, setDarkMode] = useState(true);
  const [showSettings, setShowSettings] = useState(false);

  const rafRef = useRef(null);
  const lastTRef = useRef(null);
  const containerRef = useRef(null);
  const contentRef = useRef(null);

  useWakeLock(view === "sing" && playing);
  useEffect(() => saveSongs(songs), [songs]);

  // Lock orientation hint via meta (best effort on iOS Safari)
  useEffect(() => {
    if (view === "sing") {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [view]);

  // Auto scroll
  useEffect(() => {
    if (view !== "sing" || !playing) {
      lastTRef.current = null;
      cancelAnimationFrame(rafRef.current);
      return;
    }
    const step = (ts) => {
      if (lastTRef.current == null) lastTRef.current = ts;
      const dt = (ts - lastTRef.current) / 1000;
      lastTRef.current = ts;
      setScrollY(prev => {
        const max = contentRef.current
          ? Math.max(0, contentRef.current.scrollHeight - containerRef.current.clientHeight)
          : 0;
        const next = prev + (activeSong?.speed ?? 45) * dt;
        if (next >= max) { setPlaying(false); return max; }
        return next;
      });
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, view, activeSong]);

  useEffect(() => {
    if (containerRef.current) containerRef.current.scrollTop = scrollY;
  }, [scrollY]);

  // Tap left/right to rewind/forward
  const handleSingTap = useCallback((e) => {
    if (locked) return;
    const x = e.touches?.[0]?.clientX ?? e.clientX;
    const w = window.innerWidth;
    const JUMP = 120;
    if (x < w * 0.3) {
      vibrate(15);
      setScrollY(p => Math.max(0, p - JUMP));
    } else if (x > w * 0.7) {
      vibrate(15);
      setScrollY(p => p + JUMP);
    }
  }, [locked]);

  function startSinging(song) {
    setActiveSong(song);
    setScrollY(0);
    setPlaying(false);
    setLocked(false);
    setView("sing");
  }

  function stopSinging() {
    setPlaying(false);
    cancelAnimationFrame(rafRef.current);
    setView("library");
    setActiveSong(null);
    setScrollY(0);
    setLocked(false);
  }

  function openEdit(song = null) {
    if (song) {
      setForm({ title: song.title, artist: song.artist || "", lyrics: song.lyrics, speed: song.speed ?? 45, fontSize: song.fontSize ?? 26 });
      setEditSong(song);
    } else {
      setForm({ title: "", artist: "", lyrics: "", speed: 45, fontSize: 26 });
      setEditSong(null);
    }
    setView("edit");
  }

  function saveForm() {
    if (!form.title.trim() || !form.lyrics.trim()) return;
    if (editSong) {
      setSongs(s => s.map(x => x.id === editSong.id ? { ...x, ...form } : x));
    } else {
      setSongs(s => [{ id: Date.now().toString(), ...form }, ...s]);
    }
    setView("library");
  }

  function deleteSong(id) {
    setSongs(s => s.filter(x => x.id !== id));
    setConfirmDelete(null);
  }

  function pasteFromClipboard(field) {
    navigator.clipboard?.readText?.().then(text => {
      if (text) setForm(f => ({ ...f, [field]: text }));
    }).catch(() => {});
  }

  const theme = darkMode ? dark : light;
  const filtered = songs.filter(s =>
    s.title.toLowerCase().includes(search.toLowerCase()) ||
    (s.artist || "").toLowerCase().includes(search.toLowerCase())
  );

  // ─── SING VIEW ─────────────────────────────────────────────────────────────
  if (view === "sing" && activeSong) {
    return (
      <div style={{ position: "fixed", inset: 0, background: "#07090e", display: "flex", flexDirection: "column", fontFamily: "'Georgia', serif", touchAction: "none" }}>
        {/* Top bar */}
        {!locked && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", paddingTop: "max(10px, env(safe-area-inset-top))", background: "rgba(0,0,0,0.6)", backdropFilter: "blur(12px)", flexShrink: 0, zIndex: 10 }}>
            <button onClick={stopSinging} style={pill("#1c1f28", "#aaa")}>← Retour</button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: "#fff", fontWeight: 700, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{activeSong.title}</div>
              {activeSong.artist && <div style={{ color: "#666", fontSize: 11 }}>{activeSong.artist}</div>}
            </div>
            {/* Speed */}
            <input type="range" min={8} max={140} value={activeSong.speed ?? 45}
              onChange={e => {
                const s = Number(e.target.value);
                setActiveSong(a => ({ ...a, speed: s }));
                setSongs(songs => songs.map(x => x.id === activeSong.id ? { ...x, speed: s } : x));
              }}
              style={{ width: 64, accentColor: "#e8c97a" }}
            />
            <button onClick={() => { vibrate(10); setPlaying(p => !p); }}
              style={{ ...pill(playing ? "#e8c97a" : "#2a2d36", playing ? "#000" : "#fff"), fontWeight: 700, fontSize: 18, width: 44, height: 44, borderRadius: 22, padding: 0, flexShrink: 0 }}>
              {playing ? "⏸" : "▶"}
            </button>
            <button onClick={() => { setScrollY(0); setPlaying(false); }} style={pill("#1c1f28", "#aaa")}>↺</button>
            <button onClick={() => { vibrate(20); setLocked(true); }} style={pill("#1c1f28", "#e8c97a")} title="Verrouiller">🔒</button>
          </div>
        )}

        {/* Locked overlay bar */}
        {locked && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", paddingTop: "max(10px, env(safe-area-inset-top))", background: "rgba(0,0,0,0.8)", flexShrink: 0, zIndex: 10 }}>
            <span style={{ color: "#555", fontSize: 12 }}>🔒 Écran verrouillé</span>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => { vibrate(10); setPlaying(p => !p); }}
                style={{ ...pill(playing ? "#e8c97a" : "#2a2d36", playing ? "#000" : "#fff"), fontWeight: 700, fontSize: 18, width: 44, height: 44, borderRadius: 22, padding: 0 }}>
                {playing ? "⏸" : "▶"}
              </button>
              <button onClick={() => { vibrate(20); setLocked(false); }} style={pill("#2a2d36", "#e8c97a")}>🔓 Déverrouiller</button>
            </div>
          </div>
        )}

        {/* Lyrics */}
        <div ref={containerRef} style={{ flex: 1, overflow: "hidden", position: "relative" }} onTouchEnd={handleSingTap}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 80, background: "linear-gradient(to bottom, #07090e, transparent)", zIndex: 2, pointerEvents: "none" }} />
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 120, background: "linear-gradient(to top, #07090e, transparent)", zIndex: 2, pointerEvents: "none" }} />

          {/* Tap zones hint */}
          {!playing && scrollY === 0 && !locked && (
            <div style={{ position: "absolute", bottom: 40, left: 0, right: 0, zIndex: 3, display: "flex", justifyContent: "space-between", padding: "0 20px", pointerEvents: "none" }}>
              <div style={{ color: "#333", fontSize: 11, textAlign: "center" }}>◀ tap<br/>reculer</div>
              <div style={{ color: "#444", fontSize: 11, textAlign: "center", animation: "pulse 2s infinite" }}>Appuie sur ▶<br/>pour commencer</div>
              <div style={{ color: "#333", fontSize: 11, textAlign: "center" }}>tap ▶<br/>avancer</div>
            </div>
          )}

          <div ref={contentRef} style={{ padding: "60px 24px 160px" }}>
            {activeSong.lyrics.split("\n").map((line, i) => {
              const blank = line.trim() === "";
              return (
                <div key={i} style={{
                  fontSize: blank ? 10 : (activeSong.fontSize ?? 26),
                  lineHeight: blank ? "32px" : "1.6",
                  color: blank ? "transparent" : "#f0e8d0",
                  textAlign: "center",
                  maxWidth: 560,
                  margin: "0 auto",
                  padding: blank ? "6px 0" : "1px 0",
                  letterSpacing: "0.01em",
                }}>
                  {blank ? "·" : line}
                </div>
              );
            })}
            <div style={{ height: 100 }} />
          </div>
        </div>
        <style>{`@keyframes pulse{0%,100%{opacity:.3}50%{opacity:.8}}`}</style>
      </div>
    );
  }

  // ─── EDIT VIEW ─────────────────────────────────────────────────────────────
  if (view === "edit") {
    const valid = form.title.trim() && form.lyrics.trim();
    return (
      <div style={{ minHeight: "100vh", background: theme.bg, color: theme.text, fontFamily: "'Georgia', serif", paddingBottom: 40 }}>
        <div style={{ padding: "16px 16px 0", paddingTop: "max(16px, env(safe-area-inset-top))" }}>
          <button onClick={() => setView("library")} style={pill(theme.card, theme.muted)}>← Annuler</button>
        </div>
        <div style={{ padding: "16px 16px 0" }}>
          <h2 style={{ margin: "0 0 20px", fontSize: 22, fontWeight: 700, color: theme.heading }}>
            {editSong ? "Modifier" : "Nouvelle chanson"}
          </h2>

          <label style={lbl(theme)}>Titre *</label>
          <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Ex : Bohemian Rhapsody" style={inp(theme)} />

          <label style={lbl(theme)}>Artiste</label>
          <div style={{ position: "relative" }}>
            <input value={form.artist} onChange={e => setForm(f => ({ ...f, artist: e.target.value }))} placeholder="Ex : Queen" style={inp(theme)} />
          </div>

          <label style={lbl(theme)}>Paroles *</label>
          <div style={{ position: "relative" }}>
            <textarea
              value={form.lyrics}
              onChange={e => setForm(f => ({ ...f, lyrics: e.target.value }))}
              placeholder={"Collez les paroles ici...\n\nLaissez une ligne vide entre les strophes."}
              rows={14}
              style={{ ...inp(theme), resize: "none", fontFamily: "monospace", fontSize: 14, lineHeight: 1.6 }}
            />
            <button
              onClick={() => pasteFromClipboard("lyrics")}
              style={{ position: "absolute", top: 10, right: 10, ...pill("#e8c97a", "#000"), fontSize: 12, fontWeight: 700 }}
            >
              📋 Coller
            </button>
          </div>

          {/* Speed per song */}
          <label style={lbl(theme)}>Vitesse par défaut</label>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <span style={{ color: theme.muted, fontSize: 18 }}>🐢</span>
            <input type="range" min={8} max={140} value={form.speed} onChange={e => setForm(f => ({ ...f, speed: Number(e.target.value) }))} style={{ flex: 1, accentColor: "#e8c97a" }} />
            <span style={{ color: theme.muted, fontSize: 18 }}>🐇</span>
          </div>

          {/* Font size */}
          <label style={lbl(theme)}>Taille du texte</label>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
            <span style={{ color: theme.muted, fontSize: 13 }}>A</span>
            <input type="range" min={16} max={42} value={form.fontSize} onChange={e => setForm(f => ({ ...f, fontSize: Number(e.target.value) }))} style={{ flex: 1, accentColor: "#e8c97a" }} />
            <span style={{ color: theme.muted, fontSize: 22 }}>A</span>
            <span style={{ color: theme.accent, fontSize: 13, width: 28 }}>{form.fontSize}px</span>
          </div>

          <button onClick={saveForm} disabled={!valid} style={{
            background: valid ? "#e8c97a" : theme.card,
            color: valid ? "#000" : theme.muted,
            border: "none", borderRadius: 12, padding: "16px", fontSize: 16, fontWeight: 700,
            width: "100%", cursor: valid ? "pointer" : "not-allowed", fontFamily: "inherit",
            opacity: valid ? 1 : 0.5,
          }}>
            {editSong ? "Enregistrer" : "Ajouter la chanson"}
          </button>
        </div>
      </div>
    );
  }

  // ─── LIBRARY VIEW ──────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: theme.bg, color: theme.text, fontFamily: "'Georgia', serif" }}>
      {/* Header */}
      <div style={{ padding: "0 16px 12px", paddingTop: "max(16px, env(safe-area-inset-top))", borderBottom: `1px solid ${theme.border}` }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: "0.2em", color: theme.accent, textTransform: "uppercase", marginBottom: 2 }}>🎤 Lyrics</div>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: theme.heading }}>Ma bibliothèque</h1>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setDarkMode(d => !d)} style={pill(theme.card, theme.muted)}>{darkMode ? "☀️" : "🌙"}</button>
            <button onClick={() => openEdit()} style={pill("#e8c97a", "#000", true)}>+ Nouvelle</button>
          </div>
        </div>
        {/* Search */}
        <div style={{ position: "relative" }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: theme.muted, fontSize: 14 }}>🔍</span>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher..."
            style={{ ...inp(theme), paddingLeft: 36, marginBottom: 0 }}
          />
          {search && (
            <button onClick={() => setSearch("")} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: theme.muted, fontSize: 18, cursor: "pointer" }}>×</button>
          )}
        </div>
      </div>

      {/* List */}
      <div style={{ padding: "12px 16px 100px" }}>
        {filtered.length === 0 && (
          <div style={{ textAlign: "center", color: theme.muted, padding: "60px 20px" }}>
            <div style={{ fontSize: 44, marginBottom: 12 }}>🎵</div>
            <div style={{ fontSize: 15 }}>{search ? "Aucun résultat" : "Aucune chanson.\nAppuie sur + pour commencer."}</div>
          </div>
        )}
        {filtered.map((song, idx) => (
          <SongCard
            key={song.id}
            song={song}
            theme={theme}
            onSing={() => { vibrate(10); startSinging(song); }}
            onEdit={() => openEdit(song)}
            onDelete={() => setConfirmDelete(song.id)}
            style={{ animationDelay: `${idx * 40}ms` }}
          />
        ))}
      </div>

      {/* Delete confirm */}
      {confirmDelete && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "flex-end", zIndex: 100 }} onClick={() => setConfirmDelete(null)}>
          <div style={{ background: theme.card, borderRadius: "20px 20px 0 0", padding: "28px 20px", paddingBottom: "max(28px, env(safe-area-inset-bottom))", width: "100%", textAlign: "center" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🗑️</div>
            <div style={{ fontWeight: 700, fontSize: 17, color: theme.heading, marginBottom: 6 }}>Supprimer cette chanson ?</div>
            <div style={{ color: theme.muted, fontSize: 14, marginBottom: 24 }}>Cette action est irréversible.</div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setConfirmDelete(null)} style={{ ...pill(theme.bg, theme.text), flex: 1, padding: "14px", fontSize: 15 }}>Annuler</button>
              <button onClick={() => { vibrate(20); deleteSong(confirmDelete); }} style={{ ...pill("#c0504d", "#fff", true), flex: 1, padding: "14px", fontSize: 15 }}>Supprimer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SongCard({ song, theme, onSing, onEdit, onDelete }) {
  const [swiped, setSwiped] = useState(false);
  const startX = useRef(null);

  function onTouchStart(e) { startX.current = e.touches[0].clientX; }
  function onTouchEnd(e) {
    if (startX.current == null) return;
    const dx = e.changedTouches[0].clientX - startX.current;
    if (dx < -60) setSwiped(true);
    else if (dx > 30) setSwiped(false);
    startX.current = null;
  }

  return (
    <div style={{ position: "relative", marginBottom: 10, overflow: "hidden", borderRadius: 14 }} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {/* Delete action behind */}
      <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, background: "#c0504d", display: "flex", alignItems: "center", padding: "0 20px", borderRadius: 14 }}>
        <button onClick={onDelete} style={{ background: "none", border: "none", color: "#fff", fontSize: 22, cursor: "pointer" }}>🗑</button>
      </div>
      {/* Card */}
      <div style={{
        background: theme.card,
        border: `1px solid ${theme.border}`,
        borderRadius: 14,
        padding: "14px 14px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        transform: swiped ? "translateX(-70px)" : "translateX(0)",
        transition: "transform 0.25s ease",
        position: "relative",
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15, color: theme.heading, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{song.title}</div>
          <div style={{ fontSize: 12, color: theme.muted, marginTop: 2 }}>{song.artist || <span style={{ fontStyle: "italic" }}>Artiste inconnu</span>} · {song.lyrics.split("\n").filter(l => l.trim()).length} lignes</div>
        </div>
        <button onClick={onEdit} style={pill(theme.bg, theme.muted)}>✏️</button>
        <button onClick={onSing} style={{ ...pill("#e8c97a", "#000"), fontWeight: 700, fontSize: 15 }}>▶ Chanter</button>
      </div>
    </div>
  );
}

// ─── Themes ──────────────────────────────────────────────────────────────────
const dark = {
  bg: "#0d0f14", card: "#161920", border: "rgba(255,255,255,0.07)",
  text: "#e0d8c8", heading: "#f0e8d0", muted: "#666", accent: "#e8c97a",
};
const light = {
  bg: "#f5f0e8", card: "#fff", border: "rgba(0,0,0,0.08)",
  text: "#2a2520", heading: "#1a1510", muted: "#999", accent: "#b8860b",
};

// ─── Shared styles ───────────────────────────────────────────────────────────
function pill(bg, color, bold = false) {
  return { background: bg, color, border: "none", borderRadius: 20, padding: "8px 14px", fontSize: 13, fontWeight: bold ? 700 : 500, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", WebkitTapHighlightColor: "transparent" };
}
function lbl(t) {
  return { display: "block", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: t.muted, marginBottom: 6, marginTop: 16 };
}
function inp(t) {
  return { width: "100%", background: t.card, border: `1px solid ${t.border}`, borderRadius: 10, padding: "12px 14px", color: t.text, fontSize: 15, fontFamily: "inherit", outline: "none", boxSizing: "border-box", marginBottom: 4 };
}
