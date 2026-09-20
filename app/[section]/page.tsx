import { Suspense } from "react";
import { notFound } from "next/navigation";
import Portal from "../portal";
const sections=["dashboard","follow-ups","my-day","calendar","clients","team","imports","reports","settings","notifications","audit","platform","security","login","register","forgot-password","reset-password","confirm","invite","privacy","terms"];
export default async function Page({params}:{params:Promise<{section:string}>}){const {section}=await params;if(!sections.includes(section))notFound();return <Suspense fallback={<main className="loading">Loading workspace…</main>}><Portal section={section}/></Suspense>;}
