import type { Metadata } from "next";
import { Inter, Lora, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const lora = Lora({ variable: "--font-lora", subsets: ["latin"], display: "swap" });
const mono = JetBrains_Mono({ variable: "--font-mono-ui", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "Master — Inteligência Analítica",
  description: "Análise assistida com verificação de fontes e grau de confiança declarado.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className={`${inter.variable} ${lora.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-papel text-tinta">{children}</body>
    </html>
  );
}
