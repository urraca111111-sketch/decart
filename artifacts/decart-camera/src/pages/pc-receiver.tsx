import { useState, useEffect, useRef, useCallback } from "react";
import {
  Monitor, Settings, Maximize2, Minimize2, Loader2, PhoneOff,
  Image, Sparkles, CheckCircle, AlertCircle, ArrowLeft,
  Eye, EyeOff, Upload, Trash2, RefreshCw, Video,
  Code2, Zap
} from "lucide-react";
import { Link } from "wouter";
import { createDecartClient, models } from "@decartai/sdk";
import type { RealTimeClient } from "@decartai/sdk";

const API_BASE = "/api";
const LUCY_MODEL = models.realtime("lucy-2.1");

type SdkMode = "typescript" | "python";
type DecartPhase = "idle" | "connecting" | "active" | "error";

export default function PcReceiver() {
  // ── WebRTC state ──
  const [roomId, setRoomId] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [rtcStatus, setRtcStatus] = useState("Listo para iniciar");
  const [rtcError, setRtcError] = useState("");

  // ── Decart AI state ──
  const [sdkMode, setSdkMode] = useState<SdkMode>("typescript");
  const [decartPhase, setDecartPhase] = useState<DecartPhase>("idle");
  const [decartMsg, setDecartMsg] = useState("");
  const [pythonJobId, setPythonJobId] = useState("");

  // ── View state ──
  const [showFiltered, setShowFiltered] = useState(true);
  const [hasFilteredStream, setHasFilteredStream] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [batchImageUrl, setBatchImageUrl] = useState("");

  // ── Config state ──
  const [showConfig, setShowConfig] = useState(true);
  const [apiKey, setApiKey] = useState("");
  const [prompt, setPrompt] = useState("Anime style portrait, soft colors");
  const [styleImage, setStyleImage] = useState("");
  const [configSaved, setConfigSaved] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);

  // ── Refs ──
  const rawVideoRef = useRef<HTMLVideoElement>(null);
  const filteredVideoRef = useRef<HTMLVideoElement>(null);
  const bridgeCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const decartRef = useRef<RealTimeClient | null>(null);
  const bridgeRafRef = useRef<number | null>(null);
  const bridgeStreamRef = useRef<MediaStream | null>(null);
  const pythonIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const iceCandidatesRef = useRef<RTCIceCandidate[]>([]);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const icePollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const styleFileRef = useRef<HTMLInputElement>(null);

  // ── Load saved config ──
  useEffect(() => {
    fetch(`${API_BASE}/decart/config`)
      .then(r => r.json())
      .then((d: { prompt?: string; apiKey?: string }) => {
        if (d.prompt) setPrompt(d.prompt);
        if (d.apiKey && d.apiKey !== "***") setApiKey(d.apiKey);
      })
      .catch(() => {});
    fetch(`${API_BASE}/decart/style-image`)
      .then(r => r.json())
      .then((d: { styleImage?: string }) => { if (d.styleImage) setStyleImage(d.styleImage); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => { document.removeEventListener("fullscreenchange", onFs); stopAll(); };
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) containerRef.current?.requestFullscreen();
    else document.exitFullscreen();
  };

  const saveConfig = async () => {
    await fetch(`${API_BASE}/decart/config`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey, prompt }),
    });
    await fetch(`${API_BASE}/decart/style-image`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ styleImage }),
    });
    setConfigSaved(true);
    setTimeout(() => setConfigSaved(false), 2500);
  };

  // ── Canvas bridge ──
  // Browsers block forwarding a remote WebRTC track to another WebRTC connection.
  // Solution: draw received video to hidden canvas → canvas.captureStream() → local MediaStream → SDK
  // NOTE: We deliberately do NOT add audio tracks to the Decart bridge stream.
  // Decart only processes video; passing audio causes latency and potential feedback loops.
  // Audio is played exclusively through rawVideoRef (the received WebRTC video element).
  const startCanvasBridge = useCallback((videoEl: HTMLVideoElement): MediaStream | null => {
    const canvas = bridgeCanvasRef.current;
    if (!canvas) return null;
    if (bridgeRafRef.current) cancelAnimationFrame(bridgeRafRef.current);

    const draw = () => {
      if (videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
        if (canvas.width !== videoEl.videoWidth) canvas.width = videoEl.videoWidth;
        if (canvas.height !== videoEl.videoHeight) canvas.height = videoEl.videoHeight;
        const ctx = canvas.getContext("2d");
        if (ctx) ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
      }
      bridgeRafRef.current = requestAnimationFrame(draw);
    };
    bridgeRafRef.current = requestAnimationFrame(draw);

    // Video-only stream to Decart — no audio
    const localStream = canvas.captureStream(30);
    bridgeStreamRef.current = localStream;
    return localStream;
  }, []);

  const stopCanvasBridge = () => {
    if (bridgeRafRef.current) { cancelAnimationFrame(bridgeRafRef.current); bridgeRafRef.current = null; }
    if (pythonIntervalRef.current) { clearInterval(pythonIntervalRef.current); pythonIntervalRef.current = null; }
    bridgeStreamRef.current = null;
  };

  // ── TypeScript SDK: connect real-time ──
  const connectDecartTS = useCallback(async (localStream: MediaStream) => {
    if (!apiKey.trim()) {
      setDecartMsg("⚠️ Ingresa tu API Key y guarda la configuración primero");
      setDecartPhase("error");
      return;
    }
    if (decartRef.current) { decartRef.current.disconnect(); decartRef.current = null; }
    setDecartPhase("connecting");
    setDecartMsg("Conectando con Decart AI — Lucy 2.1 (WebRTC)...");

    try {
      const client = createDecartClient({ apiKey: apiKey.trim() });
      const rt = await client.realtime.connect(localStream, {
        model: LUCY_MODEL,
        mirror: "auto",
        initialState: styleImage
          ? { image: styleImage }
          : prompt
          ? { prompt: { text: prompt, enhance: true } }
          : undefined,
        onRemoteStream: (edited) => {
          if (filteredVideoRef.current) {
            filteredVideoRef.current.srcObject = edited;
            filteredVideoRef.current.muted = true;
          }
          setHasFilteredStream(true);
          setDecartPhase("active");
          setDecartMsg("✅ Filtro en tiempo real activo · 30fps · Lucy 2.1");
        },
        onConnectionChange: (state) => {
          if (state === "connected") {
            setDecartMsg("🔗 Conectado con Decart AI — esperando primer frame filtrado...");
          }
          if (state === "generating") {
            setDecartPhase("active");
            setDecartMsg("🎨 Generando filtro en tiempo real...");
          }
          if (state === "disconnected") {
            setDecartPhase("idle");
            setHasFilteredStream(false);
            setDecartMsg("Decart desconectado");
          }
          if (state === "reconnecting") {
            setDecartPhase("connecting");
            setDecartMsg("🔄 Reconectando con Decart AI...");
          }
        },
      });
      decartRef.current = rt;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setDecartPhase("error");
      setDecartMsg(`❌ Error Decart AI: ${msg}`);
    }
  }, [apiKey, prompt, styleImage]);

  // ── Python/Server batch: capture frame → server → Decart queue API ──
  const startPythonBatch = useCallback((videoEl: HTMLVideoElement) => {
    if (!apiKey.trim()) {
      setDecartMsg("⚠️ Ingresa tu API Key y guarda la configuración primero");
      setDecartPhase("error");
      return;
    }
    setDecartPhase("active");
    setDecartMsg("Modo Python/Servidor · Enviando frames al servidor cada 5s...");

    const processFrame = async () => {
      const canvas = bridgeCanvasRef.current;
      if (!canvas || videoEl.readyState < 2 || videoEl.videoWidth === 0) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      canvas.width = videoEl.videoWidth;
      canvas.height = videoEl.videoHeight;
      ctx.drawImage(videoEl, 0, 0);
      const frame = canvas.toDataURL("image/jpeg", 0.85);

      try {
        setDecartMsg("🐍 Python mode · enviando frame al servidor Decart...");
        const res = await fetch(`${API_BASE}/decart/process-frame`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ frame, prompt, apiKey }),
        });
        const data = await res.json() as { status?: string; outputDataUrl?: string; jobId?: string; error?: string };
        if (data.status === "completed" && data.outputDataUrl) {
          setBatchImageUrl(data.outputDataUrl);
          setPythonJobId(data.jobId ?? "");
          setDecartMsg(`✅ Frame procesado (job: ${data.jobId?.slice(0, 8)})`);
        } else if (data.error) {
          setDecartMsg(`❌ Error servidor: ${data.error}`);
        }
      } catch (err: unknown) {
        setDecartMsg(`❌ ${err instanceof Error ? err.message : "Error de red"}`);
      }
    };

    processFrame();
    pythonIntervalRef.current = setInterval(processFrame, 5000);
  }, [apiKey, prompt]);

  // ── Universal: apply / re-apply filter based on selected mode ──
  const applyFilter = useCallback(async () => {
    if (!apiKey.trim()) {
      setDecartMsg("⚠️ Ingresa y guarda tu API Key primero");
      setDecartPhase("error");
      return;
    }
    const stream = bridgeStreamRef.current;
    const video = rawVideoRef.current;

    if (!stream || !video) {
      setDecartMsg("⚠️ Espera a que el celular se conecte y envíe video primero");
      return;
    }

    if (sdkMode === "typescript") {
      const rt = decartRef.current;
      // If already connected → just update the filter state
      if (rt && rt.isConnected()) {
        try {
          setDecartMsg("Actualizando filtro...");
          if (styleImage) {
            await rt.setImage(styleImage);
          } else {
            await rt.setPrompt(prompt, { enhance: true });
          }
          setDecartMsg("✅ Filtro actualizado");
        } catch (err: unknown) {
          setDecartMsg(`❌ ${err instanceof Error ? err.message : "Error actualizando"}`);
        }
        return;
      }
      await connectDecartTS(stream);
    } else {
      // Python mode
      if (pythonIntervalRef.current) clearInterval(pythonIntervalRef.current);
      startPythonBatch(video);
    }
  }, [apiKey, prompt, styleImage, sdkMode, connectDecartTS, startPythonBatch]);

  // ── WebRTC: start receiving from mobile ──
  const startReceiving = async () => {
    setIsConnecting(true);
    setRtcError("");
    setRtcStatus("Creando sala...");
    iceCandidatesRef.current = [];

    try {
      const res = await fetch(`${API_BASE}/signaling/rooms`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "PC" }),
      });
      const data = await res.json() as { id: string };
      const rid: string = data.id;
      setRoomId(rid);
      setRtcStatus("Sala lista — escribe el código en el celular");

      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
          { urls: "stun:stun2.l.google.com:19302" },
        ],
      });
      pcRef.current = pc;

      pc.onconnectionstatechange = () => {
        const s = pc.connectionState;
        if (s === "connected") { setIsConnected(true); setIsConnecting(false); setRtcStatus("✅ Móvil conectado"); }
        if (s === "failed" || s === "disconnected") {
          setIsConnected(false);
          setRtcStatus("Conexión perdida — detén y vuelve a intentar");
        }
      };

      // Single MediaStream that accumulates all tracks from the mobile peer
      // Adding tracks to a live MediaStream automatically starts audio/video playback
      const incomingStream = new MediaStream();
      let videoReady = false;

      pc.ontrack = (event) => {
        // Add every arriving track (audio or video) to the single stream
        incomingStream.addTrack(event.track);

        if (event.track.kind === "video" && !videoReady) {
          videoReady = true;
          setIsConnected(true);
          setIsConnecting(false);
          setRtcStatus("✅ Recibiendo video del móvil");

          // Assign the combined stream to rawVideoRef — audio plays here, nowhere else
          if (rawVideoRef.current) {
            rawVideoRef.current.srcObject = incomingStream;
            // Unmute: autoplay with audio is allowed since user already clicked a button
            rawVideoRef.current.muted = false;
            rawVideoRef.current.play().catch(() => {
              // Autoplay blocked — keep muted so browser allows it, then let user unmute
              if (rawVideoRef.current) rawVideoRef.current.muted = true;
            });
          }

          // Small delay so audio track can arrive and attach before the bridge starts
          setTimeout(async () => {
            const videoEl = rawVideoRef.current;
            if (!videoEl) return;

            // Video-only stream to Decart — audio plays exclusively through rawVideoRef
            const localStream = startCanvasBridge(videoEl);

            if (apiKey.trim()) {
              if (sdkMode === "typescript" && localStream) {
                await connectDecartTS(localStream);
              } else if (sdkMode === "python") {
                startPythonBatch(videoEl);
              }
            } else {
              setDecartMsg("⚠️ Video listo — ingresa tu API Key y pulsa 'Aplicar filtro IA'");
            }
          }, 500);
        }
      };

      pc.onicecandidate = (e) => { if (e.candidate) iceCandidatesRef.current.push(e.candidate); };

      const pollOffer = async () => {
        try {
          const r = await fetch(`${API_BASE}/signaling/rooms/${rid}/offer`);
          const d = await r.json() as { success?: boolean; type?: string; sdp?: string };
          if (d.success && d.type === "offer" && d.sdp) {
            setRtcStatus("Oferta del móvil recibida — conectando...");
            await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: d.sdp }));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await new Promise(r => setTimeout(r, 1500));
            await fetch(`${API_BASE}/signaling/rooms/${rid}/answer`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ type: "answer", sdp: pc.localDescription?.sdp }),
            });
            for (const c of iceCandidatesRef.current) {
              await fetch(`${API_BASE}/signaling/rooms/${rid}/ice`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex, source: "pc" }),
              });
            }
            if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
          }
        } catch { /* ignore polling errors */ }
      };

      const pollIce = async () => {
        try {
          const r = await fetch(`${API_BASE}/signaling/rooms/${rid}/ice/mobile`);
          const d = await r.json() as { candidates: RTCIceCandidateInit[] };
          for (const c of d.candidates) {
            try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch { /* ignore */ }
          }
        } catch { /* ignore */ }
      };

      pollingRef.current = setInterval(pollOffer, 2000);
      icePollingRef.current = setInterval(pollIce, 3000);
      pollOffer();
    } catch (err: unknown) {
      setRtcError(err instanceof Error ? err.message : "Error iniciando");
      setIsConnecting(false);
    }
  };

  const stopAll = () => {
    decartRef.current?.disconnect(); decartRef.current = null;
    pcRef.current?.close(); pcRef.current = null;
    stopCanvasBridge();
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
    if (icePollingRef.current) { clearInterval(icePollingRef.current); icePollingRef.current = null; }
    setIsConnected(false); setIsConnecting(false);
    setHasFilteredStream(false); setDecartPhase("idle"); setDecartMsg("");
    setRoomId(""); setRtcStatus("Listo para iniciar"); setRtcError("");
    setBatchImageUrl(""); setPythonJobId("");
    if (rawVideoRef.current) rawVideoRef.current.srcObject = null;
    if (filteredVideoRef.current) filteredVideoRef.current.srcObject = null;
  };

  const isDecartActive = decartPhase === "active";
  const isDecartBusy = decartPhase === "connecting";

  return (
    <div className="min-h-screen w-full bg-black flex flex-col">
      {/* Hidden elements — NOTE: audio plays through rawVideoRef, no separate <audio> needed */}
      <canvas ref={bridgeCanvasRef} className="hidden" />

      {/* ── Header ── */}
      {!isFullscreen && (
        <div className="flex items-center justify-between p-3 bg-gray-900 border-b border-gray-800 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Link href="/"><button className="text-gray-500 hover:text-gray-300 mr-1"><ArrowLeft className="w-4 h-4" /></button></Link>
            <Monitor className="w-5 h-5 text-blue-400" />
            <span className="text-base font-bold text-white">Panel PC</span>
          </div>
          <div className="flex items-center gap-2">
            {isDecartActive && (
              <span className="text-xs bg-purple-600 text-white px-2 py-0.5 rounded-full flex items-center gap-1">
                <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                {sdkMode === "python" ? "🐍 Python" : "⚡ TS"} · Filtro
              </span>
            )}
            {isConnected && (
              <span className="text-xs bg-green-600 text-white px-2 py-0.5 rounded-full flex items-center gap-1">
                <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />En vivo
              </span>
            )}
            <button onClick={() => setShowConfig(!showConfig)} className="p-1.5 text-gray-400 hover:text-white">
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ── Config Panel ── */}
      {showConfig && !isFullscreen && (
        <div className="bg-gray-900 border-b border-gray-800 p-4 space-y-4 overflow-y-auto flex-shrink-0" style={{ maxHeight: "55vh" }}>

          {/* SDK Mode selector */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Modo de Integración Decart AI</label>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setSdkMode("typescript")}
                className={`rounded-xl p-3 flex flex-col items-center gap-1.5 text-left border-2 transition-colors ${
                  sdkMode === "typescript"
                    ? "border-purple-500 bg-purple-950/40"
                    : "border-gray-700 bg-gray-800/50 hover:border-gray-600"
                }`}>
                <div className="flex items-center gap-1.5 w-full">
                  <Zap className={`w-4 h-4 ${sdkMode === "typescript" ? "text-purple-400" : "text-gray-500"}`} />
                  <span className={`text-sm font-bold ${sdkMode === "typescript" ? "text-purple-300" : "text-gray-400"}`}>TypeScript SDK</span>
                </div>
                <p className="text-xs text-gray-500 w-full">Real-time 30fps · WebRTC directo al navegador · @decartai/sdk</p>
                {sdkMode === "typescript" && <span className="text-xs text-purple-400 font-semibold w-full">✅ Seleccionado (recomendado para llamadas)</span>}
              </button>

              <button onClick={() => setSdkMode("python")}
                className={`rounded-xl p-3 flex flex-col items-center gap-1.5 text-left border-2 transition-colors ${
                  sdkMode === "python"
                    ? "border-green-500 bg-green-950/40"
                    : "border-gray-700 bg-gray-800/50 hover:border-gray-600"
                }`}>
                <div className="flex items-center gap-1.5 w-full">
                  <Code2 className={`w-4 h-4 ${sdkMode === "python" ? "text-green-400" : "text-gray-500"}`} />
                  <span className={`text-sm font-bold ${sdkMode === "python" ? "text-green-300" : "text-gray-400"}`}>Python / Servidor</span>
                </div>
                <p className="text-xs text-gray-500 w-full">Batch queue API · El servidor llama a Decart · ~5s por frame</p>
                {sdkMode === "python" && <span className="text-xs text-green-400 font-semibold w-full">✅ Seleccionado (modo batch)</span>}
              </button>
            </div>

            {/* Mode explanation */}
            {sdkMode === "python" && (
              <div className="bg-gray-800 rounded-lg p-3 text-xs text-gray-400 space-y-1 font-mono">
                <p className="text-green-400 font-bold text-xs">🐍 Equivalente Python (ejecutado en servidor):</p>
                <p className="text-gray-500">POST https://api.decart.ai/v1/queue/submit</p>
                <p className="text-gray-500">{"  "}model: lucy-pro-v2v</p>
                <p className="text-gray-500">{"  "}prompt: <span className="text-yellow-400">"{prompt || "tu prompt aquí"}"</span></p>
                <p className="text-gray-500">{"  "}data: frame.jpg (capturado del video)</p>
                <p className="text-gray-400 mt-1 font-sans">Nota: Batch API tiene ~5s latencia. Para llamadas en vivo, usa TypeScript SDK.</p>
              </div>
            )}
          </div>

          {/* Info box */}
          <div className="bg-blue-950/50 border border-blue-800/40 rounded-lg p-3 text-xs text-blue-200 space-y-1">
            <p className="font-semibold">📋 Pasos:</p>
            <p>1. Elige modo → ingresa API key → sube foto de filtro o escribe prompt → <strong>Guardar</strong></p>
            <p>2. Toca <strong>Iniciar PC</strong> → aparece código de <strong>3 letras</strong></p>
            <p>3. En el celular: <code className="bg-black/30 px-1 rounded">/mobile</code> → escribe el código → Conectar</p>
            <p>4. El filtro se aplica <strong>automáticamente</strong> si hay API key guardada</p>
          </div>

          {/* API Key */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">API Key de Decart AI *</label>
            <div className="relative">
              <input type={showApiKey ? "text" : "password"} value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="Pega tu API key aquí (platform.decart.ai)"
                className="w-full bg-gray-800 text-white px-3 py-2.5 pr-10 rounded-lg border border-gray-700 focus:border-purple-500 focus:outline-none text-sm" />
              <button onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-gray-600">Regístrate gratis en <span className="text-purple-400">platform.decart.ai</span> · 2 créditos/seg en tiempo real</p>
          </div>

          {/* Style image */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-1">
              <Image className="w-3.5 h-3.5" /> Foto de Referencia de Filtro
            </label>
            {styleImage ? (
              <div className="flex items-start gap-3 bg-gray-800 rounded-lg p-3">
                <img src={styleImage} alt="Filtro" className="w-20 h-20 object-cover rounded-lg border-2 border-purple-500 flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <p className="text-xs text-green-400 font-medium flex items-center gap-1"><CheckCircle className="w-3.5 h-3.5" /> Imagen de estilo cargada</p>
                  <p className="text-xs text-gray-500">El video adoptará el estilo visual de esta foto</p>
                  <div className="flex gap-2">
                    <button onClick={() => styleFileRef.current?.click()}
                      className="text-xs bg-gray-700 text-white px-2 py-1 rounded hover:bg-gray-600 flex items-center gap-1">
                      <Upload className="w-3 h-3" /> Cambiar
                    </button>
                    <button onClick={() => { setStyleImage(""); if (styleFileRef.current) styleFileRef.current.value = ""; }}
                      className="text-xs bg-red-900/60 text-red-300 px-2 py-1 rounded hover:bg-red-900 flex items-center gap-1">
                      <Trash2 className="w-3 h-3" /> Quitar
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <button onClick={() => styleFileRef.current?.click()}
                className="w-full border-2 border-dashed border-gray-700 hover:border-purple-500 rounded-lg p-4 flex flex-col items-center gap-2 transition-colors text-gray-500 hover:text-purple-400">
                <Upload className="w-5 h-5" />
                <span className="text-sm font-medium">Subir foto de referencia</span>
                <span className="text-xs text-center">PNG, JPG · El filtro imitará el estilo de esta imagen</span>
              </button>
            )}
            <input ref={styleFileRef} type="file" accept="image/*" className="hidden"
              onChange={e => {
                const f = e.target.files?.[0]; if (!f) return;
                const r = new FileReader();
                r.onload = () => setStyleImage(r.result as string);
                r.readAsDataURL(f);
              }} />
          </div>

          {/* Prompt */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Prompt (alternativa a foto)</label>
            <input type="text" value={prompt} onChange={e => setPrompt(e.target.value)}
              placeholder="Ej: Anime style, Oil painting, Cyberpunk..."
              className="w-full bg-gray-800 text-white px-3 py-2.5 rounded-lg border border-gray-700 focus:border-purple-500 focus:outline-none text-sm" />
            <p className="text-xs text-gray-600">Prompts de 20–30 palabras dan mejores resultados (según docs de Decart)</p>
          </div>

          {/* Save */}
          <button onClick={saveConfig}
            className={`w-full font-bold py-2.5 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 text-sm ${
              configSaved ? "bg-green-600 text-white" : "bg-purple-600 hover:bg-purple-700 text-white"
            }`}>
            <CheckCircle className="w-4 h-4" />
            {configSaved ? "✅ Guardado" : "Guardar configuración"}
          </button>

          {/* Room code — shown prominently when active */}
          {roomId && (
            <div className="bg-gray-800 rounded-xl p-4 text-center border-2 border-blue-600">
              <p className="text-xs text-gray-400 mb-1">📱 Código para el celular (/mobile):</p>
              <p className="text-5xl font-mono font-black text-white tracking-[0.4em] select-all">{roomId}</p>
              <p className="text-xs text-gray-500 mt-2">Solo 3 caracteres — escríbelo tal cual</p>
            </div>
          )}
        </div>
      )}

      {/* ── Video Area ── */}
      <div ref={containerRef} className="flex-1 relative bg-black overflow-hidden" style={{ minHeight: "220px" }}>
        {/* Raw stream (from mobile) — carries audio, never muted */}
        <video ref={rawVideoRef} autoPlay playsInline
          className={`w-full h-full object-contain absolute inset-0 transition-opacity ${
            (hasFilteredStream && showFiltered && sdkMode === "typescript") || (batchImageUrl && showFiltered && sdkMode === "python")
              ? "opacity-0" : "opacity-100"
          }`} />

        {/* TypeScript mode: filtered stream — always muted (audio comes from rawVideoRef) */}
        {sdkMode === "typescript" && (
          <video ref={filteredVideoRef} autoPlay playsInline muted
            className={`w-full h-full object-contain absolute inset-0 transition-opacity ${hasFilteredStream && showFiltered ? "opacity-100" : "opacity-0"}`} />
        )}

        {/* Python mode: batch result image */}
        {sdkMode === "python" && batchImageUrl && showFiltered && (
          <img src={batchImageUrl} alt="Resultado Decart" className="w-full h-full object-contain absolute inset-0" />
        )}

        {/* Empty state */}
        {!isConnected && !isConnecting && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <div className="text-center max-w-xs px-4">
              <Monitor className="w-14 h-14 text-gray-700 mx-auto mb-3" />
              <p className="text-gray-400 mb-1 font-semibold">Esperando video del móvil</p>
              <p className="text-gray-600 text-sm">Toca "Iniciar PC" y escribe el código en el celular</p>
              {roomId && (
                <div className="mt-4 bg-gray-800 rounded-xl p-4 border-2 border-blue-600">
                  <p className="text-xs text-gray-400 mb-1">Código:</p>
                  <p className="text-4xl font-mono font-black text-white tracking-[0.4em] select-all">{roomId}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Connecting overlay */}
        {isConnecting && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-10">
            <div className="text-center">
              <Loader2 className="w-10 h-10 animate-spin text-blue-400 mx-auto mb-3" />
              <p className="text-white mb-2">{rtcStatus}</p>
              {roomId && (
                <div className="bg-gray-800 rounded-xl px-8 py-4 border-2 border-blue-600">
                  <p className="text-xs text-gray-400 mb-1">Código para el celular:</p>
                  <p className="text-5xl font-mono font-black text-white tracking-[0.4em] select-all">{roomId}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Decart connecting overlay */}
        {isDecartBusy && isConnected && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10">
            <div className="bg-gray-900/95 rounded-xl p-6 text-center max-w-xs">
              <Sparkles className="w-8 h-8 text-purple-400 mx-auto mb-2 animate-pulse" />
              <p className="text-white text-sm font-semibold">Conectando Decart AI</p>
              <p className="text-gray-500 text-xs mt-1">Estableciendo sesión de filtro con Lucy 2.1...</p>
            </div>
          </div>
        )}

        {/* Toggle filtered/raw */}
        {isConnected && !isDecartBusy && (hasFilteredStream || batchImageUrl) && (
          <div className="absolute bottom-3 right-3 flex gap-2 z-10">
            <button onClick={() => setShowFiltered(!showFiltered)}
              className="bg-purple-600/80 backdrop-blur text-white px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5">
              {showFiltered ? <><Video className="w-3.5 h-3.5" /> Original</> : <><Sparkles className="w-3.5 h-3.5" /> Filtrado</>}
            </button>
            <button onClick={toggleFullscreen} className="bg-gray-800/80 backdrop-blur text-white p-2 rounded-lg">
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          </div>
        )}

        {/* Status badge top */}
        {isConnected && (
          <div className="absolute top-3 left-3 z-10">
            <div className="bg-black/70 text-white px-3 py-1.5 rounded-lg text-xs flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full animate-pulse ${isDecartActive ? "bg-purple-400" : "bg-green-400"}`} />
              {isDecartActive && showFiltered ? (sdkMode === "python" ? "🐍 Batch procesado" : "⚡ Filtro IA en vivo") : "📡 Video directo"}
            </div>
          </div>
        )}

        {/* Python job badge */}
        {pythonJobId && sdkMode === "python" && (
          <div className="absolute top-3 right-3 z-10">
            <div className="bg-green-900/80 text-green-300 px-2 py-1 rounded-lg text-xs">
              Job: {pythonJobId.slice(0, 8)}
            </div>
          </div>
        )}
      </div>

      {/* ── Footer Buttons ── */}
      {!isFullscreen && (
        <div className="bg-gray-900 border-t border-gray-800 p-4 space-y-2 flex-shrink-0">

          {/* Main action: Start / Stop */}
          {!isConnected && !isConnecting ? (
            <button onClick={startReceiving}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 text-base">
              <Monitor className="w-5 h-5" />
              📡 INICIAR PC — genera código de 3 letras para el celular
            </button>
          ) : (
            <button onClick={stopAll}
              className="w-full bg-red-700 hover:bg-red-800 text-white font-bold py-3 px-4 rounded-xl transition-colors flex items-center justify-center gap-2">
              <PhoneOff className="w-5 h-5" />
              {isConnecting
                ? `⏳ Esperando celular (código: ${roomId}) — Cancelar`
                : "⛔ Detener todo"}
            </button>
          )}

          {/* Filter button (only when connected) */}
          {isConnected && (
            <button onClick={applyFilter} disabled={isDecartBusy}
              className={`w-full font-bold py-3 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-50 ${
                isDecartActive
                  ? "bg-purple-700 hover:bg-purple-800 text-white"
                  : sdkMode === "python"
                  ? "bg-green-700 hover:bg-green-800 text-white"
                  : "bg-purple-600 hover:bg-purple-700 text-white"
              }`}>
              {isDecartBusy
                ? <><Loader2 className="w-5 h-5 animate-spin" /> Conectando Decart AI...</>
                : isDecartActive
                ? <><RefreshCw className="w-5 h-5" /> 🔄 Re-aplicar / actualizar filtro</>
                : sdkMode === "python"
                ? <><Code2 className="w-5 h-5" /> 🐍 APLICAR FILTRO · Modo Python/Servidor</>
                : <><Sparkles className="w-5 h-5" /> ⚡ APLICAR FILTRO · Modo TypeScript SDK</>}
            </button>
          )}

          {/* Fullscreen (when filter active) */}
          {isConnected && isDecartActive && (
            <button onClick={toggleFullscreen}
              className="w-full bg-gray-700 hover:bg-gray-600 text-white font-semibold py-2.5 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 text-sm">
              <Maximize2 className="w-4 h-4" />
              🖥️ Pantalla completa → captura con SplitCam → WhatsApp / Meet
            </button>
          )}

          {/* Status messages */}
          {decartMsg && (
            <div className={`text-xs text-center px-3 py-2 rounded-lg ${
              decartMsg.startsWith("❌") ? "bg-red-900/40 text-red-300" :
              decartMsg.startsWith("✅") ? "bg-green-900/40 text-green-300" :
              decartMsg.startsWith("⚠️") ? "bg-yellow-900/40 text-yellow-300" :
              "bg-gray-800 text-gray-400"
            }`}>{decartMsg}</div>
          )}

          {rtcError && (
            <div className="flex items-start gap-2 bg-red-900/40 text-red-300 p-3 rounded-lg text-xs">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />{rtcError}
            </div>
          )}

          {!rtcError && rtcStatus && (
            <p className="text-center text-xs text-gray-600">{rtcStatus}</p>
          )}
        </div>
      )}
    </div>
  );
}
