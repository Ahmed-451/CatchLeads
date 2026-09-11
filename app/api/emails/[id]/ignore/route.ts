import { NextResponse } from "next/server";
import { getEmailById, updateEmailStatus } from "@/lib/db";

export const runtime = "nodejs";

type RouteContext = {
  params: { id: string };
};

/** Marks an email as ignored so it is excluded from future action. */
export function POST(_request: Request, { params }: RouteContext) {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Email id must be a positive integer." }, { status: 400 });
  }

  try {
    const email = getEmailById(id);
    if (!email) {
      return NextResponse.json({ error: "Email not found." }, { status: 404 });
    }
    if (email.status !== "pending_approval") {
      return NextResponse.json(
        { error: "Only emails pending approval can be ignored." },
        { status: 400 },
      );
    }

    return NextResponse.json(updateEmailStatus(id, "ignored"));
  } catch (error) {
    console.error(`Unable to ignore email ${id}.`, error);
    return NextResponse.json({ error: "Email not found." }, { status: 404 });
  }
}
