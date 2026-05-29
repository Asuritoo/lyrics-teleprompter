import { useState, useEffect, useRef, useCallback } from "react";

const STORAGE_KEY = "lyrics_v4";
const BACKEND = "https://lyrics-backend-production.up.railway.app";

// ─── LRC parser ──────────────────────────────────────────────────────────────
function parseLRC(lrc) {
  if (!lrc) return null;
  const lines = [];
  const re = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/;
  for (const raw of lrc.split("\n")) {
    const m = raw.match(re);
    if (!m) continue;
    const time = parseInt(m[1]) * 60 + parseFloat(m[2] + "." + m[3]);
    const text = m[4].trim();
    if (text) lines.push({ time, text });
  }
  return lines.length ? lines : null;
}

function load() {
  try { const r = localStorage.getItem(STORAGE_KEY); if (r) return JSON.parse(r); } catch {}
  return [];
}
function save(s) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {} }
function vibrate(ms) { try { navigator.vibrate?.(ms); } catch {} }

function useWakeLock(on) {
  const ref = useRef(null);
  useEffect(() => {
    if (!on) { ref.current?.release?.(); ref.current = null; return; }
    navigator.wakeLock?.request("screen").then(l => ref.current = l).catch(() => {});
    return () => { ref.current?.release?.(); ref.current = null; };
  }, [on]);
}

// ════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [songs, setSongs]       = useState(load);
  const [view, setView]         = useState("lib"); // lib | edit | sing | karaoke
  const [active, setActive]     = useState(null);
  const [editTarget, setEdit]   = useState(null);
  const [form, setForm]         = useState(emptyForm());
  const [search, setSearch]     = useState("");
  const [delId, setDelId]       = useState(null);

  // Karaoke state
  const [playing, setPlaying]   = useState(false);
  const [elapsed, setElapsed]   = useState(0);
  const [locked, setLocked]     = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);

  // Search lyrics state
  const [searchQuery, setSearchQuery] = useState({ title: "", artist: "" });
  const [searching, setSearching]     = useState(false);
  const [searchErr, setSearchErr]     = useState("");
  const [searchResults, setSearchResults] = useState(null);

  const startTime   = useRef(null);
  const rafRef      = useRef(null);
  const linesRef    = useRef(null);
  const activeLineRef = useRef(null);

  useWakeLock(view === "karaoke" && playing);
  useEffect(() => save(songs), [songs]);

  // ── Timer ──
  useEffect(() => {
    if (view !== "karaoke" || !playing) { cancelAnimationFrame(rafRef.current); return; }
    const tick = (ts) => {
      if (!startTime.current) startTime.current = ts - elapsed * 1000;
      const e = (ts - startTime.current) / 1000;
      setElapsed(e);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, view]);

  // ── Active line ──
  useEffect(() => {
    if (!active?.syncedLines) return;
    const lines = active.syncedLines;
    let idx = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].time <= elapsed) idx = i;
      else break;
    }
    setActiveIdx(idx);
  }, [elapsed, active]);

  // ── Scroll active line into view ──
  useEffect(() => {
    if (activeLineRef.current && linesRef.current) {
      const container = linesRef.current;
      const el = activeLineRef.current;
      const top = el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2;
      container.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    }
  }, [activeIdx]);

  // ── Actions ──
  function startKaraoke(song) {
    setActive(song);
    setElapsed(0);
    startTime.current = null;
    setPlaying(false);
    setLocked(false);
    setActiveIdx(0);
    setView("karaoke");
  }

  function stopKaraoke() {
    cancelAnimationFrame(rafRef.current);
    setPlaying(false);
    setActive(null);
    setElapsed(0);
    setView("lib");
  }

  function togglePlay() {
    if (!playing) startTime.current = null; // recalibrate
    setPlaying(p => !p);
    vibrate(8);
  }

  function seek(delta) {
    setElapsed(e => Math.max(0, e + delta));
    startTime.current = null;
    vibrate(12);
  }

  function openEdit(song = null) {
    setForm(song ? { ...song } : emptyForm());
    setEdit(song);
    setSearchResults(null);
    setSearchErr("");
    setSearchQuery({ title: song?.title || "", artist: song?.artist || "" });
    setView("edit");
  }

  function saveForm(overrides = {}) {
    const data = { ...form, ...overrides };
    if (!data.title.trim() || (!data.lyrics.trim() && !data.syncedLines)) return;
    if (editTarget) setSongs(s => s.map(x => x.id === editTarget.id ? { ...x, ...data } : x));
    else setSongs(s => [{ id: Date.now().toString(), ...data }, ...s]);
    setView("lib");
  }

  async function fetchLyrics() {
    if (!searchQuery.title.trim()) return;
    setSearching(true);
    setSearchErr("");
    setSearchResults(null);
    try {
      const url = `${BACKEND}/search?title=${encodeURIComponent(searchQuery.title)}&artist=${encodeURIComponent(searchQuery.artist)}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error("Introuvable");
      const data = await r.json();
      const synced = parseLRC(data.synced);
      setSearchResults({ ...data, syncedLines: synced });
      setForm(f => ({
        ...f,
        title: data.title || f.title,
        artist: data.artist || f.artist,
        lyrics: data.plain || (synced ? synced.map(l => l.text).join("\n") : ""),
        syncedLines: synced,
      }));
      if (synced) setSearchErr("✅ Paroles synchronisées trouvées !");
      else setSearchErr("⚠️ Paroles trouvées mais sans synchronisation. Le karaoké auto ne sera pas disponible.");
    } catch {
      setSearchErr("❌ Chanson introuvable. Essaie un autre titre ou artiste.");
    } finally {
      setSearching(false);
    }
  }

  const filtered = songs.filter(s =>
    s.title.toLowerCase().includes(search.toLowerCase()) ||
    (s.artist || "").toLowerCase().includes(search.toLowerCase())
  );

  // ════════════════════════════════════════════════════════════════════════════
  // KARAOKE VIEW
  // ════════════════════════════════════════════════════════════════════════════
  if (view === "karaoke" && active) {
    const lines = active.syncedLines;
    const hasSynced = !!lines;

    return (
      <div style={S.singWrap}>
        <style>{`
          * { -webkit-tap-highlight-color: transparent; box-sizing: border-box; }
          html,body { overflow:hidden; position:fixed; width:100%; height:100%; overscroll-behavior:none; }
          @keyframes pulse { 0%,100%{opacity:.3} 50%{opacity:.9} }
          @keyframes fadein { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:none} }
        `}</style>

        {/* Top bar */}
        <div style={S.singBar}>
          {!locked ? <>
            <Btn onClick={stopKaraoke} style={S.iconBtn}>✕</Btn>
            <div style={{ flex:1, minWidth:0, padding:"0 6px" }}>
              <div style={S.singTitle}>{active.title}</div>
              {active.artist && <div style={S.singArtist}>{active.artist}</div>}
            </div>
            {/* Rewind */}
            <Btn onClick={() => seek(-3)} style={S.iconBtn}>−3s</Btn>
            <Btn onClick={togglePlay} style={{ ...S.playBtn, background: playing ? GOLD : "#232630" }}>
              <span style={{ color: playing ? "#000":"#fff", fontSize:20 }}>{playing ? "⏸":"▶"}</span>
            </Btn>
            <Btn onClick={() => seek(3)} style={S.iconBtn}>+3s</Btn>
            <Btn onClick={() => { vibrate(20); setLocked(true); }} style={S.iconBtn}>🔒</Btn>
          </> : <>
            <span style={{ color:"#444", fontSize:12, flex:1 }}>🔒 Verrouillé</span>
            <Btn onClick={togglePlay} style={{ ...S.playBtn, background: playing ? GOLD : "#232630" }}>
              <span style={{ color: playing ? "#000":"#fff", fontSize:20 }}>{playing ? "⏸":"▶"}</span>
            </Btn>
            <Btn onClick={() => { vibrate(20); setLocked(false); }} style={{ ...S.iconBtn, color:GOLD }}>🔓</Btn>
          </>}
        </div>

        {/* Timer */}
        <div style={{ textAlign:"center", color:"#333", fontSize:12, padding:"4px 0", flexShrink:0, fontFamily:"monospace" }}>
          {fmt(elapsed)}
          {!playing && elapsed === 0 && (
            <span style={{ color:"#444", marginLeft:12, animation:"pulse 2s infinite" }}>
              ▶ Lance ta musique puis appuie sur ▶
            </span>
          )}
        </div>

        {/* Lyrics */}
        <div ref={linesRef} style={S.lyricsScroll}>
          <div style={S.fadeTop} />
          <div style={S.fadeBot} />
          <div style={{ padding:"80px 20px 180px" }}>
            {hasSynced ? lines.map((line, i) => {
              const isPast   = i < activeIdx;
              const isCurrent = i === activeIdx;
              const isFuture = i > activeIdx;
              return (
                <div
                  key={i}
                  ref={isCurrent ? activeLineRef : null}
                  style={{
                    textAlign: "center",
                    margin: "0 auto",
                    maxWidth: 560,
                    padding: "6px 0",
                    fontSize: isCurrent ? (active.fontSize ?? 26) : (active.fontSize ?? 26) * 0.78,
                    fontWeight: isCurrent ? 700 : 400,
                    color: isCurrent ? GOLD : isPast ? "#2a2d38" : "#666",
                    transition: "all 0.3s ease",
                    animation: isCurrent ? "fadein 0.3s ease" : "none",
                    letterSpacing: isCurrent ? "0.02em" : "0",
                    lineHeight: 1.5,
                  }}
                >
                  {line.text}
                </div>
              );
            }) : (
              // No synced lines — fallback to plain scroll
              active.lyrics?.split("\n").map((line, i) => (
                <div key={i} style={{ textAlign:"center", fontSize: active.fontSize ?? 24, color:"#f0e8d0", padding:"2px 0", lineHeight:1.6, maxWidth:560, margin:"0 auto" }}>
                  {line || <br />}
                </div>
              ))
            )}
            <div style={{ height:100 }} />
          </div>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // EDIT VIEW
  // ════════════════════════════════════════════════════════════════════════════
  if (view === "edit") {
    const ok = form.title?.trim() && (form.lyrics?.trim() || form.syncedLines);
    return (
      <div style={S.page}>
        <style>{`*{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}html,body{overscroll-behavior:none;}`}</style>
        <div style={S.editHeader}>
          <Btn onClick={() => setView("lib")} style={S.backBtn}>← Retour</Btn>
          <span style={S.pageTitle}>{editTarget ? "Modifier" : "Nouvelle chanson"}</span>
        </div>
        <div style={S.editBody}>

          {/* ── Recherche automatique ── */}
          <div style={{ background:"#0e1520", border:`1px solid ${GOLD}33`, borderRadius:14, padding:14, marginBottom:4 }}>
            <div style={{ fontSize:11, letterSpacing:"0.15em", color:GOLD, textTransform:"uppercase", marginBottom:10 }}>
              🔍 Recherche automatique
            </div>
            <input
              value={searchQuery.title}
              onChange={e => setSearchQuery(q => ({ ...q, title: e.target.value }))}
              placeholder="Titre de la chanson *"
              style={{ ...S.input, marginBottom:8 }}
              onKeyDown={e => e.key === "Enter" && fetchLyrics()}
            />
            <input
              value={searchQuery.artist}
              onChange={e => setSearchQuery(q => ({ ...q, artist: e.target.value }))}
              placeholder="Artiste (optionnel mais recommandé)"
              style={{ ...S.input, marginBottom:10 }}
              onKeyDown={e => e.key === "Enter" && fetchLyrics()}
            />
            <Btn onClick={fetchLyrics} style={{
              background: searching ? "#1c2030" : GOLD,
              color: searching ? "#555" : "#000",
              borderRadius:12, padding:"12px", fontSize:15, fontWeight:700, width:"100%",
            }}>
              {searching ? "Recherche en cours..." : "🎵 Trouver les paroles"}
            </Btn>
            {searchErr && (
              <div style={{ marginTop:10, fontSize:13, color: searchErr.startsWith("✅") ? "#7ec87e" : searchErr.startsWith("⚠️") ? GOLD : "#e07070" }}>
                {searchErr}
              </div>
            )}
          </div>

          <div style={{ textAlign:"center", color:"#333", fontSize:12, margin:"12px 0" }}>— ou entre les paroles manuellement —</div>

          <label style={S.label}>Titre *</label>
          <input value={form.title || ""} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            placeholder="Ex : Bohemian Rhapsody" style={S.input} />

          <label style={S.label}>Artiste</label>
          <input value={form.artist || ""} onChange={e => setForm(f => ({ ...f, artist: e.target.value }))}
            placeholder="Ex : Queen" style={S.input} />

          <label style={S.label}>Paroles</label>
          <div style={{ position:"relative" }}>
            <textarea value={form.lyrics || ""} onChange={e => setForm(f => ({ ...f, lyrics: e.target.value, syncedLines: null }))}
              placeholder={"Colle les paroles ici...\n\nLaisse une ligne vide entre les strophes."}
              rows={10} style={{ ...S.input, resize:"none", fontFamily:"monospace", fontSize:13, lineHeight:1.6, paddingTop:44 }} />
            <Btn onClick={() => {
              navigator.clipboard?.readText?.().then(t => {
                if (t) setForm(f => ({ ...f, lyrics: t, syncedLines: null }));
              }).catch(() => {});
            }} style={S.pasteBtn}>📋 Coller</Btn>
          </div>

          {form.syncedLines && (
            <div style={{ background:"#0a1a0a", border:"1px solid #2a4a2a", borderRadius:10, padding:"10px 14px", marginTop:8, fontSize:13, color:"#7ec87e" }}>
              ✅ {form.syncedLines.length} lignes synchronisées — mode karaoké disponible !
            </div>
          )}

          <label style={S.label}>Taille du texte</label>
          <div style={S.sliderRow}>
            <span style={{ fontSize:14, color:MUTED }}>A</span>
            <input type="range" min={16} max={40} value={form.fontSize ?? 24}
              onChange={e => setForm(f => ({ ...f, fontSize: Number(e.target.value) }))} style={S.sliderFull} />
            <span style={{ fontSize:22, color:MUTED }}>A</span>
          </div>

          <Btn onClick={() => saveForm()} style={{
            ...S.saveBtn,
            background: ok ? GOLD : "#1e2128",
            color: ok ? "#000" : "#555",
            opacity: ok ? 1 : 0.5,
          }}>
            {editTarget ? "💾 Enregistrer" : "➕ Ajouter"}
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
      <style>{`*{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}html,body{overscroll-behavior:none;height:100%;}`}</style>

      <div style={S.libHeader}>
        <div>
          <div style={S.appLabel}>🎤 LYRICS</div>
          <div style={S.appTitle}>Ma bibliothèque</div>
        </div>
        <Btn onClick={() => openEdit()} style={S.addBtn}>+ Nouvelle</Btn>
      </div>

      <div style={S.searchWrap}>
        <span style={S.searchIcon}>🔍</span>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Rechercher..." style={S.searchInput} />
        {search && <Btn onClick={() => setSearch("")} style={S.clearBtn}>✕</Btn>}
      </div>

      <div style={S.list}>
        {filtered.length === 0 && (
          <div style={S.empty}>
            <div style={{ fontSize:44, marginBottom:12 }}>🎵</div>
            <div style={{ color:MUTED, fontSize:15 }}>
              {search ? "Aucun résultat" : "Aucune chanson.\nAppuie sur + pour commencer."}
            </div>
          </div>
        )}
        {filtered.map(song => (
          <SongRow key={song.id} song={song}
            onSing={() => startKaraoke(song)}
            onEdit={() => openEdit(song)}
            onDelete={() => setDelId(song.id)}
          />
        ))}
        <div style={{ height:40 }} />
      </div>

      {delId && (
        <div style={S.overlay} onClick={() => setDelId(null)}>
          <div style={S.sheet} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize:28, marginBottom:8 }}>🗑️</div>
            <div style={S.sheetTitle}>Supprimer cette chanson ?</div>
            <div style={S.sheetSub}>Cette action est irréversible.</div>
            <Btn onClick={() => { vibrate(20); setSongs(s => s.filter(x => x.id !== delId)); setDelId(null); }} style={S.delConfirm}>Supprimer</Btn>
            <Btn onClick={() => setDelId(null)} style={S.delCancel}>Annuler</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Song Row ─────────────────────────────────────────────────────────────────
function SongRow({ song, onSing, onEdit, onDelete }) {
  const [dx, setDx] = useState(0);
  const startX = useRef(null);
  function ts(e) { startX.current = e.touches[0].clientX; }
  function tm(e) {
    if (startX.current == null) return;
    const d = e.touches[0].clientX - startX.current;
    if (d < 0) setDx(Math.max(d, -80)); else setDx(Math.min(d, 0));
  }
  function te() { if (dx < -50) setDx(-80); else setDx(0); startX.current = null; }
  return (
    <div style={{ position:"relative", marginBottom:10, borderRadius:14, overflow:"hidden" }}>
      <div style={S.rowDelete}>
        <Btn onClick={onDelete} style={S.rowDeleteBtn}>🗑️</Btn>
      </div>
      <div style={{ ...S.row, transform:`translateX(${dx}px)`, transition: dx===0||dx===-80 ? "transform .25s ease":"none" }}
        onTouchStart={ts} onTouchMove={tm} onTouchEnd={te}>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={S.rowTitle}>{song.title}</div>
          <div style={S.rowSub}>
            {song.artist || <em style={{ opacity:.5 }}>Artiste inconnu</em>}
            {song.syncedLines && <span style={{ color:GOLD, marginLeft:8, fontSize:11 }}>● karaoké</span>}
          </div>
        </div>
        <Btn onClick={onEdit} style={S.editBtn}>✏️</Btn>
        <Btn onClick={onSing} style={S.singBtn}>
          {song.syncedLines ? "🎤 Karaoké" : "▶ Chanter"}
        </Btn>
      </div>
    </div>
  );
}

function Btn({ onClick, style, children }) {
  return <button onClick={onClick} style={{ border:"none", cursor:"pointer", fontFamily:"inherit", WebkitTapHighlightColor:"transparent", ...style }}>{children}</button>;
}

function emptyForm() { return { title:"", artist:"", lyrics:"", syncedLines:null, fontSize:24 }; }

function fmt(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
}

// ─── Constants & Styles ───────────────────────────────────────────────────────
const GOLD  = "#e8c97a";
const BG    = "#0d0f14";
const CARD  = "#13161d";
const BORDER = "rgba(255,255,255,0.07)";
const TEXT   = "#e0d8c8";
const MUTED  = "#555";

const S = {
  page:      { minHeight:"100dvh", background:BG, color:TEXT, fontFamily:"'Georgia',serif", display:"flex", flexDirection:"column" },
  libHeader: { display:"flex", alignItems:"flex-end", justifyContent:"space-between", padding:"0 16px 14px", paddingTop:"max(20px,env(safe-area-inset-top))", borderBottom:`1px solid ${BORDER}`, background:BG, flexShrink:0 },
  appLabel:  { fontSize:10, letterSpacing:"0.22em", color:GOLD, textTransform:"uppercase", marginBottom:3 },
  appTitle:  { fontSize:26, fontWeight:700, color:"#f0e8d0", lineHeight:1 },
  addBtn:    { background:GOLD, color:"#000", borderRadius:22, padding:"10px 18px", fontSize:15, fontWeight:700 },
  searchWrap:{ display:"flex", alignItems:"center", margin:"12px 16px 0", background:CARD, borderRadius:12, border:`1px solid ${BORDER}`, overflow:"hidden", flexShrink:0 },
  searchIcon:{ padding:"0 10px 0 14px", color:MUTED, fontSize:15, flexShrink:0 },
  searchInput:{ flex:1, background:"transparent", border:"none", outline:"none", color:TEXT, fontSize:15, padding:"13px 0", fontFamily:"inherit" },
  clearBtn:  { background:"transparent", color:MUTED, borderRadius:0, padding:"10px 14px", fontSize:18 },
  list:      { flex:1, overflowY:"auto", padding:"12px 16px 0", WebkitOverflowScrolling:"touch" },
  empty:     { textAlign:"center", padding:"60px 20px", whiteSpace:"pre-line" },
  row:       { background:CARD, border:`1px solid ${BORDER}`, borderRadius:14, padding:"13px 12px", display:"flex", alignItems:"center", gap:8, position:"relative", zIndex:1, willChange:"transform" },
  rowTitle:  { fontSize:15, fontWeight:600, color:"#f0e8d0", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" },
  rowSub:    { fontSize:12, color:"#666", marginTop:2 },
  rowDelete: { position:"absolute", right:0, top:0, bottom:0, background:"#c0504d", borderRadius:14, display:"flex", alignItems:"center", justifyContent:"flex-end", paddingRight:16, minWidth:80 },
  rowDeleteBtn:{ background:"transparent", color:"#fff", fontSize:22, padding:"8px" },
  editBtn:   { background:"#1c2030", color:MUTED, borderRadius:10, padding:"8px 10px", fontSize:15, flexShrink:0 },
  singBtn:   { background:GOLD, color:"#000", borderRadius:22, padding:"9px 14px", fontSize:14, fontWeight:700, flexShrink:0, whiteSpace:"nowrap" },
  overlay:   { position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", display:"flex", alignItems:"flex-end", zIndex:200 },
  sheet:     { background:"#181b24", borderRadius:"20px 20px 0 0", padding:"28px 20px", paddingBottom:"max(28px,env(safe-area-inset-bottom))", width:"100%", textAlign:"center" },
  sheetTitle:{ fontWeight:700, fontSize:18, color:"#f0e8d0", marginBottom:6 },
  sheetSub:  { color:MUTED, fontSize:14, marginBottom:24 },
  delConfirm:{ display:"block", width:"100%", background:"#c0504d", color:"#fff", borderRadius:14, padding:"15px", fontSize:16, fontWeight:700, marginBottom:10 },
  delCancel: { display:"block", width:"100%", background:"#1c2030", color:TEXT, borderRadius:14, padding:"15px", fontSize:16 },
  editHeader:{ display:"flex", alignItems:"center", gap:12, padding:"0 16px 14px", paddingTop:"max(16px,env(safe-area-inset-top))", borderBottom:`1px solid ${BORDER}`, background:BG, flexShrink:0 },
  backBtn:   { background:"#1c2030", color:MUTED, borderRadius:10, padding:"9px 14px", fontSize:14 },
  pageTitle: { fontSize:18, fontWeight:700, color:"#f0e8d0" },
  editBody:  { flex:1, overflowY:"auto", padding:"8px 16px", paddingBottom:"max(24px,env(safe-area-inset-bottom))", WebkitOverflowScrolling:"touch" },
  label:     { display:"block", fontSize:11, letterSpacing:"0.12em", textTransform:"uppercase", color:MUTED, marginBottom:6, marginTop:18 },
  input:     { width:"100%", background:CARD, border:`1px solid ${BORDER}`, borderRadius:12, padding:"13px 14px", color:TEXT, fontSize:15, fontFamily:"inherit", outline:"none", display:"block" },
  pasteBtn:  { position:"absolute", top:10, right:10, background:GOLD, color:"#000", borderRadius:10, padding:"6px 10px", fontSize:12, fontWeight:700 },
  sliderRow: { display:"flex", alignItems:"center", gap:10, margin:"6px 0 4px" },
  sliderFull:{ flex:1, accentColor:GOLD },
  saveBtn:   { display:"block", width:"100%", borderRadius:14, padding:"16px", fontSize:16, fontWeight:700, marginTop:28, marginBottom:8 },
  singWrap:  { position:"fixed", inset:0, background:"#07090e", display:"flex", flexDirection:"column", fontFamily:"'Georgia',serif", touchAction:"none" },
  singBar:   { display:"flex", alignItems:"center", gap:8, padding:"8px 12px", paddingTop:"max(10px,env(safe-area-inset-top))", background:"rgba(10,12,18,0.9)", backdropFilter:"blur(16px)", borderBottom:`1px solid ${BORDER}`, flexShrink:0, zIndex:10, minHeight:56 },
  iconBtn:   { background:"#1c2030", color:"#aaa", borderRadius:10, padding:"9px 12px", fontSize:13, flexShrink:0, whiteSpace:"nowrap" },
  playBtn:   { borderRadius:24, width:46, height:46, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 },
  singTitle: { fontSize:13, fontWeight:700, color:"#fff", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" },
  singArtist:{ fontSize:11, color:"#555", marginTop:1 },
  lyricsScroll:{ flex:1, overflowY:"auto", position:"relative", WebkitOverflowScrolling:"touch" },
  lyricsInner: { padding:"70px 0 160px" },
  fadeTop:   { position:"absolute", top:0, left:0, right:0, height:80, background:"linear-gradient(to bottom,#07090e 30%,transparent)", zIndex:2, pointerEvents:"none" },
  fadeBot:   { position:"absolute", bottom:0, left:0, right:0, height:140, background:"linear-gradient(to top,#07090e 40%,transparent)", zIndex:2, pointerEvents:"none" },
};
