import { useState, useEffect, useRef } from "react";
import { Camera, PhoneOff, Loader2, ArrowLeft, Mic, MicOff, RotateCcw } from "lucide-react";
import { Link } from "wouter";
import { models } from "@decartai/sdk";

const API_BASE = "/api";
const LUCY_MODEL = models.realtime("lucy-2.1");

// Model target resolution for best results with Decart AI
const VIDEO_WIDTH = LUCY_MODEL.width;   // 1088
const VIDEO_HEIGHT = LUCY_MODEL.height; // 624
const VIDEO_FPS = typeof LUCY_MODEL.fps === "object"
  ? (LUCY_MODEL.fps.ideal ?? 30)
  : LUCY_MODEL.fps;

export default function MobileSender() {
  const [inputRoomId, setInputRoomId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Iniciando cámara...");
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [isMuted, setIsMuted] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const iceCandidatesRef = useRef<RTCIceCandidate[]>([]);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const icePollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-start camera on mount with Lucy's optimal resolution
  useEffect(() => {
    startCameraPreview("user");
    return () => stopAll();
  }, []);

  const startCameraPreview = async (mode: "user" | "environment") => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: mode,
          width: { ideal: VIDEO_WIDTH },
          height: { ideal: VIDEO_HEIGHT },
          frameRate: { ideal: VIDEO_FPS, max: VIDEO_FPS },
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 48000,
          sampleSize: 16,
        },
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCameraReady(true);
      setStatus(`Cámara lista · ${VIDEO_WIDTH}×${VIDEO_HEIGHT}@${VIDEO_FPS}fps`);
    } catch (err: unknown) {
      setError("No se pudo acceder a la cámara: " + (err as Error).message);
      setStatus("Error de cámara");
    }
  };

  const switchCamera = async () => {
    const newMode = facingMode === "user" ? "environment" : "user";
    setFacingMode(newMode);
    try {
      const oldStream = streamRef.current;
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: newMode,
          width: { ideal: VIDEO_WIDTH },
          height: { ideal: VIDEO_HEIGHT },
          frameRate: { ideal: VIDEO_FPS, max: VIDEO_FPS },
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 48000,
          sampleSize: 16,
        },
      });
      streamRef.current = newStream;
      if (videoRef.current) videoRef.current.srcObject = newStream;

      // If connected via WebRTC, replace tracks live
      if (pcRef.current) {
        const senders = pcRef.current.getSenders();
        const vTrack = newStream.getVideoTracks()[0];
        const aTrack = newStream.getAudioTracks()[0];
        const vSender = senders.find((s) => s.track?.kind === "video");
        const aSender = senders.find((s) => s.track?.kind === "audio");
        if (vSender && vTrack) await vSender.replaceTrack(vTrack);
        if (aSender && aTrack) await aSender.replaceTrack(aTrack);
      }

      if (oldStream) oldStream.getTracks().forEach((t) => t.stop());
    } catch {
      setError("No se pudo cambiar de cámara");
    }
  };

  const startConnection = async () => {
    const targetRoomId = inputRoomId.trim();
    if (!targetRoomId) { setError("Escribe el ID de sala del PC"); return; }
    if (!streamRef.current) { setError("La cámara no está lista"); return; }

    setIsConnecting(true);
    setError("");
    setStatus("Verificando sala del PC...");
    setRoomId(targetRoomId);
    iceCandidatesRef.current = [];

    try {
      const roomCheck = await fetch(`${API_BASE}/signaling/rooms/${targetRoomId}`);
      if (!roomCheck.ok) {
        setError("Sala no encontrada. Asegúrate de que el PC tocó 'Iniciar PC' primero.");
        setIsConnecting(false);
        return;
      }

      const stream = streamRef.current;

      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ],
      });
      pcRef.current = pc;

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        if (state === "connected") {
          setIsConnected(true);
          setIsConnecting(false);
          setStatus("✅ Conectado — transmitiendo al PC en tiempo real");
        } else if (state === "failed" || state === "disconnected") {
          setIsConnected(false);
          setStatus("Conexión perdida");
        }
      };

      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      // ── Audio priority: prefer Opus codec BEFORE creating the offer ──
      // This tells WebRTC to negotiate Opus first in the SDP, giving audio
      // the best codec and leaving video with the remaining bandwidth.
      const audioTransceiver = pc.getTransceivers().find(
        (t) => t.sender.track?.kind === "audio"
      );
      if (audioTransceiver && typeof RTCRtpSender.getCapabilities === "function") {
        try {
          const caps = RTCRtpSender.getCapabilities("audio");
          if (caps) {
            const opus = caps.codecs.filter(
              (c) => c.mimeType.toLowerCase() === "audio/opus"
            );
            const rest = caps.codecs.filter(
              (c) => c.mimeType.toLowerCase() !== "audio/opus"
            );
            audioTransceiver.setCodecPreferences([...opus, ...rest]);
          }
        } catch { /* not supported on all browsers */ }
      }

      pc.onicecandidate = (event) => {
        if (event.candidate) iceCandidatesRef.current.push(event.candidate);
      };

      setStatus("Preparando oferta WebRTC...");
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // ── Audio priority: set high network priority on audio sender ──
      // Done after setLocalDescription so encoding params are available.
      const audioSender = pc.getSenders().find((s) => s.track?.kind === "audio");
      if (audioSender) {
        try {
          const params = audioSender.getParameters();
          if (!params.encodings || params.encodings.length === 0) {
            params.encodings = [{}];
          }
          // High network priority means the browser sends audio packets
          // before video packets when bandwidth is constrained.
          (params.encodings[0] as RTCRtpEncodingParameters & { networkPriority?: string }).networkPriority = "high";
          params.encodings[0].priority = "high";
          // 128 kbps minimum for clear voice; Opus default is ~32 kbps
          params.encodings[0].maxBitrate = 128_000;
          await audioSender.setParameters(params);
        } catch { /* ignore — not all browsers support setParameters before connection */ }
      }

      // ── Video: cap bitrate so audio always has bandwidth headroom ──
      const videoSender = pc.getSenders().find((s) => s.track?.kind === "video");
      if (videoSender) {
        try {
          const params = videoSender.getParameters();
          if (!params.encodings || params.encodings.length === 0) {
            params.encodings = [{}];
          }
          params.encodings[0].maxBitrate = 2_500_000; // 2.5 Mbps max video
          await videoSender.setParameters(params);
        } catch { /* ignore */ }
      }

      // Wait for ICE gathering
      await new Promise((r) => setTimeout(r, 2000));

      setStatus("Enviando señal al PC...");
      await fetch(`${API_BASE}/signaling/rooms/${targetRoomId}/offer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "offer", sdp: pc.localDescription?.sdp }),
      });

      for (const c of iceCandidatesRef.current) {
        await fetch(`${API_BASE}/signaling/rooms/${targetRoomId}/ice`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            candidate: c.candidate, sdpMid: c.sdpMid,
            sdpMLineIndex: c.sdpMLineIndex, source: "mobile",
          }),
        });
      }

      setStatus("Esperando respuesta del PC...");

      const pollAnswer = async () => {
        try {
          const r = await fetch(`${API_BASE}/signaling/rooms/${targetRoomId}/answer`);
          if (!r.ok) return;
          const d = await r.json();
          if (d.success && d.type === "answer") {
            await pc.setRemoteDescription(new RTCSessionDescription(d));

            // Re-apply audio priority after full negotiation — this is the
            // point where setParameters reliably sticks on all browsers.
            const aSender = pc.getSenders().find((s) => s.track?.kind === "audio");
            if (aSender) {
              try {
                const p = aSender.getParameters();
                if (!p.encodings || p.encodings.length === 0) p.encodings = [{}];
                (p.encodings[0] as RTCRtpEncodingParameters & { networkPriority?: string }).networkPriority = "high";
                p.encodings[0].priority = "high";
                p.encodings[0].maxBitrate = 128_000;
                await aSender.setParameters(p);
              } catch { /* ignore */ }
            }

            setIsConnected(true);
            setIsConnecting(false);
            setStatus("✅ Conectado — transmitiendo al PC en tiempo real");
            if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
          }
        } catch { /* ignore */ }
      };

      pollingRef.current = setInterval(pollAnswer, 2000);
      pollAnswer();

      const pollIce = async () => {
        try {
          const r = await fetch(`${API_BASE}/signaling/rooms/${targetRoomId}/ice/pc`);
          if (!r.ok) return;
          const d = await r.json();
          for (const c of d.candidates) {
            try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch { /* ignore */ }
          }
        } catch { /* ignore */ }
      };
      icePollingRef.current = setInterval(pollIce, 3000);

    } catch (err: unknown) {
      setError((err as Error).message || "Error de conexión");
      setIsConnecting(false);
      setStatus("Error");
    }
  };

  const disconnect = () => {
    pcRef.current?.close(); pcRef.current = null;
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
    if (icePollingRef.current) { clearInterval(icePollingRef.current); icePollingRef.current = null; }
    setIsConnected(false);
    setIsConnecting(false);
    setRoomId("");
    setStatus(`Cámara lista · ${VIDEO_WIDTH}×${VIDEO_HEIGHT}@${VIDEO_FPS}fps`);
    // Keep camera preview
    if (streamRef.current && videoRef.current) videoRef.current.srcObject = streamRef.current;
  };

  const stopAll = () => {
    pcRef.current?.close(); pcRef.current = null;
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
    if (icePollingRef.current) { clearInterval(icePollingRef.current); icePollingRef.current = null; }
    setIsConnected(false); setIsConnecting(false);
    setRoomId(""); setCameraReady(false);
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  const toggleMute = () => {
    if (streamRef.current) {
      streamRef.current.getAudioTracks().forEach((t) => { t.enabled = isMuted; });
      setIsMuted(!isMuted);
    }
  };

  return (
    <div className="min-h-screen w-full bg-black flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-3 bg-gray-900 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <Link href="/">
            <button className="text-gray-500 hover:text-gray-300 transition-colors mr-1">
              <ArrowLeft className="w-4 h-4" />
            </button>
          </Link>
          <Camera className="w-5 h-5 text-green-400" />
          <h1 className="text-base font-bold text-white">Panel Móvil</h1>
        </div>
        <div className="flex items-center gap-2">
          {isConnected && (
            <span className="text-xs bg-green-600 text-white px-2 py-0.5 rounded-full flex items-center gap-1">
              <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
              Transmitiendo
            </span>
          )}
        </div>
      </div>

      {/* Camera preview */}
      <div className="relative flex-1 bg-black" style={{ minHeight: "52vh" }}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover"
          style={{ minHeight: "52vh" }}
        />

        {!cameraReady && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <Loader2 className="w-8 h-8 animate-spin text-green-400 mx-auto mb-2" />
              <p className="text-sm text-gray-400">Iniciando cámara...</p>
            </div>
          </div>
        )}

        {/* Camera controls */}
        {cameraReady && (
          <div className="absolute top-3 right-3 flex gap-2">
            <button
              onClick={switchCamera}
              className="bg-black/60 backdrop-blur text-white p-2.5 rounded-full hover:bg-black/80 transition-colors"
              title="Cambiar cámara"
            >
              <RotateCcw className="w-5 h-5" />
            </button>
            <button
              onClick={toggleMute}
              className={`backdrop-blur text-white p-2.5 rounded-full transition-colors ${
                isMuted ? "bg-red-600/80 hover:bg-red-700/80" : "bg-black/60 hover:bg-black/80"
              }`}
              title={isMuted ? "Activar micro" : "Silenciar micro"}
            >
              {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>
          </div>
        )}

        {/* Badges */}
        {isConnected && (
          <div className="absolute top-3 left-3 bg-green-600/80 backdrop-blur text-white text-xs px-2.5 py-1 rounded-full flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
            En vivo → PC
          </div>
        )}

        {isConnecting && (
          <div className="absolute bottom-3 left-0 right-0 flex justify-center">
            <div className="bg-black/80 backdrop-blur text-white text-sm px-4 py-2 rounded-full flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              {status}
            </div>
          </div>
        )}

        {/* Resolution badge */}
        {cameraReady && (
          <div className="absolute bottom-3 right-3 bg-black/60 text-gray-400 text-xs px-2 py-1 rounded-lg">
            {VIDEO_WIDTH}×{VIDEO_HEIGHT} · {VIDEO_FPS}fps
          </div>
        )}
      </div>

      {/* Bottom controls */}
      <div className="bg-gray-900 border-t border-gray-800 p-4 space-y-3">

        <p className="text-xs text-gray-500 text-center">{status}</p>

        {/* Room ID input */}
        {!isConnected && !isConnecting && (
          <div className="space-y-2">
            <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">
              ID de Sala del PC
            </label>
            <input
              type="text"
              value={inputRoomId}
              onChange={(e) => setInputRoomId(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && startConnection()}
              placeholder="Ej: abc123 (del panel PC)"
              className="w-full bg-gray-800 text-white px-4 py-3 rounded-xl border border-gray-700 focus:border-green-500 focus:outline-none font-mono text-xl tracking-widest text-center"
            />
            <p className="text-xs text-gray-600 text-center">
              Este ID aparece en el panel PC al tocar "Iniciar PC"
            </p>
          </div>
        )}

        {/* Action buttons */}
        {!isConnected && !isConnecting && (
          <button
            onClick={startConnection}
            disabled={!cameraReady}
            className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:text-gray-500 text-white font-bold py-4 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 text-lg"
          >
            <Camera className="w-6 h-6" />
            📡 Conectar y transmitir al PC
          </button>
        )}

        {isConnecting && (
          <button
            onClick={disconnect}
            className="w-full bg-yellow-700 hover:bg-yellow-800 text-white font-bold py-4 px-4 rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            <PhoneOff className="w-5 h-5" />
            Cancelar
          </button>
        )}

        {isConnected && (
          <button
            onClick={disconnect}
            className="w-full bg-red-700 hover:bg-red-800 text-white font-bold py-4 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 text-lg"
          >
            <PhoneOff className="w-6 h-6" />
            ⛔ Desconectar del PC
          </button>
        )}

        {error && (
          <div className="bg-red-900/40 text-red-300 text-xs p-3 rounded-lg text-center">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
