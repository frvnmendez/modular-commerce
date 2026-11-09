import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'Panel de tienda', description: 'Administra tu tienda online' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
