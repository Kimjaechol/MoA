import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    const supabase = getServiceSupabase();

    // Single post with comments
    if (id) {
      const { data: post, error: postError } = await supabase
        .from("moa_community_posts")
        .select("*")
        .eq("id", id)
        .single();

      if (postError || !post) {
        return NextResponse.json(
          { error: "Post not found" },
          { status: 404 }
        );
      }

      const { data: comments, error: commentsError } = await supabase
        .from("moa_community_comments")
        .select("id, nickname, content, created_at")
        .eq("post_id", id)
        .order("created_at", { ascending: true });

      if (commentsError) {
        return NextResponse.json(
          { error: "Failed to fetch comments" },
          { status: 500 }
        );
      }

      return NextResponse.json({
        post: {
          id: post.id,
          nickname: post.nickname,
          email: post.email,
          title: post.title,
          content: post.content,
          likeCount: post.like_count,
          createdAt: post.created_at,
        },
        comments: (comments ?? []).map((c) => ({
          id: c.id,
          nickname: c.nickname,
          content: c.content,
          createdAt: c.created_at,
        })),
      });
    }

    // Paginated post list
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
    const limit = Math.min(
      50,
      Math.max(1, parseInt(searchParams.get("limit") ?? "10", 10))
    );
    const offset = (page - 1) * limit;

    // Get total count
    const { count, error: countError } = await supabase
      .from("moa_community_posts")
      .select("id", { count: "exact", head: true });

    if (countError) {
      return NextResponse.json(
        { error: "Failed to fetch posts" },
        { status: 500 }
      );
    }

    // Get posts with comment counts via a separate query
    const { data: posts, error: postsError } = await supabase
      .from("moa_community_posts")
      .select("id, nickname, title, content, like_count, created_at")
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (postsError) {
      return NextResponse.json(
        { error: "Failed to fetch posts" },
        { status: 500 }
      );
    }

    // Fetch comment counts for each post
    const postIds = (posts ?? []).map((p) => p.id);
    let commentCounts: Record<string, number> = {};

    if (postIds.length > 0) {
      const { data: commentData } = await supabase
        .from("moa_community_comments")
        .select("post_id")
        .in("post_id", postIds);

      if (commentData) {
        commentCounts = commentData.reduce(
          (acc: Record<string, number>, row) => {
            acc[row.post_id] = (acc[row.post_id] ?? 0) + 1;
            return acc;
          },
          {}
        );
      }
    }

    return NextResponse.json({
      posts: (posts ?? []).map((p) => ({
        id: p.id,
        nickname: p.nickname,
        title: p.title,
        content: p.content,
        likeCount: p.like_count,
        commentCount: commentCounts[p.id] ?? 0,
        createdAt: p.created_at,
      })),
      total: count ?? 0,
      page,
      limit,
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
    const { nickname, email, title, content } = body;

    if (!nickname || typeof nickname !== "string" || !nickname.trim() || nickname.trim().length > 50) {
      return NextResponse.json(
        { error: "닉네임은 1~50자 이내로 입력해주세요." },
        { status: 400 }
      );
    }

    if (!title || typeof title !== "string" || !title.trim() || title.trim().length > 200) {
      return NextResponse.json(
        { error: "제목은 1~200자 이내로 입력해주세요." },
        { status: 400 }
      );
    }

    if (!content || typeof content !== "string" || !content.trim() || content.trim().length > 10000) {
      return NextResponse.json(
        { error: "내용은 1~10,000자 이내로 입력해주세요." },
        { status: 400 }
      );
    }

    const supabase = getServiceSupabase();

    const { data, error } = await supabase
      .from("moa_community_posts")
      .insert({
        nickname: nickname.trim(),
        email: email?.trim() || null,
        title: title.trim(),
        content: content.trim(),
        like_count: 0,
      })
      .select("id")
      .single();

    if (error) {
      return NextResponse.json(
        { error: "Failed to create post" },
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
