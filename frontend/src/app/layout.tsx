import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SentiWatch — Brand Reputation Intelligence",
  description: "AI-powered reputation monitoring for African businesses.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
