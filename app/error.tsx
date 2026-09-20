"use client";
export default function ErrorPage({reset}:{reset:()=>void}){return <main className="legal"><h1>We could not load this page</h1><p>Your saved work remains in the database. Please retry.</p><button onClick={reset}>Try again</button></main>;}
