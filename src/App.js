import { useState, useEffect, useRef, useCallback } from "react";

const STORAGE_KEY = "lyrics_v6";
const BACKEND = "https://lyrics-backend-production.up.railway.app";

// ─── LRC parser ──────────────────────────────────────────────────────────────
function parseLRC(lrc) {
  if (!lrc) return null;
  const lines = [];
  const re = /\[(\d{2}):(\d{2})[.:](\d{2,3})\](.*)/;
  for (const raw of lrc.split("\n")) {
    const m = raw.match(re);
    if (!m) continue;
    const ms = m[3].length === 2 ? parseInt(m[3]) * 10 : parseInt(m[3]);
    const time = parseInt(m[1]) * 60 + parseInt(m[2]) + ms / 1000;
    const text = m[4].trim();
    if (text) lines.push({ time, text });
  }
  return lines.length >= 2 ? lines : null;
}

function load() {
  try { const r = localStorage.getItem(STORAGE_KEY); if (r) return JSON.parse(r); } catch {}
  return [];
}
function save(s) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {} }
function vibrate(ms) { try { navigator.vibrate?.(ms); } catch {} }
function fmt(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function useWakeLock(on) {
  const ref = useRef(null);
  useEffect(() => {
    if (!on) { ref.current?.release?.(); ref.current = null; return; }
    navigator.wakeLock?.request("screen").then(l => { ref.current = l; }).catch(() => {});
    return () => { ref.current?.release?.(); ref.current = null; };
  }, [on]);
}

function smoothScrollTo(el, target, duration = 300) {
  if (!el) return;
  const start = el.scrollTop;
  const dist = target - start;
  if (Math.abs(dist) < 2) return;
  const startT = performance.now();
  function step(now) {
    const p = Math.min((now - startT) / duration, 1);
    const ease = p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p;
    el.scrollTop = start + dist * ease;
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ─── YouTube Player hook ─────────────────────────────────────────────────────
function useYouTubePlayer(videoId, onReady, onStateChange) {
  const playerRef = useRef(null);
  const divId = "yt-player";

  useEffect(() => {
    if (!videoId) return;

    function createPlayer() {
      if (playerRef.current) { playerRef.current.destroy(); playerRef.current = null; }
      playerRef.current = new window.YT.Player(divId, {
        videoId,
        playerVars: {
          autoplay: 0,
          controls: 1,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          mute: 0,
          origin: window.location.origin,
        },
        events: {
          onReady: (e) => onReady?.(e.target),
          onStateChange: (e) => onStateChange?.(e.data),
          onError: () => {},
        },
      });
    }

    if (window.YT?.Player) {
      createPlayer();
    } else {
      if (!document.getElementById("yt-script")) {
        const tag = document.createElement("script");
        tag.id = "yt-script";
        tag.src = "https://www.youtube.com/iframe_api";
        document.head.appendChild(tag);
      }
      window.onYouTubeIframeAPIReady = createPlayer;
    }

    return () => { playerRef.current?.destroy?.(); playerRef.current = null; };
  }, [videoId]);

  return playerRef;
}

// ════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [songs, setSongs]     = useState(load);
  const [view, setView]       = useState("lib");
  const [active, setActive]   = useState(null);
  const [editTarget, setEdit] = useState(null);
  const [form, setForm]       = useState(emptyForm());
  const [search, setSearch]   = useState("");
  const [delId, setDelId]     = useState(null);

  // Karaoke
  const [playing, setPlaying]     = useState(false);
  const [elapsed, setElapsed]     = useState(0);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [locked, setLocked]       = useState(false);
  const [ytReady, setYtReady]     = useState(false);
  const [ytBlocked, setYtBlocked] = useState(false);
  const [showVideo, setShowVideo] = useState(true);

  // Search
  const [sq, setSq]               = useState({ title: "", artist: "" });
  const [searching, setSearching] = useState(false);
  const [searchMsg, setSearchMsg] = useState("");

  // Refs
  const elapsedRef    = useRef(0);
  const baseElapsed   = useRef(0);
  const startTsRef    = useRef(null);
  const rafRef        = useRef(null);
  const syncRafRef    = useRef(null);
  const scrollRef     = useRef(null);
  const lineRefs      = useRef([]);
  const ytPlayerRef   = useRef(null);
  const usingYT       = useRef(false);

  useWakeLock(view === "karaoke" && playing);
  useEffect(() => save(songs), [songs]);

  // ── YouTube Player init ──
  const ytPlayer = useYouTubePlayer(
    view === "karaoke" ? active?.videoId : null,
    (player) => {
      ytPlayerRef.current = player;
      usingYT.current = true;
      setYtReady(true);
    },
    (state) => {
      // YT.PlayerState: PLAYING=1, PAUSED=2, ENDED=0
      if (state === 1) setPlaying(true);
      else if (state === 2 || state === 0) setPlaying(false);
    }
  );

  // ── Sync loop: read YT time OR use manual timer ──
  useEffect(() => {
    if (view !== "karaoke" || !playing) {
      cancelAnimationFrame(syncRafRef.current);
      cancelAnimationFrame(rafRef.current);
      if (!playing) baseElapsed.current = elapsedRef.current;
      return;
    }

    if (usingYT.current && ytPlayerRef.current) {
      // YouTube mode — poll player.getCurrentTime()
      const poll = () => {
        try {
          const t = ytPlayerRef.current?.getCurrentTime?.() ?? 0;
          elapsedRef.current = t;
          setElapsed(t);
        } catch {}
        syncRafRef.current = requestAnimationFrame(poll);
      };
      syncRafRef.current = requestAnimationFrame(poll);
    } else {
      // Manual timer mode
      startTsRef.current = performance.now();
      const tick = () => {
        const e = baseElapsed.current + (performance.now() - startTsRef.current) / 1000;
        elapsedRef.current = e;
        setElapsed(e);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    }

    return () => {
      cancelAnimationFrame(syncRafRef.current);
      cancelAnimationFrame(rafRef.current);
    };
  }, [playing, view, ytReady]);

  // ── Active line ──
  useEffect(() => {
    if (!active?.syncedLines) return;
    const lines = active.syncedLines;
    let idx = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].time <= elapsed + 0.15) idx = i;
      else break;
    }
    if (idx !== activeIdx) setActiveIdx(idx);
  }, [elapsed, active]);

  // ── Scroll to active line ──
  useEffect(() => {
    if (activeIdx < 0 || !scrollRef.current || !lineRefs.current[activeIdx]) return;
    const container = scrollRef.current;
    const el = lineRefs.current[activeIdx];
    const target = el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2;
    smoothScrollTo(container, Math.max(0, target), 300);
  }, [activeIdx]);

  // ── Actions ──
  function startKaraoke(song) {
    setActive(song);
    setElapsed(0);
    elapsedRef.current = 0;
    baseElapsed.current = 0;
    startTsRef.current = null;
    usingYT.current = false;
    setPlaying(false);
    setYtReady(false);
    setYtBlocked(false);
    setActiveIdx(-1);
    setLocked(false);
    setShowVideo(true);
    lineRefs.current = [];
    setView("karaoke");
  }

  function stopKaraoke() {
    cancelAnimationFrame(rafRef.current);
    cancelAnimationFrame(syncRafRef.current);
    ytPlayerRef.current?.stopVideo?.();
    setPlaying(false);
    usingYT.current = false;
    setActive(null);
    setElapsed(0);
    elapsedRef.current = 0;
    baseElapsed.current = 0;
    setYtReady(false);
    setView("lib");
  }

  function togglePlay() {
    vibrate(8);
    if (usingYT.current && ytPlayerRef.current) {
      // MUST call playVideo/pauseVideo directly in user gesture handler for iOS
      try {
        const state = ytPlayerRef.current.getPlayerState?.();
        if (state === 1) {
          ytPlayerRef.current.pauseVideo();
          setPlaying(false);
          baseElapsed.current = elapsedRef.current;
        } else {
          ytPlayerRef.current.playVideo();
          setPlaying(true);
        }
      } catch(e) {}
    } else {
      if (!playing) {
        startTsRef.current = performance.now() - baseElapsed.current * 1000;
        setPlaying(true);
      } else {
        baseElapsed.current = elapsedRef.current;
        setPlaying(false);
      }
    }
  }

  function seek(delta) {
    vibrate(12);
    if (usingYT.current && ytPlayerRef.current) {
      const cur = ytPlayerRef.current.getCurrentTime?.() ?? 0;
      ytPlayerRef.current.seekTo(Math.max(0, cur + delta), true);
    } else {
      const next = Math.max(0, elapsedRef.current + delta);
      elapsedRef.current = next;
      baseElapsed.current = next;
      startTsRef.current = performance.now();
      setElapsed(next);
    }
  }

  // Tap on lyric line → seek to its timestamp (direct call for iOS)
  function seekToLine(line) {
    vibrate(10);
    if (usingYT.current && ytPlayerRef.current) {
      try {
        ytPlayerRef.current.seekTo(line.time, true);
        ytPlayerRef.current.playVideo(); // always play after seek
        setPlaying(true);
        elapsedRef.current = line.time;
        setElapsed(line.time);
      } catch(e) {}
    } else {
      elapsedRef.current = line.time;
      baseElapsed.current = line.time;
      startTsRef.current = performance.now();
      setElapsed(line.time);
      setPlaying(true);
    }
  }

  function openEdit(song = null) {
    setForm(song ? { ...song } : emptyForm());
    setEdit(song);
    setSearchMsg("");
    setSq({ title: song?.title || "", artist: song?.artist || "" });
    setView("edit");
  }

  function saveForm() {
    if (!form.title?.trim() || (!form.lyrics?.trim() && !form.syncedLines)) return;
    if (editTarget) setSongs(s => s.map(x => x.id === editTarget.id ? { ...x, ...form } : x));
    else setSongs(s => [{ id: Date.now().toString(), ...form }, ...s]);
    setView("lib");
  }

  async function fetchAll() {
    if (!sq.title.trim()) return;
    setSearching(true);
    setSearchMsg("Recherche en cours...");
    try {
      const url = `${BACKEND}/search?title=${encodeURIComponent(sq.title)}&artist=${encodeURIComponent(sq.artist)}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error();
      const data = await r.json();
      const synced = parseLRC(data.synced);
      setForm(f => ({
        ...f,
        title: data.title || sq.title,
        artist: data.artist || sq.artist,
        lyrics: data.plain || (synced?.map(l => l.text).join("\n") ?? ""),
        syncedLines: synced,
        videoId: data.videoId || null,
        videoTitle: data.videoTitle || null,
        thumbnail: data.thumbnail || null,
      }));
      const parts = [];
      if (synced) parts.push("✅ Paroles synchronisées");
      else if (data.plain) parts.push("⚠️ Paroles sans sync");
      if (data.videoId) parts.push("✅ Vidéo YouTube trouvée");
      else parts.push("❌ Vidéo YouTube introuvable");
      setSearchMsg(parts.join(" · "));
    } catch {
      setSearchMsg("❌ Introuvable. Vérifie le titre ou l'artiste.");
    } finally {
      setSearching(false);
    }
  }

  function paste() {
    navigator.clipboard?.readText?.().then(t => {
      if (t) setForm(f => ({ ...f, lyrics: t, syncedLines: null }));
    }).catch(() => {});
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
    const fontSize = active.fontSize ?? 24;
    const hasYT = !!active.videoId;

    return (
      <div style={S.singWrap}>
        <style>{globalCSS}</style>

        {/* Top bar */}
        <div style={S.singBar}>
          {!locked ? (
            <>
              <Btn onClick={stopKaraoke} style={S.iconBtn}>✕</Btn>
              <div style={{ flex: 1, minWidth: 0, padding: "0 4px" }}>
                <div style={S.singTitle}>{active.title}</div>
                {active.artist && <div style={S.singArtist}>{active.artist}</div>}
              </div>
              {hasYT && (
                <Btn onClick={() => setShowVideo(v => !v)} style={{ ...S.iconBtn, color: showVideo ? GOLD : "#aaa" }}>
                  {showVideo ? "🎬" : "🎵"}
                </Btn>
              )}
              <Btn onClick={() => seek(-5)} style={S.iconBtn}>−5s</Btn>
              <Btn onClick={togglePlay} style={{ ...S.playBtn, background: playing ? GOLD : "#232630" }}>
                <span style={{ color: playing ? "#000" : "#fff", fontSize: 22 }}>{playing ? "⏸" : "▶"}</span>
              </Btn>
              <Btn onClick={() => seek(5)} style={S.iconBtn}>+5s</Btn>
              <Btn onClick={() => { vibrate(20); setLocked(true); }} style={S.iconBtn}>🔒</Btn>
            </>
          ) : (
            <>
              <span style={{ color: "#555", fontSize: 12, flex: 1 }}>🔒 Verrouillé</span>
              <Btn onClick={togglePlay} style={{ ...S.playBtn, background: playing ? GOLD : "#232630" }}>
                <span style={{ color: playing ? "#000" : "#fff", fontSize: 22 }}>{playing ? "⏸" : "▶"}</span>
              </Btn>
              <Btn onClick={() => { vibrate(20); setLocked(false); }} style={{ ...S.iconBtn, color: GOLD }}>🔓</Btn>
            </>
          )}
        </div>

        {/* YouTube player */}
        {hasYT && (
          <div style={{
            ...S.ytWrap,
            height: showVideo ? 200 : 0,
            overflow: "hidden",
            transition: "height 0.3s ease",
          }}>
            <div id="yt-player" style={{ width: "100%", height: "100%" }} />
            {ytBlocked && (
              <div style={S.ytBlocked}>
                ⚠️ Cette vidéo bloque l'intégration.<br />Lance-la sur YouTube + appuie sur ▶ ici.
              </div>
            )}
          </div>
        )}

        {/* Timer */}
        <div style={S.timerBar}>
          <span style={{ fontFamily: "monospace", fontSize: 13, color: "#555" }}>{fmt(elapsed)}</span>
          {!playing && elapsed < 0.5 && !hasYT && (
            <span style={{ color: "#333", fontSize: 11, marginLeft: 10, animation: "pulse 2s infinite" }}>
              Lance ta musique puis appuie sur ▶
            </span>
          )}
          {!playing && elapsed < 0.5 && hasYT && (
            <span style={{ color: "#333", fontSize: 11, marginLeft: 10, animation: "pulse 2s infinite" }}>
              Appuie sur ▶ pour démarrer
            </span>
          )}
        </div>

        {/* Lyrics */}
        <div ref={scrollRef} style={S.lyricsScroll}>
          <div style={S.fadeTop} />
          <div style={S.fadeBot} />
          <div style={{ padding: "80px 16px 200px" }}>
            {hasSynced ? lines.map((line, i) => {
              const isCurrent = i === activeIdx;
              const isPast    = i < activeIdx;
              const isNext    = i === activeIdx + 1;

              // Barre de progression entre lignes (pause > 1.5s)
              const nextLine  = lines[i + 1];
              const gap       = nextLine ? nextLine.time - line.time : 0;
              const showBar   = gap > 1.5 && isCurrent && playing;
              const barProgress = showBar
                ? Math.min(1, (elapsed - line.time) / gap)
                : 0;

              return (
                <div key={i}>
                  <div
                    ref={el => lineRefs.current[i] = el}
                    onClick={() => hasSynced && seekToLine(line)}
                    style={{
                      textAlign: "center",
                      maxWidth: 580,
                      margin: "0 auto",
                      padding: "5px 8px",
                      fontSize: isCurrent ? fontSize : isNext ? Math.round(fontSize * 0.85) : Math.round(fontSize * 0.68),
                      fontWeight: isCurrent ? 700 : isNext ? 500 : 400,
                      color: isCurrent ? GOLD : isPast ? "#222530" : isNext ? "#5a5e6a" : "#3a3e4a",
                      transition: "font-size 0.2s ease, color 0.2s ease",
                      willChange: "color, font-size",
                      lineHeight: 1.5,
                      letterSpacing: isCurrent ? "0.02em" : "normal",
                      cursor: "pointer",
                      WebkitTapHighlightColor: "transparent",
                    }}
                  >
                    {line.text}
                  </div>

                  {/* Barre de progression pendant les pauses */}
                  {gap > 1.5 && (
                    <div style={{ margin: "8px auto", maxWidth: 200, height: 2, background: "#1a1d28", borderRadius: 2, overflow: "hidden" }}>
                      <div style={{
                        height: "100%",
                        width: isCurrent && playing ? `${barProgress * 100}%` : isPast ? "100%" : "0%",
                        background: isCurrent ? GOLD : "#2a2d38",
                        transition: isCurrent ? "none" : "width 0s",
                        borderRadius: 2,
                      }} />
                    </div>
                  )}
                </div>
              );
            }) : (
              active.lyrics?.split("\n").map((line, i) => (
                <div key={i} style={{ textAlign: "center", fontSize, color: "#f0e8d0", padding: "3px 16px", lineHeight: 1.65, maxWidth: 560, margin: "0 auto" }}>
                  {line || <span style={{ opacity: 0 }}>·</span>}
                </div>
              ))
            )}
            <div style={{ height: 120 }} />
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
        <style>{globalCSS}</style>
        <div style={S.editHeader}>
          <Btn onClick={() => setView("lib")} style={S.backBtn}>← Retour</Btn>
          <span style={S.pageTitle}>{editTarget ? "Modifier" : "Nouvelle chanson"}</span>
        </div>
        <div style={S.editBody}>

          {/* Auto search */}
          <div style={S.searchBox}>
            <div style={S.searchBoxLabel}>🔍 Recherche automatique</div>
            <input value={sq.title} onChange={e => setSq(q => ({ ...q, title: e.target.value }))}
              onKeyDown={e => e.key === "Enter" && fetchAll()}
              placeholder="Titre *" style={S.input} />
            <input value={sq.artist} onChange={e => setSq(q => ({ ...q, artist: e.target.value }))}
              onKeyDown={e => e.key === "Enter" && fetchAll()}
              placeholder="Artiste (recommandé)" style={{ ...S.input, marginTop: 8 }} />
            <Btn onClick={fetchAll} style={{
              ...S.searchBtn,
              background: searching ? "#1c2030" : GOLD,
              color: searching ? "#555" : "#000",
            }}>
              {searching ? "Recherche..." : "🎵 Trouver paroles + vidéo"}
            </Btn>
            {searchMsg && (
              <div style={{ marginTop: 10, fontSize: 13, lineHeight: 1.5, color: "#aaa" }}>
                {searchMsg}
              </div>
            )}
          </div>

          {/* YouTube preview */}
          {form.videoId && (
            <div style={{ marginTop: 12, borderRadius: 12, overflow: "hidden", border: `1px solid ${BORDER}` }}>
              <img src={form.thumbnail} alt="" style={{ width: "100%", display: "block" }} />
              <div style={{ background: CARD, padding: "8px 12px", fontSize: 12, color: "#888" }}>
                🎬 {form.videoTitle}
              </div>
            </div>
          )}

          <div style={S.divider}>— ou entre les paroles manuellement —</div>

          <label style={S.label}>Titre *</label>
          <input value={form.title || ""} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            placeholder="Ex : Bohemian Rhapsody" style={S.input} />

          <label style={S.label}>Artiste</label>
          <input value={form.artist || ""} onChange={e => setForm(f => ({ ...f, artist: e.target.value }))}
            placeholder="Ex : Queen" style={S.input} />

          <label style={S.label}>Paroles</label>
          <div style={{ position: "relative" }}>
            <textarea value={form.lyrics || ""} rows={10}
              onChange={e => setForm(f => ({ ...f, lyrics: e.target.value, syncedLines: null }))}
              placeholder={"Colle les paroles ici...\n\nLigne vide = pause entre strophes."}
              style={{ ...S.input, resize: "none", fontFamily: "monospace", fontSize: 13, lineHeight: 1.6, paddingTop: 46 }} />
            <Btn onClick={paste} style={S.pasteBtn}>📋 Coller</Btn>
          </div>

          {form.syncedLines && (
            <div style={S.syncBadge}>✅ {form.syncedLines.length} lignes synchronisées — karaoké disponible !</div>
          )}

          <label style={S.label}>Taille du texte — <span style={{ color: GOLD }}>{form.fontSize ?? 24}px</span></label>
          <div style={S.sliderRow}>
            <span style={{ fontSize: 13, color: MUTED }}>A</span>
            <input type="range" min={16} max={40} value={form.fontSize ?? 24}
              onChange={e => setForm(f => ({ ...f, fontSize: Number(e.target.value) }))}
              style={{ flex: 1, accentColor: GOLD }} />
            <span style={{ fontSize: 22, color: MUTED }}>A</span>
          </div>

          <Btn onClick={saveForm} style={{
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
      <style>{globalCSS}</style>
      <div style={S.libHeader}>
        <div>
          <div style={S.appLabel}>🎤 LYRICS</div>
          <div style={S.appTitle}>Ma bibliothèque</div>
        </div>
        <Btn onClick={() => openEdit()} style={S.addBtn}>+ Nouvelle</Btn>
      </div>
      <div style={S.searchWrap}>
        <span style={{ padding: "0 10px 0 14px", color: MUTED, fontSize: 15 }}>🔍</span>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Rechercher..." style={S.searchInput} />
        {search && <Btn onClick={() => setSearch("")} style={S.clearBtn}>✕</Btn>}
      </div>
      <div style={S.list}>
        {filtered.length === 0 && (
          <div style={S.empty}>
            <div style={{ fontSize: 44, marginBottom: 12 }}>🎵</div>
            <div style={{ color: MUTED, fontSize: 15, whiteSpace: "pre-line" }}>
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
        <div style={{ height: 40 }} />
      </div>
      {delId && (
        <div style={S.overlay} onClick={() => setDelId(null)}>
          <div style={S.sheet} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🗑️</div>
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
    setDx(d < 0 ? Math.max(d, -80) : Math.min(d, 0));
  }
  function te() { setDx(dx < -50 ? -80 : 0); startX.current = null; }
  return (
    <div style={{ position: "relative", marginBottom: 10, borderRadius: 14, overflow: "hidden" }}>
      <div style={S.rowDelete}>
        <Btn onClick={onDelete} style={{ background: "transparent", color: "#fff", fontSize: 22, padding: "8px", border: "none", cursor: "pointer" }}>🗑️</Btn>
      </div>
      <div style={{ ...S.row, transform: `translateX(${dx}px)`, transition: (dx === 0 || dx === -80) ? "transform .22s ease" : "none" }}
        onTouchStart={ts} onTouchMove={tm} onTouchEnd={te}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={S.rowTitle}>{song.title}</div>
          <div style={S.rowSub}>
            {song.artist || <em style={{ opacity: .5 }}>Artiste inconnu</em>}
            {song.syncedLines && <span style={{ color: GOLD, marginLeft: 6, fontSize: 10 }}>● KARAOKÉ</span>}
            {song.videoId && <span style={{ color: "#6a8fff", marginLeft: 6, fontSize: 10 }}>▶ YT</span>}
          </div>
        </div>
        <Btn onClick={onEdit} style={S.editBtn}>✏️</Btn>
        <Btn onClick={onSing} style={S.singBtn}>
          {song.syncedLines ? "🎤" : "▶"} {song.syncedLines ? "Karaoké" : "Chanter"}
        </Btn>
      </div>
    </div>
  );
}

function Btn({ onClick, style, children }) {
  return (
    <button onClick={onClick} style={{ border: "none", cursor: "pointer", fontFamily: "inherit", WebkitTapHighlightColor: "transparent", ...style }}>
      {children}
    </button>
  );
}

function emptyForm() {
  return { title: "", artist: "", lyrics: "", syncedLines: null, fontSize: 24, videoId: null, videoTitle: null, thumbnail: null };
}

const GOLD   = "#e8c97a";
const BG     = "#0d0f14";
const CARD   = "#13161d";
const BORDER = "rgba(255,255,255,0.07)";
const TEXT   = "#e0d8c8";
const MUTED  = "#555";

const globalCSS = `
  *, *::before, *::after { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html, body { overflow: hidden; position: fixed; width: 100%; height: 100%; overscroll-behavior: none; }
  input, textarea {
    -webkit-appearance: none;
    appearance: none;
    border-radius: 12px;
    border: 1px solid rgba(255,255,255,0.07) !important;
    outline: none !important;
    background: #13161d;
    color: #e0d8c8;
    box-shadow: none !important;
    -webkit-box-shadow: none !important;
  }
  input:focus, textarea:focus {
    border: 1px solid rgba(232,201,122,0.4) !important;
    outline: none !important;
    box-shadow: none !important;
    -webkit-box-shadow: none !important;
  }
  @keyframes pulse { 0%,100%{opacity:.2} 50%{opacity:.8} }
`;

const S = {
  page:        { height: "100dvh", background: BG, color: TEXT, fontFamily: "'Georgia',serif", display: "flex", flexDirection: "column", overflow: "hidden" },
  libHeader:   { display: "flex", alignItems: "flex-end", justifyContent: "space-between", padding: "0 16px 14px", paddingTop: "max(20px,env(safe-area-inset-top))", borderBottom: `1px solid ${BORDER}`, flexShrink: 0 },
  appLabel:    { fontSize: 10, letterSpacing: "0.22em", color: GOLD, textTransform: "uppercase", marginBottom: 3 },
  appTitle:    { fontSize: 26, fontWeight: 700, color: "#f0e8d0", lineHeight: 1 },
  addBtn:      { background: GOLD, color: "#000", borderRadius: 22, padding: "10px 18px", fontSize: 15, fontWeight: 700 },
  searchWrap:  { display: "flex", alignItems: "center", margin: "12px 16px 0", background: CARD, borderRadius: 12, border: `1px solid ${BORDER}`, overflow: "hidden", flexShrink: 0 },
  searchInput: { flex: 1, background: "transparent", border: "none", outline: "none", color: TEXT, fontSize: 15, padding: "13px 0", fontFamily: "inherit" },
  clearBtn:    { background: "transparent", color: MUTED, padding: "10px 14px", fontSize: 18 },
  list:        { flex: 1, overflowY: "auto", padding: "12px 16px 0", WebkitOverflowScrolling: "touch" },
  empty:       { textAlign: "center", padding: "60px 20px" },
  row:         { background: CARD, border: `1px solid ${BORDER}`, borderRadius: 14, padding: "13px 12px", display: "flex", alignItems: "center", gap: 8, position: "relative", zIndex: 1, willChange: "transform", userSelect: "none" },
  rowTitle:    { fontSize: 15, fontWeight: 600, color: "#f0e8d0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  rowSub:      { fontSize: 12, color: "#666", marginTop: 2 },
  rowDelete:   { position: "absolute", right: 0, top: 0, bottom: 0, background: "#c0504d", borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 16, minWidth: 80 },
  editBtn:     { background: "#1c2030", color: MUTED, borderRadius: 10, padding: "8px 10px", fontSize: 15, flexShrink: 0 },
  singBtn:     { background: GOLD, color: "#000", borderRadius: 22, padding: "9px 14px", fontSize: 14, fontWeight: 700, flexShrink: 0, whiteSpace: "nowrap" },
  overlay:     { position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "flex-end", zIndex: 200 },
  sheet:       { background: "#181b24", borderRadius: "20px 20px 0 0", padding: "28px 20px", paddingBottom: "max(28px,env(safe-area-inset-bottom))", width: "100%", textAlign: "center" },
  sheetTitle:  { fontWeight: 700, fontSize: 18, color: "#f0e8d0", marginBottom: 6 },
  sheetSub:    { color: MUTED, fontSize: 14, marginBottom: 24 },
  delConfirm:  { display: "block", width: "100%", background: "#c0504d", color: "#fff", borderRadius: 14, padding: "15px", fontSize: 16, fontWeight: 700, marginBottom: 10 },
  delCancel:   { display: "block", width: "100%", background: "#1c2030", color: TEXT, borderRadius: 14, padding: "15px", fontSize: 16 },
  editHeader:  { display: "flex", alignItems: "center", gap: 12, padding: "0 16px 14px", paddingTop: "max(16px,env(safe-area-inset-top))", borderBottom: `1px solid ${BORDER}`, flexShrink: 0 },
  backBtn:     { background: "#1c2030", color: MUTED, borderRadius: 10, padding: "9px 14px", fontSize: 14 },
  pageTitle:   { fontSize: 18, fontWeight: 700, color: "#f0e8d0" },
  editBody:    { flex: 1, overflowY: "auto", padding: "12px 16px", paddingBottom: "max(24px,env(safe-area-inset-bottom))", WebkitOverflowScrolling: "touch" },
  searchBox:   { background: "#0e1520", border: `1px solid ${GOLD}44`, borderRadius: 14, padding: "14px", marginBottom: 4 },
  searchBoxLabel: { fontSize: 11, letterSpacing: "0.15em", color: GOLD, textTransform: "uppercase", marginBottom: 10 },
  searchBtn:   { borderRadius: 12, padding: "13px", fontSize: 15, fontWeight: 700, width: "100%", marginTop: 10 },
  divider:     { textAlign: "center", color: "#2a2d38", fontSize: 12, margin: "14px 0 2px" },
  label:       { display: "block", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: MUTED, marginBottom: 6, marginTop: 16 },
  input:       { width: "100%", background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "13px 14px", color: TEXT, fontSize: 15, fontFamily: "inherit", outline: "none", display: "block" },
  pasteBtn:    { position: "absolute", top: 10, right: 10, background: GOLD, color: "#000", borderRadius: 10, padding: "6px 10px", fontSize: 12, fontWeight: 700 },
  syncBadge:   { background: "#0a1a0a", border: "1px solid #2a4a2a", borderRadius: 10, padding: "10px 14px", marginTop: 8, fontSize: 13, color: "#7ec87e" },
  sliderRow:   { display: "flex", alignItems: "center", gap: 10, margin: "6px 0 4px" },
  saveBtn:     { display: "block", width: "100%", borderRadius: 14, padding: "16px", fontSize: 16, fontWeight: 700, marginTop: 24, marginBottom: 8 },
  singWrap:    { position: "fixed", inset: 0, background: "#07090e", display: "flex", flexDirection: "column", fontFamily: "'Georgia',serif", userSelect: "none" },
  singBar:     { display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", paddingTop: "max(10px,env(safe-area-inset-top))", background: "rgba(8,10,16,0.95)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderBottom: `1px solid ${BORDER}`, flexShrink: 0, zIndex: 10, minHeight: 58 },
  ytWrap:      { flexShrink: 0, background: "#000", position: "relative" },
  ytBlocked:   { position: "absolute", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", color: "#888", fontSize: 13, padding: 20 },
  timerBar:    { display: "flex", alignItems: "center", justifyContent: "center", padding: "4px 16px", flexShrink: 0, minHeight: 26 },
  iconBtn:     { background: "#1c2030", color: "#aaa", borderRadius: 10, padding: "9px 12px", fontSize: 13, flexShrink: 0, whiteSpace: "nowrap" },
  playBtn:     { borderRadius: 24, width: 48, height: 48, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  singTitle:   { fontSize: 13, fontWeight: 700, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  singArtist:  { fontSize: 11, color: "#555", marginTop: 1 },
  lyricsScroll:{ flex: 1, overflowY: "auto", position: "relative", WebkitOverflowScrolling: "touch" },
  fadeTop:     { position: "sticky", top: 0, height: 70, background: "linear-gradient(to bottom,#07090e 30%,transparent)", zIndex: 2, pointerEvents: "none", marginBottom: -70 },
  fadeBot:     { position: "sticky", bottom: 0, height: 120, background: "linear-gradient(to top,#07090e 40%,transparent)", zIndex: 2, pointerEvents: "none", marginTop: -120 },
};
