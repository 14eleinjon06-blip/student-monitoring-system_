import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Student Monitoring System | ID & Face Recognition",
  description: "Student attendance monitoring with ID scanning and browser-based face recognition.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
