import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Alshy — Asyk Atu",
  description: "Асық ату · Асык ату · Asyk Atu — a Kazakh game of skill and precision.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: `try{var p=localStorage.getItem('alshy.theme');var t=p==='dark'||(p==='system'&&matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light';document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t;var l=localStorage.getItem('alshy.language');document.documentElement.lang=l==='kk'||l==='ru'||l==='en'?l:(navigator.language.toLowerCase().startsWith('kk')?'kk':navigator.language.toLowerCase().startsWith('ru')?'ru':'en')}catch(e){}` }} /></head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
