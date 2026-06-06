import { useState, useEffect, useRef } from "react";
import { ArrowLeft, Save, Key, Type, Sparkles, Link, Image, Trash2 } from "lucide-react";
import { Link as WouterLink } from "wouter";

const API_BASE = "/api";

export default function ConfigPage() {
  const [apiKey, setApiKey] = useState("");
  const [prompt, setPrompt] = useState("Anime style portrait");
  const [model, setModel] = useState("lucy-2.1");
  const [mirror, setMirror] = useState("auto");
  const [enhance, setEnhance] = useState(true);
  const [endpoint, setEndpoint] = useState("wss://api3.decart.ai/v1/stream");
  const [styleImage, setStyleImage] = useState("");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Load current config
    fetch(`${API_BASE}/decart/config`)
      .then((res) => res.json())
      .then((data) => {
        if (data.prompt) setPrompt(data.prompt);
        if (data.model) setModel(data.model);
        if (data.mirror) setMirror(data.mirror);
        if (data.enhance !== undefined) setEnhance(data.enhance);
        if (data.endpoint) setEndpoint(data.endpoint);
      })
      .catch(() => {});
    // Load style image separately
    fetch(`${API_BASE}/decart/style-image`)
      .then((res) => res.json())
      .then((data) => {
        if (data.styleImage) setStyleImage(data.styleImage);
      })
      .catch(() => {});
  }, []);

  const saveConfig = async () => {
    setLoading(true);
    try {
      await fetch(`${API_BASE}/decart/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey,
          prompt,
          model,
          mirror,
          enhance,
          endpoint,
        }),
      });
      await fetch(`${API_BASE}/decart/style-image`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ styleImage }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error("Error saving config:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      setStyleImage(base64);
    };
    reader.readAsDataURL(file);
  };

  const clearStyleImage = () => {
    setStyleImage("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div className="min-h-screen w-full bg-gray-950 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 bg-gray-900">
        <div className="flex items-center gap-2">
          <WouterLink href="/">
            <button className="p-2 text-gray-400 hover:text-white transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </button>
          </WouterLink>
          <h1 className="text-lg font-semibold text-white">Configuración</h1>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-4 max-w-2xl mx-auto w-full space-y-6">
        {/* Decart AI Section */}
        <div className="bg-gray-800 rounded-lg p-6 space-y-4">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="w-5 h-5 text-purple-400" />
            <h2 className="text-lg font-semibold text-white">Decart AI</h2>
          </div>

          <div className="space-y-2">
            <label className="text-sm text-gray-400 flex items-center gap-2">
              <Link className="w-4 h-4" />
              URL del Endpoint
            </label>
            <input
              type="text"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="wss://api3.decart.ai/v1/stream"
              className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg border border-gray-600 focus:border-purple-500 focus:outline-none"
            />
            <p className="text-xs text-gray-500">
              Si el endpoint cambia, puedes actualizarlo aquí. Ej: wss://api3.decart.ai/v1/stream
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm text-gray-400 flex items-center gap-2">
              <Key className="w-4 h-4" />
              API Key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Tu API key de Decart AI"
              className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg border border-gray-600 focus:border-purple-500 focus:outline-none"
            />
            <p className="text-xs text-gray-500">
              Obtén tu API key en https://decart.ai
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm text-gray-400 flex items-center gap-2">
              <Image className="w-4 h-4" />
              Imagen de estilo (Filtro)
            </label>
            <p className="text-xs text-gray-500">
              Sube una foto que define el estilo visual. Decart AI transformará tu video para parecerse a esta imagen.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg border border-gray-600 file:mr-4 file:py-1 file:px-2 file:rounded file:border-0 file:bg-purple-600 file:text-white file:text-sm hover:file:bg-purple-500"
            />
            {styleImage && (
              <div className="relative mt-2">
                <img
                  src={styleImage}
                  alt="Estilo de filtro"
                  className="w-32 h-32 object-cover rounded-lg border border-gray-600"
                />
                <button
                  onClick={clearStyleImage}
                  className="absolute top-1 right-1 bg-red-500 text-white p-1 rounded hover:bg-red-600"
                  title="Eliminar imagen"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
                <p className="text-xs text-gray-400 mt-1">Vista previa del filtro</p>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm text-gray-400 flex items-center gap-2">
              <Type className="w-4 h-4" />
              Prompt de filtro (opcional, alternativa a imagen)
            </label>
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Ej: Anime style portrait"
              className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg border border-gray-600 focus:border-purple-500 focus:outline-none"
            />
            <p className="text-xs text-gray-500">
              Si no usas imagen, describe cómo quieres que se vea el video
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm text-gray-400">Modelo</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg border border-gray-600 focus:border-purple-500 focus:outline-none"
            >
              <option value="lucy-2.1">Lucy 2.1</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm text-gray-400">Espejo</label>
            <select
              value={mirror}
              onChange={(e) => setMirror(e.target.value)}
              className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg border border-gray-600 focus:border-purple-500 focus:outline-none"
            >
              <option value="auto">Auto</option>
              <option value="true">Siempre</option>
              <option value="false">Nunca</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="enhance"
              checked={enhance}
              onChange={(e) => setEnhance(e.target.checked)}
              className="w-4 h-4 rounded border-gray-600"
            />
            <label htmlFor="enhance" className="text-sm text-gray-400">
              Mejorar calidad (enhance)
            </label>
          </div>
        </div>

        {/* Save Button */}
        <button
          onClick={saveConfig}
          disabled={loading}
          className="w-full bg-purple-600 text-white font-semibold py-3 px-4 rounded-lg hover:bg-purple-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <Save className="w-5 h-5" />
          {loading ? "Guardando..." : saved ? "¡Guardado!" : "Guardar configuración"}
        </button>

        {/* Info */}
        <div className="bg-gray-800 rounded-lg p-4 text-sm text-gray-400">
          <h3 className="font-semibold text-gray-300 mb-2">Sobre Decart AI</h3>
          <p className="mb-2">
            Decart AI proporciona filtros de video en tiempo real usando inteligencia artificial.
          </p>
          <p className="mb-2">
            Costo: 2 créditos por segundo de procesamiento.
          </p>
          <p>
            Visita <a href="https://decart.ai" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:underline">decart.ai</a> para obtener tu API key y créditos.
          </p>
        </div>
      </div>
    </div>
  );
}
