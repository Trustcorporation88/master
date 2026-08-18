"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Login() {
  const router = useRouter();
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    if (!senha.trim() || enviando) return;

    setEnviando(true);
    setErro(null);

    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ senha }),
      });
      const data = await res.json();

      if (data.ok) {
        router.replace("/");
        router.refresh();
      } else {
        setErro(data.error ?? "Não foi possível entrar.");
        setSenha("");
      }
    } catch {
      setErro("Falha de conexão. Tente novamente.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-16">
      <div className="surgir w-full max-w-sm">
        <div className="mb-9 text-center">
          <div className="mb-5 inline-flex size-11 items-center justify-center rounded-lg bg-marca">
            <span className="font-serif text-lg font-semibold text-white">M</span>
          </div>
          <h1 className="font-serif text-2xl font-semibold tracking-tight text-tinta">Master</h1>
          <p className="mt-1.5 text-[13px] text-tinta-clara">Inteligência analítica</p>
        </div>

        <form onSubmit={entrar} className="rounded-xl border border-linha bg-branco p-6 shadow-sm">
          <label htmlFor="senha" className="block text-[13px] font-medium text-tinta-media">
            Senha de acesso
          </label>
          <input
            id="senha"
            type="password"
            value={senha}
            autoFocus
            autoComplete="current-password"
            onChange={(e) => {
              setSenha(e.target.value);
              setErro(null);
            }}
            className="mt-2 w-full rounded-lg border border-linha-forte bg-papel px-3.5 py-2.5 text-sm text-tinta outline-none transition focus:border-marca focus:bg-branco focus:ring-2 focus:ring-marca/10"
          />

          {erro && <p className="mt-3 text-[12.5px] text-alerta">{erro}</p>}

          <button
            type="submit"
            disabled={!senha.trim() || enviando}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-marca px-4 py-2.5 text-sm font-medium text-white transition hover:bg-marca-clara disabled:cursor-not-allowed disabled:opacity-40"
          >
            {enviando && (
              <span className="girar size-3.5 rounded-full border-2 border-white/40 border-t-white" />
            )}
            {enviando ? "Verificando" : "Entrar"}
          </button>
        </form>

        <p className="mt-6 text-center text-[11px] text-tinta-clara">
          Acesso restrito · TrustCorp
        </p>
      </div>
    </main>
  );
}
