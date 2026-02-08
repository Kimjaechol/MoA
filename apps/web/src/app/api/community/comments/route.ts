import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const postId = searchParams.get("postId");

    if (!postId) {
      return NextResponse.json(
        { error: "postId parameter is required" },
        { status: 400 }
      );
    }

    const supabase = getServiceSupabase();

    const { data, error } = await supabase
      .from("moa_community_comments")
      .select("id, nickname, content, created_at")
      .eq("post_id", postId)
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json(
        { error: "Failed to fetch comments" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      comments: (data ?? []).map((c) => ({
        id: c.id,
        nickname: c.nickname,
        content: c.content,
        createdAt: c.created_at,
      })),
    });
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
    const { postId, nickname, content } = body;

    if (!postId || typeof postId !== "string") {
      return NextResponse.json(
        { error: "postId is required" },
        { status: 400 }
      );
    }

    if (!nickname || typeof nickname !== "string" || !nickname.trim()) {
      return NextResponse.json(
        { error: "Nickname is required" },
        { status: 400 }
      );
    }

    if (!content || typeof content !== "string" || !content.trim()) {
      return NextResponse.json(
        { error: "Content is required" },
        { status: 400 }
      );
    }

    const supabase = getServiceSupabase();

    // Verify the post exists
    const { data: post, error: postError } = await supabase
      .from("moa_community_posts")
      .select("id")
      .eq("id", postId)
      .single();

    if (postError || !post) {
      return NextResponse.json(
        { error: "Post not found" },
        { status: 404 }
      );
    }

    const { data, error } = await supabase
      .from("moa_community_comments")
      .insert({
        post_id: postId,
        nickname: nickname.trim(),
        content: content.trim(),
      })
      .select("id, nickname, content, created_at")
      .single();

    if (error) {
      return NextResponse.json(
        { error: "Failed to create comment" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        comment: {
          id: data.id,
          nickname: data.nickname,
          content: data.content,
          createdAt: data.created_at,
        },
      },
      { status: 201 }
    );
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
