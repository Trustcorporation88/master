"use client";

import { useEffect } from "react";

/**
 * Abre o diálogo de impressão sozinho.
 *
 * Quem clicou em "PDF" não quer ver a página: quer o arquivo. O atraso curto dá
 * tempo de a fonte e o realce de código assentarem — imprimir antes disso
 * produz um PDF com a fonte de fallback.
 */
export function AutoImprimir() {
  useEffect(() => {
    const t = setTimeout(() => window.print(), 600);
    return () => clearTimeout(t);
  }, []);

  return null;
}
