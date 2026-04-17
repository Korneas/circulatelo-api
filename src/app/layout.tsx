import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Circulatelo API",
  description: "Webflow Cloud API for Circulatelo",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}