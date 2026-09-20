import type { Metadata } from "next";
import "./globals.css";
export const metadata:Metadata={title:"Follow-through | Client Follow-up Board",description:"Client commitments and follow-ups requiring action.",robots:{index:false,follow:false}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>;}
