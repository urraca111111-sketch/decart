import { useLocation } from "wouter";
import { Smartphone, Monitor, Sparkles, Zap } from "lucide-react";

export default function Home() {
  const [, navigate] = useLocation();

  return (
    <div className="min-h-screen w-full bg-black flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-lg space-y-8">
        {/* Logo / Title */}
        <div className="text-center space-y-3">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Sparkles className="w-8 h-8 text-purple-400" />
            <h1 className="text-4xl font-bold text-white">Decart AI</h1>
          </div>
          <p className="text-gray-400 text-base">
            Filtros de IA en tiempo real para tus videollamadas
          </p>
          <div className="flex items-center justify-center gap-1 text-xs text-purple-400">
            <Zap className="w-3 h-3" />
            <span>Powered by Decart AI · Captura con SplitCam</span>
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-gray-800" />

        {/* Instructions */}
        <div className="bg-gray-900 rounded-xl p-4 space-y-2 text-sm text-gray-400">
          <p className="text-white font-semibold text-sm mb-3">¿Cómo funciona?</p>
          <div className="flex items-start gap-2">
            <span className="bg-purple-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0 mt-0.5">1</span>
            <p>Abre esta app en tu <strong className="text-white">PC</strong> y toca el botón <strong className="text-blue-400">PC</strong></p>
          </div>
          <div className="flex items-start gap-2">
            <span className="bg-purple-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0 mt-0.5">2</span>
            <p>En el PC: configura tu API key, sube la foto de filtro y toca <strong className="text-white">Iniciar PC</strong></p>
          </div>
          <div className="flex items-start gap-2">
            <span className="bg-purple-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0 mt-0.5">3</span>
            <p>Abre esta app en tu <strong className="text-white">celular</strong> y toca el botón <strong className="text-green-400">Móvil</strong></p>
          </div>
          <div className="flex items-start gap-2">
            <span className="bg-purple-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0 mt-0.5">4</span>
            <p>En el móvil: escribe el <strong className="text-white">ID de sala</strong> del PC y toca <strong className="text-white">Conectar</strong></p>
          </div>
          <div className="flex items-start gap-2">
            <span className="bg-purple-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0 mt-0.5">5</span>
            <p>El filtro se aplica automáticamente. Captura la ventana del PC con <strong className="text-white">SplitCam</strong></p>
          </div>
        </div>

        {/* Main buttons */}
        <div className="grid grid-cols-2 gap-4">
          {/* MÓVIL button */}
          <button
            onClick={() => navigate("/mobile")}
            className="group relative bg-gradient-to-br from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 text-white rounded-2xl p-6 flex flex-col items-center gap-3 transition-all duration-200 shadow-lg shadow-green-900/40 active:scale-95"
          >
            <div className="bg-green-500/30 rounded-full p-3 group-hover:bg-green-500/50 transition-colors">
              <Smartphone className="w-10 h-10" />
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold">MÓVIL</p>
              <p className="text-green-200 text-xs mt-1">Enviar cámara y audio al PC</p>
            </div>
          </button>

          {/* PC button */}
          <button
            onClick={() => navigate("/pc")}
            className="group relative bg-gradient-to-br from-blue-600 to-purple-700 hover:from-blue-500 hover:to-purple-600 text-white rounded-2xl p-6 flex flex-col items-center gap-3 transition-all duration-200 shadow-lg shadow-blue-900/40 active:scale-95"
          >
            <div className="bg-blue-500/30 rounded-full p-3 group-hover:bg-blue-500/50 transition-colors">
              <Monitor className="w-10 h-10" />
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold">PC</p>
              <p className="text-blue-200 text-xs mt-1">Recibir video y aplicar filtro IA</p>
            </div>
          </button>
        </div>

        <p className="text-center text-xs text-gray-600">
          Decart AI Camera · Para usar con SplitCam y WhatsApp
        </p>
      </div>
    </div>
  );
}
