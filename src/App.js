import { useState, useEffect, useRef, useCallback } from "react";

// ─── Storage ─────────────────────────────────────────────────────────────────
const KEY = "lyrics_v3";

const DEMO = [{
  id: "demo1",
  title: "Exemple — lis moi !",
  artist: "Guide rapide",
  speed: 40,
  fontSize: 24,
  lyrics: `Bienvenue 🎤

Appuie sur ▶ pour lancer le défilement
Règle la vitesse avec le curseur en haut

─────────────

Pendant que ça défile :
  Tape à GAUCHE pour reculer
  Tape à DROITE pour avancer
  Appuie au CENTRE pour pause

─────────────

🔒 Appuie sur le cadenas
pour verrouiller l'écran
pendant que tu chantes

─────────────

Ajoute tes chansons avec +
Colle les paroles d'un coup
avec le bouton Coller 📋

Bonne chanson ! 🎶`
}];

function load() {
  try { const r = localStorage.getItem(KEY); if (r) return JSON.parse(r); } catch {}
  return DEMO;
}
function save(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
}

// ─── Wake Lock ───────────────────────────────────────────────────────────────
function useWakeLock(on) {
  const ref = useRef(null);
  useEffect(() => {
    if (!on) { ref.current?.release?.(); ref.current = null; return; }
    navigator.wakeLock?.request("screen").then(l => ref.current = l).catch(() => {});
    return () => { ref.current?.release?.(); ref.current = null; };
  }, [on]);
}

// ─── App ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [songs, setSongs]         = useState(load);
  const [view, setView]           = useState("lib"); // lib | edit | sing
  const [active, setActive]       = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  const [playing, setPlaying]     = useState(false);
  const [pos, setPos]             = useState(0);
  const [locked, setLocked]       = useState(false);
  const [search, setSearch]       = useState("");
  const [delId, setDelId]         = useState(null);
  const [form, setForm]           = useState(emptyForm());

  const rafRef    = useRef(null);
  const lastT     = useRef(null);
  const scrollRef = useRef(null);
  const innerRef  = useRef(null);
  const touchX    = useRef(null);

  useWakeLock(view === "sing" && playing);
  useEffect(() => save(songs), [songs]);

  // ── Scroll animation ──
  useEffect(() => {
    if (view !== "sing" || !playing) { lastT.current = null; cancelAnimationFrame(rafRef.current); return; }
    const tick = (ts) => {
      if (!lastT.current) lastT.current = ts;
      const dt = (ts - lastT.current) / 1000;
      lastT.current = ts;
      setPos(p => {
        const max = innerRef.current && scrollRef.current
          ? Math.max(0, innerRef.current.scrollHeight - scrollRef.current.clientHeight)
          : 0;
        const next = p + (active?.speed ?? 40) * dt;
        if (next >= max) { setPlaying(false); return max; }
        return next;
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, view, active]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = pos;
  }, [pos]);

  // ── Tap zones (sing view) ──
  const onTouchStart = useCallback(e => { touchX.current = e.touches[0].clientX; }, []);
  const onTouchEnd   = useCallback(e => {
    if (locked || touchX.current == null) return;
    const dx = Math.abs(e.changedTouches[0].clientX - touchX.current);
    if (dx > 10) return; // was a swipe, not a tap
    const x = e.changedTouches[0].clientX;
    const w = window.innerWidth;
    const JUMP = 100;
    if (x < w * 0.28)      { vibrate(12); setPos(p => Math.max(0, p - JUMP)); }
    else if (x > w * 0.72) { vibrate(12); setPos(p => p + JUMP); }
    else                   { vibrate(8);  setPlaying(p => !p); }
    touchX.current = null;
  }, [locked]);

  // ── Actions ──
  function sing(song) {
    setActive(song); setPos(0); setPlaying(false); setLocked(false); setView("sing");
  }
  function stopSing() {
    cancelAnimationFrame(rafRef.current);
    setPlaying(false); setActive(null); setPos(0); setLocked(false); setView("lib");
  }
  function openEdit(song = null) {
    setForm(song ? { title: song.title, artist: song.artist || "", lyrics: song.lyrics, speed: song.speed ?? 40, fontSize: song.fontSize ?? 24 } : emptyForm());
    setEditTarget(song);
    setView("edit");
  }
  function saveForm() {
    if (!form.title.trim() || !form.lyrics.trim()) return;
    if (editTarget) setSongs(s => s.map(x => x.id === editTarget.id ? { ...x, ...form } : x));
    else            setSongs(s => [{ id: Date.now().toString(), ...form }, ...s]);
    setView("lib");
  }
  function doDelete(id) { setSongs(s => s.filter(x => x.id !== id)); setDelId(null); }
  function updateSpeed(v) {
    const s = Number(v);
    setActive(a => ({ ...a, speed: s }));
    setSongs(list => list.map(x => x.id === active.id ? { ...x, speed: s } : x));
  }
  function paste(field) {
    navigator.clipboard?.readText?.().then(t => { if (t) setForm(f => ({ ...f, [field]: t })); }).catch(() => {});
  }

  const filtered = songs.filter(s =>
    s.title.toLowerCase().includes(search.toLowerCase()) ||
    (s.artist || "").toLowerCase().includes(search.toLowerCase())
  );

  // ════════════════════════════════════════════════════════════════════════════
  // SING VIEW
  // ════════════════════════════════════════════════════════════════════════════
  if (view === "sing" && active) {
    return (
      <div style={S.singWrap}>

        {/* ── Top bar ── */}
        <div style={S.singBar}>
          {!locked ? (
            <>
              <Btn onClick={stopSing} style={S.iconBtn}>✕</Btn>
              <div style={{ flex: 1, minWidth: 0, padding: "0 4px" }}>
                <div style={S.singTitle}>{active.title}</div>
                {active.artist ? <div style={S.singArtist}>{active.artist}</div> : null}
              </div>
              <input type="range" min={8} max={130} value={active.speed ?? 40}
                onChange={e => updateSpeed(e.target.value)}
                style={S.slider} />
              <Btn onClick={() => { vibrate(8); setPlaying(p => !p); }} style={{ ...S.playBtn, background: playing ? GOLD : "#232630" }}>
                <span style={{ color: playing ? "#000" : "#fff", fontSize: 20 }}>{playing ? "⏸" : "▶"}</span>
              </Btn>
              <Btn onClick={() => { setPos(0); setPlaying(false); }} style={S.iconBtn}>↺</Btn>
              <Btn onClick={() => { vibrate(20); setLocked(true); }} style={S.iconBtn}>🔒</Btn>
            </>
          ) : (
            <>
              <span style={{ color: "#444", fontSize: 12, flex: 1 }}>🔒 Verrouillé</span>
              <Btn onClick={() => { vibrate(8); setPlaying(p => !p); }} style={{ ...S.playBtn, background: playing ? GOLD : "#232630" }}>
                <span style={{ color: playing ? "#000" : "#fff", fontSize: 20 }}>{playing ? "⏸" : "▶"}</span>
              </Btn>
              <Btn onClick={() => { vibrate(20); setLocked(false); }} style={{ ...S.iconBtn, color: GOLD }}>🔓</Btn>
            </>
          )}
        </div>

        {/* ── Lyrics area ── */}
        <div
          ref={scrollRef}
          style={S.lyricsScroll}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          {/* Fade top/bottom */}
          <div style={S.fadeTop} />
          <div style={S.fadeBot} />

          {/* Tap zones hint */}
          {!playing && pos === 0 && (
            <div style={S.tapHint}>
              <span style={{ opacity: 0.3, fontSize: 11 }}>◀ reculer</span>
              <span style={{ opacity: 0.5, fontSize: 11, animation: "pulse 2s infinite" }}>● pause</span>
              <span style={{ opacity: 0.3, fontSize: 11 }}>avancer ▶</span>
            </div>
          )}

          <div ref={innerRef} style={S.lyricsInner}>
            {active.lyrics.split("\n").map((line, i) => {
              const blank = line.trim() === "";
              return (
                <div key={i} style={{
                  fontSize:   blank ? 0   : (active.fontSize ?? 24),
                  height:     blank ? 28  : "auto",
                  lineHeight: blank ? "28px" : 1.65,
                  color:      "#f0e8d0",
                  textAlign:  "center",
                  padding:    blank ? 0 : "1px 20px",
                  letterSpacing: "0.01em",
                  maxWidth: 580,
                  margin: "0 auto",
                }}>{blank ? "" : line}</div>
              );
            })}
            <div style={{ height: 140 }} />
          </div>
        </div>

        <style>{`
          @keyframes pulse { 0%,100%{opacity:.2} 50%{opacity:.7} }
          * { -webkit-tap-highlight-color: transparent; box-sizing: border-box; }
          html, body { overscroll-behavior: none; overflow: hidden; height: 100%; position: fixed; width: 100%; }
        `}</style>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // EDIT VIEW
  // ════════════════════════════════════════════════════════════════════════════
  if (view === "edit") {
    const ok = form.title.trim() && form.lyrics.trim();
    return (
      <div style={S.page}>
        <style>{`* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; } html,body{overscroll-behavior:none;}`}</style>

        {/* Header */}
        <div style={S.editHeader}>
          <Btn onClick={() => setView("lib")} style={S.backBtn}>← Retour</Btn>
          <span style={S.pageTitle}>{editTarget ? "Modifier" : "Nouvelle chanson"}</span>
        </div>

        <div style={S.editBody}>
          {/* Titre */}
          <label style={S.label}>Titre *</label>
          <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            placeholder="Ex : Bohemian Rhapsody" style={S.input} />

          {/* Artiste */}
          <label style={S.label}>Artiste</label>
          <input value={form.artist} onChange={e => setForm(f => ({ ...f, artist: e.target.value }))}
            placeholder="Ex : Queen" style={S.input} />

          {/* Paroles */}
          <label style={S.label}>Paroles *</label>
          <div style={{ position: "relative" }}>
            <textarea value={form.lyrics} onChange={e => setForm(f => ({ ...f, lyrics: e.target.value }))}
              placeholder={"Colle les paroles ici...\n\nLaisse une ligne vide entre les strophes."}
              rows={12} style={{ ...S.input, resize: "none", fontFamily: "monospace", fontSize: 14, lineHeight: 1.6, paddingTop: 44 }} />
            <Btn onClick={() => paste("lyrics")} style={S.pasteBtn}>📋 Coller depuis le presse-papier</Btn>
          </div>

          {/* Vitesse */}
          <label style={S.label}>Vitesse de défilement</label>
          <div style={S.sliderRow}>
            <span style={S.sliderEmoji}>🐢</span>
            <input type="range" min={8} max={130} value={form.speed}
              onChange={e => setForm(f => ({ ...f, speed: Number(e.target.value) }))} style={S.sliderFull} />
            <span style={S.sliderEmoji}>🐇</span>
          </div>

          {/* Taille police */}
          <label style={S.label}>Taille du texte — aperçu : <span style={{ color: GOLD, fontSize: form.fontSize * 0.5 + 10 }}>Aa</span></label>
          <div style={S.sliderRow}>
            <span style={{ ...S.sliderEmoji, fontSize: 14 }}>A</span>
            <input type="range" min={16} max={40} value={form.fontSize}
              onChange={e => setForm(f => ({ ...f, fontSize: Number(e.target.value) }))} style={S.sliderFull} />
            <span style={{ ...S.sliderEmoji, fontSize: 24 }}>A</span>
          </div>

          {/* Save */}
          <Btn onClick={saveForm} style={{
            ...S.saveBtn,
            background: ok ? GOLD : "#1e2128",
            color: ok ? "#000" : "#555",
            opacity: ok ? 1 : 0.6,
            cursor: ok ? "pointer" : "default",
          }}>
            {editTarget ? "💾 Enregistrer" : "➕ Ajouter la chanson"}
          </Btn>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LIBRARY VIEW
  // ════════════════════════════════════════════════════════════════════════════
  return (
    <div style={S.page}>
      <style>{`* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; } html,body{overscroll-behavior:none;height:100%;}`}</style>

      {/* Header */}
      <div style={S.libHeader}>
        <div>
          <div style={S.appLabel}>🎤 LYRICS</div>
          <div style={S.appTitle}>Ma bibliothèque</div>
        </div>
        <Btn onClick={() => openEdit()} style={S.addBtn}>+ Nouvelle</Btn>
      </div>

      {/* Search */}
      <div style={S.searchWrap}>
        <span style={S.searchIcon}>🔍</span>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Rechercher une chanson..." style={S.searchInput} />
        {search ? <Btn onClick={() => setSearch("")} style={S.clearBtn}>✕</Btn> : null}
      </div>

      {/* List */}
      <div style={S.list}>
        {filtered.length === 0 && (
          <div style={S.empty}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🎵</div>
            <div style={{ color: "#555", fontSize: 15 }}>
              {search ? "Aucun résultat" : "Aucune chanson.\nAppuie sur + pour en ajouter."}
            </div>
          </div>
        )}
        {filtered.map(song => (
          <SongRow
            key={song.id}
            song={song}
            onSing={() => sing(song)}
            onEdit={() => openEdit(song)}
            onDelete={() => setDelId(song.id)}
          />
        ))}
        <div style={{ height: 40 }} />
      </div>

      {/* Delete sheet */}
      {delId && (
        <div style={S.overlay} onClick={() => setDelId(null)}>
          <div style={S.sheet} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🗑️</div>
            <div style={S.sheetTitle}>Supprimer cette chanson ?</div>
            <div style={S.sheetSub}>Cette action est irréversible.</div>
            <Btn onClick={() => { vibrate(20); doDelete(delId); }} style={S.delConfirm}>Supprimer</Btn>
            <Btn onClick={() => setDelId(null)} style={S.delCancel}>Annuler</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Song row with swipe-to-delete ───────────────────────────────────────────
function SongRow({ song, onSing, onEdit, onDelete }) {
  const [dx, setDx]   = useState(0);
  const startX        = useRef(null);
  const THRESHOLD     = 60;

  function ts(e) { startX.current = e.touches[0].clientX; }
  function tm(e) {
    if (startX.current == null) return;
    const d = e.touches[0].clientX - startX.current;
    if (d < 0) setDx(Math.max(d, -80));
    else        setDx(Math.min(d, 0));
  }
  function te() {
    if (dx < -THRESHOLD) setDx(-80); else setDx(0);
    startX.current = null;
  }

  return (
    <div style={{ position: "relative", marginBottom: 10, borderRadius: 14, overflow: "hidden" }}>
      {/* Delete behind */}
      <div style={S.rowDelete}>
        <Btn onClick={onDelete} style={S.rowDeleteBtn}>🗑️</Btn>
      </div>
      {/* Card */}
      <div
        style={{ ...S.row, transform: `translateX(${dx}px)`, transition: dx === 0 || dx === -80 ? "transform .25s ease" : "none" }}
        onTouchStart={ts} onTouchMove={tm} onTouchEnd={te}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={S.rowTitle}>{song.title}</div>
          <div style={S.rowSub}>
            {song.artist || <em style={{ opacity: 0.5 }}>Artiste inconnu</em>}
            <span style={{ color: "#3a3d48", margin: "0 5px" }}>·</span>
            <span style={{ color: "#444" }}>{song.lyrics.split("\n").filter(l => l.trim()).length} lignes</span>
          </div>
        </div>
        <Btn onClick={onEdit}  style={S.editBtn}>✏️</Btn>
        <Btn onClick={onSing}  style={S.singBtn}>▶ Chanter</Btn>
      </div>
    </div>
  );
}

// ─── Tiny button wrapper ──────────────────────────────────────────────────────
function Btn({ onClick, style, children }) {
  return (
    <button onClick={onClick} style={{ border: "none", cursor: "pointer", fontFamily: "inherit", WebkitTapHighlightColor: "transparent", ...style }}>
      {children}
    </button>
  );
}

function emptyForm() { return { title: "", artist: "", lyrics: "", speed: 40, fontSize: 24 }; }
function vibrate(ms) { try { navigator.vibrate?.(ms); } catch {} }

// ─── Constants ────────────────────────────────────────────────────────────────
const GOLD = "#e8c97a";
const BG   = "#0d0f14";
const CARD = "#13161d";
const BORDER = "rgba(255,255,255,0.07)";
const TEXT   = "#e0d8c8";
const MUTED  = "#555";

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = {
  // Shared
  page: {
    minHeight: "100dvh",
    background: BG,
    color: TEXT,
    fontFamily: "'Georgia', serif",
    display: "flex",
    flexDirection: "column",
  },

  // Library
  libHeader: {
    display: "flex", alignItems: "flex-end", justifyContent: "space-between",
    padding: "0 16px 14px",
    paddingTop: "max(20px, env(safe-area-inset-top))",
    borderBottom: `1px solid ${BORDER}`,
    background: BG,
    flexShrink: 0,
  },
  appLabel: { fontSize: 10, letterSpacing: "0.22em", color: GOLD, textTransform: "uppercase", marginBottom: 3 },
  appTitle: { fontSize: 26, fontWeight: 700, color: "#f0e8d0", lineHeight: 1 },
  addBtn:   { background: GOLD, color: "#000", borderRadius: 22, padding: "10px 18px", fontSize: 15, fontWeight: 700 },

  searchWrap: {
    display: "flex", alignItems: "center",
    margin: "12px 16px 0",
    background: CARD,
    borderRadius: 12,
    border: `1px solid ${BORDER}`,
    overflow: "hidden",
    flexShrink: 0,
  },
  searchIcon:  { padding: "0 10px 0 14px", color: MUTED, fontSize: 15, flexShrink: 0 },
  searchInput: { flex: 1, background: "transparent", border: "none", outline: "none", color: TEXT, fontSize: 15, padding: "13px 0", fontFamily: "inherit" },
  clearBtn:    { background: "transparent", color: MUTED, borderRadius: 0, padding: "10px 14px", fontSize: 18 },

  list: { flex: 1, overflowY: "auto", padding: "12px 16px 0", WebkitOverflowScrolling: "touch" },
  empty: { textAlign: "center", padding: "60px 20px", whiteSpace: "pre-line" },

  row: {
    background: CARD,
    border: `1px solid ${BORDER}`,
    borderRadius: 14,
    padding: "13px 12px",
    display: "flex", alignItems: "center", gap: 8,
    position: "relative", zIndex: 1,
    willChange: "transform",
  },
  rowTitle: { fontSize: 15, fontWeight: 600, color: "#f0e8d0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  rowSub:   { fontSize: 12, color: "#666", marginTop: 2 },
  rowDelete: { position: "absolute", right: 0, top: 0, bottom: 0, background: "#c0504d", borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 16, minWidth: 80 },
  rowDeleteBtn: { background: "transparent", color: "#fff", fontSize: 22, padding: "8px" },
  editBtn: { background: "#1c2030", color: MUTED, borderRadius: 10, padding: "8px 10px", fontSize: 15, flexShrink: 0 },
  singBtn: { background: GOLD, color: "#000", borderRadius: 22, padding: "9px 14px", fontSize: 14, fontWeight: 700, flexShrink: 0 },

  // Delete sheet
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "flex-end", zIndex: 200 },
  sheet: {
    background: "#181b24", borderRadius: "20px 20px 0 0",
    padding: "28px 20px",
    paddingBottom: "max(28px, env(safe-area-inset-bottom))",
    width: "100%", textAlign: "center",
  },
  sheetTitle:  { fontWeight: 700, fontSize: 18, color: "#f0e8d0", marginBottom: 6 },
  sheetSub:    { color: MUTED, fontSize: 14, marginBottom: 24 },
  delConfirm:  { display: "block", width: "100%", background: "#c0504d", color: "#fff", borderRadius: 14, padding: "15px", fontSize: 16, fontWeight: 700, marginBottom: 10 },
  delCancel:   { display: "block", width: "100%", background: "#1c2030", color: TEXT, borderRadius: 14, padding: "15px", fontSize: 16 },

  // Edit
  editHeader: {
    display: "flex", alignItems: "center", gap: 12,
    padding: "0 16px 14px",
    paddingTop: "max(16px, env(safe-area-inset-top))",
    borderBottom: `1px solid ${BORDER}`,
    background: BG,
    flexShrink: 0,
  },
  backBtn:   { background: "#1c2030", color: MUTED, borderRadius: 10, padding: "9px 14px", fontSize: 14 },
  pageTitle: { fontSize: 18, fontWeight: 700, color: "#f0e8d0" },
  editBody:  { flex: 1, overflowY: "auto", padding: "8px 16px", paddingBottom: "max(24px, env(safe-area-inset-bottom))", WebkitOverflowScrolling: "touch" },
  label:     { display: "block", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: MUTED, marginBottom: 6, marginTop: 18 },
  input:     { width: "100%", background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "13px 14px", color: TEXT, fontSize: 15, fontFamily: "inherit", outline: "none", display: "block" },
  pasteBtn:  { position: "absolute", top: 10, right: 10, background: GOLD, color: "#000", borderRadius: 10, padding: "6px 10px", fontSize: 12, fontWeight: 700 },
  sliderRow: { display: "flex", alignItems: "center", gap: 10, margin: "6px 0 4px" },
  sliderEmoji: { fontSize: 20, flexShrink: 0 },
  sliderFull:  { flex: 1, accentColor: GOLD },
  saveBtn:   { display: "block", width: "100%", borderRadius: 14, padding: "16px", fontSize: 16, fontWeight: 700, marginTop: 28, marginBottom: 8 },

  // Sing
  singWrap: {
    position: "fixed", inset: 0,
    background: "#07090e",
    display: "flex", flexDirection: "column",
    fontFamily: "'Georgia', serif",
    touchAction: "none",
  },
  singBar: {
    display: "flex", alignItems: "center", gap: 8,
    padding: "8px 12px",
    paddingTop: "max(10px, env(safe-area-inset-top))",
    background: "rgba(10,12,18,0.9)",
    backdropFilter: "blur(16px)",
    borderBottom: `1px solid ${BORDER}`,
    flexShrink: 0,
    zIndex: 10,
    minHeight: 56,
  },
  iconBtn:   { background: "#1c2030", color: "#aaa", borderRadius: 10, padding: "9px 12px", fontSize: 15, flexShrink: 0 },
  playBtn:   { borderRadius: 24, width: 46, height: 46, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  singTitle: { fontSize: 13, fontWeight: 700, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  singArtist: { fontSize: 11, color: "#555", marginTop: 1 },
  slider:    { width: 60, accentColor: GOLD, flexShrink: 0 },

  lyricsScroll: {
    flex: 1, overflow: "hidden", position: "relative",
    touchAction: "none",
  },
  lyricsInner: { padding: "70px 0 160px" },
  fadeTop: { position: "absolute", top: 0, left: 0, right: 0, height: 70, background: "linear-gradient(to bottom, #07090e 30%, transparent)", zIndex: 2, pointerEvents: "none" },
  fadeBot: { position: "absolute", bottom: 0, left: 0, right: 0, height: 130, background: "linear-gradient(to top, #07090e 40%, transparent)", zIndex: 2, pointerEvents: "none" },
  tapHint: {
    position: "absolute", bottom: 50, left: 0, right: 0, zIndex: 3,
    display: "flex", justifyContent: "space-between", padding: "0 24px",
    pointerEvents: "none",
    color: "#fff",
  },
};
