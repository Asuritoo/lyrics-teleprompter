import { useState, useEffect, useRef } from "react";

const STORAGE_KEY = "lyrics_songs";

const defaultSongs = [
  {
    id: "demo1",
    title: "Exemple — Copiez vos paroles ici",
    artist: "",
    lyrics: `Couplet 1
Remplacez ce texte par vos vraies paroles
Collez n'importe quelle chanson
Et chantez par-dessus !

Refrain
Les paroles défilent à votre rythme
Ajustez la vitesse avec le curseur
Appuyez sur Espace pour pause / reprise

Couplet 2
Ajoutez autant de chansons que vous voulez
Elles sont sauvegardées automatiquement
Bonne chanson ! 🎤`,
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

export default function App() {
  const [songs, setSongs] = useState(loadSongs);
  const [view, setView] = useState("library");
  const [editSong, setEditSong] = useState(null);
  const [activeSong, setActiveSong] = useState(null);
  const [speed, setSpeed] = useState(40);
  const [playing, setPlaying] = useState(false);
  const [scrollY, setScrollY] = useState(0);
  const [form, setForm] = useState({ title: "", artist: "", lyrics: "" });
  const [confirmDelete, setConfirmDelete] = useState(null);

  const rafRef = useRef(null);
  const lastTRef = useRef(null);
  const containerRef = useRef(null);
  const contentRef = useRef(null);

  useEffect(() => saveSongs(songs), [songs]);

  useEffect(() => {
    if (view !== "sing") return;
    const onKey = (e) => {
      if (e.code === "Space") { e.preventDefault(); setPlaying(p => !p); }
      if (e.code === "Escape") { stopSinging(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view]);

  useEffect(() => {
    if (view !== "sing") return;
    if (!playing) { lastTRef.current = null; cancelAnimationFrame(rafRef.current); return; }
    const step = (ts) => {
      if (lastTRef.current == null) lastTRef.current = ts;
      const dt = (ts - lastTRef.current) / 1000;
      lastTRef.current = ts;
      setScrollY(prev => {
        const maxScroll = contentRef.current
          ? Math.max(0, contentRef.current.scrollHeight - containerRef.current.clientHeight)
          : 0;
        const next = prev + speed * dt;
        if (next >= maxScroll) { setPlaying(false); return maxScroll; }
        return next;
      });
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, speed, view]);

  useEffect(() => {
    if (containerRef.current) containerRef.current.scrollTop = scrollY;
  }, [scrollY]);

  function startSinging(song) {
    setActiveSong(song);
    setScrollY(0);
    setPlaying(false);
    setView("sing");
  }

  function stopSinging() {
    setPlaying(false);
    cancelAnimationFrame(rafRef.current);
    setView("library");
    setActiveSong(null);
    setScrollY(0);
  }

  function openEdit(song = null) {
    if (song) {
      setForm({ title: song.title, artist: song.artist || "", lyrics: song.lyrics });
      setEditSong(song);
    } else {
      setForm({ title: "", artist: "", lyrics: "" });
      setEditSong(null);
    }
    setView("edit");
  }

  function saveForm() {
    if (!form.title.trim() || !form.lyrics.trim()) return;
    if (editSong) {
      setSongs(s => s.map(x => x.id === editSong.id ? { ...x, ...form } : x));
    } else {
      setSongs(s => [...s, { id: Date.now().toString(), ...form }]);
    }
    setView("library");
  }

  function deleteSong(id) {
    setSongs(s => s.filter(x => x.id !== id));
    setConfirmDelete(null);
  }

  if (view === "sing" && activeSong) {
    return (
      <div style={{ position:"fixed", inset:0, background:"#080a0f", display:"flex", flexDirection:"column", fontFamily:"Georgia, serif", userSelect:"none" }}>
        <div style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 16px", background:"rgba(255,255,255,0.04)", borderBottom:"1px solid rgba(255,255,255,0.08)", flexShrink:0 }}>
          <button onClick={stopSinging} style={btnStyle("#1a1d24","#fff")}>← Retour</button>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ color:"#fff", fontWeight:700, fontSize:14, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{activeSong.title}</div>
            {activeSong.artist && <div style={{ color:"#888", fontSize:11 }}>{activeSong.artist}</div>}
          </div>
          <input type="range" min={8} max={140} value={speed} onChange={e => setSpeed(Number(e.target.value))} style={{ width:70, accentColor:"#e8c97a" }} />
          <button onClick={() => setPlaying(p => !p)} style={{ ...btnStyle(playing?"#e8c97a":"#2a2d36", playing?"#000":"#fff"), fontWeight:700, fontSize:18, width:44, height:44, borderRadius:22, padding:0 }}>
            {playing ? "⏸" : "▶"}
          </button>
          <button onClick={() => { setScrollY(0); setPlaying(false); }} style={btnStyle("#1a1d24","#fff")}>↺</button>
        </div>

        <div ref={containerRef} style={{ flex:1, overflow:"hidden", padding:"40px 24px 120px", position:"relative" }}>
          <div style={{ position:"absolute", top:0, left:0, right:0, height:60, background:"linear-gradient(to bottom, #080a0f, transparent)", zIndex:2, pointerEvents:"none" }} />
          <div style={{ position:"absolute", bottom:0, left:0, right:0, height:120, background:"linear-gradient(to top, #080a0f, transparent)", zIndex:2, pointerEvents:"none" }} />
          <div ref={contentRef}>
            {activeSong.lyrics.split("\n").map((line, i) => {
              const isBlank = line.trim() === "";
              return (
                <div key={i} style={{ fontSize:isBlank?12:24, lineHeight:isBlank?"24px":"1.6", color:isBlank?"transparent":"#f0e6c8", textAlign:"center", maxWidth:600, margin:"0 auto", padding:isBlank?"8px 0":"2px 0" }}>
                  {isBlank ? "·" : line}
                </div>
              );
            })}
            <div style={{ height:80 }} />
          </div>
        </div>
      </div>
    );
  }

  if (view === "edit") {
    const valid = form.title.trim() && form.lyrics.trim();
    return (
      <div style={{ minHeight:"100vh", background:"#0d0f14", color:"#e8e0d0", fontFamily:"Georgia, serif", padding:"24px 20px", boxSizing:"border-box" }}>
        <div style={{ maxWidth:600, margin:"0 auto" }}>
          <button onClick={() => setView("library")} style={{ ...btnStyle("#1a1d24","#aaa"), marginBottom:20, fontSize:13 }}>← Annuler</button>
          <h2 style={{ margin:"0 0 24px", fontSize:22, fontWeight:700, color:"#f0e6c8" }}>{editSong ? "Modifier" : "Nouvelle chanson"}</h2>

          <label style={labelStyle}>Titre *</label>
          <input value={form.title} onChange={e => setForm(f=>({...f,title:e.target.value}))} placeholder="Ex : Bohemian Rhapsody" style={inputStyle} />

          <label style={labelStyle}>Artiste</label>
          <input value={form.artist} onChange={e => setForm(f=>({...f,artist:e.target.value}))} placeholder="Ex : Queen" style={inputStyle} />

          <label style={labelStyle}>Paroles *</label>
          <textarea value={form.lyrics} onChange={e => setForm(f=>({...f,lyrics:e.target.value}))} placeholder={"Collez les paroles ici...\n\nLaissez une ligne vide entre les strophes."} rows={16} style={{ ...inputStyle, resize:"vertical", fontFamily:"monospace", fontSize:14, lineHeight:1.6 }} />

          <button onClick={saveForm} disabled={!valid} style={{ ...btnStyle(valid?"#e8c97a":"#2a2d36", valid?"#000":"#555"), width:"100%", padding:"14px", fontSize:16, fontWeight:700, marginTop:8, opacity:valid?1:0.5, cursor:valid?"pointer":"not-allowed" }}>
            {editSong ? "Enregistrer" : "Ajouter la chanson"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight:"100vh", background:"#0d0f14", color:"#e8e0d0", fontFamily:"Georgia, serif" }}>
      <div style={{ padding:"28px 20px 20px", borderBottom:"1px solid rgba(255,255,255,0.07)", background:"rgba(255,255,255,0.02)" }}>
        <div style={{ maxWidth:640, margin:"0 auto", display:"flex", alignItems:"flex-end", justifyContent:"space-between" }}>
          <div>
            <div style={{ fontSize:11, letterSpacing:"0.2em", color:"#e8c97a", textTransform:"uppercase", marginBottom:4 }}>🎤 Téléprompter</div>
            <h1 style={{ margin:0, fontSize:26, fontWeight:700, color:"#f0e6c8" }}>Ma bibliothèque</h1>
          </div>
          <button onClick={() => openEdit()} style={btnStyle("#e8c97a","#000",true)}>+ Nouvelle</button>
        </div>
      </div>

      <div style={{ maxWidth:640, margin:"0 auto", padding:"16px 20px 40px" }}>
        {songs.length === 0 && (
          <div style={{ textAlign:"center", color:"#555", padding:"60px 20px" }}>
            <div style={{ fontSize:48, marginBottom:12 }}>🎵</div>
            <div>Aucune chanson.</div>
          </div>
        )}
        {songs.map(song => (
          <div key={song.id} style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:12, padding:"14px 16px", marginBottom:10, display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontWeight:600, fontSize:15, color:"#f0e6c8", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{song.title}</div>
              <div style={{ fontSize:12, color:"#666" }}>{song.artist || <span style={{ fontStyle:"italic" }}>Artiste inconnu</span>}</div>
            </div>
            <button onClick={() => openEdit(song)} style={btnStyle("#1a1d24","#aaa")}>✏️</button>
            <button onClick={() => startSinging(song)} style={{ ...btnStyle("#e8c97a","#000"), fontWeight:700 }}>▶</button>
            <button onClick={() => setConfirmDelete(song.id)} style={btnStyle("#1a1d24","#c0504d")}>🗑</button>
          </div>
        ))}
      </div>

      {confirmDelete && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:100, padding:20 }} onClick={() => setConfirmDelete(null)}>
          <div style={{ background:"#181b22", border:"1px solid rgba(255,255,255,0.12)", borderRadius:14, padding:"28px", maxWidth:320, width:"100%", textAlign:"center" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize:32, marginBottom:12 }}>🗑️</div>
            <div style={{ fontWeight:700, fontSize:17, marginBottom:8, color:"#f0e6c8" }}>Supprimer cette chanson ?</div>
            <div style={{ color:"#777", fontSize:13, marginBottom:24 }}>Cette action est irréversible.</div>
            <div style={{ display:"flex", gap:10, justifyContent:"center" }}>
              <button onClick={() => setConfirmDelete(null)} style={btnStyle("#2a2d36","#ccc")}>Annuler</button>
              <button onClick={() => deleteSong(confirmDelete)} style={btnStyle("#c0504d","#fff",true)}>Supprimer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function btnStyle(bg, color, bold = false) {
  return { background:bg, color, border:"none", borderRadius:8, padding:"8px 12px", fontSize:14, fontWeight:bold?700:500, cursor:"pointer", fontFamily:"inherit", whiteSpace:"nowrap" };
}

const labelStyle = { display:"block", fontSize:12, letterSpacing:"0.1em", textTransform:"uppercase", color:"#888", marginBottom:6, marginTop:16 };
const inputStyle = { width:"100%", background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:8, padding:"10px 12px", color:"#e8e0d0", fontSize:15, fontFamily:"inherit", outline:"none", boxSizing:"border-box" };
