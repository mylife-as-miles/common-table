import type { Metadata } from "next";
import "../src/styles.css";
import "../src/cinematic.css";
export const metadata: Metadata = {
  title: "Common Table — A shared evening",
  description: "Find your common ground: explore restaurants on a living map, turn a tactile menu, gather your company and agree on a shared dinner plan.",
  icons: { icon: "/favicon.svg" },
};
export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  return <html lang="en"><body>{children}</body></html>;
}
