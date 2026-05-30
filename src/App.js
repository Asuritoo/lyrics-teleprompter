import React, { useState, useEffect, useRef } from "react";

const STORAGE_KEY = "lyrics_v8";
const BACKEND = "https://lyrics-backend-production.up.railway.app";
const SPOTIFY_CLIENT_ID = "69c5a063a61a436d83be3136eeeb6059";
const SPOTIFY_REDIRECT_URI = "https://lyrics-backend-production.up.railway.app/callback";
const SPOTIFY_SCOPES = "playlist-read-private playlist-read-collaborative user-library-read";

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
  // Try current key first, then migrate from older versions
  const KEYS = ["lyrics_v8", "lyrics_v7", "lyrics_v6", "lyrics_v5", "lyrics_v4", "lyrics_v3", "lyrics_v2", "lyrics_songs"];
  for (const key of KEYS) {
    try {
      const r = localStorage.getItem(key);
      if (!r) continue;
      const parsed = JSON.parse(r);
      // Old format was just an array of songs
      if (Array.isArray(parsed)) return { songs: parsed, playlists: [] };
      // New format has songs and playlists
      if (parsed && (parsed.songs || parsed.playlists)) return { songs: parsed.songs || [], playlists: parsed.playlists || [] };
    } catch {}
  }
  return { songs: [], playlists: [] };
}
function save(s) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {} }
function vibrate(ms) { try { navigator.vibrate?.(ms); } catch {} }
function fmt(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
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
  const start = el.scrollTop, dist = target - start;
  if (Math.abs(dist) < 2) return;
  const startT = performance.now();
  function step(now) {
    const p = Math.min((now - startT) / duration, 1);
    const ease = p < 0.5 ? 2*p*p : -1+(4-2*p)*p;
    el.scrollTop = start + dist * ease;
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function useYouTubePlayer(videoId, onReady, onStateChange) {
  const playerRef = useRef(null);
  useEffect(() => {
    if (!videoId) return;
    function create() {
      if (playerRef.current) { try { playerRef.current.destroy(); } catch {} playerRef.current = null; }
      try {
        playerRef.current = new window.YT.Player("yt-player", {
          videoId,
          playerVars: { autoplay:0, controls:1, rel:0, modestbranding:1, playsinline:1, mute:0, origin: window.location.origin },
          events: {
            onReady: e => onReady?.(e.target),
            onStateChange: e => onStateChange?.(e.data),
            onError: (e) => { if(e.data===101||e.data===150) setYtBlocked(true); },
          },
        });
      } catch {}
    }
    if (window.YT?.Player) { create(); }
    else {
      if (!document.getElementById("yt-script")) {
        const tag = document.createElement("script");
        tag.id = "yt-script"; tag.src = "https://www.youtube.com/iframe_api";
        document.head.appendChild(tag);
      }
      window.onYouTubeIframeAPIReady = create;
    }
    return () => { try { playerRef.current?.destroy?.(); } catch {} playerRef.current = null; };
  }, [videoId]);
  return playerRef;
}

// ─── Spotify PKCE ────────────────────────────────────────────────────────────
async function generateChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=/g,"");
}
function generateVerifier() {
  const arr = new Uint8Array(56); crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=/g,"");
}
async function startSpotifyAuth() {
  const verifier = generateVerifier();
  const challenge = await generateChallenge(verifier);
  sessionStorage.setItem("spotify_verifier", verifier);
  const params = new URLSearchParams({ response_type:"code", client_id:SPOTIFY_CLIENT_ID, scope:SPOTIFY_SCOPES, redirect_uri:SPOTIFY_REDIRECT_URI, code_challenge_method:"S256", code_challenge:challenge, state:verifier });
  window.location.href = "https://accounts.spotify.com/authorize?" + params.toString();
}
function getSpotifyToken() {
  try {
    const raw = localStorage.getItem("spotify_token");
    if (!raw) return null;
    const t = JSON.parse(raw);
    if (t && t.access_token) return t.access_token;
  } catch {}
  return null;
}

// ════════════════════════════════════════════════════════════════════════════
export default function App() {
  const stored = load();
  const [songs, setSongs]         = useState(stored.songs || []);
  const [playlists, setPlaylists] = useState(stored.playlists || []);
  const [tab, setTab]             = useState("home");   // home | search | library | import
  const [view, setView]           = useState("lib");    // lib | edit | sing | playlist_detail
  const [active, setActive]       = useState(null);
  const [editTarget, setEdit]     = useState(null);
  const [form, setForm]           = useState(emptyForm());
  const [search, setSearch]       = useState("");
  const [delId, setDelId]         = useState(null);
  const [activePlaylist, setActivePlaylist] = useState(null);
  const [showNewPlaylist, setShowNewPlaylist] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [addToPlaylistSong, setAddToPlaylistSong] = useState(null);
  const [editingPlaylistCover, setEditingPlaylistCover] = useState(null);

  // Karaoke
  const [playing, setPlaying]     = useState(false);
  const [elapsed, setElapsed]     = useState(0);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [locked, setLocked]       = useState(false);
  const [ytReady, setYtReady]     = useState(false);
  const [showVideo, setShowVideo] = useState(true);
  const [ytBlocked, setYtBlocked] = useState(false);
  const [muted, setMuted]         = useState(false);

  // Search/edit
  const [sq, setSq]               = useState({ title:"", artist:"" });
  const [searching, setSearching] = useState(false);
  const [searchMsg, setSearchMsg] = useState("");
  const [globalSearch, setGlobalSearch] = useState("");

  // Import
  const [importProgress, setImportProgress] = useState({ done:0, total:0, active:false });

  // Refs
  const elapsedRef  = useRef(0);
  const baseElapsed = useRef(0);
  const startTsRef  = useRef(null);
  const rafRef      = useRef(null);
  const syncRafRef  = useRef(null);
  const scrollRef   = useRef(null);
  const lineRefs    = useRef([]);
  const ytPlayerRef = useRef(null);
  const usingYT     = useRef(false);

  useWakeLock(view === "sing" && playing);
  useEffect(() => save({ songs, playlists }), [songs, playlists]);

  // Spotify callback
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const sp = url.searchParams.get("sp");
      if (sp) {
        window.history.replaceState({}, "", "/");
        fetch(BACKEND + "/token/" + sp).then(r => r.ok ? r.json() : null).then(data => {
          if (!data?.access_token) return;
          try {
            localStorage.setItem("spotify_token", JSON.stringify({ access_token: data.access_token, expires: Date.now() + (data.expires_in||3600)*1000 }));
          } catch {}
          setTab("import");
        }).catch(() => {});
      }
    } catch {}
  }, []);

  // YouTube
  useYouTubePlayer(
    view === "sing" ? active?.videoId : null,
    player => { ytPlayerRef.current = player; usingYT.current = true; setYtReady(true); },
    state => {
      if (state === 1) setPlaying(true);
      else if (state === 2 || state === 0) { setPlaying(false); baseElapsed.current = elapsedRef.current; }
    }
  );

  // Sync loop
  useEffect(() => {
    if (view !== "sing" || !playing) {
      cancelAnimationFrame(syncRafRef.current); cancelAnimationFrame(rafRef.current);
      if (!playing) baseElapsed.current = elapsedRef.current;
      return;
    }
    if (usingYT.current && ytPlayerRef.current) {
      const poll = () => {
        try { const t = ytPlayerRef.current?.getCurrentTime?.()??0; elapsedRef.current=t; setElapsed(t); } catch {}
        syncRafRef.current = requestAnimationFrame(poll);
      };
      syncRafRef.current = requestAnimationFrame(poll);
    } else {
      startTsRef.current = performance.now() - baseElapsed.current * 1000;
      const tick = () => {
        const e = (performance.now()-startTsRef.current)/1000;
        elapsedRef.current=e; setElapsed(e);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    }
    return () => { cancelAnimationFrame(syncRafRef.current); cancelAnimationFrame(rafRef.current); };
  }, [playing, view, ytReady]);

  // Active line
  useEffect(() => {
    if (!active?.syncedLines) return;
    const lines = active.syncedLines;
    let idx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].time <= elapsed+0.15) idx=i; else break;
    }
    if (idx !== activeIdx) setActiveIdx(idx);
  }, [elapsed, active]);

  // Scroll to active
  useEffect(() => {
    if (activeIdx<0||!scrollRef.current||!lineRefs.current[activeIdx]) return;
    const el = lineRefs.current[activeIdx];
    smoothScrollTo(scrollRef.current, Math.max(0, el.offsetTop-scrollRef.current.clientHeight/2+el.clientHeight/2));
  }, [activeIdx]);

  // ── Actions ──
  async function startSing(song) {
    try { ytPlayerRef.current?.stopVideo?.(); ytPlayerRef.current?.destroy?.(); } catch {}
    ytPlayerRef.current = null; usingYT.current = false;
    cancelAnimationFrame(rafRef.current); cancelAnimationFrame(syncRafRef.current);
    let finalSong = { ...song };
    // Auto-fetch missing data on first play
    const needsVideo = !song.videoId;
    const needsLyrics = !song.lyrics && !song.syncedLines;
    if (needsVideo || needsLyrics) {
      try {
        const endpoint = needsVideo ? "/search" : "/lyrics";
        const r = await fetch(BACKEND+endpoint+"?title="+encodeURIComponent(song.title)+"&artist="+encodeURIComponent(song.artist||""));
        if (r.ok) {
          const data = await r.json();
          const synced = parseLRC(data.synced);
          if (needsVideo && data.videoId) finalSong.videoId = data.videoId;
          if (needsVideo && data.videoTitle) finalSong.videoTitle = data.videoTitle;
          if (needsVideo && data.thumbnail) finalSong.thumbnail = data.thumbnail;
          if (needsLyrics && data.plain) finalSong.lyrics = data.plain;
          if (needsLyrics && synced) finalSong.syncedLines = synced;
          if (needsLyrics && !data.plain && synced) finalSong.lyrics = synced.map(l=>l.text).join("\n");
          setSongs(s => s.map(x => x.id===song.id ? {...x,...finalSong} : x));
        }
      } catch {}
    }
    setActive(finalSong); setElapsed(0); elapsedRef.current=0; baseElapsed.current=0; startTsRef.current=null;
    setPlaying(false); setYtReady(false); setActiveIdx(-1); setLocked(false); setShowVideo(true); setMuted(false);
    lineRefs.current = [];
    setView("sing");
  }

  function stopSing() {
    try { ytPlayerRef.current?.stopVideo?.(); ytPlayerRef.current?.destroy?.(); } catch {}
    ytPlayerRef.current = null; usingYT.current = false;
    cancelAnimationFrame(rafRef.current); cancelAnimationFrame(syncRafRef.current);
    setPlaying(false); setActive(null); setElapsed(0); elapsedRef.current=0; baseElapsed.current=0;
    setYtReady(false); setActiveIdx(-1); setLocked(false); setMuted(false);
    setView("lib");
  }

  function togglePlay() {
    vibrate(8);
    if (usingYT.current && ytPlayerRef.current) {
      try {
        const s = ytPlayerRef.current.getPlayerState?.();
        if (s===1) { ytPlayerRef.current.pauseVideo(); setPlaying(false); baseElapsed.current=elapsedRef.current; }
        else { ytPlayerRef.current.playVideo(); setPlaying(true); }
      } catch {}
    } else {
      if (!playing) { startTsRef.current=performance.now()-baseElapsed.current*1000; setPlaying(true); }
      else { baseElapsed.current=elapsedRef.current; setPlaying(false); }
    }
  }

  function seek(delta) {
    vibrate(12);
    if (usingYT.current && ytPlayerRef.current) {
      try { ytPlayerRef.current.seekTo(Math.max(0,(ytPlayerRef.current.getCurrentTime?.()??0)+delta),true); } catch {}
    } else {
      const next = Math.max(0, elapsedRef.current+delta);
      elapsedRef.current=next; baseElapsed.current=next;
      startTsRef.current=performance.now()-next*1000; setElapsed(next);
    }
  }

  function seekToLine(line) {
    vibrate(10);
    if (usingYT.current && ytPlayerRef.current) {
      try { ytPlayerRef.current.seekTo(line.time,true); ytPlayerRef.current.playVideo(); setPlaying(true); } catch {}
    } else {
      elapsedRef.current=line.time; baseElapsed.current=line.time;
      startTsRef.current=performance.now()-line.time*1000;
      setElapsed(line.time); setPlaying(true);
    }
  }

  function toggleMute() {
    vibrate(8);
    try {
      if (muted) { ytPlayerRef.current?.unMute?.(); setMuted(false); }
      else { ytPlayerRef.current?.mute?.(); setMuted(true); }
    } catch {}
  }

  function openEdit(song = null) {
    setForm(song ? {...song} : emptyForm());
    setEdit(song); setSearchMsg("");
    setSq({ title:song?.title||"", artist:song?.artist||"" });
    setView("edit");
  }

  function saveForm() {
    if (!form.title?.trim()||(!form.lyrics?.trim()&&!form.syncedLines)) return;
    if (editTarget) setSongs(s=>s.map(x=>x.id===editTarget.id?{...x,...form}:x));
    else setSongs(s=>[{id:Date.now().toString(),...form},...s]);
    setEdit(null);
    setView("lib");
  }

  async function fetchAll() {
    if (!sq.title.trim()) return;
    setSearching(true); setSearchMsg("Recherche en cours...");
    try {
      const r = await fetch(BACKEND+"/search?title="+encodeURIComponent(sq.title)+"&artist="+encodeURIComponent(sq.artist));
      if (!r.ok) throw new Error();
      const data = await r.json();
      const synced = parseLRC(data.synced);
      setForm(f=>({...f, title:data.title||sq.title, artist:data.artist||sq.artist, lyrics:data.plain||(synced?.map(l=>l.text).join("\n")??""), syncedLines:synced, videoId:data.videoId||null, videoTitle:data.videoTitle||null, thumbnail:data.thumbnail||null}));
      const parts = [];
      if (synced) parts.push("✅ Paroles synchronisées");
      else if (data.plain) parts.push("⚠️ Paroles sans sync");
      if (data.videoId) parts.push("✅ Vidéo YouTube trouvée");
      else parts.push("❌ Vidéo introuvable");
      setSearchMsg(parts.join(" · "));
    } catch { setSearchMsg("❌ Introuvable. Vérifie le titre ou l'artiste."); }
    finally { setSearching(false); }
  }

  function updatePlaylistCover(plId, updates) {
    setPlaylists(p => p.map(pl => pl.id===plId ? {...pl,...updates} : pl));
    // Also update editingPlaylistCover to show preview
    setEditingPlaylistCover(prev => prev ? {...prev,...updates} : prev);
  }

  function createPlaylist(name) {
    if (!name.trim()) return;
    setPlaylists(p=>[...p,{id:Date.now().toString(),name:name.trim(),songIds:[],createdAt:Date.now()}]);
    setNewPlaylistName(""); setShowNewPlaylist(false);
  }

  function addSongToPlaylist(plId, songId) {
    setPlaylists(p=>p.map(pl=>pl.id===plId?{...pl,songIds:pl.songIds.includes(songId)?pl.songIds:[...pl.songIds,songId]}:pl));
    setAddToPlaylistSong(null);
  }

  async function handleCSV(file) {
    if (!file) return;
    const playlistName = file.name.replace(".csv","").replace(/_/g," ");
    const text = await file.text();
    const lines = text.split("\n").filter(l=>l.trim());
    if (lines.length<2) { alert("Fichier vide ou invalide"); return; }
    const headers = lines[0].split(",").map(h=>h.replace(/"/g,"").trim());
    const titleIdx = headers.indexOf("Track Name");
    const artistIdx = headers.indexOf("Artist Name(s)");
    if (titleIdx===-1) { alert("Format invalide — colonne Track Name introuvable"); return; }
    const tracks = [];
    for (let i=1;i<lines.length;i++) {
      const cols=[]; let cur="",inQ=false;
      for (let c=0;c<lines[i].length;c++) {
        const ch=lines[i][c];
        if (ch==='"'){inQ=!inQ;}
        else if (ch===','&&!inQ){cols.push(cur.trim());cur="";}
        else{cur+=ch;}
      }
      cols.push(cur.trim());
      const title=cols[titleIdx]||"";
      const artist=artistIdx!==-1?(cols[artistIdx]||""):"";
      if (title) tracks.push({title,artist:artist.split(";")[0]});
    }
    if (tracks.length===0){alert("Aucun titre trouvé");return;}
    if (!window.confirm("Importer "+tracks.length+" titres dans "+playlistName+"?")) return;
    setImportProgress({done:0,total:tracks.length,active:true});
    const playlistId = Date.now().toString();
    const newPlaylist = {id:playlistId,name:playlistName,songIds:[],createdAt:Date.now(),fromSpotify:true};
    const newSongs = [];
    const BATCH=20;
    for (let b=0;b<tracks.length;b+=BATCH) {
      const batch=tracks.slice(b,b+BATCH);
      const results = await Promise.all(batch.map(async(track,j)=>{
        const idx=b+j;
        try {
          const r=await fetch(BACKEND+"/lyrics?title="+encodeURIComponent(track.title)+"&artist="+encodeURIComponent(track.artist));
          if (r.ok){
            const data=await r.json();
            const synced=parseLRC(data.synced);
            return {id:"csv_"+Date.now()+"_"+idx,title:data.title||track.title,artist:data.artist||track.artist,lyrics:data.plain||(synced?synced.map(l=>l.text).join("\n"):""),syncedLines:synced,videoId:null,thumbnail:null,fontSize:24};
          }
        } catch {}
        return {id:"csv_"+Date.now()+"_"+idx,title:track.title,artist:track.artist,lyrics:"",syncedLines:null,videoId:null,fontSize:24};
      }));
      results.forEach(s=>{newSongs.push(s);newPlaylist.songIds.push(s.id);});
      setImportProgress({done:Math.min(b+BATCH,tracks.length),total:tracks.length,active:true});
    }
    setSongs(s=>[...s,...newSongs]);
    setPlaylists(p=>[...p,newPlaylist]);
    setImportProgress({done:tracks.length,total:tracks.length,active:false});
    setTab("library"); setView("lib");

    // Phase 2 — fetch YouTube in background, song by song
    const songsToEnrich = [...newSongs];
    let ytDone = 0;
    setImportProgress({done:0, total:songsToEnrich.length, active:true, phase:"youtube"});

    for (let i = 0; i < songsToEnrich.length; i++) {
      const song = songsToEnrich[i];
      try {
        const r = await fetch(BACKEND + "/search?title=" + encodeURIComponent(song.title) + "&artist=" + encodeURIComponent(song.artist||""));
        if (r.ok) {
          const data = await r.json();
          if (data.videoId) {
            setSongs(s => s.map(x => x.id === song.id
              ? {...x, videoId:data.videoId, videoTitle:data.videoTitle, thumbnail:data.thumbnail}
              : x
            ));
          }
        }
      } catch {}
      ytDone++;
      setImportProgress({done:ytDone, total:songsToEnrich.length, active:true, phase:"youtube"});
      // Small delay to avoid hammering the API
      await new Promise(res => setTimeout(res, 150));
    }
    setImportProgress({done:0, total:0, active:false, phase:null});
  }

  // Enrich all songs without YouTube video
  async function enrichLibrary() {
    const toEnrich = songs.filter(s => !s.videoId);
    if (toEnrich.length === 0) { alert("Toutes les chansons ont déjà une vidéo !"); return; }
    setImportProgress({done:0, total:toEnrich.length, active:true, phase:"youtube"});
    for (let i = 0; i < toEnrich.length; i++) {
      const song = toEnrich[i];
      try {
        const r = await fetch(BACKEND+"/search?title="+encodeURIComponent(song.title)+"&artist="+encodeURIComponent(song.artist||""));
        if (r.ok) {
          const data = await r.json();
          if (data.videoId) {
            setSongs(s => s.map(x => x.id===song.id
              ? {...x, videoId:data.videoId, videoTitle:data.videoTitle, thumbnail:data.thumbnail}
              : x
            ));
          }
        }
      } catch {}
      setImportProgress({done:i+1, total:toEnrich.length, active:true, phase:"youtube"});
      await new Promise(res => setTimeout(res, 150));
    }
    setImportProgress({done:0, total:0, active:false, phase:null});
  }

  const allFiltered = songs.filter(s =>
    s.title.toLowerCase().includes(globalSearch.toLowerCase()) ||
    (s.artist||"").toLowerCase().includes(globalSearch.toLowerCase())
  );

  const playlistSongs = activePlaylist ? songs.filter(s=>activePlaylist.songIds.includes(s.id)) : [];

  // ════════════════════════════════════════════════════════════════════════════
  // SING VIEW
  // ════════════════════════════════════════════════════════════════════════════
  if (view === "sing" && active) {
    const lines = active.syncedLines;
    const hasSynced = !!lines;
    const fontSize = active.fontSize ?? 24;
    const hasYT = !!active.videoId;
    return (
      <div style={S.singWrap}>
        <style>{CSS}</style>
        {/* Bar */}
        <div style={S.singBar}>
          {!locked ? <>
            <Btn onClick={stopSing} style={S.singBack}>✕</Btn>
            <div style={{flex:1,minWidth:0,padding:"0 8px"}}>
              <div style={S.singTitle}>{active.title}</div>
              {active.artist&&<div style={S.singArtist}>{active.artist}</div>}
            </div>
            {hasYT&&<Btn onClick={()=>setShowVideo(v=>!v)} style={{...S.singIcon,color:showVideo?"#1DB954":"#535353"}}>{showVideo?"🎬":"🎵"}</Btn>}
            {hasYT&&<Btn onClick={toggleMute} style={{...S.singIcon,color:muted?"#f15e6c":"#535353"}}>{muted?"🔇":"🔊"}</Btn>}
            <Btn onClick={()=>seek(-5)} style={S.singIcon}>−5s</Btn>
            <Btn onClick={togglePlay} style={{...S.singPlay,background:playing?"#1DB954":"#282828"}}>
              <span style={{color:playing?"#000":"#fff",fontSize:20}}>{playing?"⏸":"▶"}</span>
            </Btn>
            <Btn onClick={()=>seek(5)} style={S.singIcon}>+5s</Btn>
            <Btn onClick={()=>{vibrate(20);setLocked(true);}} style={S.singIcon}>🔒</Btn>
          </> : <>
            <span style={{color:"#535353",fontSize:12,flex:1}}>🔒 Verrouillé</span>
            <Btn onClick={togglePlay} style={{...S.singPlay,background:playing?"#1DB954":"#282828"}}>
              <span style={{color:playing?"#000":"#fff",fontSize:20}}>{playing?"⏸":"▶"}</span>
            </Btn>
            <Btn onClick={()=>{vibrate(20);setLocked(false);}} style={{...S.singIcon,color:"#1DB954"}}>🔓</Btn>
          </>}
        </div>
        {/* YouTube */}
        {hasYT&&(
          <div style={{...S.ytWrap,height:showVideo?200:0}}>
            <div id="yt-player" style={{width:"100%",height:"100%"}}/>
          </div>
        )}
        {/* Timer */}
        <div style={S.timerRow}>
          <span style={{fontFamily:"monospace",fontSize:12,color:"#535353"}}>{fmt(elapsed)}</span>
          {!playing&&elapsed<0.5&&<span style={{color:"#535353",fontSize:11,marginLeft:10,animation:"pulse 2s infinite"}}>{hasYT?"Appuie sur ▶":"Lance ta musique puis ▶"}</span>}
        </div>
        {/* Lyrics */}
        <div ref={scrollRef} style={S.lyricsScroll}>
          <div style={S.fadeTop}/>
          <div style={S.fadeBot}/>
          <div style={{padding:"80px 16px 200px"}}>
            {hasSynced ? (()=>{
              const introGap=lines[0]?.time??0;
              const introProgress=introGap>1.5?Math.min(1,elapsed/introGap):1;
              const introIsPast=elapsed>=(lines[0]?.time??0);
              return <>
                {introGap>1.5&&<div style={{margin:"0 auto 20px",maxWidth:160,height:2,background:"#282828",borderRadius:2,overflow:"hidden"}}>
                  <div style={{height:"100%",width:`${introProgress*100}%`,background:introIsPast?"#282828":"#1DB954",borderRadius:2,transition:"none"}}/>
                </div>}
                {lines.map((line,i)=>{
                  const isCurrent=i===activeIdx,isPast=i<activeIdx,isNext=i===activeIdx+1;
                  const nextLine=lines[i+1],gap=nextLine?nextLine.time-line.time:0;
                  const barProg=(gap>1.5&&isCurrent)?Math.min(1,(elapsed-line.time)/gap):0;
                  return <div key={i}>
                    <div ref={el=>lineRefs.current[i]=el} onClick={()=>seekToLine(line)} style={{
                      textAlign:"center",maxWidth:580,margin:"0 auto",padding:"4px 8px",
                      fontSize:isCurrent?fontSize:isNext?Math.round(fontSize*.85):Math.round(fontSize*.65),
                      fontWeight:isCurrent?700:isNext?500:400,
                      color:isCurrent?"#fff":isPast?"#282828":isNext?"#727272":"#535353",
                      transition:"font-size .2s ease,color .2s ease",
                      lineHeight:1.5,letterSpacing:isCurrent?"0.01em":"normal",cursor:"pointer",
                      fontFamily:"'Circular Std','Helvetica Neue',sans-serif",
                    }}>{line.text}</div>
                    {gap>1.5&&<div style={{margin:"8px auto",maxWidth:160,height:2,background:"#282828",borderRadius:2,overflow:"hidden"}}>
                      <div style={{height:"100%",width:isPast?"100%":isCurrent?`${barProg*100}%`:"0%",background:isPast?"#282828":"#1DB954",borderRadius:2,transition:"none"}}/>
                    </div>}
                  </div>;
                })}
              </>;
            })() : active.lyrics && active.lyrics.trim()
              ? active.lyrics.split("\n").map((line,i)=>(
                  <div key={i} style={{textAlign:"center",fontSize,color:"#fff",padding:"3px 16px",lineHeight:1.65,maxWidth:560,margin:"0 auto",fontFamily:"'Circular Std','Helvetica Neue',sans-serif"}}>
                    {line||<span style={{opacity:0}}>·</span>}
                  </div>
                ))
              : <div style={{textAlign:"center",color:"#535353",padding:"60px 20px"}}>
                  <div style={{fontSize:32,marginBottom:12}}>🎵</div>
                  <div style={{fontSize:15}}>Pas de paroles disponibles</div>
                  <div style={{fontSize:13,marginTop:8}}>Lance ta musique sur Spotify</div>
                </div>
            }
            <div style={{height:120}}/>
          </div>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // EDIT VIEW
  // ════════════════════════════════════════════════════════════════════════════
  if (view === "edit") {
    const ok = form.title?.trim()&&(form.lyrics?.trim()||form.syncedLines);
    return (
      <div style={S.page}>
        <style>{CSS}</style>
        <div style={S.subHeader}>
          <Btn onClick={()=>{setView("lib");setEdit(null);}} style={S.backBtn}>←</Btn>
          <span style={S.subTitle}>{editTarget?"Modifier":"Nouvelle chanson"}</span>
        </div>
        <div style={S.scrollBody}>
          {/* Auto search */}
          <div style={S.searchCard}>
            <div style={S.cardLabel}>🔍 RECHERCHE AUTOMATIQUE</div>
            <input value={sq.title} onChange={e=>setSq(q=>({...q,title:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&fetchAll()} placeholder="Titre *" style={S.spotInput}/>
            <input value={sq.artist} onChange={e=>setSq(q=>({...q,artist:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&fetchAll()} placeholder="Artiste (recommandé)" style={{...S.spotInput,marginTop:8}}/>
            <Btn onClick={fetchAll} style={{...S.greenBtn,width:"100%",marginTop:10,opacity:searching?.6:1}}>
              {searching?"Recherche...":"🎵 Trouver paroles + vidéo"}
            </Btn>
            {searchMsg&&<div style={{marginTop:10,fontSize:13,color:"#b3b3b3",lineHeight:1.5}}>{searchMsg}</div>}
          </div>
          {form.videoId&&<div style={{marginTop:12,borderRadius:8,overflow:"hidden"}}>
            <img src={form.thumbnail} alt="" style={{width:"100%",display:"block"}}/>
            <div style={{background:"#282828",padding:"8px 12px",fontSize:12,color:"#727272"}}>🎬 {form.videoTitle}</div>
          </div>}
          <div style={S.divider}>— ou entre les paroles manuellement —</div>
          <label style={S.spotLabel}>TITRE *</label>
          <input value={form.title||""} onChange={e=>setForm(f=>({...f,title:e.target.value}))} placeholder="Ex : Bohemian Rhapsody" style={S.spotInput}/>
          <label style={S.spotLabel}>ARTISTE</label>
          <input value={form.artist||""} onChange={e=>setForm(f=>({...f,artist:e.target.value}))} placeholder="Ex : Queen" style={S.spotInput}/>
          <label style={S.spotLabel}>PAROLES</label>
          <div style={{position:"relative"}}>
            <textarea value={form.lyrics||""} rows={10} onChange={e=>setForm(f=>({...f,lyrics:e.target.value,syncedLines:null}))}
              placeholder={"Colle les paroles ici..."} style={{...S.spotInput,resize:"none",fontFamily:"monospace",fontSize:13,lineHeight:1.6,paddingTop:46}}/>
            <Btn onClick={()=>{navigator.clipboard?.readText?.().then(t=>{if(t)setForm(f=>({...f,lyrics:t,syncedLines:null}));}).catch(()=>{});}} style={S.pasteBtn}>📋 Coller</Btn>
          </div>
          {form.syncedLines&&<div style={S.syncBadge}>✅ {form.syncedLines.length} lignes synchronisées</div>}
          <label style={S.spotLabel}>TAILLE DU TEXTE — <span style={{color:"#1DB954"}}>{form.fontSize??24}px</span></label>
          <div style={{display:"flex",alignItems:"center",gap:10,margin:"8px 0 4px"}}>
            <span style={{fontSize:13,color:"#727272"}}>A</span>
            <input type="range" min={16} max={40} value={form.fontSize??24} onChange={e=>setForm(f=>({...f,fontSize:Number(e.target.value)}))} style={{flex:1,accentColor:"#1DB954"}}/>
            <span style={{fontSize:22,color:"#727272"}}>A</span>
          </div>
          <Btn onClick={saveForm} style={{...S.greenBtn,width:"100%",marginTop:24,opacity:ok?1:.4}}>
            {editTarget?"💾 Enregistrer":"➕ Ajouter"}
          </Btn>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PLAYLIST DETAIL
  // ════════════════════════════════════════════════════════════════════════════
  if (view === "playlist_detail" && activePlaylist && playlists.some(p=>p.id===activePlaylist.id)) {
    return (
      <div style={S.page}>
        <style>{CSS}</style>
        <div style={S.subHeader}>
          <Btn onClick={()=>{setView("lib");setActivePlaylist(null);}} style={S.backBtn}>←</Btn>
          <PlaylistCover playlist={activePlaylist} size={36} onClick={()=>setEditingPlaylistCover(activePlaylist)}/>
          <span style={{...S.subTitle,flex:1}}>{activePlaylist.name}</span>
          <Btn onClick={()=>setEditingPlaylistCover(activePlaylist)} style={{background:"transparent",color:"#727272",fontSize:13,padding:"4px 8px"}}>✏️ Modifier</Btn>
        </div>
        <div style={S.scrollBody}>
          {playlistSongs.length===0&&<div style={S.empty}><div style={{fontSize:40,marginBottom:8}}>🎵</div><div style={{color:"#535353"}}>Playlist vide</div></div>}
          {playlistSongs.map(song=>(
            <TrackRow key={song.id} song={song} onPlay={()=>startSing(song)} onEdit={()=>openEdit(song)}
              onRemove={()=>setPlaylists(p=>p.map(pl=>pl.id===activePlaylist.id?{...pl,songIds:pl.songIds.filter(id=>id!==song.id)}:pl))}
            />
          ))}
          <div style={{height:100}}/>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // MAIN TABS
  // ════════════════════════════════════════════════════════════════════════════

  // ── HOME ──
  const homeContent = (
    <div style={S.scrollBody} key="home">
      <div style={{paddingTop:8}}>
        {songs.length === 0 ? (
          <div style={{textAlign:"center",padding:"60px 20px",color:"#535353"}}>
            <div style={{fontSize:40,marginBottom:12}}>🎵</div>
            <div style={{fontSize:16,color:"#fff",marginBottom:8}}>Bienvenue dans Lyrics</div>
            <div style={{fontSize:14}}>Importe tes playlists Spotify ou ajoute une chanson</div>
          </div>
        ) : <>
        <div style={S.sectionTitle}>Accès rapide</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:24}}>
          {songs.slice(0,8).map(song=>(
            <Btn key={song.id} onClick={()=>startSing(song)} style={S.quickCard}>
              {song.thumbnail?<img src={song.thumbnail} alt="" style={{width:48,height:48,objectFit:"cover",borderRadius:4,flexShrink:0}}/>
                :<div style={{width:48,height:48,background:"#282828",borderRadius:4,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>🎵</div>}
              <span style={{fontSize:13,fontWeight:700,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{song.title}</span>
            </Btn>
          ))}
        </div>
        {playlists.length>0&&<>
          <div style={S.sectionTitle}>Mes playlists</div>
          {playlists.slice(0,4).map(pl=>(
            <Btn key={pl.id} onClick={()=>{setActivePlaylist(pl);setView("playlist_detail");}} style={S.playlistRow}>
              <PlaylistCover playlist={pl} size={56}/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{color:"#fff",fontWeight:700,fontSize:15}}>{pl.name}</div>
                <div style={{color:"#727272",fontSize:13}}>{pl.fromSpotify?"Playlist • Spotify":"Playlist"} • {pl.songIds.length} titres</div>
              </div>
            </Btn>
          ))}
        </>}
        </>}
      </div>
      <div style={{height:100}}/>
    </div>
  );

  // ── SEARCH ──
  const searchContent = (
    <div style={S.scrollBody} key="search">
      <div style={{...S.searchWrap,margin:"0 0 16px"}}>
        <span style={{color:"#727272",fontSize:16,marginRight:8}}>🔍</span>
        <input value={globalSearch} onChange={e=>setGlobalSearch(e.target.value)} placeholder="Artistes, chansons..." style={S.searchInput} autoFocus/>
        {globalSearch&&<Btn onClick={()=>setGlobalSearch("")} style={{background:"transparent",color:"#727272",fontSize:18,padding:"0 8px"}}>✕</Btn>}
      </div>
      {globalSearch ? (
        allFiltered.length===0
          ? <div style={S.empty}><div style={{color:"#535353"}}>Aucun résultat pour "{globalSearch}"</div></div>
          : allFiltered.map(song=><TrackRow key={song.id} song={song} onPlay={()=>startSing(song)} onEdit={()=>openEdit(song)} onAdd={playlists.length>0?()=>setAddToPlaylistSong(song):null}/>)
      ) : (
        <div style={{color:"#727272",textAlign:"center",padding:"40px 20px",fontSize:15}}>Cherche une chanson ou un artiste</div>
      )}
      <div style={{height:100}}/>
    </div>
  );

  // ── LIBRARY ──
  const libraryContent = (
    <div style={S.scrollBody} key="library">
      {importProgress.active && importProgress.phase==="youtube" && (
        <div style={{background:"#282828",borderRadius:8,padding:"10px 14px",marginBottom:12,display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:8,height:8,borderRadius:4,background:"#1DB954",animation:"pulse 1s infinite",flexShrink:0}}/>
          <div style={{flex:1}}>
            <div style={{color:"#fff",fontSize:13,fontWeight:600}}>Chargement des vidéos YouTube</div>
            <div style={{height:3,background:"#181818",borderRadius:3,marginTop:6,overflow:"hidden"}}>
              <div style={{height:"100%",width:`${importProgress.total>0?Math.round(importProgress.done/importProgress.total*100):0}%`,background:"#1DB954",borderRadius:3,transition:"width .3s ease"}}/>
            </div>
          </div>
          <div style={{color:"#727272",fontSize:12}}>{importProgress.done}/{importProgress.total}</div>
        </div>
      )}
      {/* Playlists */}
      <div style={{display:"flex",gap:8,marginBottom:16,overflowX:"auto",paddingBottom:4}}>
        {["Tout","Playlists"].map(f=>(
          <div key={f} style={{background:"#282828",color:"#fff",borderRadius:20,padding:"6px 14px",fontSize:13,fontWeight:600,flexShrink:0,cursor:"pointer"}}>{f}</div>
        ))}
      </div>
      {playlists.map(pl=>(
        <Btn key={pl.id} onClick={()=>{setActivePlaylist(pl);setView("playlist_detail");}} style={S.playlistRow}>
          <PlaylistCover playlist={pl} size={56}/>
          <div style={{flex:1,minWidth:0}}>
            <div style={{color:"#fff",fontWeight:700,fontSize:15,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{pl.name}</div>
            <div style={{color:"#727272",fontSize:13}}>{pl.fromSpotify?"Playlist · Spotify":"Playlist"} · {pl.songIds.length} titres</div>
          </div>
        </Btn>
      ))}
      {songs.filter(s=>!playlists.some(pl=>pl.songIds.includes(s.id))).map(song=>(
        <TrackRow key={song.id} song={song} onPlay={()=>startSing(song)} onEdit={()=>openEdit(song)} onAdd={playlists.length>0?()=>setAddToPlaylistSong(song):null}
          onDelete={()=>setDelId(song.id)}/>
      ))}
      <div style={{height:100}}/>
    </div>
  );

  // ── IMPORT ──
  const importContent = (
    <div style={S.scrollBody} key="import">
      <div style={S.searchCard}>
        <div style={S.cardLabel}>📁 IMPORTER DEPUIS SPOTIFY</div>
        <div style={{color:"#b3b3b3",fontSize:13,lineHeight:1.7,marginBottom:16}}>
          <div style={{marginBottom:4}}>1️⃣ Va sur <span style={{color:"#1DB954"}}>exportify.net</span></div>
          <div style={{marginBottom:4}}>2️⃣ Connecte-toi et exporte une playlist en CSV</div>
          <div>3️⃣ Reviens ici et importe le fichier</div>
        </div>
        <label style={{...S.greenBtn,display:"block",textAlign:"center",cursor:"pointer"}}>
          📁 Choisir un fichier CSV
          <input type="file" accept=".csv" style={{display:"none"}} onChange={e=>{handleCSV(e.target.files&&e.target.files[0]);e.target.value="";}}/>
        </label>
      </div>
      {importProgress.active&&(
        <div style={{...S.searchCard,marginTop:16}}>
          <div style={{color:"#fff",fontSize:14,marginBottom:10}}>
            {importProgress.phase==="youtube"
              ? "🎬 Vidéos YouTube... " + importProgress.done + "/" + importProgress.total
              : "🎵 Paroles... " + importProgress.done + "/" + importProgress.total}
          </div>
          <div style={{height:4,background:"#282828",borderRadius:4,overflow:"hidden"}}>
            <div style={{height:"100%",width:`${importProgress.total>0?Math.round(importProgress.done/importProgress.total*100):0}%`,background:"#1DB954",borderRadius:4,transition:"width .3s ease"}}/>
          </div>
        </div>
      )}
      <div style={{...S.searchCard,marginTop:16}}>
        <div style={S.cardLabel}>➕ NOUVELLE CHANSON MANUELLE</div>
        <Btn onClick={()=>openEdit()} style={{...S.greenBtn,width:"100%"}}>Ajouter une chanson</Btn>
      </div>
      {/* Enrich existing library */}
      {songs.filter(s=>!s.videoId).length > 0 && !importProgress.active && (
        <div style={{...S.searchCard,marginTop:16}}>
          <div style={S.cardLabel}>🎬 ENRICHIR LA BIBLIOTHÈQUE</div>
          <div style={{color:"#b3b3b3",fontSize:13,marginBottom:12}}>
            {songs.filter(s=>!s.videoId).length} chansons sans vidéo YouTube
          </div>
          <Btn onClick={enrichLibrary} style={{...S.greenBtn,width:"100%"}}>
            🎬 Charger les vidéos YouTube
          </Btn>
        </div>
      )}

      <div style={{...S.searchCard,marginTop:16}}>
        <div style={S.cardLabel}>📋 CRÉER UNE PLAYLIST</div>
        <input value={newPlaylistName} onChange={e=>setNewPlaylistName(e.target.value)} placeholder="Nom de la playlist" style={{...S.spotInput,marginBottom:10}}/>
        <Btn onClick={()=>createPlaylist(newPlaylistName)} style={{...S.greenBtn,width:"100%"}}>Créer</Btn>
      </div>
      <div style={{height:100}}/>
    </div>
  );

  const tabContent = tab==="home"?homeContent:tab==="search"?searchContent:tab==="library"?libraryContent:importContent;
  const tabTitle   = tab==="home"?"Accueil":tab==="search"?"Rechercher":tab==="library"?"Bibliothèque":"Importer";

  return (
    <div style={S.page}>
      <style>{CSS}</style>

      {/* Header */}
      <div style={S.header}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{width:36,height:36,borderRadius:18,background:"#535353",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>🎤</div>
          <span style={{fontSize:22,fontWeight:700,color:"#fff"}}>{tabTitle}</span>
        </div>
        <div style={{display:"flex",gap:16}}>
          {tab==="library"&&<Btn onClick={()=>setTab("import")} style={{background:"transparent",color:"#fff",fontSize:22,padding:0}}>+</Btn>}
          {tab==="home"&&<Btn onClick={()=>setTab("search")} style={{background:"transparent",color:"#fff",fontSize:20,padding:0}}>🔍</Btn>}
        </div>
      </div>

      {/* Content */}
      {tabContent}

      {/* Bottom nav */}
      <div style={S.bottomNav}>
        {[
          {id:"home",icon:"🏠",label:"Accueil"},
          {id:"search",icon:"🔍",label:"Rechercher"},
          {id:"library",icon:"📚",label:"Bibliothèque"},
          {id:"import",icon:"➕",label:"Importer"},
        ].map(t=>(
          <Btn key={t.id} onClick={()=>{setTab(t.id);if(t.id!=="search")setGlobalSearch("");setView("lib");setActivePlaylist(null);}} style={{background:"transparent",display:"flex",flexDirection:"column",alignItems:"center",gap:2,padding:"4px 0",flex:1}}>
            <span style={{fontSize:20,opacity:tab===t.id?1:.4}}>{t.icon}</span>
            <span style={{fontSize:10,color:tab===t.id?"#fff":"#535353",fontWeight:tab===t.id?700:400}}>{t.label}</span>
          </Btn>
        ))}
      </div>

      {/* Delete confirm */}
      {delId&&(
        <div style={S.overlay} onClick={()=>setDelId(null)}>
          <div style={S.sheet} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:28,marginBottom:8}}>🗑️</div>
            <div style={{fontWeight:700,fontSize:18,color:"#fff",marginBottom:6}}>Supprimer cette chanson ?</div>
            <div style={{color:"#727272",fontSize:14,marginBottom:24}}>Cette action est irréversible.</div>
            <Btn onClick={()=>{vibrate(20);setSongs(s=>s.filter(x=>x.id!==delId));setDelId(null);}} style={{...S.greenBtn,width:"100%",background:"#e91429",marginBottom:10}}>Supprimer</Btn>
            <Btn onClick={()=>setDelId(null)} style={{...S.greenBtn,width:"100%",background:"#282828",color:"#fff"}}>Annuler</Btn>
          </div>
        </div>
      )}

      {/* Add to playlist */}
      {addToPlaylistSong&&(
        <div style={S.overlay} onClick={()=>setAddToPlaylistSong(null)}>
          <div style={S.sheet} onClick={e=>e.stopPropagation()}>
            <div style={{fontWeight:700,fontSize:18,color:"#fff",marginBottom:4}}>Ajouter à une playlist</div>
            <div style={{color:"#727272",fontSize:13,marginBottom:16}}>{addToPlaylistSong.title}</div>
            {playlists.map(pl=>(
              <Btn key={pl.id} onClick={()=>addSongToPlaylist(pl.id,addToPlaylistSong.id)}
                style={{display:"block",width:"100%",background:"#282828",color:"#fff",borderRadius:8,padding:"13px",fontSize:15,marginBottom:8,textAlign:"left"}}>
                🎵 {pl.name} <span style={{color:"#727272",fontSize:12}}>({pl.songIds.length})</span>
              </Btn>
            ))}
            <Btn onClick={()=>setAddToPlaylistSong(null)} style={{...S.greenBtn,width:"100%",background:"#282828",color:"#fff",marginTop:4}}>Annuler</Btn>
          </div>
        </div>
      )}
      {/* Playlist cover editor */}
      {editingPlaylistCover && (
        <PlaylistImageEditor
          playlist={editingPlaylistCover}
          onUpdate={updates => {
            updatePlaylistCover(editingPlaylistCover.id, updates);
            setEditingPlaylistCover(prev => ({...prev,...updates}));
            if (activePlaylist?.id === editingPlaylistCover.id) {
              setActivePlaylist(prev => prev ? {...prev,...updates} : prev);
            }
          }}
          onClose={() => setEditingPlaylistCover(null)}
        />
      )}
    </div>
  );
}

// ─── Playlist Cover ──────────────────────────────────────────────────────────
function PlaylistCover({ playlist, size=56, onClick }) {
  const style = {
    width: size, height: size, borderRadius: 4, flexShrink: 0,
    display: "flex", alignItems: "center", justifyContent: "center",
    cursor: onClick ? "pointer" : "default", overflow: "hidden",
    background: playlist.coverColor || "#282828",
    fontSize: size * 0.4,
    position: "relative",
    minWidth: size, minHeight: size,
    maxWidth: size, maxHeight: size,
  };
  if (playlist.coverImage) {
    return <div style={style} onClick={onClick}>
      <img src={playlist.coverImage} alt="" style={{width:"100%",height:"100%",objectFit:"cover",position:"absolute",inset:0}}/>
    </div>;
  }
  return <div style={style} onClick={onClick}>
    {playlist.coverEmoji || "🎵"}
  </div>;
}

// ─── Playlist Image Editor ────────────────────────────────────────────────────
const COLORS = ["#282828","#1DB954","#E91429","#2D46B9","#E8115B","#FF6437","#8D67AB","#148A08","#F037A5","#BA5D07","#1e3264","#7358ff"];
const EMOJIS = ["🎵","🎸","🎤","🎹","🥁","🎷","🎺","🎻","🎧","🎶","🔥","💿","🎼","🌟","💜","🏆","🎭","🌈","⚡","🎪"];

function PlaylistImageEditor({ playlist, onUpdate, onClose }) {
  const [tab, setTab] = React.useState("color");
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:300,display:"flex",alignItems:"flex-end"}} onClick={onClose}>
      <div style={{background:"#282828",borderRadius:"16px 16px 0 0",width:"100%",padding:"20px 16px",paddingBottom:"max(20px,env(safe-area-inset-bottom))",maxHeight:"70dvh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
        <div style={{fontWeight:700,fontSize:18,color:"#fff",marginBottom:16,textAlign:"center"}}>Personnaliser la playlist</div>

        {/* Preview */}
        <div style={{display:"flex",justifyContent:"center",marginBottom:20}}>
          <PlaylistCover playlist={playlist} size={100}/>
        </div>

        {/* Tabs */}
        <div style={{display:"flex",gap:8,marginBottom:16}}>
          {[{id:"color",label:"🎨 Couleur"},
            {id:"emoji",label:"😊 Emoji"},
            {id:"photo",label:"📷 Photo"}
          ].map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{flex:1,background:tab===t.id?"#1DB954":"#181818",color:tab===t.id?"#000":"#fff",border:"none",borderRadius:20,padding:"8px 4px",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Color picker */}
        {tab==="color"&&(
          <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:8}}>
            {COLORS.map(color=>(
              <div key={color} onClick={()=>onUpdate({coverColor:color,coverImage:null})}
                style={{height:44,borderRadius:8,background:color,cursor:"pointer",border:playlist.coverColor===color?"3px solid #fff":"3px solid transparent",display:"flex",alignItems:"center",justifyContent:"center"}}>
                {playlist.coverColor===color&&<span style={{color:"#fff",fontSize:18}}>✓</span>}
              </div>
            ))}
          </div>
        )}

        {/* Emoji picker */}
        {tab==="emoji"&&(
          <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8}}>
            {EMOJIS.map(emoji=>(
              <div key={emoji} onClick={()=>onUpdate({coverEmoji:emoji})}
                style={{height:54,borderRadius:8,background:"#181818",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,border:playlist.coverEmoji===emoji?"2px solid #1DB954":"2px solid transparent"}}>
                {emoji}
              </div>
            ))}
          </div>
        )}

        {/* Photo picker */}
        {tab==="photo"&&(
          <div>
            <label style={{display:"block",background:"#1DB954",color:"#000",borderRadius:24,padding:"13px 20px",fontSize:15,fontWeight:700,cursor:"pointer",textAlign:"center",marginBottom:12}}>
              📷 Choisir depuis la galerie
              <input type="file" accept="image/*" style={{display:"none"}} onChange={e=>{
                const file = e.target.files&&e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = ev => {
                  onUpdate({coverImage: ev.target.result});
                };
                reader.readAsDataURL(file);
                e.target.value="";
              }}/>
            </label>
            {playlist.coverImage&&(
              <button onClick={()=>onUpdate({coverImage:null})} style={{display:"block",width:"100%",background:"#E91429",color:"#fff",borderRadius:24,padding:"12px",fontSize:14,fontWeight:700,cursor:"pointer",border:"none",fontFamily:"inherit"}}>
                🗑 Supprimer la photo
              </button>
            )}
          </div>
        )}

        <button onClick={onClose} style={{display:"block",width:"100%",background:"#181818",color:"#fff",borderRadius:24,padding:"12px",fontSize:15,fontWeight:600,cursor:"pointer",border:"none",fontFamily:"inherit",marginTop:16}}>
          Fermer
        </button>
      </div>
    </div>
  );
}

// ─── Track Row ────────────────────────────────────────────────────────────────
function TrackRow({ song, onPlay, onEdit, onAdd, onRemove, onDelete }) {
  const [dx, setDx] = useState(0);
  const startX = useRef(null);
  function ts(e) { startX.current=e.touches[0].clientX; }
  function tm(e) {
    if (startX.current==null) return;
    const d=e.touches[0].clientX-startX.current;
    setDx(d<0?Math.max(d,-72):Math.min(d,0));
  }
  function te() { setDx(dx<-36?-72:0); startX.current=null; }

  return (
    <div style={{position:"relative",marginBottom:2,overflow:"hidden"}}>
      <div style={{position:"absolute",right:0,top:0,bottom:0,background:"#e91429",display:"flex",alignItems:"center",justifyContent:"flex-end",paddingRight:20,minWidth:72,borderRadius:4,zIndex:0,overflow:"hidden"}}>
        <Btn onClick={onRemove||onDelete} style={{background:"transparent",color:"#fff",fontSize:20,padding:"8px"}}>🗑</Btn>
      </div>
      <div style={{...S.trackRow,transform:`translateX(${dx}px)`,transition:(dx===0||dx===-72)?"transform .2s ease":"none"}}
        onTouchStart={ts} onTouchMove={tm} onTouchEnd={te}>
        {song.thumbnail
          ?<img src={song.thumbnail} alt="" style={{width:44,height:44,objectFit:"cover",borderRadius:4,flexShrink:0}}/>
          :<div style={{width:44,height:44,background:"#282828",borderRadius:4,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>🎵</div>
        }
        <div style={{flex:1,minWidth:0}}>
          <div style={{color:"#fff",fontSize:15,fontWeight:500,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{song.title}</div>
          <div style={{color:"#727272",fontSize:13,marginTop:2,display:"flex",alignItems:"center",gap:6}}>
            {song.artist||<em style={{opacity:.5}}>Artiste inconnu</em>}
            {song.syncedLines&&<span style={{color:"#1DB954",fontSize:10}}>● SYNC</span>}
          </div>
        </div>
        <div style={{display:"flex",gap:4,flexShrink:0}}>
          {onAdd&&<Btn onClick={onAdd} style={{...S.iconSmall}}>➕</Btn>}
          {onEdit&&<Btn onClick={onEdit} style={{...S.iconSmall}}>✏️</Btn>}
          <Btn onClick={onPlay} style={{background:"transparent",color:"#727272",fontSize:20,padding:"8px",border:"none",cursor:"pointer"}}>▶</Btn>
        </div>
      </div>
    </div>
  );
}

function Btn({ onClick, style, children }) {
  return <button onClick={onClick} style={{border:"none",cursor:"pointer",fontFamily:"inherit",WebkitTapHighlightColor:"transparent",...style}}>{children}</button>;
}
function emptyForm() { return {title:"",artist:"",lyrics:"",syncedLines:null,fontSize:24,videoId:null,videoTitle:null,thumbnail:null}; }
// ─── Spotify styles ───────────────────────────────────────────────────────────
const SP = {
  bg:      "#121212",
  card:    "#181818",
  card2:   "#282828",
  green:   "#1DB954",
  white:   "#FFFFFF",
  gray1:   "#B3B3B3",
  gray2:   "#727272",
  gray3:   "#535353",
  gray4:   "#282828",
  red:     "#E91429",
};

const CSS = `
  *, *::before, *::after { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html, body { overflow: hidden; position: fixed; width: 100%; height: 100%; overscroll-behavior: none; margin: 0; background: ${SP.bg}; }
  input, textarea { -webkit-appearance: none; appearance: none; border-radius: 4px; border: none !important; outline: none !important; background: ${SP.card2}; color: #fff; box-shadow: none !important; }
  input:focus, textarea:focus { border: none !important; outline: none !important; }
  input::placeholder, textarea::placeholder { color: ${SP.gray3}; }
  @keyframes pulse { 0%,100%{opacity:.2} 50%{opacity:.8} }
  ::-webkit-scrollbar { display: none; }
`;

const S = {
  page:       { height:"100dvh", background:SP.bg, color:SP.white, fontFamily:"'Circular Std','Helvetica Neue',Helvetica,Arial,sans-serif", display:"flex", flexDirection:"column", overflow:"hidden", position:"relative" },
  header:     { display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 16px 12px", paddingTop:"max(16px,env(safe-area-inset-top))", flexShrink:0 },
  subHeader:  { display:"flex", alignItems:"center", gap:12, padding:"0 16px 14px", paddingTop:"max(16px,env(safe-area-inset-top))", flexShrink:0, overflow:"hidden", zIndex:10, background:"#121212" },
  backBtn:    { background:"transparent", color:SP.white, fontSize:22, padding:"8px 0" },
  subTitle:   { fontSize:18, fontWeight:700, color:SP.white },
  scrollBody: { flex:1, overflowY:"auto", padding:"0 16px", WebkitOverflowScrolling:"touch" },
  searchWrap: { display:"flex", alignItems:"center", background:SP.card2, borderRadius:4, padding:"0 12px", flexShrink:0 },
  searchInput:{ flex:1, background:"transparent", border:"none", outline:"none", color:SP.white, fontSize:15, padding:"12px 0", fontFamily:"inherit" },
  sectionTitle:{ fontSize:22, fontWeight:700, color:SP.white, marginBottom:14, marginTop:8 },
  quickCard:  { display:"flex", alignItems:"center", gap:10, background:SP.card2, borderRadius:4, padding:"8px 10px", overflow:"hidden", cursor:"pointer", textAlign:"left" },
  playlistRow:{ display:"flex", alignItems:"center", gap:14, padding:"8px 0", cursor:"pointer", width:"100%", background:"transparent", textAlign:"left" },
  trackRow:   { display:"flex", alignItems:"center", gap:12, padding:"8px 0", background:SP.bg, position:"relative", zIndex:1, willChange:"transform", userSelect:"none" },
  iconSmall:  { background:"transparent", color:SP.gray3, fontSize:16, padding:"8px 6px", border:"none", cursor:"pointer" },
  empty:      { textAlign:"center", padding:"60px 20px", color:SP.gray3, fontSize:15 },
  searchCard: { background:SP.card, borderRadius:8, padding:16, marginBottom:4 },
  cardLabel:  { fontSize:11, letterSpacing:"0.15em", color:SP.gray2, marginBottom:12 },
  spotLabel:  { display:"block", fontSize:11, letterSpacing:"0.12em", color:SP.gray2, marginBottom:6, marginTop:16 },
  spotInput:  { width:"100%", background:SP.card2, borderRadius:4, padding:"12px 14px", color:SP.white, fontSize:15, fontFamily:"inherit", display:"block" },
  greenBtn:   { background:SP.green, color:"#000", borderRadius:24, padding:"13px 20px", fontSize:15, fontWeight:700, cursor:"pointer", fontFamily:"inherit", border:"none" },
  pasteBtn:   { position:"absolute", top:10, right:10, background:SP.green, color:"#000", borderRadius:4, padding:"6px 10px", fontSize:12, fontWeight:700, border:"none", cursor:"pointer" },
  syncBadge:  { background:"#0a2e1a", border:"1px solid #1a4a2a", borderRadius:4, padding:"10px 14px", marginTop:8, fontSize:13, color:"#1DB954" },
  divider:    { textAlign:"center", color:SP.gray4, fontSize:12, margin:"16px 0 4px" },
  overlay:    { position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", display:"flex", alignItems:"flex-end", zIndex:200 },
  sheet:      { background:"#282828", borderRadius:"12px 12px 0 0", padding:"28px 20px", paddingBottom:"max(28px,env(safe-area-inset-bottom))", width:"100%", textAlign:"center", maxHeight:"80dvh", overflowY:"auto" },
  bottomNav:  { display:"flex", alignItems:"flex-end", padding:"8px 0", paddingBottom:"max(8px,env(safe-area-inset-bottom))", background:SP.bg, borderTop:"1px solid #282828", flexShrink:0 },
  singWrap:   { position:"fixed", inset:0, background:SP.bg, display:"flex", flexDirection:"column", fontFamily:"'Circular Std','Helvetica Neue',sans-serif", userSelect:"none" },
  singBar:    { display:"flex", alignItems:"center", gap:8, padding:"8px 12px", paddingTop:"max(10px,env(safe-area-inset-top))", background:"rgba(18,18,18,0.95)", backdropFilter:"blur(20px)", WebkitBackdropFilter:"blur(20px)", borderBottom:"1px solid #282828", flexShrink:0, zIndex:10, minHeight:58 },
  singBack:   { background:"transparent", color:SP.gray2, fontSize:18, padding:"8px", border:"none", cursor:"pointer" },
  singTitle:  { fontSize:13, fontWeight:700, color:SP.white, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" },
  singArtist: { fontSize:11, color:SP.gray3, marginTop:1 },
  singIcon:   { background:SP.card2, color:SP.gray2, borderRadius:8, padding:"8px 10px", fontSize:13, flexShrink:0, whiteSpace:"nowrap", border:"none", cursor:"pointer" },
  singPlay:   { borderRadius:24, width:46, height:46, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, border:"none", cursor:"pointer" },
  ytWrap:     { flexShrink:0, background:"#000", overflow:"hidden", transition:"height .3s ease" },
  timerRow:   { display:"flex", alignItems:"center", justifyContent:"center", padding:"4px 16px", flexShrink:0, minHeight:24 },
  lyricsScroll:{ flex:1, overflowY:"auto", position:"relative", WebkitOverflowScrolling:"touch" },
  fadeTop:    { position:"sticky", top:0, height:70, background:`linear-gradient(to bottom,${SP.bg} 30%,transparent)`, zIndex:2, pointerEvents:"none", marginBottom:-70 },
  fadeBot:    { position:"sticky", bottom:0, height:120, background:`linear-gradient(to top,${SP.bg} 40%,transparent)`, zIndex:2, pointerEvents:"none", marginTop:-120 },
};
