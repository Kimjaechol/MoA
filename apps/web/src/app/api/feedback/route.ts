import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const email = searchParams.get("email");
    const isAdmin = searchParams.get("admin") === "true";
    const adminSecret = request.headers.get("x-admin-secret");

    const supabase = getServiceSupabase();

    // Admin mode: return all entries if secret matches
    if (isAdmin) {
      if (!process.env.ADMIN_SECRET || adminSecret !== process.env.ADMIN_SECRET) {
        return NextResponse.json(
          { error: "Unauthorized" },
          { status: 401 }
        );
      }

      const { data, error } = await supabase
        .from("moa_feedback")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        return NextResponse.json(
          { error: "Failed to fetch feedback" },
          { status: 500 }
        );
      }

      return NextResponse.json({ entries: data });
    }

    // User mode: return entries matching email
    if (!email) {
      return NextResponse.json(
        { error: "Email parameter is required" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("moa_feedback")
      .select("id, type, content, status, created_at")
      .eq("email", email)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json(
        { error: "Failed to fetch feedback" },
        { status: 500 }
      );
    }

    return NextResponse.json({ entries: data });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, email, content, userAgent } = body;

    if (!content || typeof content !== "string" || !content.trim()) {
      return NextResponse.json(
        { error: "Content is required" },
        { status: 400 }
      );
    }

    const validTypes = ["bug", "feature", "other"];
    if (!type || !validTypes.includes(type)) {
      return NextResponse.json(
        { error: "Invalid feedback type" },
        { status: 400 }
      );
    }

    const supabase = getServiceSupabase();

    const { data, error } = await supabase
      .from("moa_feedback")
      .insert({
        type,
        email: email || null,
        content: content.trim(),
        user_agent: userAgent || null,
        status: "pending",
      })
      .select("id")
      .single();

    if (error) {
      return NextResponse.json(
        { error: "Failed to submit feedback" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { success: true, id: data.id },
      { status: 201 }
    );
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
