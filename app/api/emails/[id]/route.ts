import { NextResponse } from "next/server";
import { deleteEmail } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: { id: string };
};

/** Permanently deletes one email row after dashboard confirmation. */
export async function DELETE(_request: Request, { params }: RouteContext) {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Email id must be a positive integer." }, { status: 400 });
  }

  try {
    await deleteEmail(id);
    return NextResponse.json({ success: true, id });
  } catch (error) {
    console.error(`Unable to delete email ${id}.`, error);
    if (error instanceof Error && error.message === `No email found with id ${id}`) {
      return NextResponse.json({ error: "Email not found." }, { status: 404 });
    }
    return NextResponse.json({ error: "Unable to delete email." }, { status: 500 });
  }
}
