import { NextResponse } from "next/server";
import { getAllEmails } from "@/lib/db";

export const runtime = "nodejs";

/** Returns persisted email rows, ordered newest-first by the database helper. */
export function GET() {
  try {
    return NextResponse.json(getAllEmails());
  } catch (error) {
    console.error("Unable to load emails.", error);
    return NextResponse.json({ error: "Unable to load emails." }, { status: 500 });
  }
}
